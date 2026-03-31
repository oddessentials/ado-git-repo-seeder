import { describe, it, expect, vi, Mock } from 'vitest';
import { GitGenerator } from './generator.js';
import { SeededRng } from '../util/rng.js';
import { exec } from '../util/exec.js';

vi.mock('../util/exec.js');

describe('GitGenerator commit author attribution', () => {
    it('adds --author with configured user emails for generated commits', async () => {
        vi.clearAllMocks();
        (exec as Mock).mockResolvedValue({ stdout: '', stderr: '', code: 0 });

        const generator = new GitGenerator(new SeededRng(42), undefined, [], undefined, [
            'dev1@example.com',
            'dev.two@example.com',
        ]);

        const generated = await generator.createRepo(
            'author-test-repo',
            [{ name: 'feature/test-run-0', commits: 1 }],
            42,
            'test-run'
        );

        const commitCalls = (exec as Mock).mock.calls.filter(
            (call) => call[0] === 'git' && Array.isArray(call[1]) && call[1][0] === 'commit'
        );

        expect(commitCalls.length).toBeGreaterThan(0);
        for (const call of commitCalls) {
            const args: string[] = call[1];
            expect(args).toContain('--author');
            const authorIdx = args.indexOf('--author');
            expect(args[authorIdx + 1]).toMatch(/<.+@example\.com>$/);
        }

        generated.cleanup();
    });

    it('omits --author when no commit authors are configured', async () => {
        vi.clearAllMocks();
        (exec as Mock).mockResolvedValue({ stdout: '', stderr: '', code: 0 });

        const generator = new GitGenerator(new SeededRng(99));

        await generator.createRepo('no-author-repo', [{ name: 'feature/no-author', commits: 1 }], 99, 'run-1');

        const commitCalls = (exec as Mock).mock.calls.filter(
            (call) => call[0] === 'git' && Array.isArray(call[1]) && call[1][0] === 'commit'
        );

        expect(commitCalls.length).toBeGreaterThan(0);
        for (const call of commitCalls) {
            const args: string[] = call[1];
            expect(args).not.toContain('--author');
        }
    });
});
