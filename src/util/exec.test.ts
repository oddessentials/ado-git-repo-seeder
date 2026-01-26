/**
 * Tests for exec utility with Windows environment variable preservation.
 *
 * IMPORTANT: This test exists because of a bug where Windows-critical env vars
 * (ComSpec, SYSTEMROOT) were being shadowed during child process spawning,
 * causing "spawn cmd.exe ENOENT" errors on Windows.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { exec } from './exec.js';

describe('exec utility', () => {
    describe('Windows environment preservation', () => {
        const originalEnv = { ...process.env };

        afterEach(() => {
            // Restore original env by mutating (preserves Windows case-insensitive lookup)
            for (const key of Object.keys(process.env)) {
                if (!(key in originalEnv)) {
                    delete process.env[key];
                }
            }
            for (const [key, value] of Object.entries(originalEnv)) {
                process.env[key] = value;
            }
        });

        it('preserves ComSpec when custom env vars are passed', async () => {
            // This test verifies that ComSpec is not shadowed by custom env vars
            // which would cause "spawn cmd.exe ENOENT" on Windows
            const result = await exec('echo', ['hello'], {
                env: { CUSTOM_VAR: 'test' },
            });

            // If ComSpec was lost, this would fail on Windows with ENOENT
            expect(result.code).toBe(0);
            expect(result.stdout).toContain('hello');
        });

        it('preserves SYSTEMROOT when custom env vars are passed', async () => {
            // SYSTEMROOT is required for many Windows operations
            const result = await exec('echo', ['test'], {
                env: { ANOTHER_VAR: 'value' },
            });

            expect(result.code).toBe(0);
        });

        it('allows custom GIT_ASKPASS to be set while preserving system vars', async () => {
            // GIT_ASKPASS is used for PAT authentication
            const result = await exec('echo', ['auth-test'], {
                env: { GIT_ASKPASS: '/path/to/askpass' },
            });

            expect(result.code).toBe(0);
            expect(result.stdout).toContain('auth-test');
        });

        it('redacts PATs from output', async () => {
            const secretPat = 'super-secret-pat-12345';
            const result = await exec('echo', [secretPat], {
                patsToRedact: [secretPat],
            });

            expect(result.stdout).not.toContain(secretPat);
            expect(result.stdout).toContain('[REDACTED]');
        });
    });

    describe('argument handling', () => {
        it('escapes arguments with spaces', async () => {
            const result = await exec('echo', ['hello world']);

            expect(result.code).toBe(0);
            expect(result.stdout).toContain('hello world');
        });

        it('escapes arguments with tabs', async () => {
            const result = await exec('echo', ['hello\tworld']);

            expect(result.code).toBe(0);
        });

        it('handles empty arguments', async () => {
            const result = await exec('echo', ['']);

            expect(result.code).toBe(0);
        });

        it('handles arguments with quotes', async () => {
            const result = await exec('echo', ['say "hello"']);

            expect(result.code).toBe(0);
        });
    });

    describe('exit codes', () => {
        it('returns non-zero exit code for failed commands', async () => {
            const isWindows = process.platform === 'win32';
            // Use platform-appropriate command and path format
            const result = isWindows
                ? await exec('cmd', ['/c', 'dir', 'C:\\nonexistent-path-12345'])
                : await exec('ls', ['/nonexistent/path/that/does/not/exist']);

            expect(result.code).not.toBe(0);
        });

        it('returns exit code 0 for successful commands', async () => {
            const result = await exec('echo', ['success']);

            expect(result.code).toBe(0);
        });
    });

    describe('working directory', () => {
        it('executes in specified working directory', async () => {
            const isWindows = process.platform === 'win32';
            const tempDir = tmpdir();

            // Use platform-appropriate command to print working directory
            // Windows: 'cd' prints cwd; Unix: 'pwd' prints cwd
            const result = await exec(isWindows ? 'cd' : 'pwd', [], {
                cwd: tempDir,
            });

            expect(result.code).toBe(0);
            // Case-insensitive comparison for Windows path normalization
            expect(result.stdout.toLowerCase()).toContain(tempDir.toLowerCase().replace(/\\/g, '\\'));
        });
    });

    describe('stderr handling', () => {
        it('captures stderr output', async () => {
            const isWindows = process.platform === 'win32';
            // Use platform-appropriate command to generate stderr
            const result = isWindows
                ? await exec('cmd', ['/c', 'dir', 'C:\\nonexistent-path-12345'])
                : await exec('ls', ['/nonexistent-path-12345']);

            // Should have non-zero exit code for the error
            expect(result.code).not.toBe(0);
        });

        it('redacts PATs from stderr', async () => {
            const secretPat = 'stderr-secret-pat';
            const isWindows = process.platform === 'win32';

            // Write to stderr using platform-appropriate shell
            // Windows: cmd /c "echo message 1>&2"
            // Unix: sh -c 'printf "%s" "$SECRET_VAL" >&2'
            const result = isWindows
                ? await exec('cmd', ['/c', `echo ${secretPat} 1>&2`], {
                      patsToRedact: [secretPat],
                  })
                : await exec('sh', ['-c', 'printf "%s" "$SECRET_VAL" >&2'], {
                      env: { SECRET_VAL: secretPat },
                      patsToRedact: [secretPat],
                  });

            expect(result.stderr).not.toContain(secretPat);
            expect(result.stderr).toContain('[REDACTED]');
        });
    });

    describe('redaction edge cases', () => {
        it('handles empty PAT array', async () => {
            const result = await exec('echo', ['test'], {
                patsToRedact: [],
            });

            expect(result.code).toBe(0);
            expect(result.stdout).toContain('test');
        });

        it('handles empty string in PAT array', async () => {
            const result = await exec('echo', ['test'], {
                patsToRedact: [''],
            });

            expect(result.code).toBe(0);
            expect(result.stdout).toContain('test');
        });

        it('redacts multiple PATs', async () => {
            const pat1 = 'secret1-abc';
            const pat2 = 'secret2-def';
            const result = await exec('echo', [`${pat1} and ${pat2}`], {
                patsToRedact: [pat1, pat2],
            });

            expect(result.stdout).not.toContain(pat1);
            expect(result.stdout).not.toContain(pat2);
            expect(result.stdout).toContain('[REDACTED]');
        });
    });
});
