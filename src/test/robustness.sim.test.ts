import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SeedRunner } from '../seed/runner.js';
import { createPlan } from '../seed/planner.js';
import { loadConfig } from '../config.js';
import { exec } from '../util/exec.js';
import axios from 'axios';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../util/exec.js');
vi.mock('axios');

describe('Multi-Run Robustness (Simulated)', () => {
    let tempDir: string;
    let configPath: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = mkdtempSync(join(tmpdir(), 'robustness-test-'));
        configPath = join(tempDir, 'seed.config.json');

        const config = {
            org: 'test-org',
            projects: [{ name: 'ProjA', repos: ['Repo1'] }],
            users: [{ email: 'u1@t.com', patEnvVar: 'PAT1' }],
            scale: {
                branchesPerRepo: 1,
                commitsPerBranch: { min: 1, max: 1 },
                prsPerRepo: 1,
                reviewersPerPr: { min: 1, max: 1 },
                commentsPerPr: { min: 1, max: 1 },
            },
            voteDistribution: { approve: 1, approveWithSuggestions: 0, reject: 0, noVote: 0 },
            prOutcomes: { complete: 1, abandon: 0, leaveOpen: 0 },
            seed: 123,
            repoNaming: 'direct', // Re-use repo name
        };

        writeFileSync(configPath, JSON.stringify(config));
        process.env.PAT1 = 'fake-pat';

        // Mock ADO APIs
        (axios.create as any).mockReturnValue({
            interceptors: {
                request: { use: vi.fn() },
                response: { use: vi.fn() },
            },
            get: vi.fn().mockImplementation((url) => {
                const lowUrl = url.toLowerCase();
                if (lowUrl.includes('_apis/policy/configurations')) return Promise.resolve({ data: { value: [] } });
                if (lowUrl.includes('_apis/git/repositories/repo1')) return Promise.resolve({ data: { id: 'repo-id-1', remoteUrl: 'https://fake/Repo1' } });
                if (lowUrl.includes('_apis/git/repositories')) return Promise.resolve({ data: { value: [{ name: 'Repo1', id: 'repo-id-1' }] } });
                if (lowUrl.includes('_apis/identities')) return Promise.resolve({ data: { value: [{ id: 'user-id-1' }] } });
                if (lowUrl.includes('pullrequests/')) return Promise.resolve({ data: { pullRequestId: 101, lastMergeSourceCommit: { commitId: 'abc' } } });
                return Promise.resolve({ data: {} });
            }),
            post: vi.fn().mockResolvedValue({ data: { pullRequestId: 101 } }),
            patch: vi.fn().mockResolvedValue({ data: {} }),
        });

        // Mock Git commands
        (exec as any).mockResolvedValue({ stdout: '', stderr: '', code: 0 });
    });

    it('Scenario 1: Accumulation (Run 1 -> Run 2 with unique runIds)', async () => {
        const config1 = loadConfig(configPath, 'run-day-1');
        const plan1 = createPlan(config1);
        const runner1 = new SeedRunner(config1, plan1);

        const summary1 = await runner1.run();
        expect(summary1.fatalFailure).toBeNull();

        // Run 2
        const config2 = loadConfig(configPath, 'run-day-2');
        const plan2 = createPlan(config2);
        const runner2 = new SeedRunner(config2, plan2);

        const summary2 = await runner2.run();
        expect(summary2.fatalFailure).toBeNull();

        // Verify checkCollisions was called with seeder@ URL
        expect(exec).toHaveBeenCalledWith('git', expect.arrayContaining(['ls-remote', '--heads', 'https://seeder@fake/Repo1']), expect.any(Object));
    });

    it('Scenario 2: Fatal Collision (Run 2 re-run with same runId)', async () => {
        // Mock ls-remote to find existing branch for 'run-day-2'
        // Branches are chore/run-day-2-0, feature/run-day-2-1, etc.
        (exec as any).mockImplementation((cmd: string, args: string[]) => {
            if (args.includes('ls-remote')) {
                return Promise.resolve({
                    stdout: 'hash\trefs/heads/chore/run-day-2-0',
                    stderr: '',
                    code: 0
                });
            }
            return Promise.resolve({ stdout: '', stderr: '', code: 0 });
        });

        const config = loadConfig(configPath, 'run-day-2');
        const plan = createPlan(config);
        const runner = new SeedRunner(config, plan);

        const summary = await runner.run();

        expect(summary.fatalFailure).not.toBeNull();
        expect(summary.fatalFailure?.error).toContain('FATAL: Collision detected');
    });
});
