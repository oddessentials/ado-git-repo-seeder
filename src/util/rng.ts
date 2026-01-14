import seedrandom from 'seedrandom';

/**
 * Seeded random number generator for distributional determinism.
 */
export class SeededRng {
    private rng: seedrandom.PRNG;

    constructor(seed: number | string) {
        this.rng = seedrandom(String(seed));
    }

    /** Returns a random float in [0, 1). */
    random(): number {
        return this.rng();
    }

    /** Returns a random integer in [min, max] (inclusive). */
    int(min: number, max: number): number {
        return Math.floor(this.random() * (max - min + 1)) + min;
    }

    /** Picks a random element from an array. */
    pick<T>(arr: readonly T[]): T {
        if (arr.length === 0) {
            throw new Error('Cannot pick from empty array');
        }
        return arr[this.int(0, arr.length - 1)];
    }

    /** Picks N unique elements from an array. */
    pickN<T>(arr: readonly T[], n: number): T[] {
        if (n > arr.length) {
            throw new Error(`Cannot pick ${n} elements from array of length ${arr.length}`);
        }
        const copy = [...arr];
        const result: T[] = [];
        for (let i = 0; i < n; i++) {
            const idx = this.int(0, copy.length - 1);
            result.push(copy.splice(idx, 1)[0]);
        }
        return result;
    }

    /** Shuffles an array in-place. */
    shuffle<T>(arr: T[]): T[] {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /**
     * Selects an outcome based on weighted probabilities.
     * @param weights Object mapping outcomes to probabilities (should sum to ~1).
     */
    weighted<K extends string>(weights: Record<K, number>): K {
        const entries = Object.entries(weights) as [K, number][];
        const r = this.random();
        let cumulative = 0;
        for (const [key, weight] of entries) {
            cumulative += weight;
            if (r < cumulative) {
                return key;
            }
        }
        // Fallback to last entry (handles floating point)
        return entries[entries.length - 1][0];
    }
}
