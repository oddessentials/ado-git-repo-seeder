import { describe, it, expect } from 'vitest';
import { ContentDeriver } from './deriver.js';
import { SeededRng } from '../util/rng.js';

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
});
