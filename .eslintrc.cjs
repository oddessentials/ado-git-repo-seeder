module.exports = {
    root: true,
    env: {
        node: true,
        es2022: true,
    },
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
    plugins: ['@typescript-eslint'],
    extends: ['eslint:recommended'],
    globals: {
        NodeJS: 'readonly',
    },
    rules: {
        'no-unused-vars': 'off', // TypeScript handles this
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'no-console': 'off',
        'no-empty': ['error', { allowEmptyCatch: true }],
        'no-case-declarations': 'warn',
        'no-useless-catch': 'warn',
    },
    ignorePatterns: ['dist/', 'node_modules/', 'coverage/'],
};
