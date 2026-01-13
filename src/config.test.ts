import { describe, it, expect } from 'vitest';
import { loadConfig, redactPat } from './config.js';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveRepoConfig } from './config.js';

describe('config', () => {
    describe('loadConfig()', () => {
        it('loads and validates a valid config file', () => {
            const tempDir = mkdtempSync(join(tmpdir(), 'config-test-'));
            const configPath = join(tempDir, 'seed.config.json');

            const validConfig = {
                org: 'test-org',
                projects: [{ name: 'project1', repos: ['repo1'] }],
                users: [{ email: 'user@test.com', patEnvVar: 'TEST_PAT_VAR' }],
                scale: {
                    branchesPerRepo: 3,
                    commitsPerBranch: { min: 1, max: 5 },
                    prsPerRepo: 2,
                    reviewersPerPr: { min: 1, max: 2 },
                    commentsPerPr: { min: 1, max: 3 },
                },
                voteDistribution: {
                    approve: 0.5,
                    approveWithSuggestions: 0.2,
                    reject: 0.1,
                    noVote: 0.2,
                },
                prOutcomes: {
                    complete: 0.5,
                    abandon: 0.2,
                    leaveOpen: 0.3,
                },
                seed: 12345,
            };

            writeFileSync(configPath, JSON.stringify(validConfig));
            process.env.TEST_PAT_VAR = 'test-pat-value';

            try {
                const loaded = loadConfig(configPath);

                expect(loaded.org).toBe('test-org');
                expect(loaded.resolvedUsers).toHaveLength(1);
                expect(loaded.resolvedUsers[0].pat).toBe('test-pat-value');
                expect(loaded.runId).toMatch(/^run-/);
            } finally {
                delete process.env.TEST_PAT_VAR;
                unlinkSync(configPath);
            }
        });

        it('throws on missing config file', () => {
            expect(() => loadConfig('/nonexistent/path.json')).toThrow('Config file not found');
        });

        it('throws on invalid JSON', () => {
            const tempDir = mkdtempSync(join(tmpdir(), 'config-test-'));
            const configPath = join(tempDir, 'invalid.json');
            writeFileSync(configPath, 'not valid json');

            try {
                expect(() => loadConfig(configPath)).toThrow('Invalid JSON');
            } finally {
                unlinkSync(configPath);
            }
        });

        it('throws on missing PAT env var', () => {
            const tempDir = mkdtempSync(join(tmpdir(), 'config-test-'));
            const configPath = join(tempDir, 'missing-pat.json');

            const config = {
                org: 'test',
                projects: [{ name: 'p', repos: ['r'] }],
                users: [{ email: 'u@t.com', patEnvVar: 'NONEXISTENT_PAT_VAR' }],
                scale: {
                    branchesPerRepo: 1,
                    commitsPerBranch: { min: 1, max: 1 },
                    prsPerRepo: 1,
                    reviewersPerPr: { min: 1, max: 1 },
                    commentsPerPr: { min: 1, max: 1 },
                },
                voteDistribution: { approve: 1, approveWithSuggestions: 0, reject: 0, noVote: 0 },
                prOutcomes: { complete: 1, abandon: 0, leaveOpen: 0 },
                seed: 1,
            };

            writeFileSync(configPath, JSON.stringify(config));

            try {
                expect(() => loadConfig(configPath)).toThrow('Missing environment variable');
            } finally {
                unlinkSync(configPath);
            }
        });

        it('uses custom runId when provided', () => {
            const tempDir = mkdtempSync(join(tmpdir(), 'config-test-'));
            const configPath = join(tempDir, 'custom-run.json');

            const config = {
                org: 'test',
                projects: [{ name: 'p', repos: ['r'] }],
                users: [{ email: 'u@t.com', patEnvVar: 'CUSTOM_RUN_PAT' }],
                scale: {
                    branchesPerRepo: 1,
                    commitsPerBranch: { min: 1, max: 1 },
                    prsPerRepo: 1,
                    reviewersPerPr: { min: 1, max: 1 },
                    commentsPerPr: { min: 1, max: 1 },
                },
                voteDistribution: { approve: 1, approveWithSuggestions: 0, reject: 0, noVote: 0 },
                prOutcomes: { complete: 1, abandon: 0, leaveOpen: 0 },
                seed: 1,
            };

            writeFileSync(configPath, JSON.stringify(config));
            process.env.CUSTOM_RUN_PAT = 'pat';

            try {
                const loaded = loadConfig(configPath, 'my-custom-run-id');
                expect(loaded.runId).toBe('my-custom-run-id');
                // Check new defaults
                expect(loaded.repoNaming).toBe('isolated');
                expect(loaded.repoStrategy.createIfMissing).toBe(true);
            } finally {
                delete process.env.CUSTOM_RUN_PAT;
                unlinkSync(configPath);
            }
        });
    });

    describe('resolveRepoConfig()', () => {
        const mockConfig: any = {
            repoNaming: 'isolated',
            repoStrategy: { createIfMissing: true, failIfMissing: false, skipIfExists: false },
        };

        const mockProject: any = {
            name: 'p1',
        };

        it('resolves string repo to isolated naming by default', () => {
            const resolved = resolveRepoConfig(mockConfig, mockProject, 'repoA');
            expect(resolved.name).toBe('repoA');
            expect(resolved.repoNaming).toBe('isolated');
        });

        it('resolves complex repo with overrides', () => {
            const resolved = resolveRepoConfig(mockConfig, mockProject, {
                name: 'repoB',
                repoNaming: 'direct',
            });
            expect(resolved.name).toBe('repoB');
            expect(resolved.repoNaming).toBe('direct');
        });

        it('prefers project-level overrides over global', () => {
            const projectWithOverride = { ...mockProject, repoNaming: 'direct' };
            const resolved = resolveRepoConfig(mockConfig, projectWithOverride, 'repoC');
            expect(resolved.repoNaming).toBe('direct');
        });

        it('prefers repo-level overrides over project-level', () => {
            const projectWithOverride = { ...mockProject, repoNaming: 'direct' };
            const resolved = resolveRepoConfig(mockConfig, projectWithOverride, {
                name: 'repoD',
                repoNaming: 'isolated',
            });
            expect(resolved.repoNaming).toBe('isolated');
        });
    });

    describe('redactPat()', () => {
        it('redacts single PAT from string', () => {
            const result = redactPat('Authorization: secret123', ['secret123']);
            expect(result).toBe('Authorization: [REDACTED]');
        });

        it('redacts multiple PATs', () => {
            const result = redactPat('pat1 and pat2 are secrets', ['pat1', 'pat2']);
            expect(result).toBe('[REDACTED] and [REDACTED] are secrets');
        });

        it('handles empty PAT array', () => {
            const result = redactPat('no secrets here', []);
            expect(result).toBe('no secrets here');
        });

        it('handles empty string PAT', () => {
            const result = redactPat('some text', ['']);
            expect(result).toBe('some text');
        });
    });
});
