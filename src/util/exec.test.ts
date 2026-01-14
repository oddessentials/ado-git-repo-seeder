/**
 * Tests for exec utility with Windows environment variable preservation.
 *
 * IMPORTANT: This test exists because of a bug where Windows-critical env vars
 * (ComSpec, SYSTEMROOT) were being shadowed during child process spawning,
 * causing "spawn cmd.exe ENOENT" errors on Windows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from './exec.js';

describe('exec utility', () => {
    describe('Windows environment preservation', () => {
        const originalPlatform = process.platform;
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
});
