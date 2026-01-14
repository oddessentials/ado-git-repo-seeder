import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';

const RangeSchema = z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
});

const UserSchema = z.object({
    email: z.string().email(),
    patEnvVar: z.string(),
});

export const RepoNamingSchema = z.enum(['isolated', 'direct']);
export type RepoNaming = z.infer<typeof RepoNamingSchema>;

const RepoConfigSchema = z.union([
    z.string(),
    z.object({
        name: z.string(),
        repoNaming: RepoNamingSchema.optional(),
    }),
]);

const ProjectSchema = z.object({
    name: z.string(),
    repos: z.array(RepoConfigSchema),
    repoNaming: RepoNamingSchema.optional(),
});

const RepoStrategySchema = z.object({
    createIfMissing: z.boolean().default(true),
    failIfMissing: z.boolean().default(false),
    skipIfExists: z.boolean().default(false),
});

const BranchStrategySchema = z.object({
    alwaysUseRunId: z.boolean().default(true),
    allowCollisions: z.boolean().default(false),
});

const ScaleSchema = z.object({
    branchesPerRepo: z.number().int().positive(),
    commitsPerBranch: RangeSchema,
    prsPerRepo: z.number().int().positive(),
    reviewersPerPr: RangeSchema,
    commentsPerPr: RangeSchema,
});

const VoteDistributionSchema = z.object({
    approve: z.number().min(0).max(1),
    approveWithSuggestions: z.number().min(0).max(1),
    reject: z.number().min(0).max(1),
    noVote: z.number().min(0).max(1),
});

const PrOutcomesSchema = z.object({
    complete: z.number().min(0).max(1),
    abandon: z.number().min(0).max(1),
    leaveOpen: z.number().min(0).max(1),
});

const ActivitySchema = z.object({
    pushFollowUpCommits: z.number().min(0).max(1).default(0.3),
    followUpCommitsRange: RangeSchema.default({ min: 1, max: 3 }),
});

export const SeedConfigSchema = z.object({
    org: z.string(),
    projects: z.array(ProjectSchema),
    users: z.array(UserSchema).min(1),
    scale: ScaleSchema,
    voteDistribution: VoteDistributionSchema,
    prOutcomes: PrOutcomesSchema,
    seed: z.number().int(),
    repoNaming: RepoNamingSchema.default('isolated'),
    repoStrategy: RepoStrategySchema.default({}),
    branchStrategy: BranchStrategySchema.default({}),
    activity: ActivitySchema.default({}),
});

export type SeedConfig = z.infer<typeof SeedConfigSchema>;
export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type User = z.infer<typeof UserSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type RepoStrategy = z.infer<typeof RepoStrategySchema>;
export type BranchStrategy = z.infer<typeof BranchStrategySchema>;
export type Activity = z.infer<typeof ActivitySchema>;

export interface ResolvedUser extends User {
    pat: string;
    identityId?: string;
}

export interface LoadedConfig extends SeedConfig {
    resolvedUsers: ResolvedUser[];
    runId: string;
}

/**
 * Resolves properties for a specific repository using hierarchy: Repo > Project > Global.
 */
export function resolveRepoConfig(config: SeedConfig, project: Project, repo: RepoConfig) {
    const repoObj = typeof repo === 'string' ? { name: repo } : repo;
    return {
        name: repoObj.name,
        repoNaming: repoObj.repoNaming ?? project.repoNaming ?? config.repoNaming,
    };
}

/**
 * Loads and validates the seed configuration file.
 * Resolves PATs from environment variables.
 */
export function loadConfig(configPath: string, runIdOverride?: string): LoadedConfig {
    const absolutePath = resolve(configPath);
    if (!existsSync(absolutePath)) {
        throw new Error(`Config file not found: ${absolutePath}`);
    }

    const rawContent = readFileSync(absolutePath, 'utf-8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawContent);
    } catch {
        throw new Error(`Invalid JSON in config file: ${absolutePath}`);
    }

    const config = SeedConfigSchema.parse(parsed);

    // Resolve PATs from environment
    const resolvedUsers: ResolvedUser[] = config.users.map((user) => {
        const pat = process.env[user.patEnvVar];
        if (!pat) {
            throw new Error(`Missing environment variable '${user.patEnvVar}' for user '${user.email}'`);
        }
        return { ...user, pat };
    });

    // Generate a unique run ID for isolation
    const runId = runIdOverride ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
        ...config,
        resolvedUsers,
        runId,
    };
}

/**
 * Redacts PAT from a string (for logging).
 */
export function redactPat(str: string, pats: string[]): string {
    let result = str;
    for (const pat of pats) {
        if (pat) {
            result = result.replaceAll(pat, '[REDACTED]');
        }
    }
    return result;
}
