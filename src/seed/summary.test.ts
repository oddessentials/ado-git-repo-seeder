import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMarkdownSummary, writeSummary, printSummary } from './summary.js';
import type { SeedSummary } from './summary.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('summary', () => {
    describe('generateMarkdownSummary()', () => {
        const baseSummary: SeedSummary = {
            version: '1.1.0',
            runId: 'test-run-001',
            org: 'test-org',
            startTime: '2026-01-12T10:00:00Z',
            endTime: '2026-01-12T10:05:00Z',
            repos: [],
            fatalFailure: null,
        };

        it('includes run metadata', () => {
            const md = generateMarkdownSummary(baseSummary);

            expect(md).toContain('test-run-001');
            expect(md).toContain('test-org');
            expect(md).toContain('2026-01-12T10:00:00Z');
        });

        it('shows fatal failure prominently', () => {
            const summaryWithFatal: SeedSummary = {
                ...baseSummary,
                fatalFailure: {
                    phase: 'initialization',
                    error: 'Auth failed',
                },
            };

            const md = generateMarkdownSummary(summaryWithFatal);

            expect(md).toContain('Fatal Failure');
            expect(md).toContain('initialization');
            expect(md).toContain('Auth failed');
        });

        it('calculates statistics correctly', () => {
            const summaryWithData: SeedSummary = {
                ...baseSummary,
                repos: [
                    {
                        project: 'p1',
                        repoName: 'r1',
                        repoId: 'id1',
                        resolvedNaming: 'isolated',
                        branchesCreated: 3,
                        prs: [
                            {
                                prId: 1,
                                title: 'PR1',
                                creator: 'a@b.com',
                                reviewers: [],
                                comments: 2,
                                outcome: 'complete',
                                outcomeApplied: true,
                                followUpCommitsAdded: 0,
                            },
                            {
                                prId: 2,
                                title: 'PR2',
                                creator: 'c@d.com',
                                reviewers: [],
                                comments: 1,
                                outcome: 'abandon',
                                outcomeApplied: true,
                                followUpCommitsAdded: 0,
                            },
                        ],
                        failures: [],
                    },
                    {
                        project: 'p2',
                        repoName: 'r2',
                        repoId: 'id2',
                        resolvedNaming: 'direct',
                        branchesCreated: 2,
                        prs: [
                            {
                                prId: 3,
                                title: 'PR3',
                                creator: 'e@f.com',
                                reviewers: [],
                                comments: 0,
                                outcome: 'leaveOpen',
                                outcomeApplied: true,
                                followUpCommitsAdded: 0,
                            },
                        ],
                        failures: [{ phase: 'add-comment', error: 'timeout', isFatal: false }],
                    },
                ],
            };

            const md = generateMarkdownSummary(summaryWithData);

            expect(md).toContain('Repositories:** 2');
            expect(md).toContain('Branches Created:** 5');
            expect(md).toContain('Pull Requests:** 3');
            expect(md).toContain('Non-Fatal Failures:** 1');
        });

        it('includes PR details', () => {
            const summaryWithPr: SeedSummary = {
                ...baseSummary,
                repos: [
                    {
                        project: 'proj',
                        repoName: 'repo',
                        repoId: 'rid',
                        resolvedNaming: 'isolated',
                        branchesCreated: 1,
                        prs: [
                            {
                                prId: 42,
                                title: 'Test PR Title',
                                creator: 'creator@test.com',
                                reviewers: [{ email: 'rev@test.com', vote: 'approve' }],
                                comments: 3,
                                outcome: 'complete',
                                outcomeApplied: true,
                                followUpCommitsAdded: 0,
                            },
                        ],
                        failures: [],
                    },
                ],
            };

            const md = generateMarkdownSummary(summaryWithPr);

            expect(md).toContain('#42');
            expect(md).toContain('Test PR Title');
            expect(md).toContain('creator@test.com');
            expect(md).toContain('rev@test.com');
            expect(md).toContain('approve');
        });

        it('includes failure details', () => {
            const summaryWithFailures: SeedSummary = {
                ...baseSummary,
                repos: [
                    {
                        project: 'proj',
                        repoName: 'repo',
                        repoId: 'rid',
                        resolvedNaming: 'direct',
                        branchesCreated: 1,
                        prs: [],
                        failures: [{ phase: 'create-pr', error: 'Network error', isFatal: false, prId: 5 }],
                    },
                ],
            };

            const md = generateMarkdownSummary(summaryWithFailures);

            expect(md).toContain('create-pr');
            expect(md).toContain('PR #5');
            expect(md).toContain('Network error');
        });

        describe('cleanup mode', () => {
            it('shows cleanup mode header and statistics when cleanupMode is true', () => {
                const cleanupSummary: SeedSummary = {
                    ...baseSummary,
                    repos: [], // Empty in cleanup mode
                    cleanupMode: true,
                    cleanupStats: {
                        draftsPublished: 5,
                        prsCompleted: 213,
                        prsFailed: 2,
                        completionTarget: 200,
                        openPrsBefore: 400,
                        openPrsAfter: 187,
                    },
                };

                const md = generateMarkdownSummary(cleanupSummary);

                expect(md).toContain('Cleanup Mode');
                expect(md).toContain('PRs Completed:** 213');
                expect(md).toContain('Drafts Published:** 5');
                expect(md).toContain('PRs Failed:** 2');
                expect(md).toContain('Completion Target:** 200');
                expect(md).toContain('Open PRs Before:** 400');
                expect(md).toContain('Open PRs After:** 187');
            });

            it('does not show normal statistics in cleanup mode', () => {
                const cleanupSummary: SeedSummary = {
                    ...baseSummary,
                    repos: [],
                    cleanupMode: true,
                    cleanupStats: {
                        draftsPublished: 0,
                        prsCompleted: 50,
                        prsFailed: 0,
                    },
                };

                const md = generateMarkdownSummary(cleanupSummary);

                // Should NOT contain normal seeding stats
                expect(md).not.toContain('Repositories:**');
                expect(md).not.toContain('Branches Created:**');
                expect(md).not.toContain('Non-Fatal Failures:**');
            });

            it('includes cleanup explanation text', () => {
                const cleanupSummary: SeedSummary = {
                    ...baseSummary,
                    cleanupMode: true,
                    cleanupStats: {
                        draftsPublished: 0,
                        prsCompleted: 10,
                        prsFailed: 0,
                    },
                };

                const md = generateMarkdownSummary(cleanupSummary);

                expect(md).toContain('threshold');
                expect(md).toContain('prioritized');
            });

            it('still shows fatal failure in cleanup mode', () => {
                const cleanupWithFatal: SeedSummary = {
                    ...baseSummary,
                    cleanupMode: true,
                    cleanupStats: {
                        draftsPublished: 0,
                        prsCompleted: 0,
                        prsFailed: 0,
                    },
                    fatalFailure: {
                        phase: 'identity-resolution',
                        error: 'Failed to resolve user',
                    },
                };

                const md = generateMarkdownSummary(cleanupWithFatal);

                expect(md).toContain('Fatal Failure');
                expect(md).toContain('identity-resolution');
                expect(md).toContain('Failed to resolve user');
            });
        });

        it('includes follow-up commits when greater than zero', () => {
            const summaryWithFollowUp: SeedSummary = {
                ...baseSummary,
                repos: [
                    {
                        project: 'proj',
                        repoName: 'repo',
                        repoId: 'rid',
                        resolvedNaming: 'isolated',
                        branchesCreated: 1,
                        prs: [
                            {
                                prId: 99,
                                title: 'PR with follow-ups',
                                creator: 'dev@test.com',
                                reviewers: [],
                                comments: 0,
                                outcome: 'complete',
                                outcomeApplied: true,
                                followUpCommitsAdded: 3,
                            },
                        ],
                        failures: [],
                    },
                ],
            };

            const md = generateMarkdownSummary(summaryWithFollowUp);

            expect(md).toContain('Follow-up Commits: 3');
        });

        it('handles repo with null repoId', () => {
            const summaryWithNullRepoId: SeedSummary = {
                ...baseSummary,
                repos: [
                    {
                        project: 'proj',
                        repoName: 'repo',
                        repoId: null,
                        resolvedNaming: 'isolated',
                        branchesCreated: 0,
                        prs: [],
                        failures: [],
                    },
                ],
            };

            const md = generateMarkdownSummary(summaryWithNullRepoId);

            expect(md).toContain('Repo ID:** N/A');
        });
    });

    describe('writeSummary()', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = mkdtempSync(join(tmpdir(), 'summary-test-'));
        });

        afterEach(() => {
            rmSync(tempDir, { recursive: true, force: true });
        });

        it('writes summary to JSON file', () => {
            const summary: SeedSummary = {
                version: '1.0.0',
                runId: 'write-test',
                org: 'test-org',
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:01:00Z',
                repos: [],
                fatalFailure: null,
            };

            const outputPath = join(tempDir, 'summary.json');
            writeSummary(summary, outputPath);

            const content = readFileSync(outputPath, 'utf-8');
            const parsed = JSON.parse(content);

            expect(parsed.runId).toBe('write-test');
            expect(parsed.version).toBe('1.0.0');
        });

        it('writes formatted JSON with indentation', () => {
            const summary: SeedSummary = {
                version: '1.0.0',
                runId: 'formatted-test',
                org: 'org',
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:01:00Z',
                repos: [],
                fatalFailure: null,
            };

            const outputPath = join(tempDir, 'formatted.json');
            writeSummary(summary, outputPath);

            const content = readFileSync(outputPath, 'utf-8');
            // Check for indentation (formatted JSON)
            expect(content).toContain('\n  ');
        });
    });

    describe('printSummary()', () => {
        it('logs markdown summary to console', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            const summary: SeedSummary = {
                version: '1.0.0',
                runId: 'print-test',
                org: 'test-org',
                startTime: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:01:00Z',
                repos: [],
                fatalFailure: null,
            };

            printSummary(summary);

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('print-test'));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test-org'));

            consoleSpy.mockRestore();
        });
    });
});
