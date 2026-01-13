import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exec } from '../util/exec.js';
import { ContentDeriver } from './deriver.js';
import { SeededRng } from '../util/rng.js';

export interface BranchSpec {
    name: string;
    commits: number;
}

export interface GeneratedRepo {
    localPath: string;
    branches: string[];
    cleanup: () => void;
}

/**
 * Generates local git repositories with derived content.
 */
export class GitGenerator {
    private deriver: ContentDeriver;
    private rng: SeededRng;
    private patsToRedact: string[];

    constructor(rng: SeededRng, fixturesPath?: string, patsToRedact: string[] = []) {
        this.rng = rng;
        this.deriver = new ContentDeriver(rng, fixturesPath);
        this.patsToRedact = patsToRedact;
    }

    /**
     * Creates a temporary local repository with branches and commits.
     */
    async createRepo(repoName: string, branches: BranchSpec[]): Promise<GeneratedRepo> {
        // Create temp directory
        const tempDir = mkdtempSync(join(tmpdir(), `ado-seed-${repoName}-`));
        const createdBranches: string[] = [];

        try {
            // Initialize git repo
            await this.git(tempDir, ['init']);
            await this.git(tempDir, ['config', 'user.email', 'seeder@example.com']);
            await this.git(tempDir, ['config', 'user.name', 'ADO Seeder']);

            // Create initial commit on main
            writeFileSync(join(tempDir, 'README.md'), `# ${repoName}\n\nSeeded repository.`);
            await this.git(tempDir, ['add', '.']);
            await this.git(tempDir, ['commit', '-m', 'Initial commit']);
            await this.git(tempDir, ['branch', '-M', 'main']);

            // Create branches
            for (const branch of branches) {
                await this.git(tempDir, ['checkout', '-b', branch.name]);

                // Generate commits
                for (let i = 0; i < branch.commits; i++) {
                    const files = this.deriver.generateFileSet(this.rng.int(1, 3));
                    for (const file of files) {
                        const filePath = join(tempDir, 'src', file.name);
                        writeFileSync(filePath, file.content, { recursive: true } as any);
                    }
                    await this.git(tempDir, ['add', '.']);
                    await this.git(tempDir, ['commit', '-m', `${branch.name}: commit ${i + 1}`]);
                }

                createdBranches.push(branch.name);
                await this.git(tempDir, ['checkout', 'main']);
            }

            return {
                localPath: tempDir,
                branches: createdBranches,
                cleanup: () => {
                    try {
                        rmSync(tempDir, { recursive: true, force: true });
                    } catch {
                        // Ignore cleanup errors
                    }
                },
            };
        } catch (error) {
            // Cleanup on failure
            try {
                rmSync(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore
            }
            throw error;
        }
    }

    /**
     * Pushes all branches to a remote ADO repository.
     * PAT is injected in-memory only (never persisted to .git/config).
     */
    async pushToRemote(
        localPath: string,
        remoteUrl: string,
        pat: string,
        branches: string[]
    ): Promise<void> {
        // Construct authenticated URL (in-memory only)
        const url = new URL(remoteUrl);
        url.password = pat;
        url.username = '';  // ADO uses PAT as password with empty username
        const authenticatedUrl = url.toString();

        try {
            // Push main first
            await this.git(localPath, ['push', authenticatedUrl, 'main'], true);

            // Push all feature branches
            for (const branch of branches) {
                await this.git(localPath, ['push', authenticatedUrl, branch], true);
            }
        } catch (error) {
            // Error is already redacted by exec utility
            throw error;
        }
        // No cleanup needed - URL was never written to disk
    }

    /**
     * Gets the latest commit SHA for a branch.
     */
    async getCommitSha(localPath: string, branch: string): Promise<string> {
        const result = await this.git(localPath, ['rev-parse', branch]);
        return result.stdout.trim();
    }

    private async git(cwd: string, args: string[], sensitiveOutput: boolean = false): Promise<{ stdout: string; stderr: string }> {
        const result = await exec('git', args, {
            cwd,
            patsToRedact: sensitiveOutput ? this.patsToRedact : [],
        });

        if (result.code !== 0) {
            throw new Error(`Git command failed: git ${args.join(' ')}\n${result.stderr}`);
        }

        return result;
    }
}
