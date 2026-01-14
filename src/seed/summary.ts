import { writeFileSync } from 'node:fs';
import { VoteType, PrOutcome } from './planner.js';

export interface FailureRecord {
    phase: string;
    prId?: number;
    error: string;
    isFatal: boolean;
}

export interface PrResult {
    prId: number;
    title: string;
    creator: string;
    reviewers: Array<{ email: string; vote: VoteType }>;
    comments: number;
    followUpCommitsAdded: number; // NEW
    outcome: PrOutcome;
    outcomeApplied: boolean;
}

export interface RepoResult {
    project: string;
    repoName: string;
    repoId: string | null;
    resolvedNaming: 'isolated' | 'direct'; // NEW
    branchesCreated: number;
    prs: PrResult[];
    failures: FailureRecord[];
}

export interface SeedSummary {
    version: string;
    runId: string;
    org: string;
    startTime: string;
    endTime: string;
    repos: RepoResult[];
    fatalFailure: { phase: string; error: string } | null;
    cleanupMode?: boolean;
    cleanupStats?: {
        draftsPublished: number;
        prsCompleted: number;
        prsFailed: number;
    };
}

/**
 * Writes the seed summary to a JSON file.
 */
export function writeSummary(summary: SeedSummary, outputPath: string): void {
    writeFileSync(outputPath, JSON.stringify(summary, null, 2));
}

/**
 * Generates a markdown summary for console/file output.
 */
export function generateMarkdownSummary(summary: SeedSummary): string {
    const lines: string[] = [];

    lines.push(`# Seed Run Summary`);
    lines.push('');
    lines.push(`**Version:** ${summary.version}`);
    lines.push(`**Run ID:** ${summary.runId}`);
    lines.push(`**Organization:** ${summary.org}`);
    lines.push(`**Started:** ${summary.startTime}`);
    lines.push(`**Ended:** ${summary.endTime}`);
    lines.push('');

    if (summary.fatalFailure) {
        lines.push(`## ⛔ Fatal Failure`);
        lines.push(`**Phase:** ${summary.fatalFailure.phase}`);
        lines.push(`**Error:** ${summary.fatalFailure.error}`);
        lines.push('');
    }

    // Statistics
    const totalRepos = summary.repos.length;
    const totalPrs = summary.repos.reduce((sum, r) => sum + r.prs.length, 0);
    const totalBranches = summary.repos.reduce((sum, r) => sum + r.branchesCreated, 0);
    const totalFailures = summary.repos.reduce((sum, r) => sum + r.failures.length, 0);

    lines.push(`## Statistics`);
    lines.push(`- **Repositories:** ${totalRepos}`);
    lines.push(`- **Branches Created:** ${totalBranches}`);
    lines.push(`- **Pull Requests:** ${totalPrs}`);
    lines.push(`- **Non-Fatal Failures:** ${totalFailures}`);
    lines.push('');

    // Per-repo details
    lines.push(`## Repository Details`);
    for (const repo of summary.repos) {
        lines.push(`### ${repo.project}/${repo.repoName}`);
        lines.push(`- **Repo ID:** ${repo.repoId ?? 'N/A'}`);
        lines.push(`- **Naming Strategy:** ${repo.resolvedNaming}`);
        lines.push(`- **Branches:** ${repo.branchesCreated}`);
        lines.push(`- **PRs:** ${repo.prs.length}`);

        if (repo.prs.length > 0) {
            lines.push(`#### Pull Requests`);
            for (const pr of repo.prs) {
                lines.push(`- **#${pr.prId}** ${pr.title}`);
                lines.push(`  - Creator: ${pr.creator}`);
                lines.push(`  - Reviewers: ${pr.reviewers.map(r => `${r.email} (${r.vote})`).join(', ') || 'none'}`);
                lines.push(`  - Comments: ${pr.comments}`);
                if (pr.followUpCommitsAdded > 0) {
                    lines.push(`  - Follow-up Commits: ${pr.followUpCommitsAdded}`);
                }
                lines.push(`  - Outcome: ${pr.outcome} (applied: ${pr.outcomeApplied})`);
            }
        }

        if (repo.failures.length > 0) {
            lines.push(`#### Failures`);
            for (const f of repo.failures) {
                const prInfo = f.prId ? ` (PR #${f.prId})` : '';
                lines.push(`- [${f.phase}]${prInfo}: ${f.error}`);
            }
        }

        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Prints the summary to console.
 */
export function printSummary(summary: SeedSummary): void {
    const md = generateMarkdownSummary(summary);
    console.log(md);
}
