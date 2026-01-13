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

const ProjectSchema = z.object({
    name: z.string(),
    repos: z.array(z.string()),
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

export const SeedConfigSchema = z.object({
    org: z.string(),
    projects: z.array(ProjectSchema),
    users: z.array(UserSchema).min(1),
    scale: ScaleSchema,
    voteDistribution: VoteDistributionSchema,
    prOutcomes: PrOutcomesSchema,
    seed: z.number().int(),
});

export type SeedConfig = z.infer<typeof SeedConfigSchema>;
export type User = z.infer<typeof UserSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export interface ResolvedUser extends User {
    pat: string;
    identityId?: string;
}

export interface LoadedConfig extends SeedConfig {
    resolvedUsers: ResolvedUser[];
    runId: string;
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
            throw new Error(
                `Missing environment variable '${user.patEnvVar}' for user '${user.email}'`
            );
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
