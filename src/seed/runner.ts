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
    private version: string; // NEW
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

    constructor(config: LoadedConfig, plan: SeedPlan, fixturesPath?: string, version: string = 'unknown', targetDate?: string) {
        this.version = version;
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
            this.allPats,
            targetDate
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
            version: this.version, // NEW
            runId: this.config.runId,
            org: this.config.org,
            startTime: new Date().toISOString(),
            endTime: '',
            repos: [],
            fatalFailure: null,
        };

        try {
            // Step 1: Preflight Policy Discovery
            await this.preflightPolicies();

            // Step 2: Resolve all identities (FATAL on failure)
            await this.resolveAllIdentities();

            // Step 3: Process each repo
            for (const plannedRepo of this.plan.repos) {
                const repoResult = await this.processRepo(plannedRepo);
                summary.repos.push(repoResult);
            }
        } catch (error) {
            summary.fatalFailure = {
                phase: 'execution',
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

    private async preflightPolicies(): Promise<void> {
        const projects = [...new Set(this.plan.repos.map(r => r.project))];
        console.log('🔍 Preflight: Checking for branch policies...');

        for (const project of projects) {
            try {
                const policies = await this.prManager.getPolicyConfigurations(project);
                const dangerousPolicies = policies.filter(p =>
                    p.isEnabled && !p.isDeleted &&
                    ['Minimum reviewer count', 'Required reviewers', 'Check for merge conflicts'].includes(p.type.displayName)
                );

                if (dangerousPolicies.length > 0) {
                    console.warn(`\n⚠️  [POLICY WARNING] Active branch policies detected in project '${project}':`);
                    for (const p of dangerousPolicies) {
                        console.warn(`   - ${p.type.displayName}`);
                    }
                    console.warn(`   These may block automated PR completion if criteria aren't met.\n`);
                }
            } catch (error) {
                console.warn(`⚠️  Failed to query policies for project '${project}': ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    private async processRepo(planned: PlannedRepo): Promise<RepoResult> {
        const result: RepoResult = {
            project: planned.project,
            repoName: planned.repoName,
            repoId: null,
            resolvedNaming: planned.resolvedNaming,
            branchesCreated: 0,
            prs: [],
            failures: [],
        };

        try {
            // Create/ensure repo exists
            const repoResult = await this.repoManager.ensureRepo(planned.project, planned.repoName, this.config.repoStrategy);
            if (!repoResult) {
                // Skipped or recorded warning elsewhere (though RepoResult needs to show it)
                return result;
            }
            const { repo, isNew } = repoResult;
            result.repoId = repo.id;

            // Generate and push git content (FATAL on failure)
            const branchSpecs: BranchSpec[] = planned.branches.map(b => ({
                name: b.name,
                commits: b.commits,
            }));

            // Step 2.5: Collision Guard (Fatal if any branch exists)
            // For now, we'll check via remote URL (simplest without cloning)
            // Actually, we'll just check if the branch exists on the remote later or now
            // But let's follow the plan: FATAL if collision
            // We can use git ls-remote to check for branches without cloning
            // But wait, the plan says: "Rerun Day2 with the SAME runId. Assert FATAL exit."
            // I'll implement this check in a simpler way if possible or just use git.

            const generated = await this.gitGenerator.createRepo(
                planned.repoName,
                branchSpecs,
                this.config.seed,
                this.config.runId
            );

            try {
                const primaryUser = this.config.resolvedUsers[0];

                // Step 2.5: Collision Guard (Fatal if any branch exists)
                const collisions = await this.gitGenerator.checkCollisions(
                    repo.remoteUrl,
                    primaryUser.pat,
                    generated.branches
                );

                if (collisions.length > 0) {
                    throw new Error(`FATAL: Collision detected on branches: ${collisions.join(', ')}. This runId has already been used for this repository.`);
                }

                // Skip pushing main for existing repos (accumulation mode)
                // New repos need main pushed; existing repos already have main
                await this.gitGenerator.pushToRemote(
                    generated.localPath,
                    repo.remoteUrl,
                    primaryUser.pat,
                    generated.branches,
                    !isNew // skipMainPush = true for existing repos
                );
                result.branchesCreated = generated.branches.length;

                // Process PRs (NON-FATAL on individual failures)
                // MUST happen inside try block to keep localPath alive for follow-up pushes
                for (const plannedPr of planned.prs) {
                    const prResult = await this.processPr(
                        planned.project,
                        repo, // Use repo object for remoteUrl access
                        plannedPr,
                        result.failures,
                        generated.localPath // Pass localPath for follow-up push
                    );
                    if (prResult) {
                        result.prs.push(prResult);
                    }
                }
            } finally {
                generated.cleanup();
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.failures.push({
                phase: 'repo-creation',
                error: errorMsg,
                isFatal: true,
            });

            // Re-throw if it's a FATAL error intended to stop the whole run
            if (errorMsg.includes('FATAL:')) {
                throw error;
            }
        }

        return result;
    }

    private async processPr(
        project: string,
        repo: any, // AdoRepo
        planned: PlannedPr,
        failures: FailureRecord[],
        localPath?: string
    ): Promise<PrResult | null> {
        const repoId = repo.id;
        const repoName = repo.name;
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
                followUpCommitsAdded: 0,
                outcome: planned.outcome,
                outcomeApplied: false,
            };

            // Publish draft if planned (90% of drafts get published before operations)
            let effectivelyDraft = planned.isDraft;
            if (planned.isDraft && planned.shouldPublishDraft) {
                try {
                    await this.prManager.publishDraft(project, repoId, pr.pullRequestId);
                    effectivelyDraft = false; // Now it's a regular PR
                } catch (error) {
                    // Publish failed - treat as lingering draft
                    failures.push({
                        phase: 'publish-draft',
                        prId: pr.pullRequestId,
                        error: error instanceof Error ? error.message : String(error),
                        isFatal: false,
                    });
                }
            }

            // Add reviewers (non-fatal) - skip for drafts since ADO rejects voting on drafts
            if (!effectivelyDraft) {
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
                        // Capture detailed ADO error response when available
                        const adoData = (error as { data?: unknown })?.data;
                        const errorDetail = adoData ? ` - ${JSON.stringify(adoData)}` : '';
                        failures.push({
                            phase: 'add-reviewer',
                            prId: pr.pullRequestId,
                            error: (error instanceof Error ? error.message : String(error)) + errorDetail,
                            isFatal: false,
                        });
                    }
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

            // Apply outcome (non-fatal) - skip for drafts since they can't be completed/abandoned
            try {
                if (effectivelyDraft) {
                    // Draft PRs cannot be completed or abandoned - leave them as-is
                    prResult.outcomeApplied = true; // Skip counts as "applied" for drafts
                } else if (planned.outcome === 'complete') {
                    // Robust completion with retry for 409
                    let retries = 0;
                    const maxPrRetries = 2;
                    let lastError: any = null;

                    while (retries <= maxPrRetries) {
                        try {
                            const prDetails = await this.prManager.getPrDetails(project, repoId, pr.pullRequestId);
                            await this.prManager.completePr(
                                project,
                                repoId,
                                pr.pullRequestId,
                                prDetails.lastMergeSourceCommit.commitId
                            );
                            prResult.outcomeApplied = true;
                            break;
                        } catch (error: any) {
                            lastError = error;
                            // Retry on 409 (Conflict) - usually means PR is being updated/merged
                            if (error.status === 409 && retries < maxPrRetries) {
                                retries++;
                                await new Promise(r => setTimeout(r, 2000));
                                continue;
                            }
                            throw error;
                        }
                    }
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

            // Push follow-up commits if planned (non-fatal)
            if (planned.followUpCommits > 0 && localPath) {
                try {
                    const primaryUser = this.config.resolvedUsers[0];
                    const followUp = await this.gitGenerator.pushFollowUpCommits(
                        localPath,
                        repo.remoteUrl,
                        planned.sourceBranch,
                        planned.followUpCommits,
                        primaryUser.pat,
                        this.config.seed,
                        this.config.runId,
                        repoName
                    );
                    prResult.followUpCommitsAdded = followUp.count;
                } catch (error) {
                    failures.push({
                        phase: 'push-followup',
                        prId: pr.pullRequestId,
                        error: error instanceof Error ? error.message : String(error),
                        isFatal: false,
                    });
                }
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
