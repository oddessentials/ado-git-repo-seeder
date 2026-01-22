import { LoadedConfig, ResolvedUser } from '../config.js';
import { createAdoClient, createIdentityClient } from '../ado/client.js';
import { IdentityResolver } from '../ado/identities.js';
import { RepoManager } from '../ado/repos.js';
import { PrManager, PullRequest } from '../ado/prs.js';
import { GitGenerator, BranchSpec } from '../git/generator.js';
import { SeedPlan, PlannedRepo, PlannedPr, voteToValue } from './planner.js';
import { SeedSummary, RepoResult, PrResult, FailureRecord } from './summary.js';
import { SeededRng } from '../util/rng.js';

export interface CleanupOptions {
    cleanupEnabled: boolean;
    cleanupThreshold: number;
}

/**
 * Executes the seeding plan against Azure DevOps.
 */
export class SeedRunner {
    private version: string;
    private config: LoadedConfig;
    private plan: SeedPlan;
    private adoClient: ReturnType<typeof createAdoClient>;
    private identityClient: ReturnType<typeof createIdentityClient>;
    private identityResolver: IdentityResolver;
    private repoManager: RepoManager;
    private prManager: PrManager;
    private gitGenerator: GitGenerator;
    private allPats: string[];
    private cleanupOptions: CleanupOptions;

    // Per-user clients for operations that need different auth
    private userClients: Map<string, ReturnType<typeof createAdoClient>> = new Map();

    constructor(
        config: LoadedConfig,
        plan: SeedPlan,
        fixturesPath?: string,
        version: string = 'unknown',
        targetDate?: string,
        cleanupOptions: CleanupOptions = { cleanupEnabled: true, cleanupThreshold: 50 }
    ) {
        this.version = version;
        this.config = config;
        this.plan = plan;
        this.allPats = config.resolvedUsers.map((u) => u.pat);
        this.cleanupOptions = cleanupOptions;

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
        this.gitGenerator = new GitGenerator(new SeededRng(config.seed), fixturesPath, this.allPats, targetDate);

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
            version: this.version,
            runId: this.config.runId,
            org: this.config.org,
            startTime: new Date().toISOString(),
            endTime: '',
            repos: [],
            fatalFailure: null,
            cleanupMode: false,
            cleanupStats: undefined,
        };

        try {
            // Step 1: Preflight Policy Discovery
            await this.preflightPolicies();

            // Step 2: Resolve all identities (FATAL on failure)
            await this.resolveAllIdentities();

            // Step 3: Check if cleanup mode should be triggered
            if (this.cleanupOptions.cleanupEnabled) {
                const openPrCount = await this.countOpenPrs();
                console.log(`📊 Open PR count across repos: ${openPrCount}`);

                if (openPrCount > this.cleanupOptions.cleanupThreshold) {
                    console.log(
                        `🧹 Cleanup mode triggered (${openPrCount} > ${this.cleanupOptions.cleanupThreshold} threshold)\n`
                    );
                    summary.cleanupMode = true;
                    const cleanupStats = await this.runCleanupMode(openPrCount - this.cleanupOptions.cleanupThreshold);
                    summary.cleanupStats = cleanupStats;
                    summary.endTime = new Date().toISOString();
                    return summary;
                } else {
                    console.log(`✅ Below threshold, proceeding with normal seeding\n`);
                }
            }

            // Step 4: Process each repo (normal seeding mode)
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

    /**
     * Counts total open PRs across all configured repos.
     */
    private async countOpenPrs(): Promise<number> {
        let total = 0;
        for (const project of this.config.projects) {
            for (const repoConfig of project.repos) {
                const repoName = typeof repoConfig === 'string' ? repoConfig : repoConfig.name;
                try {
                    const repo = await this.repoManager.getRepo(project.name, repoName);
                    if (repo) {
                        const openPrs = await this.prManager.listOpenPrs(project.name, repo.id);
                        total += openPrs.length;
                    }
                } catch {
                    // Repo might not exist yet, skip
                }
            }
        }
        return total;
    }

    /**
     * Runs cleanup mode: publishes drafts and completes/abandons oldest open PRs.
     */
    private async runCleanupMode(targetCount: number): Promise<{
        draftsPublished: number;
        prsCompleted: number;
        prsFailed: number;
        openPrsBefore?: number;
        openPrsAfter?: number;
        completionTarget?: number;
    }> {
        const stats: {
            draftsPublished: number;
            prsCompleted: number;
            prsFailed: number;
            completionTarget?: number;
            openPrsBefore?: number;
            openPrsAfter?: number;
        } = {
            draftsPublished: 0,
            prsCompleted: 0,
            prsFailed: 0,
            completionTarget: targetCount,
        };

        // Collect all open PRs with project/repo context
        interface OpenPrInfo {
            project: string;
            repoId: string;
            repoName: string;
            remoteUrl: string;
            pr: PullRequest;
            createdDate: Date;
        }

        const allOpenPrs: OpenPrInfo[] = [];

        for (const project of this.config.projects) {
            for (const repoConfig of project.repos) {
                const repoName = typeof repoConfig === 'string' ? repoConfig : repoConfig.name;
                try {
                    const repo = await this.repoManager.getRepo(project.name, repoName);
                    if (repo) {
                        const openPrs = await this.prManager.listOpenPrs(project.name, repo.id);
                        for (const pr of openPrs) {
                            allOpenPrs.push({
                                project: project.name,
                                repoId: repo.id,
                                repoName,
                                remoteUrl: repo.remoteUrl,
                                pr,
                                createdDate: new Date((pr as any).creationDate || 0),
                            });
                        }
                    }
                } catch {
                    // Skip repos that don't exist
                }
            }
        }

        // Sort by creation date (oldest first)
        allOpenPrs.sort((a, b) => a.createdDate.getTime() - b.createdDate.getTime());

        stats.openPrsBefore = allOpenPrs.length;
        console.log(`   Found ${allOpenPrs.length} open PRs, targeting ${targetCount} for completion\n`);

        // Process oldest PRs first
        const primaryUser = this.config.resolvedUsers[0];

        for (const { project, repoId, remoteUrl, pr } of allOpenPrs) {
            if (stats.prsCompleted >= targetCount) {
                break;
            }
            const prTitle = pr.title.length > 50 ? pr.title.slice(0, 47) + '...' : pr.title;

            try {
                // Check if it's a draft and publish it
                if ((pr as any).isDraft) {
                    console.log(`   📝 Publishing draft PR #${pr.pullRequestId}: ${prTitle}`);
                    await this.prManager.publishDraft(project, repoId, pr.pullRequestId);
                    stats.draftsPublished++;
                    // Note: After publishing, we'll complete it on the next cleanup run
                    continue;
                }

                // Extract source branch from refs/heads/<branch>
                const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
                const targetBranch = pr.targetRefName.replace('refs/heads/', '');

                console.log(`   ✅ Completing PR #${pr.pullRequestId}: ${prTitle}`);

                // Use conflict resolution helper for robust completion
                const completed = await this.completePrWithConflictResolution(
                    project,
                    repoId,
                    pr.pullRequestId,
                    sourceBranch,
                    remoteUrl,
                    primaryUser.pat,
                    targetBranch
                );

                if (completed) {
                    stats.prsCompleted++;
                } else {
                    stats.prsFailed++;
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.log(`   ❌ Failed PR #${pr.pullRequestId}: ${errorMsg}`);
                stats.prsFailed++;
            }
        }

        stats.openPrsAfter = await this.countOpenPrs();
        console.log(
            `\n   📊 Cleanup summary: ${stats.prsCompleted} completed, ${stats.draftsPublished} drafts published, ${stats.prsFailed} failed`
        );
        return stats;
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
        const projects = [...new Set(this.plan.repos.map((r) => r.project))];
        console.log('🔍 Preflight: Checking for branch policies...');

        for (const project of projects) {
            try {
                const policies = await this.prManager.getPolicyConfigurations(project);
                const dangerousPolicies = policies.filter(
                    (p) =>
                        p.isEnabled &&
                        !p.isDeleted &&
                        ['Minimum reviewer count', 'Required reviewers', 'Check for merge conflicts'].includes(
                            p.type.displayName
                        )
                );

                if (dangerousPolicies.length > 0) {
                    console.warn(`\n⚠️  [POLICY WARNING] Active branch policies detected in project '${project}':`);
                    for (const p of dangerousPolicies) {
                        console.warn(`   - ${p.type.displayName}`);
                    }
                    console.warn(`   These may block automated PR completion if criteria aren't met.\n`);
                }
            } catch (error) {
                console.warn(
                    `⚠️  Failed to query policies for project '${project}': ${error instanceof Error ? error.message : String(error)}`
                );
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
            const repoResult = await this.repoManager.ensureRepo(
                planned.project,
                planned.repoName,
                this.config.repoStrategy
            );
            if (!repoResult) {
                // Skipped or recorded warning elsewhere (though RepoResult needs to show it)
                return result;
            }
            const { repo, isNew } = repoResult;
            result.repoId = repo.id;

            // Generate and push git content (FATAL on failure)
            const branchSpecs: BranchSpec[] = planned.branches.map((b) => ({
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
                    throw new Error(
                        `FATAL: Collision detected on branches: ${collisions.join(', ')}. This runId has already been used for this repository.`
                    );
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
                        const user = this.config.resolvedUsers.find((u) => u.email === reviewer.email);
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
                    // Robust completion with conflict auto-resolution and retry for 409
                    const primaryUser = this.config.resolvedUsers[0];
                    const completed = await this.completePrWithConflictResolution(
                        project,
                        repoId,
                        pr.pullRequestId,
                        planned.sourceBranch,
                        repo.remoteUrl,
                        primaryUser.pat
                    );
                    prResult.outcomeApplied = completed;
                    if (!completed) {
                        failures.push({
                            phase: 'apply-outcome',
                            prId: pr.pullRequestId,
                            error: 'Failed to complete PR after conflict resolution attempts',
                            isFatal: false,
                        });
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

    /**
     * Waits for ADO to evaluate merge status (not 'notSet' or 'queued').
     * Polls with exponential backoff up to maxWaitMs.
     *
     * @returns PR details with evaluated merge status, or null if timeout
     */
    private async waitForMergeStatusEvaluation(
        project: string,
        repoId: string,
        prId: number,
        maxWaitMs: number = 30000
    ): Promise<Awaited<ReturnType<PrManager['getPrDetails']>> | null> {
        const pollIntervalMs = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            const prDetails = await this.prManager.getPrDetails(project, repoId, prId);

            // Check if merge status has been evaluated (not pending)
            const status = prDetails.mergeStatus;
            if (status && status !== 'notSet' && status !== 'queued') {
                return prDetails;
            }

            console.log(`   ⏳ PR #${prId} merge status is '${status ?? 'undefined'}', waiting for evaluation...`);
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        console.log(`   ⚠️  PR #${prId} merge status evaluation timed out after ${maxWaitMs}ms`);
        return null;
    }

    /**
     * Waits for ADO to mark the PR as completed after a completion request.
     *
     * @returns true when status is 'completed', false on timeout
     */
    private async waitForCompletion(
        project: string,
        repoId: string,
        prId: number,
        maxWaitMs: number = 15000
    ): Promise<boolean> {
        const pollIntervalMs = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            const prDetails = await this.prManager.getPrDetails(project, repoId, prId);
            if (prDetails.status === 'completed') {
                return true;
            }
            console.log(`   ⏳ PR #${prId} status is '${prDetails.status}', waiting for completion...`);
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        console.log(`   ⚠️  PR #${prId} completion verification timed out after ${maxWaitMs}ms`);
        return false;
    }

    /**
     * Attempts to complete a PR with automatic conflict resolution.
     *
     * IMPORTANT: Only resolves conflicts when mergeStatus is explicitly 'conflicts'.
     * For other statuses (notSet, queued, undefined), we try completion directly -
     * ADO will reject if not ready, and we'll retry. This avoids unnecessary
     * force-pushes that invalidate ADO's merge evaluation.
     *
     * Flow:
     * 1. Get PR details (with short wait for evaluation if needed)
     * 2. If mergeStatus is 'conflicts' or 'failure', resolve by merging target into source
     * 3. Try completion with bypassPolicy enabled
     * 4. On failure, retry with backoff
     *
     * @returns true if PR was completed successfully
     */
    private async completePrWithConflictResolution(
        project: string,
        repoId: string,
        prId: number,
        sourceBranch: string,
        remoteUrl: string,
        pat: string,
        targetBranch: string = 'main'
    ): Promise<boolean> {
        const maxRetries = 3;
        let conflictResolutionAttempted = false;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Step 1: Get PR details, with a short wait for merge status if this is first attempt
                let prDetails = await this.prManager.getPrDetails(project, repoId, prId);

                // On first attempt, give ADO a moment to evaluate merge status if it's pending
                if (
                    attempt === 0 &&
                    (!prDetails.mergeStatus || prDetails.mergeStatus === 'notSet' || prDetails.mergeStatus === 'queued')
                ) {
                    const evaluated = await this.waitForMergeStatusEvaluation(project, repoId, prId, 10000);
                    if (evaluated) {
                        prDetails = evaluated;
                    }
                }

                const mergeStatus = prDetails.mergeStatus;

                // Step 2: ONLY resolve conflicts when explicitly reported as 'conflicts' or 'failure'
                // Do NOT resolve for: notSet, queued, undefined, succeeded
                // This prevents unnecessary force-pushes that break the completion flow
                const needsResolution =
                    (mergeStatus === 'conflicts' || mergeStatus === 'failure') && !conflictResolutionAttempted;

                if (needsResolution) {
                    const statusLabel = mergeStatus ?? 'unknown';
                    console.log(`   ⚠️  PR #${prId} merge status is '${statusLabel}', auto-resolving...`);

                    // Resolve conflicts by merging target into source with -X ours
                    const resolution = await this.gitGenerator.resolveConflicts(
                        remoteUrl,
                        pat,
                        sourceBranch,
                        targetBranch
                    );

                    if (!resolution.resolved) {
                        console.log(`   ❌ Conflict resolution failed for PR #${prId}: ${resolution.error}`);
                        // Don't set conflictResolutionAttempted - allow retry on next attempt
                        // This handles transient failures (network errors, etc.)
                        // Continue to try completion anyway - bypassPolicy might help
                    } else {
                        console.log(`   ✅ Conflicts resolved for PR #${prId}`);
                        // Only mark as attempted when resolution actually succeeded
                        // This prevents unnecessary re-resolution while allowing retry after transient failures
                        conflictResolutionAttempted = true;

                        // Wait for ADO to re-evaluate merge status after our push
                        const refreshed = await this.waitForMergeStatusEvaluation(project, repoId, prId, 15000);
                        if (refreshed) {
                            prDetails = refreshed;
                        } else {
                            // Timeout - get latest details and continue
                            prDetails = await this.prManager.getPrDetails(project, repoId, prId);
                        }
                    }
                }

                // Step 3: Complete the PR
                const commitId = prDetails.lastMergeSourceCommit?.commitId;
                if (!commitId) {
                    // If commitId is missing, ADO likely hasn't evaluated yet
                    // Throw to trigger retry with backoff rather than sending empty commitId
                    throw Object.assign(
                        new Error(`PR #${prId} missing lastMergeSourceCommit - ADO may still be evaluating`),
                        { status: 409 }
                    );
                }

                await this.prManager.completePr(project, repoId, prId, commitId, {
                    bypassPolicy: true,
                });

                const completionVerified = await this.waitForCompletion(project, repoId, prId, 15000);
                if (!completionVerified) {
                    console.log(`   ❌ PR #${prId} completion not verified after merge request`);
                    return false;
                }

                return true;
            } catch (error: any) {
                const isRetryable = error.status === 409 || error.status === 400;

                // Retry on 409 (Conflict) or 400 (Bad Request) - usually means PR is being updated or not ready
                if (isRetryable && attempt < maxRetries - 1) {
                    const waitTime = 2000 * (attempt + 1);
                    console.log(
                        `   🔄 PR #${prId} not ready (${error.status}), retrying in ${waitTime / 1000}s (attempt ${attempt + 2}/${maxRetries})...`
                    );
                    await new Promise((r) => setTimeout(r, waitTime));
                    continue;
                }

                // Log the error but don't throw - we'll return false
                console.log(
                    `   ❌ Failed to complete PR #${prId}: ${error instanceof Error ? error.message : String(error)}`
                );
                return false;
            }
        }

        return false;
    }
}
