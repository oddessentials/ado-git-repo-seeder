import { AxiosInstance } from 'axios';

export interface PullRequest {
    pullRequestId: number;
    title: string;
    status: 'active' | 'completed' | 'abandoned';
    sourceRefName: string;
    targetRefName: string;
    url: string;
}

export type VoteValue = 10 | 5 | -10 | 0; // approve, approveWithSuggestions, reject, noVote

export interface CreatePrOptions {
    project: string;
    repoId: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
    isDraft?: boolean;
}

export interface AddReviewerOptions {
    project: string;
    repoId: string;
    prId: number;
    reviewerId: string;
}

export interface AddCommentOptions {
    project: string;
    repoId: string;
    prId: number;
    content: string;
}

export interface CastVoteOptions {
    project: string;
    repoId: string;
    prId: number;
    reviewerId: string;
    vote: VoteValue;
}

/**
 * Pull Request operations for Azure DevOps.
 */
export class PrManager {
    private client: AxiosInstance;

    constructor(client: AxiosInstance) {
        this.client = client;
    }

    /**
     * Creates a pull request.
     */
    async createPr(options: CreatePrOptions): Promise<PullRequest> {
        const response = await this.client.post(
            `/${options.project}/_apis/git/repositories/${options.repoId}/pullrequests`,
            {
                sourceRefName: `refs/heads/${options.sourceBranch}`,
                targetRefName: `refs/heads/${options.targetBranch}`,
                title: options.title,
                description: options.description,
                isDraft: options.isDraft ?? false,
            },
            { params: { 'api-version': '7.1' } }
        );
        return response.data;
    }

    /**
     * Adds a reviewer to a pull request.
     */
    async addReviewer(options: AddReviewerOptions): Promise<void> {
        await this.client.put(
            `/${options.project}/_apis/git/repositories/${options.repoId}/pullrequests/${options.prId}/reviewers/${options.reviewerId}`,
            { vote: 0 }, // Initial vote = no vote
            { params: { 'api-version': '7.1' } }
        );
    }

    /**
     * Adds a comment thread to a pull request.
     */
    async addComment(options: AddCommentOptions): Promise<void> {
        await this.client.post(
            `/${options.project}/_apis/git/repositories/${options.repoId}/pullrequests/${options.prId}/threads`,
            {
                comments: [
                    {
                        parentCommentId: 0,
                        content: options.content,
                        commentType: 1, // Text comment
                    },
                ],
                status: 1, // Active
            },
            { params: { 'api-version': '7.1' } }
        );
    }

    /**
     * Casts a vote on a pull request.
     */
    async castVote(options: CastVoteOptions): Promise<void> {
        await this.client.put(
            `/${options.project}/_apis/git/repositories/${options.repoId}/pullrequests/${options.prId}/reviewers/${options.reviewerId}`,
            { vote: options.vote },
            { params: { 'api-version': '7.1' } }
        );
    }

    /**
     * Completes a pull request (merge).
     */
    async completePr(project: string, repoId: string, prId: number, lastMergeSourceCommit: string): Promise<void> {
        await this.client.patch(
            `/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}`,
            {
                status: 'completed',
                lastMergeSourceCommit: { commitId: lastMergeSourceCommit },
                completionOptions: {
                    deleteSourceBranch: false,
                    mergeStrategy: 'squash',
                },
            },
            { params: { 'api-version': '7.1' } }
        );
    }

    /**
     * Gets a pull request by ID.
     */
    async getPrDetails(
        project: string,
        repoId: string,
        prId: number
    ): Promise<PullRequest & { lastMergeSourceCommit: { commitId: string } }> {
        const response = await this.client.get(`/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}`, {
            params: { 'api-version': '7.1' },
        });
        return response.data;
    }

    /**
     * Abandons a pull request.
     */
    async abandonPr(project: string, repoId: string, prId: number): Promise<void> {
        await this.client.patch(
            `/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}`,
            { status: 'abandoned' },
            { params: { 'api-version': '7.1' } }
        );
    }

    /**
     * Publishes a draft PR (converts it to a regular PR).
     */
    async publishDraft(project: string, repoId: string, prId: number): Promise<void> {
        await this.client.patch(
            `/${project}/_apis/git/repositories/${repoId}/pullrequests/${prId}`,
            { isDraft: false },
            { params: { 'api-version': '7.1' } }
        );
    }

    /**
     * Gets policy configurations for a project.
     */
    async getPolicyConfigurations(project: string): Promise<any[]> {
        const response = await this.client.get(`/${project}/_apis/policy/configurations`, {
            params: { 'api-version': '7.1' },
        });
        return response.data?.value ?? [];
    }

    /**
     * Lists open (active) pull requests for a repository.
     * Returns PRs sorted by creation date (oldest first).
     */
    async listOpenPrs(project: string, repoId: string): Promise<PullRequest[]> {
        const response = await this.client.get(`/${project}/_apis/git/repositories/${repoId}/pullrequests`, {
            params: {
                'api-version': '7.1',
                'searchCriteria.status': 'active',
            },
        });
        return response.data?.value ?? [];
    }
}
