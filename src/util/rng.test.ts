import { describe, it, expect } from 'vitest';
import { SeededRng } from './rng.js';

describe('SeededRng', () => {
    describe('determinism', () => {
        it('produces identical sequences for the same seed', () => {
            const rng1 = new SeededRng(12345);
            const rng2 = new SeededRng(12345);

            const sequence1 = Array.from({ length: 10 }, () => rng1.random());
            const sequence2 = Array.from({ length: 10 }, () => rng2.random());

            expect(sequence1).toEqual(sequence2);
        });

        it('produces different sequences for different seeds', () => {
            const rng1 = new SeededRng(12345);
            const rng2 = new SeededRng(54321);

            const val1 = rng1.random();
            const val2 = rng2.random();

            expect(val1).not.toEqual(val2);
        });

        it('works with string seeds', () => {
            const rng1 = new SeededRng('my-seed');
            const rng2 = new SeededRng('my-seed');

            expect(rng1.random()).toEqual(rng2.random());
        });
    });

    describe('int()', () => {
        it('returns values within the specified range', () => {
            const rng = new SeededRng(42);

            for (let i = 0; i < 100; i++) {
                const val = rng.int(5, 10);
                expect(val).toBeGreaterThanOrEqual(5);
                expect(val).toBeLessThanOrEqual(10);
            }
        });

        it('is deterministic', () => {
            const rng1 = new SeededRng(999);
            const rng2 = new SeededRng(999);

            const ints1 = Array.from({ length: 20 }, () => rng1.int(0, 100));
            const ints2 = Array.from({ length: 20 }, () => rng2.int(0, 100));

            expect(ints1).toEqual(ints2);
        });
    });

    describe('pick()', () => {
        it('returns an element from the array', () => {
            const rng = new SeededRng(123);
            const arr = ['a', 'b', 'c', 'd'];

            for (let i = 0; i < 50; i++) {
                const picked = rng.pick(arr);
                expect(arr).toContain(picked);
            }
        });

        it('throws on empty array', () => {
            const rng = new SeededRng(123);
            expect(() => rng.pick([])).toThrow('Cannot pick from empty array');
        });

        it('is deterministic', () => {
            const rng1 = new SeededRng(777);
            const rng2 = new SeededRng(777);
            const arr = ['x', 'y', 'z'];

            const picks1 = Array.from({ length: 10 }, () => rng1.pick(arr));
            const picks2 = Array.from({ length: 10 }, () => rng2.pick(arr));

            expect(picks1).toEqual(picks2);
        });
    });

    describe('pickN()', () => {
        it('returns the correct number of unique elements', () => {
            const rng = new SeededRng(456);
            const arr = [1, 2, 3, 4, 5];

            const picked = rng.pickN(arr, 3);

            expect(picked).toHaveLength(3);
            expect(new Set(picked).size).toBe(3); // All unique
            picked.forEach((p) => expect(arr).toContain(p));
        });

        it('throws when requesting more elements than available', () => {
            const rng = new SeededRng(456);
            expect(() => rng.pickN([1, 2], 5)).toThrow('Cannot pick 5 elements');
        });

        it('is deterministic', () => {
            const rng1 = new SeededRng(888);
            const rng2 = new SeededRng(888);
            const arr = ['a', 'b', 'c', 'd', 'e'];

            expect(rng1.pickN(arr, 3)).toEqual(rng2.pickN(arr, 3));
        });
    });

    describe('shuffle()', () => {
        it('contains all original elements', () => {
            const rng = new SeededRng(111);
            const arr = [1, 2, 3, 4, 5];
            const shuffled = rng.shuffle([...arr]);

            expect(shuffled.sort()).toEqual(arr.sort());
        });

        it('is deterministic', () => {
            const rng1 = new SeededRng(222);
            const rng2 = new SeededRng(222);

            const shuffled1 = rng1.shuffle([1, 2, 3, 4, 5]);
            const shuffled2 = rng2.shuffle([1, 2, 3, 4, 5]);

            expect(shuffled1).toEqual(shuffled2);
        });
    });

    describe('weighted()', () => {
        it('respects probability weights', () => {
            const rng = new SeededRng(333);
            const weights = { a: 0.9, b: 0.05, c: 0.05 };

            const counts = { a: 0, b: 0, c: 0 };
            for (let i = 0; i < 1000; i++) {
                counts[rng.weighted(weights)]++;
            }

            // 'a' should be picked much more often
            expect(counts.a).toBeGreaterThan(counts.b + counts.c);
        });

        it('is deterministic', () => {
            const rng1 = new SeededRng(444);
            const rng2 = new SeededRng(444);
            const weights = { x: 0.5, y: 0.3, z: 0.2 };

            const results1 = Array.from({ length: 20 }, () => rng1.weighted(weights));
            const results2 = Array.from({ length: 20 }, () => rng2.weighted(weights));

            expect(results1).toEqual(results2);
        });
    });
});
