import { SeedRunner } from '../../seed/runner.js';
import { SeedPlan } from '../../seed/planner.js';
import { LoadedConfig } from '../../config.js';
import 'dotenv/config';

/**
 * E2E Smoke Test for ADO Git Repo Seeder
 * 
 * Validates:
 * 1. Connectivity to ADO PR and Repo APIs
 * 2. GIT_ASKPASS authentication on the host environment
 * 3. PR creation success
 * 
 * Usage:
 * export ADO_PAT=your-pat
 * export ADO_ORG=your-org
 * export ADO_PROJECT=your-project
 * export ADO_REPO=your-repo
 * npx ts-node src/test/scripts/smoke-test.ts
 */

async function runSmokeTest() {
    const org = process.env.ADO_ORG;
    const project = process.env.ADO_PROJECT;
    const repo = process.env.ADO_REPO;
    const pat = process.env.ADO_PAT;

    if (!org || !project || !repo || !pat) {
        console.error('❌ Missing environment variables: ADO_ORG, ADO_PROJECT, ADO_REPO, ADO_PAT');
        process.exit(1);
    }

    console.log('🧪 Starting E2E Smoke Test...');
    console.log(`   Target: ${org}/${project}/${repo}`);

    const config: LoadedConfig = {
        org,
        projects: [{
            name: project,
            repos: [repo],
            repoNaming: 'direct'
        }],
        users: [{
            email: 'smoke-test@example.com',
            patEnvVar: 'ADO_PAT'
        }],
        resolvedUsers: [{
            email: 'smoke-test@example.com', // Dummy email, PAT is what matters
            pat,
            patEnvVar: 'ADO_PAT'
        }],
        seed: Date.now(),
        runId: `smoke-${Math.floor(Math.random() * 1000)}`,
        repoNaming: 'direct',
        repoStrategy: { createIfMissing: false, failIfMissing: true, skipIfExists: false },
        branchStrategy: { alwaysUseRunId: true, allowCollisions: false },
        scale: {
            branchesPerRepo: 1,
            commitsPerBranch: { min: 1, max: 1 },
            prsPerRepo: 1,
            reviewersPerPr: { min: 0, max: 0 },
            commentsPerPr: { min: 0, max: 0 }
        },
        voteDistribution: { approve: 1, approveWithSuggestions: 0, reject: 0, noVote: 0 },
        prOutcomes: { complete: 0, abandon: 0, leaveOpen: 1 },
        activity: { pushFollowUpCommits: 0, followUpCommitsRange: { min: 0, max: 0 } }
    };

    const plan: SeedPlan = {
        runId: config.runId,
        org: config.org,
        repos: [{
            project,
            repoName: repo,
            resolvedNaming: 'direct',
            branches: [{
                name: `smoke/${config.runId}`,
                commits: 1
            }],
            prs: [{
                sourceBranch: `smoke/${config.runId}`,
                creatorEmail: config.resolvedUsers[0].email,
                title: `[SMOKE TEST] ${config.runId}`,
                description: 'End-to-end smoke test for GIT_ASKPASS validation.',
                isDraft: false,
                shouldPublishDraft: false,
                reviewers: [],
                comments: [],
                outcome: 'leaveOpen',
                followUpCommits: 0
            }],
        }]
    };

    const runner = new SeedRunner(config, plan, undefined, 'smoke-test');

    try {
        const summary = await runner.run();

        if (summary.fatalFailure) {
            console.error('❌ Smoke Test Failed (Fatal):', summary.fatalFailure.error);
            process.exit(1);
        }

        const repoResult = summary.repos[0];
        if (repoResult.failures.length > 0) {
            console.error('❌ Smoke Test Completed with individual failures:');
            repoResult.failures.forEach(f => console.error(`   - [${f.phase}]: ${f.error}`));
            process.exit(1);
        }

        console.log('\n✅ Smoke Test Successful!');
        console.log(`   PR Created: #${repoResult.prs[0].prId}`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Smoke Test Exception:', error);
        process.exit(1);
    }
}

runSmokeTest();
