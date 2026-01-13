import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { SeededRng } from '../util/rng.js';

// Safe text file extensions for derivation
const SAFE_EXTENSIONS = new Set([
    '.ts', '.js', '.tsx', '.jsx', '.json', '.md', '.txt', '.css', '.html', '.yml', '.yaml',
]);

interface FileContent {
    path: string;
    content: string;
}

/**
 * Derives commit content from fixtures using safe mutations.
 */
export class ContentDeriver {
    private fixtures: FileContent[] = [];
    private rng: SeededRng;

    constructor(rng: SeededRng, fixturesPath?: string) {
        this.rng = rng;
        if (fixturesPath && existsSync(fixturesPath)) {
            this.loadFixtures(fixturesPath);
        }
    }

    private loadFixtures(basePath: string, currentPath: string = basePath): void {
        const entries = readdirSync(currentPath);
        for (const entry of entries) {
            const fullPath = join(currentPath, entry);
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
                // Skip hidden directories and node_modules
                if (!entry.startsWith('.') && entry !== 'node_modules') {
                    this.loadFixtures(basePath, fullPath);
                }
            } else if (stat.isFile() && SAFE_EXTENSIONS.has(extname(entry))) {
                try {
                    const content = readFileSync(fullPath, 'utf-8');
                    this.fixtures.push({
                        path: fullPath.replace(basePath, '').replace(/^[\\/]/, ''),
                        content,
                    });
                } catch {
                    // Skip unreadable files
                }
            }
        }
    }

    /**
     * Generates a derived filename.
     */
    deriveFilename(index: number, ext: string = '.ts', rng: SeededRng = this.rng): string {
        const prefixes = ['feature', 'util', 'helper', 'service', 'component', 'module'];
        const suffixes = ['handler', 'manager', 'processor', 'factory', 'builder', 'validator'];
        const prefix = rng.pick(prefixes);
        const suffix = rng.pick(suffixes);
        return `${prefix}-${suffix}-${index}${ext}`;
    }

    /**
     * Generates derived content (safe mutations of fixture snippets).
     */
    deriveContent(index: number, rng: SeededRng = this.rng): string {
        // If we have fixtures, sample and mutate
        if (this.fixtures.length > 0) {
            const sample = rng.pick(this.fixtures);
            return this.mutate(sample.content, index, rng);
        }
        // Fallback: generate minimal synthetic content
        return this.generateSyntheticContent(index, rng);
    }

    /**
     * Applies safe mutations: comment changes, string literals, identifier renames.
     */
    private mutate(content: string, index: number, rng: SeededRng): string {
        let result = content;

        // Mutate comments (safe)
        result = result.replace(/\/\/ .+/g, () => {
            const comments = [
                `// Modified for run ${index}`,
                `// Updated implementation`,
                `// Refactored logic`,
                `// Enhanced version`,
            ];
            return rng.pick(comments);
        });

        // Mutate string literals (safe)
        result = result.replace(/"[^"]{1,20}"/g, () => {
            const strings = [
                `"value-${index}"`,
                `"data-${rng.int(100, 999)}"`,
                `"item-${Date.now() % 10000}"`,
            ];
            return rng.pick(strings);
        });

        // Truncate if too long
        const lines = result.split('\n');
        if (lines.length > 50) {
            result = lines.slice(0, 50).join('\n') + '\n// ... truncated\n';
        }

        return result;
    }

    /**
     * Generates minimal synthetic content when no fixtures available.
     */
    private generateSyntheticContent(index: number, rng: SeededRng): string {
        const functionNames = ['process', 'handle', 'validate', 'transform', 'calculate'];
        const funcName = rng.pick(functionNames);

        return `// Auto-generated for seeding (run index: ${index})
export function ${funcName}Data(input: unknown): unknown {
  // Implementation ${rng.int(1, 100)}
  return input;
}

export const CONFIG_${index} = {
  enabled: ${rng.random() > 0.5},
  threshold: ${rng.int(1, 100)},
  mode: "${rng.pick(['fast', 'balanced', 'thorough'])}",
};
`;
    }

    /**
     * Generates a complete file set for a branch.
     */
    generateFileSet(count: number, rng: SeededRng = this.rng): Array<{ name: string; content: string }> {
        const files: Array<{ name: string; content: string }> = [];
        for (let i = 0; i < count; i++) {
            files.push({
                name: this.deriveFilename(i, '.ts', rng),
                content: this.deriveContent(i, rng),
            });
        }
        return files;
    }

    get hasFixtures(): boolean {
        return this.fixtures.length > 0;
    }
}
