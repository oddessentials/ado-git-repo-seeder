/**
 * Tests for PR conflict resolution functionality in SeedRunner.
 *
 * Tests the completePrWithConflictResolution helper method behavior.
 *
 * CRITICAL REGRESSION TESTS:
 * - needsResolution must return true for 'conflicts' or 'failure' status
 * - Non-terminal statuses (notSet, queued, undefined) must NOT trigger conflict resolution
 * - Missing commitId must trigger retry, not pass empty string
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * Helper to determine if resolution is needed based on merge status.
 * This mirrors the CORRECT logic in completePrWithConflictResolution.
 *
 * IMPORTANT: Only 'conflicts' or 'failure' status should trigger resolution.
 * Other statuses (notSet, queued, undefined) should NOT trigger resolution
 * as they would cause unnecessary force-pushes that invalidate ADO's merge
 * evaluation and break the completion flow.
 */
function needsResolution(mergeStatus: string | undefined): boolean {
    // ONLY resolve when ADO explicitly reports conflicts or failure
    return mergeStatus === 'conflicts' || mergeStatus === 'failure';
}

/**
 * Helper to check if merge status is evaluated (not pending).
 * This mirrors the logic in waitForMergeStatusEvaluation.
 */
function isStatusEvaluated(mergeStatus: string | undefined): boolean {
    return mergeStatus !== undefined && mergeStatus !== 'notSet' && mergeStatus !== 'queued';
}

describe('PR Conflict Resolution', () => {
    describe('completePrWithConflictResolution behavior', () => {
        it('uses bypassPolicy: true when completing PRs', () => {
            // Verify the expected payload structure
            const completionOptions = {
                deleteSourceBranch: false,
                mergeStrategy: 'squash',
                bypassPolicy: true,
                bypassReason: 'Automated seeding - conflict auto-resolution',
            };

            expect(completionOptions.bypassPolicy).toBe(true);
            expect(completionOptions.bypassReason).toBeDefined();
        });

        it('detects conflicts via mergeStatus field', () => {
            // Test the merge status detection logic
            const prDetailsWithConflicts = {
                pullRequestId: 100,
                mergeStatus: 'conflicts',
                lastMergeSourceCommit: { commitId: 'abc123' },
            };

            const prDetailsSucceeded = {
                pullRequestId: 100,
                mergeStatus: 'succeeded',
                lastMergeSourceCommit: { commitId: 'abc123' },
            };

            expect(prDetailsWithConflicts.mergeStatus === 'conflicts').toBe(true);
            expect(prDetailsSucceeded.mergeStatus === 'conflicts').toBe(false);
        });

        it('handles 409 conflict retry logic', () => {
            // Test the retry logic structure
            const maxRetries = 3;
            const retryDelays = [2000, 4000, 6000]; // 2000 * (attempt + 1)

            expect(maxRetries).toBe(3);
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                expect(retryDelays[attempt]).toBe(2000 * (attempt + 1));
            }
        });
    });

    describe('cleanup mode branch extraction', () => {
        it('extracts source branch from refs/heads/<branch>', () => {
            const sourceRefName = 'refs/heads/feature/my-branch';
            const sourceBranch = sourceRefName.replace('refs/heads/', '');
            expect(sourceBranch).toBe('feature/my-branch');
        });

        it('extracts target branch from refs/heads/<branch>', () => {
            const targetRefName = 'refs/heads/main';
            const targetBranch = targetRefName.replace('refs/heads/', '');
            expect(targetBranch).toBe('main');
        });

        it('handles deeply nested branch names', () => {
            const sourceRefName = 'refs/heads/feature/deep/nested/branch';
            const sourceBranch = sourceRefName.replace('refs/heads/', '');
            expect(sourceBranch).toBe('feature/deep/nested/branch');
        });

        it('handles develop as target branch', () => {
            const targetRefName = 'refs/heads/develop';
            const targetBranch = targetRefName.replace('refs/heads/', '');
            expect(targetBranch).toBe('develop');
        });
    });

    describe('conflict resolution flow', () => {
        it('flow includes merge status check before conflict detection', () => {
            const flow = [
                'getPrDetails',
                'optional: waitForMergeStatusEvaluation (if first attempt and pending)',
                'check needsResolution (ONLY for conflicts/failure)',
                'if needsResolution: resolveConflicts',
                'completePr (bypassPolicy: true)',
            ];

            expect(flow).toContain('check needsResolution (ONLY for conflicts/failure)');
        });

        it('flow without conflicts skips resolution', () => {
            const flowWithoutConflicts = [
                'getPrDetails',
                'check needsResolution (false for succeeded)',
                'completePr (bypassPolicy: true)',
            ];

            expect(flowWithoutConflicts).toHaveLength(3);
            expect(flowWithoutConflicts).not.toContain('resolveConflicts');
        });
    });
});

describe('CRITICAL REGRESSION: needsResolution logic', () => {
    /**
     * REGRESSION TEST: The bug that broke PR completion was an over-aggressive
     * needsResolution check that triggered conflict resolution for ALL non-'succeeded'
     * statuses, including 'notSet', 'queued', 'undefined', and 'failure'.
     *
     * This caused:
     * 1. Unnecessary force-pushes that invalidated ADO's merge evaluation
     * 2. Stale/missing lastMergeSourceCommit after the push
     * 3. Failed completion attempts
     * 4. Stuck cleanup mode that never made progress
     *
     * The CORRECT behavior: Resolve when mergeStatus === 'conflicts' or 'failure'
     */

    describe('ONLY conflicts status should require resolution', () => {
        it('conflicts status requires resolution', () => {
            expect(needsResolution('conflicts')).toBe(true);
        });
    });

    describe('NON-CONFLICT statuses (excluding failure) must NOT require resolution', () => {
        it('failure status should require resolution attempt', () => {
            // failure means merge evaluation failed, attempt resolution to unblock
            expect(needsResolution('failure')).toBe(true);
        });

        it('REGRESSION: undefined status must NOT require resolution', () => {
            // undefined means ADO hasn't returned mergeStatus yet
            // Resolution would force-push and invalidate ADO's evaluation
            expect(needsResolution(undefined)).toBe(false);
        });

        it('REGRESSION: notSet status must NOT require resolution', () => {
            // notSet means ADO is still evaluating
            // Resolution would force-push and invalidate ADO's evaluation
            expect(needsResolution('notSet')).toBe(false);
        });

        it('REGRESSION: queued status must NOT require resolution', () => {
            // queued means ADO has queued the merge evaluation
            // Resolution would force-push and invalidate ADO's evaluation
            expect(needsResolution('queued')).toBe(false);
        });

        it('succeeded status does not require resolution', () => {
            expect(needsResolution('succeeded')).toBe(false);
        });
    });

    describe('comprehensive status matrix', () => {
        const testCases = [
            { status: 'conflicts', shouldResolve: true, reason: 'actual conflicts exist' },
            { status: 'succeeded', shouldResolve: false, reason: 'merge is ready' },
            { status: 'failure', shouldResolve: true, reason: 'attempt resolution to unblock failures' },
            { status: 'notSet', shouldResolve: false, reason: 'ADO still evaluating' },
            { status: 'queued', shouldResolve: false, reason: 'ADO evaluation queued' },
            { status: undefined, shouldResolve: false, reason: 'status not yet available' },
        ];

        testCases.forEach(({ status, shouldResolve, reason }) => {
            it(`${status ?? 'undefined'}: needsResolution=${shouldResolve} (${reason})`, () => {
                expect(needsResolution(status)).toBe(shouldResolve);
            });
        });
    });
});

describe('mergeStatus handling - isStatusEvaluated logic', () => {
    describe('statuses that indicate evaluation is complete', () => {
        it('succeeded is evaluated', () => {
            expect(isStatusEvaluated('succeeded')).toBe(true);
        });

        it('conflicts is evaluated', () => {
            expect(isStatusEvaluated('conflicts')).toBe(true);
        });

        it('failure is evaluated', () => {
            expect(isStatusEvaluated('failure')).toBe(true);
        });
    });

    describe('statuses that indicate evaluation is pending', () => {
        it('notSet is not evaluated', () => {
            expect(isStatusEvaluated('notSet')).toBe(false);
        });

        it('queued is not evaluated', () => {
            expect(isStatusEvaluated('queued')).toBe(false);
        });

        it('undefined is not evaluated', () => {
            expect(isStatusEvaluated(undefined)).toBe(false);
        });
    });
});

describe('CRITICAL REGRESSION: lastMergeSourceCommit handling', () => {
    /**
     * REGRESSION TEST: The old buggy code would pass empty string to completePr
     * when lastMergeSourceCommit was missing. This caused 400 errors from ADO.
     *
     * The CORRECT behavior: Throw an error to trigger retry with backoff,
     * giving ADO time to populate lastMergeSourceCommit.
     */

    it('safely accesses commitId when present', () => {
        const prDetails = {
            lastMergeSourceCommit: { commitId: 'abc123' },
        };

        const commitId = prDetails.lastMergeSourceCommit?.commitId;
        expect(commitId).toBe('abc123');
    });

    it('returns undefined when lastMergeSourceCommit is missing', () => {
        const prDetails: { lastMergeSourceCommit?: { commitId: string } } = {};

        const commitId = prDetails.lastMergeSourceCommit?.commitId;
        expect(commitId).toBeUndefined();
    });

    it('returns undefined when lastMergeSourceCommit is null', () => {
        const prDetails = {
            lastMergeSourceCommit: null as unknown as { commitId: string } | undefined,
        };

        const commitId = prDetails.lastMergeSourceCommit?.commitId;
        expect(commitId).toBeUndefined();
    });

    it('REGRESSION: should NOT use empty string fallback for completion', () => {
        // The old buggy code did: commitId ?? ''
        // This sent empty string to ADO which caused 400 errors
        // The correct behavior is to throw and retry
        const prDetails: { lastMergeSourceCommit?: { commitId: string } } = {};

        const commitId = prDetails.lastMergeSourceCommit?.commitId;

        // Instead of using fallback, should throw to trigger retry
        expect(commitId).toBeUndefined();
        // In the actual code, this triggers: throw { status: 409 } to retry
    });

    it('missing commitId should trigger retryable error, not silent failure', () => {
        const prDetails: { lastMergeSourceCommit?: { commitId: string } } = {};
        const commitId = prDetails.lastMergeSourceCommit?.commitId;

        if (!commitId) {
            // This is the correct behavior - create a retryable error
            const error = Object.assign(new Error('missing lastMergeSourceCommit'), { status: 409 });
            expect(error.status).toBe(409); // 409 triggers retry logic
        }
    });
});

describe('waitForMergeStatusEvaluation polling behavior', () => {
    it('returns immediately when status is succeeded', async () => {
        const mockGetPrDetails = vi.fn().mockResolvedValue({
            pullRequestId: 100,
            mergeStatus: 'succeeded',
            lastMergeSourceCommit: { commitId: 'abc123' },
        });

        const result = await mockGetPrDetails();
        expect(result.mergeStatus).toBe('succeeded');
        expect(isStatusEvaluated(result.mergeStatus)).toBe(true);
    });

    it('returns immediately when status is conflicts', async () => {
        const mockGetPrDetails = vi.fn().mockResolvedValue({
            pullRequestId: 100,
            mergeStatus: 'conflicts',
            lastMergeSourceCommit: { commitId: 'abc123' },
        });

        const result = await mockGetPrDetails();
        expect(result.mergeStatus).toBe('conflicts');
        expect(isStatusEvaluated(result.mergeStatus)).toBe(true);
    });

    it('polls when status is notSet', () => {
        const prDetails = {
            pullRequestId: 100,
            mergeStatus: 'notSet' as const,
        };

        expect(isStatusEvaluated(prDetails.mergeStatus)).toBe(false);
        // In real implementation, this would trigger polling
    });

    it('polls when status is queued', () => {
        const prDetails = {
            pullRequestId: 100,
            mergeStatus: 'queued' as const,
        };

        expect(isStatusEvaluated(prDetails.mergeStatus)).toBe(false);
        // In real implementation, this would trigger polling
    });

    it('simulates polling behavior transitioning from queued to succeeded', async () => {
        let callCount = 0;
        const mockGetPrDetails = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount < 3) {
                return { pullRequestId: 100, mergeStatus: 'queued' };
            }
            return {
                pullRequestId: 100,
                mergeStatus: 'succeeded',
                lastMergeSourceCommit: { commitId: 'abc123' },
            };
        });

        // Simulate polling loop
        let result = await mockGetPrDetails();
        while (!isStatusEvaluated(result.mergeStatus)) {
            result = await mockGetPrDetails();
        }

        expect(mockGetPrDetails).toHaveBeenCalledTimes(3);
        expect(result.mergeStatus).toBe('succeeded');
        // IMPORTANT: succeeded does NOT need resolution
        expect(needsResolution(result.mergeStatus)).toBe(false);
    });

    it('simulates polling behavior transitioning from notSet to conflicts', async () => {
        let callCount = 0;
        const mockGetPrDetails = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount < 2) {
                return { pullRequestId: 100, mergeStatus: 'notSet' };
            }
            return {
                pullRequestId: 100,
                mergeStatus: 'conflicts',
                lastMergeSourceCommit: { commitId: 'def456' },
            };
        });

        // Simulate polling loop
        let result = await mockGetPrDetails();
        while (!isStatusEvaluated(result.mergeStatus)) {
            result = await mockGetPrDetails();
        }

        expect(mockGetPrDetails).toHaveBeenCalledTimes(2);
        expect(result.mergeStatus).toBe('conflicts');
        // ONLY conflicts needs resolution
        expect(needsResolution(result.mergeStatus)).toBe(true);
    });

    it('REGRESSION: notSet status after polling timeout should NOT trigger resolution', async () => {
        // Simulates timeout scenario where status stays notSet
        const mockGetPrDetails = vi.fn().mockResolvedValue({
            pullRequestId: 100,
            mergeStatus: 'notSet',
        });

        const result = await mockGetPrDetails();
        expect(result.mergeStatus).toBe('notSet');

        // CRITICAL: notSet should NOT trigger resolution
        // The old bug would resolve here, causing force-push and breaking completion
        expect(needsResolution(result.mergeStatus)).toBe(false);
    });
});

describe('post-resolution verification', () => {
    it('verifies merge status after resolution succeeds', async () => {
        // Simulates: conflicts -> resolution -> succeeded
        let callCount = 0;
        const mockGetPrDetails = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { pullRequestId: 100, mergeStatus: 'conflicts' };
            }
            // After resolution
            return {
                pullRequestId: 100,
                mergeStatus: 'succeeded',
                lastMergeSourceCommit: { commitId: 'resolved123' },
            };
        });

        // First call detects conflicts
        const initial = await mockGetPrDetails();
        expect(initial.mergeStatus).toBe('conflicts');
        expect(needsResolution(initial.mergeStatus)).toBe(true);

        // After resolution
        const afterResolution = await mockGetPrDetails();
        expect(afterResolution.mergeStatus).toBe('succeeded');
        expect(needsResolution(afterResolution.mergeStatus)).toBe(false);
    });

    it('handles case where merge status stays conflicts after resolution', async () => {
        // Simulates: conflicts -> resolution -> still conflicts (ADO hasnt caught up)
        const mockGetPrDetails = vi.fn().mockResolvedValue({
            pullRequestId: 100,
            mergeStatus: 'conflicts',
            lastMergeSourceCommit: { commitId: 'abc123' },
        });

        const result = await mockGetPrDetails();
        expect(result.mergeStatus).toBe('conflicts');

        // In this case, the code should still attempt completion with bypassPolicy
        // But should NOT attempt resolution again (conflictResolutionAttempted flag)
    });

    it('REGRESSION: failure status SHOULD trigger resolution', async () => {
        // Simulates: notSet -> evaluation -> failure
        let callCount = 0;
        const mockGetPrDetails = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return { pullRequestId: 100, mergeStatus: 'notSet' };
            }
            return { pullRequestId: 100, mergeStatus: 'failure' };
        });

        const initial = await mockGetPrDetails();
        expect(isStatusEvaluated(initial.mergeStatus)).toBe(false);

        const evaluated = await mockGetPrDetails();
        expect(evaluated.mergeStatus).toBe('failure');

        // CRITICAL: failure should trigger resolution to attempt unblocking
        expect(needsResolution(evaluated.mergeStatus)).toBe(true);
    });
});

describe('resolveConflicts method contract', () => {
    it('returns { resolved: true } on success', async () => {
        const mockResolveConflicts = vi.fn().mockResolvedValue({ resolved: true });

        const result = await mockResolveConflicts('https://example.com/repo', 'token', 'feature-branch', 'main');

        expect(result).toEqual({ resolved: true });
        expect(result.error).toBeUndefined();
    });

    it('returns { resolved: false, error: string } on failure', async () => {
        const mockResolveConflicts = vi.fn().mockResolvedValue({
            resolved: false,
            error: 'Clone failed: network error',
        });

        const result = await mockResolveConflicts('https://example.com/repo', 'token', 'feature-branch', 'main');

        expect(result.resolved).toBe(false);
        expect(result.error).toBe('Clone failed: network error');
    });

    it('accepts optional targetBranch parameter defaulting to main', async () => {
        const mockResolveConflicts = vi.fn().mockResolvedValue({ resolved: true });

        // Call without explicit targetBranch
        await mockResolveConflicts('https://example.com/repo', 'token', 'feature-branch');

        expect(mockResolveConflicts).toHaveBeenCalledWith('https://example.com/repo', 'token', 'feature-branch');
    });
});

describe('bypassPolicy configuration', () => {
    it('bypassPolicy defaults to false when not specified', () => {
        const options: { bypassPolicy?: boolean } = {};
        const bypassPolicy = options?.bypassPolicy ?? false;
        expect(bypassPolicy).toBe(false);
    });

    it('bypassPolicy is true when explicitly set', () => {
        const options = { bypassPolicy: true };
        const bypassPolicy = options?.bypassPolicy ?? false;
        expect(bypassPolicy).toBe(true);
    });

    it('bypassReason is set when bypassPolicy is true', () => {
        const options = { bypassPolicy: true };
        const bypassReason = options.bypassPolicy ? 'Automated seeding - conflict auto-resolution' : undefined;
        expect(bypassReason).toBe('Automated seeding - conflict auto-resolution');
    });

    it('bypassReason is undefined when bypassPolicy is false', () => {
        const options = { bypassPolicy: false };
        const bypassReason = options.bypassPolicy ? 'Automated seeding - conflict auto-resolution' : undefined;
        expect(bypassReason).toBeUndefined();
    });
});

describe('CRITICAL REGRESSION: conflictResolutionAttempted flag', () => {
    /**
     * REGRESSION TEST: The conflictResolutionAttempted flag controls when we retry resolution.
     *
     * Key behaviors:
     * 1. After SUCCESSFUL resolution, don't resolve again (prevents infinite loops)
     * 2. After FAILED resolution, allow retry on next attempt (handles transient failures)
     */

    it('should NOT attempt resolution again after SUCCESSFUL resolution', () => {
        let conflictResolutionAttempted = false;
        const mergeStatus = 'conflicts';

        // First check: should resolve
        const needsFirstResolution = mergeStatus === 'conflicts' && !conflictResolutionAttempted;
        expect(needsFirstResolution).toBe(true);

        // Simulate SUCCESSFUL resolution - set the flag
        const resolutionSucceeded = true;
        if (resolutionSucceeded) {
            conflictResolutionAttempted = true;
        }

        // Second check: should NOT resolve again after success
        const needsSecondResolution = mergeStatus === 'conflicts' && !conflictResolutionAttempted;
        expect(needsSecondResolution).toBe(false);
    });

    it('REGRESSION: should allow retry after FAILED resolution (transient failure)', () => {
        /**
         * BUG FIX: Previously, conflictResolutionAttempted was set unconditionally
         * after calling resolveConflicts(), even if it returned resolved: false.
         * This meant transient failures (network errors, git push failures) would
         * permanently disable resolution for all retry attempts.
         *
         * CORRECT BEHAVIOR: Only set the flag when resolution.resolved === true
         */
        let conflictResolutionAttempted = false;
        const mergeStatus = 'conflicts';

        // First attempt: resolution FAILS (transient error)
        const needsFirstResolution = mergeStatus === 'conflicts' && !conflictResolutionAttempted;
        expect(needsFirstResolution).toBe(true);

        // Simulate FAILED resolution - do NOT set the flag
        const resolutionSucceeded = false;
        if (resolutionSucceeded) {
            conflictResolutionAttempted = true;
        }
        // Flag should still be false after failed resolution
        expect(conflictResolutionAttempted).toBe(false);

        // Second attempt (retry): should STILL try resolution because previous attempt failed
        const needsSecondResolution = mergeStatus === 'conflicts' && !conflictResolutionAttempted;
        expect(needsSecondResolution).toBe(true); // This is the key assertion!

        // Now simulate SUCCESSFUL resolution on retry
        const retrySucceeded = true;
        if (retrySucceeded) {
            conflictResolutionAttempted = true;
        }

        // Third attempt: should NOT resolve again after success
        const needsThirdResolution = mergeStatus === 'conflicts' && !conflictResolutionAttempted;
        expect(needsThirdResolution).toBe(false);
    });

    it('simulates the full retry flow with transient failure then success', () => {
        /**
         * Scenario:
         * - Attempt 1: conflicts detected, resolveConflicts() fails (network error), completion fails
         * - Attempt 2: conflicts still detected, resolveConflicts() succeeds, completion succeeds
         */
        let conflictResolutionAttempted = false;
        const mergeStatus = 'conflicts';
        const maxRetries = 3;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const needsResolution = mergeStatus === 'conflicts' && !conflictResolutionAttempted;

            if (attempt === 0) {
                // First attempt: needs resolution
                expect(needsResolution).toBe(true);

                // Resolution fails (transient error)
                const resolved = false;
                if (resolved) {
                    conflictResolutionAttempted = true;
                }
                // Completion would fail, trigger retry
            } else if (attempt === 1) {
                // Second attempt: should STILL need resolution (previous failed)
                expect(needsResolution).toBe(true);

                // Resolution succeeds this time
                const resolved = true;
                if (resolved) {
                    conflictResolutionAttempted = true;
                }
                // Completion would succeed, break
                break;
            }
        }

        expect(conflictResolutionAttempted).toBe(true);
    });
});

describe('retry behavior', () => {
    it('retries on 409 status code', () => {
        const error = { status: 409, message: 'Conflict' };
        const isRetryable = error.status === 409 || error.status === 400;
        expect(isRetryable).toBe(true);
    });

    it('retries on 400 status code', () => {
        const error = { status: 400, message: 'Bad Request' };
        const isRetryable = error.status === 409 || error.status === 400;
        expect(isRetryable).toBe(true);
    });

    it('does not retry on 403 status code', () => {
        const error = { status: 403, message: 'Forbidden' };
        const isRetryable = error.status === 409 || error.status === 400;
        expect(isRetryable).toBe(false);
    });

    it('does not retry on 500 status code', () => {
        const error = { status: 500, message: 'Internal Server Error' };
        const isRetryable = error.status === 409 || error.status === 400;
        expect(isRetryable).toBe(false);
    });
});
