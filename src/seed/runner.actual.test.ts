/**
 * Tests that exercise the ACTUAL SeedRunner code for coverage.
 *
 * Unlike runner.integration.test.ts which tests a simulated function,
 * these tests instantiate the real SeedRunner class with mocked dependencies
 * to get actual line coverage on runner.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SeedRunner } from './runner.js';
import { createPlan } from './planner.js';
import { loadConfig } from '../config.js';
import { exec } from '../util/exec.js';
import axios from 'axios';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../util/exec.js');
vi.mock('axios');

describe('SeedRunner Actual Code Coverage', () => {
    let tempDir: string;
    let configPath: string;
    let mockAxiosInstance: any;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), 'runner-actual-test-'));
        configPath = join(tempDir, 'seed.config.json');

        const config = {
            org: 'test-org',
            projects: [{ name: 'TestProject', repos: ['TestRepo'] }],
            users: [{ email: 'user@test.com', patEnvVar: 'TEST_PAT' }],
            scale: {
                branchesPerRepo: 1,
                commitsPerBranch: { min: 1, max: 1 },
                prsPerRepo: 1,
                reviewersPerPr: { min: 1, max: 1 },
                commentsPerPr: { min: 1, max: 1 },
            },
            voteDistribution: { approve: 1, approveWithSuggestions: 0, reject: 0, noVote: 0 },
            prOutcomes: { complete: 1, abandon: 0, leaveOpen: 0 },
            seed: 12345,
            repoNaming: 'direct',
        };

        writeFileSync(configPath, JSON.stringify(config));
        process.env.TEST_PAT = 'fake-pat-token';

        // Default successful git mock
        (exec as any).mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    });

    afterEach(() => {
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        delete process.env.TEST_PAT;
    });

    function setupAxiosMock(
        options: {
            mergeStatus?: string;
            commitId?: string;
            hasPrs?: boolean;
            prCount?: number;
            failComplete?: boolean;
            failCompleteStatus?: number;
        } = {}
    ) {
        const {
            mergeStatus = 'succeeded',
            commitId = 'abc123',
            hasPrs = true,
            prCount = 60, // Above threshold to trigger cleanup
            failComplete = false,
            failCompleteStatus = 409,
        } = options;

        let completePrAttempts = 0;

        mockAxiosInstance = {
            interceptors: {
                request: { use: vi.fn() },
                response: { use: vi.fn() },
            },
            get: vi.fn().mockImplementation((url: string) => {
                const lowUrl = url.toLowerCase();

                // Policy check
                if (lowUrl.includes('_apis/policy/configurations')) {
                    return Promise.resolve({ data: { value: [] } });
                }

                // Identity resolution
                if (lowUrl.includes('_apis/identities')) {
                    return Promise.resolve({
                        data: { value: [{ id: 'user-identity-id' }] },
                    });
                }

                // Specific PR by ID (must come before PR list check)
                if (lowUrl.includes('pullrequests/')) {
                    return Promise.resolve({
                        data: {
                            pullRequestId: 101,
                            mergeStatus: mergeStatus,
                            lastMergeSourceCommit: commitId ? { commitId } : undefined,
                        },
                    });
                }

                // PR list
                if (lowUrl.includes('/pullrequests')) {
                    if (!hasPrs) {
                        return Promise.resolve({ data: { value: [] } });
                    }
                    // Return PRs for cleanup mode testing
                    const prs = Array.from({ length: prCount }, (_, i) => ({
                        pullRequestId: 100 + i,
                        title: `Test PR ${i}`,
                        sourceRefName: `refs/heads/feature/branch-${i}`,
                        targetRefName: 'refs/heads/main',
                        isDraft: i === 0, // First one is a draft
                        creationDate: new Date(Date.now() - i * 86400000).toISOString(),
                    }));
                    return Promise.resolve({ data: { value: prs } });
                }

                // Specific repo
                if (lowUrl.includes('_apis/git/repositories/testrepo')) {
                    return Promise.resolve({
                        data: {
                            id: 'repo-id-1',
                            name: 'TestRepo',
                            remoteUrl: 'https://dev.azure.com/test-org/TestProject/_git/TestRepo',
                        },
                    });
                }

                // Repo list
                if (lowUrl.includes('_apis/git/repositories')) {
                    return Promise.resolve({
                        data: {
                            value: [{ name: 'TestRepo', id: 'repo-id-1' }],
                        },
                    });
                }

                return Promise.resolve({ data: {} });
            }),
            post: vi.fn().mockResolvedValue({ data: { pullRequestId: 101 } }),
            patch: vi.fn().mockImplementation((url: string) => {
                const lowUrl = url.toLowerCase();

                // Completing PR
                if (lowUrl.includes('pullrequests/') && failComplete) {
                    completePrAttempts++;
                    if (completePrAttempts < 3) {
                        const error = new Error('PR not ready') as any;
                        error.response = { status: failCompleteStatus };
                        return Promise.reject(error);
                    }
                }

                return Promise.resolve({ data: {} });
            }),
        };

        (axios.create as any).mockReturnValue(mockAxiosInstance);
    }

    describe('completePrWithConflictResolution via runCleanupMode', () => {
        it('exercises PR completion with succeeded merge status', async () => {
            setupAxiosMock({ mergeStatus: 'succeeded', prCount: 60 });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            // Should have triggered cleanup mode
            expect(summary.cleanupMode).toBe(true);
            expect(summary.cleanupStats).toBeDefined();
        });

        it('exercises PR completion with conflicts - triggers resolution', async () => {
            setupAxiosMock({ mergeStatus: 'conflicts', prCount: 60 });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(true);
            // Should have attempted conflict resolution (via git commands)
            expect(exec).toHaveBeenCalledWith('git', expect.arrayContaining(['clone']), expect.any(Object));
        });

        it('exercises retry on 409 error', async () => {
            setupAxiosMock({
                mergeStatus: 'succeeded',
                prCount: 60,
                failComplete: true,
                failCompleteStatus: 409,
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            // Should have completed after retries
            expect(summary.cleanupMode).toBe(true);
        });

        it('exercises retry on 400 error', async () => {
            setupAxiosMock({
                mergeStatus: 'succeeded',
                prCount: 60,
                failComplete: true,
                failCompleteStatus: 400,
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(true);
        });

        it('exercises missing commitId scenario', async () => {
            // Test the path where commitId is missing - simplified version
            setupAxiosMock({ mergeStatus: 'succeeded', commitId: undefined as any, prCount: 60 });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            // Should enter cleanup mode and handle missing commitId
            expect(summary.cleanupMode).toBe(true);
        }, 15000);
    });

    describe('waitForMergeStatusEvaluation via completePrWithConflictResolution', () => {
        it('exercises status evaluation wait on notSet status', async () => {
            let prDetailsCalls = 0;

            setupAxiosMock({ mergeStatus: 'notSet', prCount: 60 });

            mockAxiosInstance.get.mockImplementation((url: string) => {
                const lowUrl = url.toLowerCase();

                if (lowUrl.includes('pullrequests/')) {
                    prDetailsCalls++;
                    // Return notSet first few times, then succeeded
                    const status = prDetailsCalls < 3 ? 'notSet' : 'succeeded';
                    return Promise.resolve({
                        data: {
                            pullRequestId: 101,
                            mergeStatus: status,
                            lastMergeSourceCommit: { commitId: 'abc123' },
                        },
                    });
                }

                if (lowUrl.includes('_apis/policy/configurations')) {
                    return Promise.resolve({ data: { value: [] } });
                }
                if (lowUrl.includes('_apis/identities')) {
                    return Promise.resolve({ data: { value: [{ id: 'user-id' }] } });
                }
                if (lowUrl.includes('/pullrequests')) {
                    return Promise.resolve({
                        data: {
                            value: Array.from({ length: 60 }, (_, i) => ({
                                pullRequestId: 100 + i,
                                title: `PR ${i}`,
                                sourceRefName: 'refs/heads/feature/branch',
                                targetRefName: 'refs/heads/main',
                                isDraft: false,
                                creationDate: new Date().toISOString(),
                            })),
                        },
                    });
                }
                if (lowUrl.includes('_apis/git/repositories/testrepo')) {
                    return Promise.resolve({
                        data: { id: 'repo-id', name: 'TestRepo', remoteUrl: 'https://fake/TestRepo' },
                    });
                }
                if (lowUrl.includes('_apis/git/repositories')) {
                    return Promise.resolve({ data: { value: [{ name: 'TestRepo', id: 'repo-id' }] } });
                }
                return Promise.resolve({ data: {} });
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(true);
            // Multiple getPrDetails calls indicate waiting loop executed
            expect(prDetailsCalls).toBeGreaterThan(1);
        });

        it('exercises status evaluation wait on queued status', async () => {
            let prDetailsCalls = 0;

            setupAxiosMock({ mergeStatus: 'queued', prCount: 60 });

            mockAxiosInstance.get.mockImplementation((url: string) => {
                const lowUrl = url.toLowerCase();

                if (lowUrl.includes('pullrequests/')) {
                    prDetailsCalls++;
                    const status = prDetailsCalls < 3 ? 'queued' : 'succeeded';
                    return Promise.resolve({
                        data: {
                            pullRequestId: 101,
                            mergeStatus: status,
                            lastMergeSourceCommit: { commitId: 'abc123' },
                        },
                    });
                }

                if (lowUrl.includes('_apis/policy/configurations')) {
                    return Promise.resolve({ data: { value: [] } });
                }
                if (lowUrl.includes('_apis/identities')) {
                    return Promise.resolve({ data: { value: [{ id: 'user-id' }] } });
                }
                if (lowUrl.includes('/pullrequests')) {
                    return Promise.resolve({
                        data: {
                            value: Array.from({ length: 60 }, (_, i) => ({
                                pullRequestId: 100 + i,
                                title: `PR ${i}`,
                                sourceRefName: 'refs/heads/feature/branch',
                                targetRefName: 'refs/heads/main',
                                isDraft: false,
                                creationDate: new Date().toISOString(),
                            })),
                        },
                    });
                }
                if (lowUrl.includes('_apis/git/repositories/testrepo')) {
                    return Promise.resolve({
                        data: { id: 'repo-id', name: 'TestRepo', remoteUrl: 'https://fake/TestRepo' },
                    });
                }
                if (lowUrl.includes('_apis/git/repositories')) {
                    return Promise.resolve({ data: { value: [{ name: 'TestRepo', id: 'repo-id' }] } });
                }
                return Promise.resolve({ data: {} });
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(true);
            expect(prDetailsCalls).toBeGreaterThan(1);
        });
    });

    describe('processPr with complete outcome', () => {
        it('exercises completePrWithConflictResolution via normal processing', async () => {
            // Use below-threshold PR count to avoid cleanup mode
            setupAxiosMock({ mergeStatus: 'succeeded', prCount: 0, hasPrs: false });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            // Should not be in cleanup mode
            expect(summary.cleanupMode).toBe(false);
            // Should have created and completed a PR
            expect(mockAxiosInstance.post).toHaveBeenCalled();
            expect(mockAxiosInstance.patch).toHaveBeenCalled();
        });

        it('exercises conflict resolution during normal PR processing', async () => {
            setupAxiosMock({ mergeStatus: 'conflicts', prCount: 0, hasPrs: false });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(false);
            // Should have attempted conflict resolution
            expect(exec).toHaveBeenCalledWith('git', expect.arrayContaining(['clone']), expect.any(Object));
        });
    });

    describe('runCleanupMode paths', () => {
        it('exercises cleanup mode with draft PRs', async () => {
            // Drafts are sorted to the front since oldest PRs are processed first
            // and draft handling happens before completion
            setupAxiosMock({ mergeStatus: 'succeeded', prCount: 60 });

            // Override to include draft PRs
            mockAxiosInstance.get.mockImplementation((url: string) => {
                const lowUrl = url.toLowerCase();

                if (lowUrl.includes('_apis/policy/configurations')) {
                    return Promise.resolve({ data: { value: [] } });
                }
                if (lowUrl.includes('_apis/identities')) {
                    return Promise.resolve({ data: { value: [{ id: 'user-id' }] } });
                }
                if (lowUrl.includes('pullrequests/')) {
                    return Promise.resolve({
                        data: {
                            pullRequestId: 100,
                            mergeStatus: 'succeeded',
                            lastMergeSourceCommit: { commitId: 'abc' },
                        },
                    });
                }
                if (lowUrl.includes('/pullrequests')) {
                    // Create mix of draft and non-draft PRs
                    // Oldest PRs first (lower timestamp = older)
                    const prs = Array.from({ length: 60 }, (_, i) => ({
                        pullRequestId: 100 + i,
                        title: `PR ${i}`,
                        sourceRefName: 'refs/heads/feature/branch',
                        targetRefName: 'refs/heads/main',
                        // Make older ones (i > 50) be drafts so they get processed
                        isDraft: i > 50,
                        creationDate: new Date(Date.now() - (60 - i) * 86400000).toISOString(),
                    }));
                    return Promise.resolve({ data: { value: prs } });
                }
                if (lowUrl.includes('_apis/git/repositories/testrepo')) {
                    return Promise.resolve({
                        data: { id: 'repo-id', name: 'TestRepo', remoteUrl: 'https://fake/TestRepo' },
                    });
                }
                if (lowUrl.includes('_apis/git/repositories')) {
                    return Promise.resolve({ data: { value: [{ name: 'TestRepo', id: 'repo-id' }] } });
                }
                return Promise.resolve({ data: {} });
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(true);
            // Either drafts are published or PRs are completed
            expect(summary.cleanupStats).toBeDefined();
        });

        it('exercises failed PR completion path', async () => {
            setupAxiosMock({ mergeStatus: 'succeeded', prCount: 60 });

            // Make completion always fail with non-retryable error
            mockAxiosInstance.patch.mockImplementation(() => {
                const error = new Error('Permission denied') as any;
                error.response = { status: 403 };
                return Promise.reject(error);
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(true);
            expect(summary.cleanupStats?.prsFailed).toBeGreaterThan(0);
        });
    });

    describe('conflict resolution failure handling', () => {
        it('exercises failed resolution path', async () => {
            setupAxiosMock({ mergeStatus: 'conflicts', prCount: 60 });

            // Make git clone fail to simulate resolution failure
            (exec as any).mockImplementation((cmd: string, args: string[]) => {
                if (args.includes('clone')) {
                    return Promise.resolve({ stdout: '', stderr: 'Clone failed', code: 128 });
                }
                return Promise.resolve({ stdout: '', stderr: '', code: 0 });
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const summary = await runner.run();

            expect(summary.cleanupMode).toBe(true);
            // Clone was attempted
            expect(exec).toHaveBeenCalledWith('git', expect.arrayContaining(['clone']), expect.any(Object));
        });
    });
});
