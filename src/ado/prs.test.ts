/**
 * Tests for PrManager with mocked AxiosInstance.
 *
 * Covers all PR operations: create, review, comment, complete, abandon.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrManager } from './prs.js';

describe('PrManager', () => {
    let mockClient: any;
    let prManager: PrManager;

    beforeEach(() => {
        mockClient = {
            get: vi.fn(),
            post: vi.fn(),
            put: vi.fn(),
            patch: vi.fn(),
        };
        prManager = new PrManager(mockClient);
    });

    describe('createPr', () => {
        it('creates a pull request with correct payload', async () => {
            const expectedPr = { pullRequestId: 123, title: 'Test PR' };
            mockClient.post.mockResolvedValue({ data: expectedPr });

            const result = await prManager.createPr({
                project: 'my-project',
                repoId: 'repo-123',
                sourceBranch: 'feature/test',
                targetBranch: 'main',
                title: 'Test PR',
                description: 'Test description',
                isDraft: false,
            });

            expect(mockClient.post).toHaveBeenCalledWith(
                '/my-project/_apis/git/repositories/repo-123/pullrequests',
                {
                    sourceRefName: 'refs/heads/feature/test',
                    targetRefName: 'refs/heads/main',
                    title: 'Test PR',
                    description: 'Test description',
                    isDraft: false,
                },
                { params: { 'api-version': '7.1' } }
            );
            expect(result).toEqual(expectedPr);
        });

        it('creates draft PR when isDraft is true', async () => {
            mockClient.post.mockResolvedValue({ data: { pullRequestId: 456 } });

            await prManager.createPr({
                project: 'proj',
                repoId: 'repo',
                sourceBranch: 'draft-branch',
                targetBranch: 'main',
                title: 'Draft PR',
                description: 'WIP',
                isDraft: true,
            });

            expect(mockClient.post).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ isDraft: true }),
                expect.any(Object)
            );
        });
    });

    describe('addReviewer', () => {
        it('adds reviewer with initial no-vote', async () => {
            mockClient.put.mockResolvedValue({});

            await prManager.addReviewer({
                project: 'proj',
                repoId: 'repo',
                prId: 100,
                reviewerId: 'user-guid-123',
            });

            expect(mockClient.put).toHaveBeenCalledWith(
                '/proj/_apis/git/repositories/repo/pullrequests/100/reviewers/user-guid-123',
                { vote: 0 },
                { params: { 'api-version': '7.1' } }
            );
        });
    });

    describe('addComment', () => {
        it('adds comment thread to PR', async () => {
            mockClient.post.mockResolvedValue({});

            await prManager.addComment({
                project: 'proj',
                repoId: 'repo',
                prId: 100,
                content: 'LGTM!',
            });

            expect(mockClient.post).toHaveBeenCalledWith(
                '/proj/_apis/git/repositories/repo/pullrequests/100/threads',
                {
                    comments: [
                        {
                            parentCommentId: 0,
                            content: 'LGTM!',
                            commentType: 1,
                        },
                    ],
                    status: 1,
                },
                { params: { 'api-version': '7.1' } }
            );
        });
    });

    describe('castVote', () => {
        it('casts approval vote (10)', async () => {
            mockClient.put.mockResolvedValue({});

            await prManager.castVote({
                project: 'proj',
                repoId: 'repo',
                prId: 100,
                reviewerId: 'reviewer-id',
                vote: 10,
            });

            expect(mockClient.put).toHaveBeenCalledWith(
                '/proj/_apis/git/repositories/repo/pullrequests/100/reviewers/reviewer-id',
                { vote: 10 },
                { params: { 'api-version': '7.1' } }
            );
        });

        it('casts rejection vote (-10)', async () => {
            mockClient.put.mockResolvedValue({});

            await prManager.castVote({
                project: 'proj',
                repoId: 'repo',
                prId: 100,
                reviewerId: 'reviewer-id',
                vote: -10,
            });

            expect(mockClient.put).toHaveBeenCalledWith(expect.any(String), { vote: -10 }, expect.any(Object));
        });
    });

    describe('completePr', () => {
        it('completes PR with squash merge', async () => {
            mockClient.patch.mockResolvedValue({});

            await prManager.completePr('proj', 'repo', 100, 'abc123');

            expect(mockClient.patch).toHaveBeenCalledWith(
                '/proj/_apis/git/repositories/repo/pullrequests/100',
                {
                    status: 'completed',
                    lastMergeSourceCommit: { commitId: 'abc123' },
                    completionOptions: {
                        deleteSourceBranch: false,
                        mergeStrategy: 'squash',
                    },
                },
                { params: { 'api-version': '7.1' } }
            );
        });
    });

    describe('abandonPr', () => {
        it('abandons PR by setting status', async () => {
            mockClient.patch.mockResolvedValue({});

            await prManager.abandonPr('proj', 'repo', 100);

            expect(mockClient.patch).toHaveBeenCalledWith(
                '/proj/_apis/git/repositories/repo/pullrequests/100',
                { status: 'abandoned' },
                { params: { 'api-version': '7.1' } }
            );
        });
    });

    describe('publishDraft', () => {
        it('publishes draft by setting isDraft to false', async () => {
            mockClient.patch.mockResolvedValue({});

            await prManager.publishDraft('proj', 'repo', 100);

            expect(mockClient.patch).toHaveBeenCalledWith(
                '/proj/_apis/git/repositories/repo/pullrequests/100',
                { isDraft: false },
                { params: { 'api-version': '7.1' } }
            );
        });
    });

    describe('getPrDetails', () => {
        it('fetches PR details by ID', async () => {
            const prDetails = {
                pullRequestId: 100,
                title: 'Test',
                lastMergeSourceCommit: { commitId: 'xyz789' },
            };
            mockClient.get.mockResolvedValue({ data: prDetails });

            const result = await prManager.getPrDetails('proj', 'repo', 100);

            expect(mockClient.get).toHaveBeenCalledWith('/proj/_apis/git/repositories/repo/pullrequests/100', {
                params: { 'api-version': '7.1' },
            });
            expect(result).toEqual(prDetails);
        });
    });

    describe('getPolicyConfigurations', () => {
        it('fetches policy configurations for project', async () => {
            const policies = [{ type: { displayName: 'Minimum reviewer count' } }];
            mockClient.get.mockResolvedValue({ data: { value: policies } });

            const result = await prManager.getPolicyConfigurations('proj');

            expect(mockClient.get).toHaveBeenCalledWith('/proj/_apis/policy/configurations', {
                params: { 'api-version': '7.1' },
            });
            expect(result).toEqual(policies);
        });

        it('returns empty array when no policies exist', async () => {
            mockClient.get.mockResolvedValue({ data: {} });

            const result = await prManager.getPolicyConfigurations('proj');

            expect(result).toEqual([]);
        });
    });

    describe('listOpenPrs', () => {
        it('lists active PRs for repository', async () => {
            const openPrs = [
                { pullRequestId: 1, status: 'active' },
                { pullRequestId: 2, status: 'active' },
            ];
            mockClient.get.mockResolvedValue({ data: { value: openPrs } });

            const result = await prManager.listOpenPrs('proj', 'repo');

            expect(mockClient.get).toHaveBeenCalledWith('/proj/_apis/git/repositories/repo/pullrequests', {
                params: {
                    'api-version': '7.1',
                    'searchCriteria.status': 'active',
                },
            });
            expect(result).toEqual(openPrs);
        });

        it('returns empty array when no open PRs', async () => {
            mockClient.get.mockResolvedValue({ data: {} });

            const result = await prManager.listOpenPrs('proj', 'repo');

            expect(result).toEqual([]);
        });
    });
});
