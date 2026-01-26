import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
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
    private targetDate?: string; // ISO timestamp for backdating commits

    constructor(rng: SeededRng, fixturesPath?: string, patsToRedact: string[] = [], targetDate?: string) {
        this.rng = rng;
        this.deriver = new ContentDeriver(rng, fixturesPath);
        this.patsToRedact = patsToRedact;
        this.targetDate = targetDate;
    }

    /**
     * Creates a temporary local repository with branches and commits.
     * Uses a composite seed for guaranteed unique content per PR/commit.
     */
    async createRepo(
        repoName: string,
        branches: BranchSpec[],
        globalSeed: number,
        runId: string
    ): Promise<GeneratedRepo> {
        // Create temp directory under a standardized root
        const rootTemp = join(tmpdir(), 'ado-seeder', `run-${runId}`);
        mkdirSync(rootTemp, { recursive: true });

        const tempDir = join(rootTemp, repoName);

        // Ensure directory exists (cleanup logic should handle stale ones)
        try {
            rmSync(tempDir, { recursive: true, force: true });
        } catch {}
        const actualTempDir = mkdtempSync(join(rootTemp, `${repoName}-`));

        const createdBranches: string[] = [];

        try {
            // Initialize git repo
            await this.git(actualTempDir, ['init']);
            await this.git(actualTempDir, ['config', 'user.email', 'seeder@example.com']);
            await this.git(actualTempDir, ['config', 'user.name', 'ADO Seeder']);
            // Disable GPG signing to ensure commits work in all environments
            await this.git(actualTempDir, ['config', 'commit.gpgsign', 'false']);

            // Create initial commit on main
            writeFileSync(join(actualTempDir, 'README.md'), `# ${repoName}\n\nSeeded repository.`);
            await this.git(actualTempDir, ['add', '.']);
            await this.git(actualTempDir, ['commit', '-m', 'Initial commit']);
            await this.git(actualTempDir, ['branch', '-M', 'main']);

            // Create branches
            for (let bIdx = 0; bIdx < branches.length; bIdx++) {
                const branch = branches[bIdx];
                if (branch.name !== 'main') {
                    await this.git(actualTempDir, ['checkout', '-b', branch.name]);
                }

                // Generate commits
                for (let i = 0; i < branch.commits; i++) {
                    // Composite seed for uniqueness: (globalSeed, runId, repo, branch, commit)
                    const compositeSeed = `${globalSeed}-${runId}-${repoName}-${branch.name}-${i}`;
                    const commitRng = new SeededRng(compositeSeed);

                    const files = this.deriver.generateFileSet(commitRng.int(1, 3), commitRng);
                    for (const file of files) {
                        const fileDir = join(actualTempDir, 'src');
                        const filePath = join(fileDir, file.name);
                        try {
                            const nodeFs = await import('node:fs');
                            nodeFs.mkdirSync(fileDir, { recursive: true });
                        } catch {}
                        writeFileSync(filePath, file.content);
                    }
                    await this.git(actualTempDir, ['add', '.']);
                    await this.git(actualTempDir, ['commit', '-m', `${branch.name}: commit ${i + 1}`]);
                }

                createdBranches.push(branch.name);
                await this.git(actualTempDir, ['checkout', 'main']);
            }

            return {
                localPath: actualTempDir,
                branches: createdBranches,
                cleanup: () => {
                    try {
                        rmSync(actualTempDir, { recursive: true, force: true });
                    } catch {
                        // Ignore cleanup errors
                    }
                },
            };
        } catch (error) {
            // Cleanup on failure
            try {
                rmSync(actualTempDir, { recursive: true, force: true });
            } catch {
                // Ignore
            }
            throw error;
        }
    }

    /**
     * Pushes all branches to a remote ADO repository.
     * PAT is injected in-memory only (never persisted to .git/config).
     * @param skipMainPush - If true, skips pushing main (for existing repos in accumulation mode)
     */
    async pushToRemote(
        localPath: string,
        remoteUrl: string,
        pat: string,
        branches: string[],
        skipMainPush: boolean = false
    ): Promise<void> {
        // Use non-secret username in URL
        const url = new URL(remoteUrl);
        url.username = 'seeder';
        url.password = '';
        const cleanUrl = url.toString();

        const askPass = this.createAskPassScript(pat);

        try {
            const env = { GIT_ASKPASS: askPass.path };

            // Push main first (unless skipping for existing repos)
            if (!skipMainPush) {
                await this.git(localPath, ['push', cleanUrl, 'main'], true, env);
            }

            // Push all feature branches
            for (const branch of branches) {
                await this.git(localPath, ['push', cleanUrl, branch], true, env);
            }
        } finally {
            askPass.cleanup();
        }
    }

    /**
     * Pushes additional commits to an existing branch.
     * Uses composite seed and handles auth securely.
     */
    async pushFollowUpCommits(
        localPath: string,
        remoteUrl: string,
        branch: string,
        commitCount: number,
        pat: string,
        globalSeed: number,
        runId: string,
        repoName: string
    ): Promise<{ count: number }> {
        // Ensure we are on the right branch
        await this.git(localPath, ['checkout', branch]);

        for (let i = 0; i < commitCount; i++) {
            // Composite seed: (globalSeed, runId, repo, branch, followup-index)
            const compositeSeed = `${globalSeed}-${runId}-${repoName}-${branch}-followup-${i}`;
            const commitRng = new SeededRng(compositeSeed);

            const files = this.deriver.generateFileSet(commitRng.int(1, 2), commitRng);
            for (const file of files) {
                const filePath = join(localPath, 'src', file.name);
                writeFileSync(filePath, file.content);
            }
            await this.git(localPath, ['add', '.']);
            await this.git(localPath, ['commit', '-m', `Follow-up: addressing feedback ${i + 1}`]);
        }

        const url = new URL(remoteUrl);
        url.username = 'seeder';
        url.password = '';
        const cleanUrl = url.toString();

        const askPass = this.createAskPassScript(pat);

        try {
            const env = { GIT_ASKPASS: askPass.path };
            await this.git(localPath, ['push', cleanUrl, branch], true, env);
        } finally {
            askPass.cleanup();
        }
        return { count: commitCount };
    }

    /**
     * Resolves merge conflicts by merging target branch into source branch.
     * Uses '-X ours' to auto-resolve conflicts in favor of source branch.
     * Also uses '--allow-unrelated-histories' because we have evidence it occurs.
     *
     * @returns resolved=true if we produced a new head commit on the source branch AND pushed it
     */
    async resolveConflicts(
        remoteUrl: string,
        pat: string,
        sourceBranch: string,
        targetBranch: string = 'main'
    ): Promise<{ resolved: boolean; error?: string; newCommitSha?: string }> {
        const url = new URL(remoteUrl);
        url.username = 'seeder';
        url.password = '';
        const cleanUrl = url.toString();

        const tempDir = mkdtempSync(join(tmpdir(), 'ado-conflict-resolve-'));
        const askPass = this.createAskPassScript(pat);

        try {
            const env: NodeJS.ProcessEnv = {
                GIT_ASKPASS: askPass.path,
                GIT_TERMINAL_PROMPT: '0',
            };

            // Clone into a dedicated folder (avoid nesting cwd weirdness)
            const repoPath = join(tempDir, 'repo');
            await this.git(tempDir, ['clone', '--no-single-branch', '--depth', '200', cleanUrl, 'repo'], true, env);

            // Configure identity and disable GPG signing
            await this.git(repoPath, ['config', 'user.email', 'seeder@example.com']);
            await this.git(repoPath, ['config', 'user.name', 'ADO Seeder']);
            await this.git(repoPath, ['config', 'commit.gpgsign', 'false']);

            // Always fetch latest refs for both branches
            await this.git(repoPath, ['fetch', 'origin', '--prune'], true, env);
            await this.git(repoPath, ['fetch', 'origin', sourceBranch], true, env);
            await this.git(repoPath, ['fetch', 'origin', targetBranch], true, env);

            // Checkout source branch exactly from origin/<sourceBranch>
            // Use -B to reset local branch to remote tip deterministically.
            await this.git(repoPath, ['checkout', '-B', sourceBranch, `origin/${sourceBranch}`], true, env);

            // Record head before
            const headBeforeResult = await this.git(repoPath, ['rev-parse', 'HEAD']);
            const headBefore = headBeforeResult.stdout.trim();
            console.log(`      HEAD before merge: ${headBefore}`);

            // Attempt merge
            let merged = false;
            try {
                await this.git(repoPath, [
                    'merge',
                    `origin/${targetBranch}`,
                    '--allow-unrelated-histories',
                    '-X',
                    'ours',
                    '-m',
                    `Merge ${targetBranch} into ${sourceBranch} (auto-resolved conflicts)`,
                ]);
                merged = true;
            } catch (mergeError) {
                console.log(`      Merge failed, attempting fallback commit: ${mergeError}`);
                // Abort any partial merge if present
                try {
                    await this.git(repoPath, ['merge', '--abort']);
                } catch {
                    // ignore
                }
            }

            // If merge didn't create a new commit (or merge failed), ensure we still move HEAD
            let headAfter = (await this.git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
            console.log(`      HEAD after merge: ${headAfter}`);

            if (!merged || headAfter === headBefore) {
                console.log(`      ⚠️ No new merge commit, creating deterministic resolution commit...`);
                const marker = join(repoPath, '.conflict-resolved');
                writeFileSync(marker, `Conflict resolution marker: ${new Date().toISOString()}\n`);
                await this.git(repoPath, ['add', '.']);
                await this.git(repoPath, ['commit', '-m', 'Auto-resolve: move source branch head'], true, env);
                headAfter = (await this.git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
                console.log(`      HEAD after fallback commit: ${headAfter}`);
            }

            // Push the current HEAD to the source branch ref explicitly.
            const refspec = `HEAD:refs/heads/${sourceBranch}`;
            console.log(`      Pushing ${refspec} (SHA: ${headAfter.slice(0, 7)})...`);
            await this.git(repoPath, ['push', '--force', 'origin', refspec], true, env);
            console.log(`      Push completed successfully`);

            // Verify remote ref moved to our SHA (critical!)
            const remoteHead = await this.git(
                repoPath,
                ['ls-remote', '--heads', 'origin', `refs/heads/${sourceBranch}`],
                true,
                env
            );
            const remoteSha = remoteHead.stdout.trim().split(/\s+/)[0] || '';
            if (!remoteSha || remoteSha.toLowerCase() !== headAfter.toLowerCase()) {
                return {
                    resolved: false,
                    error: `Push did not move remote ref. local=${headAfter.slice(0, 7)} remote=${remoteSha.slice(0, 7) || 'unknown'}`,
                };
            }

            return { resolved: true, newCommitSha: headAfter };
        } catch (error) {
            return {
                resolved: false,
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            askPass.cleanup();
            try {
                rmSync(tempDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }
    }

    /**
     * Checks if any of the target branches already exist on the remote.
     */
    async checkCollisions(remoteUrl: string, pat: string, branches: string[]): Promise<string[]> {
        const url = new URL(remoteUrl);
        url.username = 'seeder';
        url.password = '';
        const cleanUrl = url.toString();

        const askPass = this.createAskPassScript(pat);

        try {
            const env = { GIT_ASKPASS: askPass.path };
            const result = await this.git(tmpdir(), ['ls-remote', '--heads', cleanUrl], true, env);
            const remoteHeads = result.stdout
                .split('\n')
                .filter((line) => line.trim())
                .map((line) => line.split(/\s+/)[1].replace('refs/heads/', ''));

            const collisions = branches.filter((b) => remoteHeads.includes(b));
            return collisions;
        } finally {
            askPass.cleanup();
        }
    }

    private createAskPassScript(pat: string): { path: string; cleanup: () => void } {
        const isWindows = process.platform === 'win32';
        const scriptExt = isWindows ? '.bat' : '.sh';
        const scriptPath = join(tmpdir(), `askpass-${Math.random().toString(36).slice(2)}${scriptExt}`);

        // Windows Git expects a script that echoes the PAT.
        // Note: Git on Windows often needs certain escaping or specific format for ASKPASS
        const content = isWindows ? `@echo ${pat}` : `#!/bin/sh\necho "${pat}"`;

        writeFileSync(scriptPath, content);
        if (!isWindows) {
            chmodSync(scriptPath, 0o700);
        }

        return {
            path: scriptPath,
            cleanup: () => {
                try {
                    rmSync(scriptPath, { force: true });
                } catch {}
            },
        };
    }

    private async git(
        cwd: string,
        args: string[],
        sensitiveOutput: boolean = false,
        env?: NodeJS.ProcessEnv
    ): Promise<{ stdout: string; stderr: string }> {
        // Inject commit date if set (for backdating)
        const dateEnv =
            this.targetDate && args.includes('commit')
                ? { GIT_AUTHOR_DATE: this.targetDate, GIT_COMMITTER_DATE: this.targetDate }
                : {};

        const result = await exec('git', args, {
            cwd,
            env: { ...env, ...dateEnv },
            patsToRedact: sensitiveOutput ? this.patsToRedact : [],
        });

        if (result.code !== 0) {
            throw new Error(`Git command failed: git ${args.join(' ')}\n${result.stderr}`);
        }

        return result;
    }
}
