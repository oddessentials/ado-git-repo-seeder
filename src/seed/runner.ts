import { LoadedConfig, ResolvedUser } from '../config.js';
import { createAdoClient, createIdentityClient } from '../ado/client.js';
import { IdentityResolver } from '../ado/identities.js';
import { RepoManager } from '../ado/repos.js';
import { PrManager, PullRequest } from '../ado/prs.js';
import { GitGenerator, BranchSpec } from '../git/generator.js';
import { SeedPlan, PlannedRepo, PlannedPr, voteToValue } from './planner.js';
import { SeedSummary, RepoResult, PrResult, FailureRecord } from './summary.js';
import { SeededRng } from '../util/rng.js';
import { exec } from '../util/exec.js';

import { writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

        const primaryUser = this.config.resolvedUsers[0];

        for (const { project, repoId, remoteUrl, pr } of allOpenPrs) {
            if (stats.prsCompleted >= targetCount) {
                break;
            }
            const prTitle = pr.title.length > 50 ? pr.title.slice(0, 47) + '...' : pr.title;

            try {
                if ((pr as any).isDraft) {
                    console.log(`   📝 Publishing draft PR #${pr.pullRequestId}: ${prTitle}`);
                    await this.prManager.publishDraft(project, repoId, pr.pullRequestId);
                    stats.draftsPublished++;
                    continue;
                }

                const sourceBranch = pr.sourceRefName.replace('refs/heads/', '');
                const targetBranch = pr.targetRefName.replace('refs/heads/', '');

                console.log(`   ✅ Completing PR #${pr.pullRequestId}: ${prTitle}`);

                const completed = await this.completePrWithConflictResolution(
                    project,
                    repoId,
                    pr.pullRequestId,
                    sourceBranch,
                    remoteUrl,
                    primaryUser.pat,
                    targetBranch
                );

                if (completed) stats.prsCompleted++;
                else stats.prsFailed++;
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
            const repoResult = await this.repoManager.ensureRepo(
                planned.project,
                planned.repoName,
                this.config.repoStrategy
            );
            if (!repoResult) return result;

            const { repo, isNew } = repoResult;
            result.repoId = repo.id;

            const branchSpecs: BranchSpec[] = planned.branches.map((b) => ({
                name: b.name,
                commits: b.commits,
            }));

            const generated = await this.gitGenerator.createRepo(
                planned.repoName,
                branchSpecs,
                this.config.seed,
                this.config.runId
            );

            try {
                const primaryUser = this.config.resolvedUsers[0];

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

                await this.gitGenerator.pushToRemote(
                    generated.localPath,
                    repo.remoteUrl,
                    primaryUser.pat,
                    generated.branches,
                    !isNew
                );
                result.branchesCreated = generated.branches.length;

                for (const plannedPr of planned.prs) {
                    const prResult = await this.processPr(
                        planned.project,
                        repo,
                        plannedPr,
                        result.failures,
                        generated.localPath
                    );
                    if (prResult) result.prs.push(prResult);
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

            if (errorMsg.includes('FATAL:')) throw error;
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

            let effectivelyDraft = planned.isDraft;
            if (planned.isDraft && planned.shouldPublishDraft) {
                try {
                    await this.prManager.publishDraft(project, repoId, pr.pullRequestId);
                    effectivelyDraft = false;
                } catch (error) {
                    failures.push({
                        phase: 'publish-draft',
                        prId: pr.pullRequestId,
                        error: error instanceof Error ? error.message : String(error),
                        isFatal: false,
                    });
                }
            }

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

            try {
                if (effectivelyDraft) {
                    prResult.outcomeApplied = true;
                } else if (planned.outcome === 'complete') {
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
                    prResult.outcomeApplied = true;
                }
            } catch (error) {
                failures.push({
                    phase: 'apply-outcome',
                    prId: pr.pullRequestId,
                    error: error instanceof Error ? error.message : String(error),
                    isFatal: false,
                });
            }

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
     * Waits for ADO to report mergeStatus as 'succeeded' after updates.
     */
    private async waitForMergeStatusSuccess(
        project: string,
        repoId: string,
        prId: number,
        maxWaitMs: number = 60000
    ): Promise<Awaited<ReturnType<PrManager['getPrDetails']>> | null> {
        const pollIntervalMs = 2000;
        const startTime = Date.now();
        let lastStatus: string | undefined;

        while (Date.now() - startTime < maxWaitMs) {
            const prDetails = await this.prManager.getPrDetails(project, repoId, prId);
            lastStatus = prDetails.mergeStatus;

            if (lastStatus === 'succeeded') {
                return prDetails;
            }

            console.log(`   ⏳ PR #${prId} merge status is '${lastStatus ?? 'undefined'}', waiting for success...`);
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        console.log(
            `   ⚠️  PR #${prId} merge status did not reach 'succeeded' after ${maxWaitMs}ms (last=${lastStatus ?? 'undefined'})`
        );
        return null;
    }

    /**
     * Waits for ADO to mark the PR as completed after a completion request.
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
            if (prDetails.status === 'completed') return true;
            console.log(`   ⏳ PR #${prId} status is '${prDetails.status}', waiting for completion...`);
            await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        console.log(`   ⚠️  PR #${prId} completion verification timed out after ${maxWaitMs}ms`);
        return false;
    }

    /**
     * Attempts to complete a PR with automatic conflict resolution.
     *
     * Key hardening:
     * - Push verification uses remote branch ref (git ls-remote) NOT PR lastMergeSourceCommit (which can lag).
     * - TF401192 stale: refetch PR + retry completion; DO NOT re-resolve (which creates new commits and loops staleness).
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

        // Track whether we have already pushed a resolution commit for this PR in this call
        let resolutionPushedSha: string | undefined;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Always start each attempt from fresh PR details (commitId can change between attempts)
                let prDetails = await this.prManager.getPrDetails(project, repoId, prId);

                // On first attempt, give ADO a moment to evaluate merge status if pending
                if (
                    attempt === 0 &&
                    (!prDetails.mergeStatus || prDetails.mergeStatus === 'notSet' || prDetails.mergeStatus === 'queued')
                ) {
                    const evaluated = await this.waitForMergeStatusEvaluation(project, repoId, prId, 10000);
                    if (evaluated) prDetails = evaluated;
                }

                const mergeStatus = prDetails.mergeStatus;

                // Resolve ONLY if ADO explicitly says conflicts/failure AND we have not already pushed a resolution SHA
                if ((mergeStatus === 'conflicts' || mergeStatus === 'failure') && !resolutionPushedSha) {
                    const statusLabel = mergeStatus ?? 'unknown';
                    console.log(`   ⚠️  PR #${prId} merge status is '${statusLabel}', auto-resolving...`);

                    const resolution = await this.gitGenerator.resolveConflicts(
                        remoteUrl,
                        pat,
                        sourceBranch,
                        targetBranch
                    );

                    if (!resolution.resolved || !resolution.newCommitSha) {
                        console.log(
                            `   ❌ Conflict resolution failed for PR #${prId}: ${resolution.error ?? 'unknown'}`
                        );
                        // Continue: bypassPolicy completion might still work, or next attempt may succeed.
                    } else {
                        console.log(`   ✅ Conflicts resolved for PR #${prId}, verifying remote ref moved...`);

                        // Verify remote branch ref actually moved to the new commit SHA (strong signal)
                        const remoteHead = await this.getRemoteBranchHeadSha(remoteUrl, pat, sourceBranch);
                        if (remoteHead && remoteHead.toLowerCase() === resolution.newCommitSha.toLowerCase()) {
                            resolutionPushedSha = resolution.newCommitSha;
                            console.log(`   ✅ PR #${prId} remote ref updated: ${remoteHead.slice(0, 7)}`);
                        } else {
                            console.log(
                                `   ❌ PR #${prId} remote ref did not move to expected SHA (expected=${resolution.newCommitSha.slice(
                                    0,
                                    7
                                )} got=${remoteHead?.slice(0, 7) ?? 'unknown'}).`
                            );
                            // Don't set resolutionPushedSha; allow retry to attempt resolution again.
                        }

                        // Give ADO a short window to re-evaluate merge status after ref update (best-effort)
                        const refreshed = await this.waitForMergeStatusEvaluation(project, repoId, prId, 15000);
                        if (refreshed) prDetails = refreshed;
                        else prDetails = await this.prManager.getPrDetails(project, repoId, prId);
                    }
                }

                // Best-effort wait for mergeStatus to succeed; do not hard-fail if it doesn't
                if (prDetails.mergeStatus !== 'succeeded') {
                    console.log(
                        `   ⏳ PR #${prId} mergeStatus is '${prDetails.mergeStatus ?? 'undefined'}', waiting up to 60s for success...`
                    );
                    const successDetails = await this.waitForMergeStatusSuccess(project, repoId, prId, 60000);
                    if (successDetails) {
                        prDetails = successDetails;
                        console.log(`   ✅ PR #${prId} mergeStatus reached 'succeeded'`);
                    } else {
                        console.log(
                            `   ⚠️  PR #${prId} mergeStatus did not reach 'succeeded', attempting completion with bypassPolicy...`
                        );
                    }
                }

                // IMPORTANT: refetch PR details just before completion to avoid stale commitId
                prDetails = await this.prManager.getPrDetails(project, repoId, prId);

                const commitId = prDetails.lastMergeSourceCommit?.commitId;
                if (!commitId) {
                    console.log(
                        `   ⏳ PR #${prId} missing lastMergeSourceCommit.commitId (mergeStatus: ${prDetails.mergeStatus ?? 'undefined'}), will retry...`
                    );
                    throw Object.assign(
                        new Error(`PR #${prId} missing lastMergeSourceCommit - ADO may still be evaluating`),
                        { status: 409 }
                    );
                }

                console.log(
                    `   🚀 PR #${prId} attempting completion (commitId: ${commitId.slice(
                        0,
                        7
                    )}, mergeStatus: ${prDetails.mergeStatus ?? 'undefined'})`
                );

                await this.prManager.completePr(project, repoId, prId, commitId, {
                    bypassPolicy: true,
                });

                const completionVerified = await this.waitForCompletion(project, repoId, prId, 15000);
                if (!completionVerified) {
                    console.log(`   ❌ PR #${prId} completion not verified after merge request`);
                    return false;
                }

                console.log(`   ✅ PR #${prId} successfully completed and verified`);
                return true;
            } catch (error: any) {
                const adoData = error?.response?.data ?? error?.data;
                const isStaleException = adoData?.typeKey === 'GitPullRequestStaleException';
                const statusCode = error?.status ?? error?.response?.status;

                // TF401192: source modified since last merge attempt.
                // Fix: refetch PR and retry completion; DO NOT resolve again (that creates more commits and loops staleness).
                if (isStaleException && attempt < maxRetries - 1) {
                    console.log(
                        `   🔄 PR #${prId} stale (TF401192: source modified), refetching and retrying completion...`
                    );
                    await new Promise((r) => setTimeout(r, 1500));
                    continue;
                }

                // Retry on 409/400 which often mean "not ready"
                const isRetryable = statusCode === 409 || statusCode === 400;
                if (isRetryable && attempt < maxRetries - 1) {
                    const waitTime = 2000 * (attempt + 1);
                    console.log(
                        `   🔄 PR #${prId} not ready (${statusCode}), retrying in ${waitTime / 1000}s (attempt ${
                            attempt + 2
                        }/${maxRetries})...`
                    );
                    await new Promise((r) => setTimeout(r, waitTime));
                    continue;
                }

                const adoMessage = adoData ? ` ADO response: ${JSON.stringify(adoData)}` : '';
                console.log(
                    `   ❌ Failed to complete PR #${prId}: ${error instanceof Error ? error.message : String(error)}${adoMessage}`
                );
                return false;
            }
        }

        return false;
    }

    /**
     * Reads the remote head SHA for refs/heads/<branch> using git ls-remote with ASKPASS auth.
     * This is the reliable push-verification signal (PR lastMergeSourceCommit may lag).
     */
    private async getRemoteBranchHeadSha(remoteUrl: string, pat: string, branch: string): Promise<string | null> {
        const url = new URL(remoteUrl);
        url.username = 'seeder';
        url.password = '';
        const cleanUrl = url.toString();

        const askPass = this.createAskPassScript(pat);

        try {
            const env: NodeJS.ProcessEnv = {
                GIT_ASKPASS: askPass.path,
                GIT_TERMINAL_PROMPT: '0',
            };

            const ref = `refs/heads/${branch}`;
            const result = await exec('git', ['ls-remote', '--heads', cleanUrl, ref], {
                cwd: tmpdir(),
                env,
                patsToRedact: this.allPats,
            });

            if (result.code !== 0) {
                return null;
            }

            const line = result.stdout.trim();
            if (!line) return null;

            // "<sha>\t<ref>"
            const sha = line.split(/\s+/)[0];
            return sha || null;
        } finally {
            askPass.cleanup();
        }
    }

    private createAskPassScript(pat: string): { path: string; cleanup: () => void } {
        const isWindows = process.platform === 'win32';
        const scriptExt = isWindows ? '.bat' : '.sh';
        const scriptPath = join(tmpdir(), `askpass-${Math.random().toString(36).slice(2)}${scriptExt}`);

        const content = isWindows ? `@echo ${pat}` : `#!/bin/sh\necho "${pat}"`;

        writeFileSync(scriptPath, content);
        if (!isWindows) chmodSync(scriptPath, 0o700);

        return {
            path: scriptPath,
            cleanup: () => {
                try {
                    rmSync(scriptPath, { force: true });
                } catch {}
            },
        };
    }
}
