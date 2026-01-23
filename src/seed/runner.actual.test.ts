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
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
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
        vi.useFakeTimers({ shouldAdvanceTime: true });
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
        (exec as any).mockImplementation((cmd: string, args: string[], options: any) => {
            if (args.includes('clone')) {
                const repoDir = join(options.cwd, 'repo');
                try {
                    mkdirSync(repoDir, { recursive: true });
                } catch {}
                return Promise.resolve({ stdout: '', stderr: '', code: 0 });
            }
            if (args.includes('ls-remote')) {
                return Promise.resolve({ stdout: 'abc123after\trefs/heads/feature/branch', stderr: '', code: 0 });
            }
            if (args.includes('rev-parse')) {
                return Promise.resolve({ stdout: 'abc123after', stderr: '', code: 0 });
            }
            return Promise.resolve({ stdout: '', stderr: '', code: 0 });
        });
    });

    afterEach(() => {
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        delete process.env.TEST_PAT;
        vi.useRealTimers();
    });

    function setupAxiosMock(
        options: {
            mergeStatus?: string;
            mergeStatusSequence?: string[];
            commitId?: string;
            hasPrs?: boolean;
            prCount?: number;
            failComplete?: boolean;
            failCompleteStatus?: number;
            failCompleteTypeKey?: string;
        } = {}
    ) {
        const {
            mergeStatus = 'succeeded',
            mergeStatusSequence,
            commitId = 'abc123after', // Match git ls-remote mock
            hasPrs = true,
            prCount = 60, // Above threshold to trigger cleanup
            failComplete = false,
            failCompleteStatus = 409,
            failCompleteTypeKey,
        } = options;

        let completePrAttempts = 0;
        let prDetailsCalls = 0;
        const statusSequence = mergeStatusSequence ?? [mergeStatus];

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

                // Specific PR by ID (polling)
                if (lowUrl.includes('pullrequests/')) {
                    const status = statusSequence[Math.min(prDetailsCalls, statusSequence.length - 1)] ?? mergeStatus;
                    prDetailsCalls += 1;
                    return Promise.resolve({
                        data: {
                            pullRequestId: 101,
                            mergeStatus: status,
                            status: status === 'succeeded' ? 'completed' : 'active',
                            lastMergeSourceCommit: commitId ? { commitId } : undefined,
                            sourceRefName: 'refs/heads/feature/branch',
                            targetRefName: 'refs/heads/main',
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
                    if (completePrAttempts < 2) {
                        const error = new Error('Conflict') as any;
                        error.response = {
                            status: failCompleteStatus,
                            data: { typeKey: failCompleteTypeKey },
                        };
                        return Promise.reject(error);
                    }
                }

                return Promise.resolve({ data: { status: 'completed' } });
            }),
        };

        (axios.create as any).mockReturnValue(mockAxiosInstance);
    }

    describe('completePrWithConflictResolution via runCleanupMode', () => {
        it('exercises PR completion with succeeded merge status', async () => {
            setupAxiosMock({ mergeStatus: 'succeeded', prCount: 60 }); // Above threshold for cleanup mode

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const promise = runner.run();
            // Advance timers to handle internal delays
            await vi.runAllTimersAsync();
            const summary = await promise;

            expect(summary.cleanupMode).toBe(true);
            expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
                expect.stringMatching(/pullrequests/i),
                expect.objectContaining({ completionOptions: expect.objectContaining({ bypassPolicy: true }) }),
                expect.anything()
            );
        });

        it('exercises PR completion with conflicts - triggers resolution and verification', async () => {
            setupAxiosMock({ mergeStatusSequence: ['conflicts', 'succeeded'], prCount: 60 });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const promise = runner.run();
            await vi.runAllTimersAsync();
            const summary = await promise;

            expect(summary.cleanupMode).toBe(true);
            // Verify conflict resolution (ls-remote call happens)
            expect(exec).toHaveBeenCalledWith('git', expect.arrayContaining(['ls-remote']), expect.any(Object));
        });

        it('exercises retry on TF401192 stale error - skips re-resolution', async () => {
            setupAxiosMock({
                mergeStatus: 'succeeded',
                prCount: 60,
                failComplete: true,
                failCompleteStatus: 409,
                failCompleteTypeKey: 'GitPullRequestStaleException',
            });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const promise = runner.run();
            await vi.runAllTimersAsync();
            const summary = await promise;

            expect(summary.cleanupMode).toBe(true);
            // resolveConflicts should NOT have been called (it's called via git resolve-conflicts in this setup)
            // But we can check that merge was NOT called (which only happens in resolveConflicts)
            expect(exec).not.toHaveBeenCalledWith('git', expect.arrayContaining(['merge']), expect.any(Object));
        });
    });

    describe('processPr with complete outcome', () => {
        it('exercises conflict resolution during normal PR processing', async () => {
            setupAxiosMock({ mergeStatusSequence: ['conflicts', 'succeeded'], hasPrs: false, prCount: 0 });

            const config = loadConfig(configPath, 'test-run');
            const plan = createPlan(config);
            const runner = new SeedRunner(config, plan);

            const promise = runner.run();
            await vi.runAllTimersAsync();
            const summary = await promise;

            expect(summary.cleanupMode).toBe(false);
            expect(exec).toHaveBeenCalledWith('git', expect.arrayContaining(['clone']), expect.any(Object));
        });
    });
});
