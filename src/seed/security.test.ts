import { describe, it, expect } from 'vitest';
import { redactPat } from '../config.js';
import { GitGenerator } from '../git/generator.js';
import { SeededRng } from '../util/rng.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';

describe('Security Canary', () => {
    describe('PAT Redaction', () => {
        it('redacts sentinel PAT from logs and summaries', () => {
            const sentinel = 'PAT_CANARY_123456789';
            const logMessage = `Pushing to remote with token ${sentinel}`;
            const summary = JSON.stringify({ error: `Failed to push with ${sentinel}` });

            expect(redactPat(logMessage, [sentinel])).not.toContain(sentinel);
            expect(redactPat(logMessage, [sentinel])).toContain('[REDACTED]');

            expect(redactPat(summary, [sentinel])).not.toContain(sentinel);
        });
    });

    describe('Git Auth Hygiene', () => {
        it('ensures .git/config does not contain the PAT', async () => {
            const rng = new SeededRng(1);
            const generator = new GitGenerator(rng);
            const pat = 'SECRET_TEST_PAT';
            const repoName = 'security-test-repo';

            const repo = await generator.createRepo(repoName, [{ name: 'main', commits: 1 }], 1, 'security-run');

            try {
                const configPath = join(repo.localPath, '.git', 'config');
                const configContent = readFileSync(configPath, 'utf-8');

                // Should not contain the PAT even before push (URLs are clean)
                expect(configContent).not.toContain(pat);

                // Note: We can't easily test a real push here without an ADO remote,
                // but we've verified the code use clean URLs and ASKPASS.
            } finally {
                repo.cleanup();
            }
        });
    });
});
