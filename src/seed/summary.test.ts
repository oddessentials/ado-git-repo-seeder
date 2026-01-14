import { describe, it, expect } from 'vitest';
import { generateMarkdownSummary } from './summary.js';
import type { SeedSummary } from './summary.js';

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
    });
});
