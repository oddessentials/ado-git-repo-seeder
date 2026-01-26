import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../../');
const configDocPath = join(rootDir, 'docs/configuration.md');
const configTsPath = join(rootDir, 'src/config.ts');
const cliTsPath = join(rootDir, 'src/cli.ts');

describe('Documentation Drift Guard', () => {
    const configDoc = readFileSync(configDocPath, 'utf-8');

    it('docs/configuration.md should mention all major SeedConfigSchema fields', () => {
        const _configTs = readFileSync(configTsPath, 'utf-8');

        // Extract field names from SeedConfigSchema definition
        // This is a basic grep-like check to ensure visibility
        const fields = [
            'org',
            'projects',
            'users',
            'scale',
            'voteDistribution',
            'prOutcomes',
            'seed',
            'repoNaming',
            'repoStrategy',
            'branchStrategy',
            'activity',
        ];

        for (const field of fields) {
            // Check for the field name as a heading or bold text
            // Escaping asterisks for regex
            const regex = new RegExp(`### (\`?|\\*\\*)${field}(\`?|\\*\\*)`, 'i');
            expect(configDoc).toMatch(regex);
        }
    });

    it('docs/configuration.md should mention critical CLI flags', () => {
        const _cliTs = readFileSync(cliTsPath, 'utf-8');

        const criticalFlags = ['run-id', 'config', 'dry-run'];

        for (const flag of criticalFlags) {
            // Check for flag with or without hyphens (run-id vs runId)
            const normalizedFlag = flag.replace(/-/g, '');
            const docLower = configDoc.toLowerCase();
            const hasFlag = docLower.includes(flag.toLowerCase()) || docLower.includes(normalizedFlag.toLowerCase());
            expect(hasFlag).toBe(true);
        }
    });

    it('all docs in docs/ should have v1.1.0 or later version stamp', () => {
        const docsDir = join(rootDir, 'docs');
        const files = readdirSync(docsDir).filter((f) => f.endsWith('.md'));

        for (const file of files) {
            const content = readFileSync(join(docsDir, file), 'utf-8');
            expect(content).toMatch(/v1\.[1-9]\.\d+/);
        }
    });
});
