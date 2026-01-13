import { LoadedConfig, ResolvedUser } from '../config.js';
import { createAdoClient, createIdentityClient } from '../ado/client.js';
import { IdentityResolver } from '../ado/identities.js';
import { RepoManager } from '../ado/repos.js';
import { PrManager } from '../ado/prs.js';
import { GitGenerator, BranchSpec } from '../git/generator.js';
import { SeedPlan, PlannedRepo, PlannedPr, voteToValue } from './planner.js';
import { SeedSummary, RepoResult, PrResult, FailureRecord } from './summary.js';
import { SeededRng } from '../util/rng.js';

/**
 * Executes the seeding plan against Azure DevOps.
 */
export class SeedRunner {
    private config: LoadedConfig;
    private plan: SeedPlan;
    private adoClient: ReturnType<typeof createAdoClient>;
    private identityClient: ReturnType<typeof createIdentityClient>;
    private identityResolver: IdentityResolver;
    private repoManager: RepoManager;
    private prManager: PrManager;
    private gitGenerator: GitGenerator;
    private allPats: string[];

    // Per-user clients for operations that need different auth
    private userClients: Map<string, ReturnType<typeof createAdoClient>> = new Map();

    constructor(config: LoadedConfig, plan: SeedPlan, fixturesPath?: string) {
        this.config = config;
        this.plan = plan;
        this.allPats = config.resolvedUsers.map(u => u.pat);

        // Primary client uses first user's PAT
        const primaryUser = config.resolvedUsers[0];
        this.adoClient = createAdoClient({
            org: config.org,
            pat: primaryUser.pat,
            allPats: this.allPats,
        });

        this.identityClient = createIdentityClient({
            org: config.org,
            pat: primaryUser.pat,
            allPats: this.allPats,
        });

        this.identityResolver = new IdentityResolver(this.identityClient, config.org);
        this.repoManager = new RepoManager(this.adoClient);
        this.prManager = new PrManager(this.adoClient);
        this.gitGenerator = new GitGenerator(
            new SeededRng(config.seed),
            fixturesPath,
            this.allPats
        );

        // Create per-user clients
        for (const user of config.resolvedUsers) {
            this.userClients.set(
                user.email,
                createAdoClient({ org: config.org, pat: user.pat, allPats: this.allPats })
            );
        }
    }


    /**
     * Runs the complete seeding process.
     */
    async run(): Promise<SeedSummary> {
        const summary: SeedSummary = {
            runId: this.plan.runId,
            org: this.plan.org,
            startTime: new Date().toISOString(),
            endTime: '',
            repos: [],
            fatalFailure: null,
        };

        try {
            // Step 1: Resolve all identities (FATAL on failure)
            await this.resolveAllIdentities();

            // Step 2: Process each repo
            for (const plannedRepo of this.plan.repos) {
                const repoResult = await this.processRepo(plannedRepo);
                summary.repos.push(repoResult);
            }
        } catch (error) {
            summary.fatalFailure = {
                phase: 'initialization',
                error: error instanceof Error ? error.message : String(error),
            };
        }

        summary.endTime = new Date().toISOString();
        return summary;
    }

    private async resolveAllIdentities(): Promise<void> {
        for (const user of this.config.resolvedUsers) {
            try {
                const identityId = await this.identityResolver.resolveWithBypass(user.email);
                user.identityId = identityId;
            } catch (error) {
                throw new Error(
                    `FATAL: Failed to resolve identity for ${user.email}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    private async processRepo(planned: PlannedRepo): Promise<RepoResult> {
        const result: RepoResult = {
            project: planned.project,
            repoName: planned.repoName,
            repoId: null,
            branchesCreated: 0,
            prs: [],
            failures: [],
        };

        try {
            // Create/ensure repo exists (FATAL on failure)
            const repo = await this.repoManager.ensureRepo(planned.project, planned.repoName);
            result.repoId = repo.id;

            // Generate and push git content (FATAL on failure)
            const branchSpecs: BranchSpec[] = planned.branches.map(b => ({
                name: b.name,
                commits: b.commits,
            }));

            const generated = await this.gitGenerator.createRepo(planned.repoName, branchSpecs);

            try {
                const primaryUser = this.config.resolvedUsers[0];
                await this.gitGenerator.pushToRemote(
                    generated.localPath,
                    repo.remoteUrl,
                    primaryUser.pat,
                    generated.branches
                );
                result.branchesCreated = generated.branches.length;
            } finally {
                generated.cleanup();
            }

            // Process PRs (NON-FATAL on individual failures)
            for (const plannedPr of planned.prs) {
                const prResult = await this.processPr(planned.project, repo.id, plannedPr, result.failures);
                if (prResult) {
                    result.prs.push(prResult);
                }
            }
        } catch (error) {
            result.failures.push({
                phase: 'repo-creation',
                error: error instanceof Error ? error.message : String(error),
                isFatal: true,
            });
        }

        return result;
    }

    private async processPr(
        project: string,
        repoId: string,
        planned: PlannedPr,
        failures: FailureRecord[]
    ): Promise<PrResult | null> {
        try {
            // Create PR
            const pr = await this.prManager.createPr({
                project,
                repoId,
                sourceBranch: planned.sourceBranch,
                targetBranch: 'main',
                title: planned.title,
                description: planned.description,
                isDraft: planned.isDraft,
            });

            const prResult: PrResult = {
                prId: pr.pullRequestId,
                title: planned.title,
                creator: planned.creatorEmail,
                reviewers: [],
                comments: 0,
                outcome: planned.outcome,
                outcomeApplied: false,
            };

            // Add reviewers (non-fatal)
            for (const reviewer of planned.reviewers) {
                try {
                    const user = this.config.resolvedUsers.find(u => u.email === reviewer.email);
                    if (user?.identityId) {
                        await this.prManager.addReviewer({
                            project,
                            repoId,
                            prId: pr.pullRequestId,
                            reviewerId: user.identityId,
                        });

                        // Cast vote using reviewer's client
                        const reviewerClient = this.userClients.get(reviewer.email);
                        if (reviewerClient) {
                            const reviewerPrManager = new PrManager(reviewerClient);
                            await reviewerPrManager.castVote({
                                project,
                                repoId,
                                prId: pr.pullRequestId,
                                reviewerId: user.identityId,
                                vote: voteToValue(reviewer.vote),
                            });
                        }

                        prResult.reviewers.push({ email: reviewer.email, vote: reviewer.vote });
                    }
                } catch (error) {
                    failures.push({
                        phase: 'add-reviewer',
                        prId: pr.pullRequestId,
                        error: error instanceof Error ? error.message : String(error),
                        isFatal: false,
                    });
                }
            }

            // Add comments (non-fatal)
            for (const comment of planned.comments) {
                try {
                    const commenterClient = this.userClients.get(comment.authorEmail);
                    if (commenterClient) {
                        const commenterPrManager = new PrManager(commenterClient);
                        await commenterPrManager.addComment({
                            project,
                            repoId,
                            prId: pr.pullRequestId,
                            content: comment.content,
                        });
                        prResult.comments++;
                    }
                } catch (error) {
                    failures.push({
                        phase: 'add-comment',
                        prId: pr.pullRequestId,
                        error: error instanceof Error ? error.message : String(error),
                        isFatal: false,
                    });
                }
            }

            // Apply outcome (non-fatal)
            try {
                if (planned.outcome === 'complete') {
                    // Need to get the latest commit SHA
                    // For now, we'll skip completion if we can't get it cleanly
                    // This would require additional API call to get PR details
                    prResult.outcomeApplied = false; // Mark as not applied for now
                } else if (planned.outcome === 'abandon') {
                    await this.prManager.abandonPr(project, repoId, pr.pullRequestId);
                    prResult.outcomeApplied = true;
                } else {
                    prResult.outcomeApplied = true; // leaveOpen is the default
                }
            } catch (error) {
                failures.push({
                    phase: 'apply-outcome',
                    prId: pr.pullRequestId,
                    error: error instanceof Error ? error.message : String(error),
                    isFatal: false,
                });
            }

            return prResult;
        } catch (error) {
            failures.push({
                phase: 'create-pr',
                error: error instanceof Error ? error.message : String(error),
                isFatal: false,
            });
            return null;
        }
    }
}
