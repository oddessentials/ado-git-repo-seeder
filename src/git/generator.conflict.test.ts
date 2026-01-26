import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { GitGenerator } from './generator.js';
import { SeededRng } from '../util/rng.js';
import { exec } from '../util/exec.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../util/exec.js');

/**
 * Test-only type for exec options parameter
 */
interface ExecOptions {
    cwd?: string;
}

describe('GitGenerator.resolveConflicts', () => {
    let generator: GitGenerator;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        generator = new GitGenerator(new SeededRng(12345));

        // Track call count for rev-parse to return different values before/after merge
        let revParseCallCount = 0;

        // Default successful mock for all git commands
        (exec as Mock).mockImplementation((cmd: string, args: string[], options?: ExecOptions) => {
            if (args.includes('clone')) {
                const repoDir = join(options?.cwd ?? '', 'repo');
                try {
                    mkdirSync(repoDir, { recursive: true });
                } catch {}
                return Promise.resolve({ stdout: '', stderr: '', code: 0 });
            }
            if (args.includes('rev-parse')) {
                revParseCallCount++;
                const sha = revParseCallCount === 1 ? 'abc123before' : 'def456after';
                return Promise.resolve({ stdout: sha, stderr: '', code: 0 });
            }
            if (args.includes('ls-remote')) {
                // Flexibly return a matching SHA for any requested ref
                const ref = args[args.length - 1];
                return Promise.resolve({ stdout: `def456after\t${ref}`, stderr: '', code: 0 });
            }
            return Promise.resolve({ stdout: '', stderr: '', code: 0 });
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('successful resolution', () => {
        it('clones the repository with shallow depth', async () => {
            const result = await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/my-branch',
                'main'
            );

            expect(result.resolved).toBe(true);
            expect(result.newCommitSha).toBe('def456after');
            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining(['clone', '--depth', '200']),
                expect.any(Object)
            );
        });

        it('configures git user for commits', async () => {
            await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/branch',
                'main'
            );

            expect(exec).toHaveBeenCalledWith(
                'git',
                ['config', 'user.email', 'seeder@example.com'],
                expect.any(Object)
            );
            expect(exec).toHaveBeenCalledWith('git', ['config', 'user.name', 'ADO Seeder'], expect.any(Object));
        });

        it('fetches latest refs and checks out source branch with reset', async () => {
            await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/my-branch',
                'main'
            );

            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining(['fetch', 'origin', '--prune']),
                expect.any(Object)
            );
            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining(['fetch', 'origin', 'feature/my-branch']),
                expect.any(Object)
            );

            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining(['checkout', '-B', 'feature/my-branch', 'origin/feature/my-branch']),
                expect.any(Object)
            );
        });

        it('merges target into source with -X ours and --allow-unrelated-histories', async () => {
            await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/branch',
                'main'
            );

            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining([
                    'merge',
                    'origin/main',
                    '--allow-unrelated-histories',
                    '-X',
                    'ours',
                    '-m',
                    'Merge main into feature/branch (auto-resolved conflicts)',
                ]),
                expect.any(Object)
            );
        });

        it('force pushes the resolved branch and verifies remote ref', async () => {
            const result = await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/branch',
                'main'
            );

            expect(result.resolved).toBe(true);
            expect(result.newCommitSha).toBe('def456after');

            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining(['push', '--force', 'origin', 'HEAD:refs/heads/feature/branch']),
                expect.any(Object)
            );

            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining(['ls-remote', '--heads', expect.any(String), 'refs/heads/feature/branch']),
                expect.any(Object)
            );
        });

        it('sanitizes URL by setting seeder username', async () => {
            await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/branch',
                'main'
            );

            expect(exec).toHaveBeenCalledWith(
                'git',
                expect.arrayContaining([expect.stringContaining('seeder@')]),
                expect.any(Object)
            );
        });
    });

    describe('push verification guard', () => {
        it('returns resolved: false if remote SHA does not match after push', async () => {
            let revParseCalls = 0;
            (exec as Mock).mockImplementation((cmd: string, args: string[]) => {
                if (args.includes('rev-parse')) {
                    revParseCalls++;
                    return Promise.resolve({ stdout: revParseCalls === 1 ? 'old' : 'new-sha', stderr: '', code: 0 });
                }
                if (args.includes('ls-remote')) {
                    return Promise.resolve({ stdout: 'stale-sha\trefs/heads/feature/branch', stderr: '', code: 0 });
                }
                return Promise.resolve({ stdout: '', stderr: '', code: 0 });
            });

            const result = await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/branch',
                'main'
            );

            expect(result.resolved).toBe(false);
            expect(result.error).toContain('Push did not move remote ref');
        });
    });

    describe('merge failure fallback', () => {
        it('handles merge failure by attempting fallback commit', async () => {
            let revParseCalls = 0;
            let mergeAborted = false;
            let commitHappened = false;

            (exec as Mock).mockImplementation((cmd: string, args: string[], options?: ExecOptions) => {
                if (args.includes('clone')) {
                    const repoDir = join(options?.cwd ?? '', 'repo');
                    try {
                        mkdirSync(repoDir, { recursive: true });
                    } catch {}
                    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
                }
                if (args.includes('merge') && !args.includes('--abort')) {
                    return Promise.reject(new Error('Merge conflict'));
                }
                if (args.includes('merge') && args.includes('--abort')) {
                    mergeAborted = true;
                    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
                }
                if (args.includes('commit')) {
                    commitHappened = true;
                    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
                }
                if (args.includes('rev-parse')) {
                    revParseCalls++;
                    let sha = 'initial-sha';
                    if (revParseCalls === 1) sha = 'initial-sha';
                    if (revParseCalls === 2) sha = 'initial-sha';
                    if (revParseCalls === 3) sha = 'final-fallback-sha';
                    return Promise.resolve({ stdout: sha, stderr: '', code: 0 });
                }
                if (args.includes('ls-remote')) {
                    const ref = args[args.length - 1];
                    return Promise.resolve({ stdout: `final-fallback-sha\t${ref}`, stderr: '', code: 0 });
                }
                return Promise.resolve({ stdout: '', stderr: '', code: 0 });
            });

            const result = await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/branch',
                'main'
            );

            expect(result.resolved).toBe(true);
            expect(result.newCommitSha).toBe('final-fallback-sha');
            expect(mergeAborted).toBe(true);
            expect(commitHappened).toBe(true);
        });
    });

    describe('error handling', () => {
        it('returns resolved: false when clone fails', async () => {
            (exec as Mock).mockImplementation((cmd: string, args: string[]) => {
                if (args.includes('clone')) {
                    return Promise.resolve({ stdout: '', stderr: 'clone failed', code: 128 });
                }
                return Promise.resolve({ stdout: '', stderr: '', code: 0 });
            });

            // Using type assertion to access private method for testing
            const generatorWithPrivate = generator as unknown as {
                git: (cwd: string, args: string[], ...rest: unknown[]) => Promise<unknown>;
            };
            const originalGit = generatorWithPrivate.git.bind(generator);
            generatorWithPrivate.git = async (cwd: string, args: string[], ...rest: unknown[]) => {
                if (args.includes('clone')) {
                    throw new Error('Git command failed: git clone');
                }
                return originalGit(cwd, args, ...rest);
            };

            const result = await generator.resolveConflicts(
                'https://dev.azure.com/org/project/_git/repo',
                'fake-pat',
                'feature/branch',
                'main'
            );

            expect(result.resolved).toBe(false);
            expect(result.error).toContain('Git command failed');
        });
    });
});
