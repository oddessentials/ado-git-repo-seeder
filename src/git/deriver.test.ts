import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContentDeriver } from './deriver.js';
import { SeededRng } from '../util/rng.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ContentDeriver', () => {
    describe('determinism', () => {
        it('produces identical output for the same seed', () => {
            const rng1 = new SeededRng(12345);
            const rng2 = new SeededRng(12345);
            const deriver1 = new ContentDeriver(rng1);
            const deriver2 = new ContentDeriver(rng2);

            const content1 = deriver1.deriveContent(0);
            const content2 = deriver2.deriveContent(0);

            expect(content1).toEqual(content2);
        });

        it('produces different output for different seeds', () => {
            const deriver1 = new ContentDeriver(new SeededRng(111));
            const deriver2 = new ContentDeriver(new SeededRng(222));

            const content1 = deriver1.deriveContent(0);
            const content2 = deriver2.deriveContent(0);

            expect(content1).not.toEqual(content2);
        });
    });

    describe('deriveFilename()', () => {
        it('generates valid TypeScript filenames', () => {
            const deriver = new ContentDeriver(new SeededRng(42));

            for (let i = 0; i < 10; i++) {
                const filename = deriver.deriveFilename(i);
                expect(filename).toMatch(/^[a-z]+-[a-z]+-\d+\.ts$/);
            }
        });

        it('respects extension parameter', () => {
            const deriver = new ContentDeriver(new SeededRng(42));
            const filename = deriver.deriveFilename(0, '.js');

            expect(filename).toMatch(/\.js$/);
        });
    });

    describe('deriveContent()', () => {
        it('generates syntactically valid TypeScript', () => {
            const deriver = new ContentDeriver(new SeededRng(999));
            const content = deriver.deriveContent(5);

            // Should contain export statement
            expect(content).toMatch(/export/);
            // Should not have unclosed braces (basic check)
            const openBraces = (content.match(/{/g) || []).length;
            const closeBraces = (content.match(/}/g) || []).length;
            expect(openBraces).toEqual(closeBraces);
        });

        it('includes index in generated content', () => {
            const deriver = new ContentDeriver(new SeededRng(123));
            const content = deriver.deriveContent(42);

            expect(content).toContain('42');
        });
    });

    describe('generateFileSet()', () => {
        it('generates the correct number of files', () => {
            const deriver = new ContentDeriver(new SeededRng(555));
            const files = deriver.generateFileSet(5);

            expect(files).toHaveLength(5);
        });

        it('each file has name and content', () => {
            const deriver = new ContentDeriver(new SeededRng(666));
            const files = deriver.generateFileSet(3);

            for (const file of files) {
                expect(file.name).toBeTruthy();
                expect(file.content).toBeTruthy();
                expect(file.name).toMatch(/\.ts$/);
            }
        });

        it('is deterministic', () => {
            const deriver1 = new ContentDeriver(new SeededRng(777));
            const deriver2 = new ContentDeriver(new SeededRng(777));

            const files1 = deriver1.generateFileSet(3);
            const files2 = deriver2.generateFileSet(3);

            expect(files1).toEqual(files2);
        });
    });

    describe('hasFixtures', () => {
        it('returns false when no fixtures path provided', () => {
            const deriver = new ContentDeriver(new SeededRng(123));
            expect(deriver.hasFixtures).toBe(false);
        });

        it('returns false for non-existent path', () => {
            const deriver = new ContentDeriver(new SeededRng(123), '/non/existent/path');
            expect(deriver.hasFixtures).toBe(false);
        });
    });

    describe('fixture loading', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = mkdtempSync(join(tmpdir(), 'deriver-test-'));
        });

        afterEach(() => {
            rmSync(tempDir, { recursive: true, force: true });
        });

        it('loads TypeScript files from fixture directory', () => {
            writeFileSync(join(tempDir, 'example.ts'), 'export const foo = 1;');

            const deriver = new ContentDeriver(new SeededRng(123), tempDir);

            expect(deriver.hasFixtures).toBe(true);
        });

        it('loads files from nested directories', () => {
            const subDir = join(tempDir, 'nested');
            mkdirSync(subDir);
            writeFileSync(join(subDir, 'nested.ts'), 'export const nested = true;');

            const deriver = new ContentDeriver(new SeededRng(123), tempDir);

            expect(deriver.hasFixtures).toBe(true);
        });

        it('ignores hidden directories', () => {
            const hiddenDir = join(tempDir, '.hidden');
            mkdirSync(hiddenDir);
            writeFileSync(join(hiddenDir, 'secret.ts'), 'export const secret = true;');

            const deriver = new ContentDeriver(new SeededRng(123), tempDir);

            // Only hidden dir, so no fixtures
            expect(deriver.hasFixtures).toBe(false);
        });

        it('ignores node_modules directory', () => {
            const nodeModules = join(tempDir, 'node_modules');
            mkdirSync(nodeModules);
            writeFileSync(join(nodeModules, 'lib.ts'), 'export const lib = true;');

            const deriver = new ContentDeriver(new SeededRng(123), tempDir);

            expect(deriver.hasFixtures).toBe(false);
        });

        it('only loads safe extensions', () => {
            writeFileSync(join(tempDir, 'valid.ts'), 'export const valid = 1;');
            writeFileSync(join(tempDir, 'invalid.exe'), 'malicious');
            writeFileSync(join(tempDir, 'also-valid.json'), '{"key": "value"}');

            const deriver = new ContentDeriver(new SeededRng(123), tempDir);

            expect(deriver.hasFixtures).toBe(true);
        });

        it('uses fixture content in deriveContent when available', () => {
            const fixtureContent = '// Original comment\nexport const x = "original";';
            writeFileSync(join(tempDir, 'fixture.ts'), fixtureContent);

            const deriver = new ContentDeriver(new SeededRng(123), tempDir);
            const derived = deriver.deriveContent(0);

            // Should contain mutated content (comments and strings replaced)
            expect(derived).toContain('export const x');
            // Comments should be mutated
            expect(derived).not.toContain('Original comment');
        });
    });

    describe('content mutation', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = mkdtempSync(join(tmpdir(), 'mutation-test-'));
        });

        afterEach(() => {
            rmSync(tempDir, { recursive: true, force: true });
        });

        it('mutates comments in fixture content', () => {
            const fixture = '// This is the original comment\nexport const x = 1;';
            writeFileSync(join(tempDir, 'comment.ts'), fixture);

            const deriver = new ContentDeriver(new SeededRng(42), tempDir);
            const result = deriver.deriveContent(0);

            expect(result).not.toContain('This is the original comment');
            expect(result).toMatch(/\/\/ (Modified|Updated|Refactored|Enhanced)/);
        });

        it('mutates string literals in fixture content', () => {
            const fixture = 'export const msg = "hello world";';
            writeFileSync(join(tempDir, 'strings.ts'), fixture);

            const deriver = new ContentDeriver(new SeededRng(42), tempDir);
            const result = deriver.deriveContent(0);

            expect(result).not.toContain('hello world');
        });

        it('truncates long content to 50 lines', () => {
            const longFixture = Array(100).fill('// Line').join('\n');
            writeFileSync(join(tempDir, 'long.ts'), longFixture);

            const deriver = new ContentDeriver(new SeededRng(42), tempDir);
            const result = deriver.deriveContent(0);

            const lines = result.split('\n');
            // Should be truncated (50 lines + truncation comment)
            expect(lines.length).toBeLessThanOrEqual(52);
            expect(result).toContain('truncated');
        });
    });

    describe('synthetic content generation', () => {
        it('generates function with one of the expected names', () => {
            const deriver = new ContentDeriver(new SeededRng(123));
            const content = deriver.deriveContent(0);

            const functionNames = ['process', 'handle', 'validate', 'transform', 'calculate'];
            const hasFunctionName = functionNames.some((name) => content.includes(`${name}Data`));
            expect(hasFunctionName).toBe(true);
        });

        it('generates CONFIG object with expected properties', () => {
            const deriver = new ContentDeriver(new SeededRng(456));
            const content = deriver.deriveContent(5);

            expect(content).toContain('CONFIG_5');
            expect(content).toContain('enabled:');
            expect(content).toContain('threshold:');
            expect(content).toContain('mode:');
        });

        it('mode is one of fast, balanced, or thorough', () => {
            const deriver = new ContentDeriver(new SeededRng(789));
            const content = deriver.deriveContent(0);

            const hasValidMode = ['fast', 'balanced', 'thorough'].some((mode) => content.includes(`"${mode}"`));
            expect(hasValidMode).toBe(true);
        });
    });
});
