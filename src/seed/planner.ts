import { SeededRng } from '../util/rng.js';
import { LoadedConfig, ResolvedUser } from '../config.js';
import { VoteValue } from '../ado/prs.js';

export type PrOutcome = 'complete' | 'abandon' | 'leaveOpen';
export type VoteType = 'approve' | 'approveWithSuggestions' | 'reject' | 'noVote';

export interface PlannedBranch {
    name: string;
    commits: number;
}

export interface PlannedComment {
    authorEmail: string;
    content: string;
}

export interface PlannedReviewer {
    email: string;
    vote: VoteType;
}

export interface PlannedPr {
    sourceBranch: string;
    creatorEmail: string;
    title: string;
    description: string;
    isDraft: boolean;
    reviewers: PlannedReviewer[];
    comments: PlannedComment[];
    outcome: PrOutcome;
}

export interface PlannedRepo {
    project: string;
    repoName: string;
    branches: PlannedBranch[];
    prs: PlannedPr[];
}

export interface SeedPlan {
    runId: string;
    org: string;
    repos: PlannedRepo[];
}

const COMMENT_TEMPLATES = [
    'Looks good to me!',
    'Could we add more documentation here?',
    'This logic seems complex, consider simplifying.',
    'Nice refactor!',
    'Please add unit tests for this.',
    'LGTM with minor suggestions.',
    'Have we considered edge cases?',
    'Great work on this feature.',
];

const BRANCH_PREFIXES = ['feature', 'bugfix', 'hotfix', 'refactor', 'chore'];

/**
 * Creates a deterministic seeding plan based on configuration.
 */
export function createPlan(config: LoadedConfig): SeedPlan {
    const rng = new SeededRng(config.seed);
    const repos: PlannedRepo[] = [];

    for (const project of config.projects) {
        for (const repoName of project.repos) {
            // Apply runId to repo name for isolation
            const isolatedRepoName = `${repoName}-${config.runId}`;

            // Plan branches
            const branches: PlannedBranch[] = [];
            for (let i = 0; i < config.scale.branchesPerRepo; i++) {
                const prefix = rng.pick(BRANCH_PREFIXES);
                branches.push({
                    name: `${prefix}/${config.runId}-${i}`,
                    commits: rng.int(config.scale.commitsPerBranch.min, config.scale.commitsPerBranch.max),
                });
            }

            // Plan PRs
            const prs: PlannedPr[] = [];
            const usableBranches = [...branches];

            for (let i = 0; i < config.scale.prsPerRepo && usableBranches.length > 0; i++) {
                const branchIdx = rng.int(0, usableBranches.length - 1);
                const branch = usableBranches.splice(branchIdx, 1)[0];
                const creator = rng.pick(config.resolvedUsers);

                // Select reviewers (exclude creator)
                const potentialReviewers = config.resolvedUsers.filter(u => u.email !== creator.email);
                const reviewerCount = Math.min(
                    rng.int(config.scale.reviewersPerPr.min, config.scale.reviewersPerPr.max),
                    potentialReviewers.length
                );
                const reviewerUsers = rng.pickN(potentialReviewers, reviewerCount);

                const reviewers: PlannedReviewer[] = reviewerUsers.map(u => ({
                    email: u.email,
                    vote: rng.weighted(config.voteDistribution) as VoteType,
                }));

                // Plan comments
                const commentCount = rng.int(config.scale.commentsPerPr.min, config.scale.commentsPerPr.max);
                const comments: PlannedComment[] = [];
                for (let c = 0; c < commentCount; c++) {
                    const commenter = rng.pick(config.resolvedUsers);
                    comments.push({
                        authorEmail: commenter.email,
                        content: rng.pick(COMMENT_TEMPLATES),
                    });
                }

                // Determine outcome
                const outcome = rng.weighted(config.prOutcomes) as PrOutcome;

                prs.push({
                    sourceBranch: branch.name,
                    creatorEmail: creator.email,
                    title: `[${config.runId}] ${branch.name}`,
                    description: `Seeded PR for testing. Run ID: ${config.runId}`,
                    isDraft: rng.random() < 0.1, // 10% drafts
                    reviewers,
                    comments,
                    outcome,
                });
            }

            repos.push({
                project: project.name,
                repoName: isolatedRepoName,
                branches,
                prs,
            });
        }
    }

    return {
        runId: config.runId,
        org: config.org,
        repos,
    };
}

/**
 * Maps VoteType to ADO vote value.
 */
export function voteToValue(vote: VoteType): VoteValue {
    switch (vote) {
        case 'approve': return 10;
        case 'approveWithSuggestions': return 5;
        case 'reject': return -10;
        case 'noVote': return 0;
    }
}
