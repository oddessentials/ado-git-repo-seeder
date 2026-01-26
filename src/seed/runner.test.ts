/**
 * Tests for SeedRunner - the main execution engine.
 *
 * Tests the exported interface and types without mocking internal dependencies.
 * For more thorough integration testing, see runner.cleanup.test.ts
 */
import { describe, it, expect } from 'vitest';
import type { CleanupOptions } from './runner.js';
import type { SeedSummary } from './summary.js';

describe('CleanupOptions interface', () => {
    it('has correct type structure', () => {
        const options: CleanupOptions = {
            cleanupEnabled: true,
            cleanupThreshold: 50,
        };

        expect(options.cleanupEnabled).toBe(true);
        expect(options.cleanupThreshold).toBe(50);
    });

    it('supports disabled cleanup', () => {
        const options: CleanupOptions = {
            cleanupEnabled: false,
            cleanupThreshold: 100,
        };

        expect(options.cleanupEnabled).toBe(false);
    });

    it('supports custom thresholds', () => {
        const options: CleanupOptions = {
            cleanupEnabled: true,
            cleanupThreshold: 25,
        };

        expect(options.cleanupThreshold).toBe(25);
    });
});

describe('SeedSummary type structure', () => {
    it('validates summary shape for normal run', () => {
        const summary: SeedSummary = {
            version: '1.0.0',
            runId: 'test-run',
            org: 'test-org',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            repos: [],
            fatalFailure: null,
            cleanupMode: false,
        };

        expect(summary.version).toBe('1.0.0');
        expect(summary.cleanupMode).toBe(false);
        expect(summary.fatalFailure).toBeNull();
    });

    it('validates summary shape for cleanup mode', () => {
        const summary: SeedSummary = {
            version: '1.0.0',
            runId: 'cleanup-run',
            org: 'test-org',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            repos: [],
            fatalFailure: null,
            cleanupMode: true,
            cleanupStats: {
                draftsPublished: 5,
                prsCompleted: 10,
                prsFailed: 2,
            },
        };

        expect(summary.cleanupMode).toBe(true);
        expect(summary.cleanupStats?.prsCompleted).toBe(10);
    });

    it('validates summary shape for fatal failure', () => {
        const summary: SeedSummary = {
            version: '1.0.0',
            runId: 'failed-run',
            org: 'test-org',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            repos: [],
            fatalFailure: {
                phase: 'execution',
                error: 'Something went wrong',
            },
            cleanupMode: false,
        };

        expect(summary.fatalFailure).not.toBeNull();
        expect(summary.fatalFailure?.phase).toBe('execution');
    });

    it('validates repo results in summary', () => {
        const summary: SeedSummary = {
            version: '1.0.0',
            runId: 'repo-run',
            org: 'test-org',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            repos: [
                {
                    project: 'TestProject',
                    repoName: 'TestRepo',
                    repoId: 'repo-123',
                    resolvedNaming: 'isolated',
                    branchesCreated: 3,
                    prs: [
                        {
                            prId: 1,
                            title: 'Test PR',
                            creator: 'user@test.com',
                            reviewers: [{ email: 'reviewer@test.com', vote: 'approve' }],
                            comments: 2,
                            followUpCommitsAdded: 1,
                            outcome: 'complete',
                            outcomeApplied: true,
                        },
                    ],
                    failures: [],
                },
            ],
            fatalFailure: null,
            cleanupMode: false,
        };

        expect(summary.repos).toHaveLength(1);
        expect(summary.repos[0].prs).toHaveLength(1);
        expect(summary.repos[0].prs[0].outcome).toBe('complete');
    });
});

describe('SeedRunner module exports', () => {
    it('exports SeedRunner class', async () => {
        const { SeedRunner } = await import('./runner.js');
        expect(SeedRunner).toBeDefined();
        expect(typeof SeedRunner).toBe('function');
    });

    it('exports CleanupOptions type via interface check', async () => {
        // Type-only export - verified by compilation
        const options: CleanupOptions = { cleanupEnabled: true, cleanupThreshold: 50 };
        expect(options).toBeDefined();
    });
});
