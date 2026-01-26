import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.test.ts'],
        coverage: {
            reporter: ['text', 'json', 'json-summary', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/cli.ts'],
            thresholds: {
                statements: 80,
                branches: 62,
                functions: 88,
                lines: 81,
            },
        },
    },
});
