import { describe, it, expect } from 'vitest';
import { createPlan, voteToValue } from './planner.js';
import type { LoadedConfig } from '../config.js';

function createTestConfig(overrides?: Partial<LoadedConfig>): LoadedConfig {
    return {
        org: 'test-org',
        projects: [
            { name: 'project1', repos: ['repo1', 'repo2'] },
            { name: 'project2', repos: ['repo3'] },
        ],
        users: [
            { email: 'dev1@test.com', patEnvVar: 'PAT1' },
            { email: 'dev2@test.com', patEnvVar: 'PAT2' },
            { email: 'dev3@test.com', patEnvVar: 'PAT3' },
        ],
        scale: {
            branchesPerRepo: 3,
            commitsPerBranch: { min: 2, max: 5 },
            prsPerRepo: 2,
            reviewersPerPr: { min: 1, max: 2 },
            commentsPerPr: { min: 1, max: 3 },
        },
        voteDistribution: {
            approve: 0.5,
            approveWithSuggestions: 0.2,
            reject: 0.1,
            noVote: 0.2,
        },
        prOutcomes: {
            complete: 0.5,
            abandon: 0.2,
            leaveOpen: 0.3,
        },
        seed: 12345,
        resolvedUsers: [
            { email: 'dev1@test.com', patEnvVar: 'PAT1', pat: 'pat1' },
            { email: 'dev2@test.com', patEnvVar: 'PAT2', pat: 'pat2' },
            { email: 'dev3@test.com', patEnvVar: 'PAT3', pat: 'pat3' },
        ],
        runId: 'test-run-123',
        ...overrides,
    };
}

describe('planner', () => {
    describe('createPlan()', () => {
        it('creates plans for all repos in all projects', () => {
            const config = createTestConfig();
            const plan = createPlan(config);

            expect(plan.repos).toHaveLength(3); // repo1, repo2, repo3
            expect(plan.repos.map(r => r.project)).toEqual(['project1', 'project1', 'project2']);
        });

        it('includes runId in repo names for isolation', () => {
            const config = createTestConfig({ runId: 'isolation-test' });
            const plan = createPlan(config);

            for (const repo of plan.repos) {
                expect(repo.repoName).toContain('isolation-test');
            }
        });

        it('creates the configured number of branches per repo', () => {
            const config = createTestConfig();
            const plan = createPlan(config);

            for (const repo of plan.repos) {
                expect(repo.branches).toHaveLength(config.scale.branchesPerRepo);
            }
        });

        it('creates the configured number of PRs per repo', () => {
            const config = createTestConfig();
            const plan = createPlan(config);

            for (const repo of plan.repos) {
                expect(repo.prs.length).toBeLessThanOrEqual(config.scale.prsPerRepo);
            }
        });

        it('assigns reviewers excluding the PR creator', () => {
            const config = createTestConfig();
            const plan = createPlan(config);

            for (const repo of plan.repos) {
                for (const pr of repo.prs) {
                    const reviewerEmails = pr.reviewers.map(r => r.email);
                    expect(reviewerEmails).not.toContain(pr.creatorEmail);
                }
            }
        });

        it('is deterministic - same seed produces same plan', () => {
            const config1 = createTestConfig({ seed: 99999 });
            const config2 = createTestConfig({ seed: 99999 });

            const plan1 = createPlan(config1);
            const plan2 = createPlan(config2);

            // Compare repo structure
            expect(plan1.repos.map(r => r.repoName)).toEqual(plan2.repos.map(r => r.repoName));

            // Compare PR creators
            const creators1 = plan1.repos.flatMap(r => r.prs.map(p => p.creatorEmail));
            const creators2 = plan2.repos.flatMap(r => r.prs.map(p => p.creatorEmail));
            expect(creators1).toEqual(creators2);

            // Compare outcomes
            const outcomes1 = plan1.repos.flatMap(r => r.prs.map(p => p.outcome));
            const outcomes2 = plan2.repos.flatMap(r => r.prs.map(p => p.outcome));
            expect(outcomes1).toEqual(outcomes2);
        });

        it('different seeds produce different plans', () => {
            const config1 = createTestConfig({ seed: 11111 });
            const config2 = createTestConfig({ seed: 22222 });

            const plan1 = createPlan(config1);
            const plan2 = createPlan(config2);

            // Creators should differ (with high probability)
            const creators1 = plan1.repos.flatMap(r => r.prs.map(p => p.creatorEmail));
            const creators2 = plan2.repos.flatMap(r => r.prs.map(p => p.creatorEmail));

            // At least some creators should be different
            const same = creators1.filter((c, i) => c === creators2[i]).length;
            expect(same).toBeLessThan(creators1.length);
        });

        it('includes runId in plan metadata', () => {
            const config = createTestConfig({ runId: 'metadata-test' });
            const plan = createPlan(config);

            expect(plan.runId).toBe('metadata-test');
            expect(plan.org).toBe('test-org');
        });

        it('includes runId in PR titles and descriptions', () => {
            const config = createTestConfig({ runId: 'pr-title-test' });
            const plan = createPlan(config);

            for (const repo of plan.repos) {
                for (const pr of repo.prs) {
                    expect(pr.title).toContain('pr-title-test');
                    expect(pr.description).toContain('pr-title-test');
                }
            }
        });
    });

    describe('voteToValue()', () => {
        it('maps vote types to correct ADO values', () => {
            expect(voteToValue('approve')).toBe(10);
            expect(voteToValue('approveWithSuggestions')).toBe(5);
            expect(voteToValue('reject')).toBe(-10);
            expect(voteToValue('noVote')).toBe(0);
        });
    });
});
