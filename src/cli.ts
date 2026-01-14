#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createPlan } from './seed/planner.js';
import { SeedRunner } from './seed/runner.js';
import { writeSummary, printSummary, generateMarkdownSummary } from './seed/summary.js';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

interface CliArgs {
    config: string;
    dryRun: boolean;
    clearCache: boolean;
    runId?: string;
    outputDir: string;
    fixturesPath?: string;
    repoNaming?: 'isolated' | 'direct';
    purgeStale: boolean;
    targetDate?: string; // ISO timestamp for git commit backdating
    noCleanup: boolean; // Disable cleanup mode (default: false, meaning cleanup is ON)
    cleanupThreshold: number; // Open PR count threshold to trigger cleanup mode
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    const result: CliArgs = {
        config: 'seed.config.json',
        dryRun: false,
        clearCache: false,
        outputDir: '.',
        purgeStale: false,
        noCleanup: false,
        cleanupThreshold: 50,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--config':
            case '-c':
                result.config = args[++i] ?? result.config;
                break;
            case '--dry-run':
            case '-d':
                result.dryRun = true;
                break;
            case '--clear-cache':
                result.clearCache = true;
                break;
            case '--run-id':
                result.runId = args[++i];
                break;
            case '--output':
            case '-o':
                result.outputDir = args[++i] ?? result.outputDir;
                break;
            case '--fixtures':
            case '-f':
                result.fixturesPath = args[++i];
                break;
            case '--naming':
                const naming = args[++i];
                if (naming === 'isolated' || naming === 'direct') {
                    result.repoNaming = naming;
                }
                break;
            case '--purge-stale':
                result.purgeStale = true;
                break;
            case '--no-cleanup':
                result.noCleanup = true;
                break;
            case '--cleanup-threshold': {
                const threshold = parseInt(args[++i], 10);
                if (isNaN(threshold) || threshold < 0) {
                    console.error('❌ Invalid --cleanup-threshold. Expected a positive integer.');
                    process.exit(1);
                }
                result.cleanupThreshold = threshold;
                break;
            }
            case '--date': {
                const dateStr = args[++i];
                if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    console.error('❌ Invalid --date format. Expected YYYY-MM-DD (e.g., 2026-01-10)');
                    process.exit(1);
                }
                const parsed = new Date(`${dateStr}T12:00:00Z`);
                if (isNaN(parsed.getTime())) {
                    console.error(`❌ Invalid date: ${dateStr}`);
                    process.exit(1);
                }
                result.targetDate = parsed.toISOString();
                break;
            }
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
        }
    }

    return result;
}

function printHelp(): void {
    console.log(`
ado-git-repo-seeder - Seed Azure DevOps with realistic PR activity

Usage:
  npx ts-node src/cli.ts [options]

Options:
  -c, --config <path>     Path to seed.config.json (default: seed.config.json)
  -d, --dry-run           Output the plan without executing any operations
  --clear-cache           Clear the identity cache before running
  --run-id <id>           Override the auto-generated run ID
  -o, --output <dir>      Output directory for summary files (default: .)
  -f, --fixtures <path>   Path to fixtures directory for content derivation
  --naming <mode>         Override global repoNaming strategy (isolated | direct)
  --purge-stale           Purge the temporary working directory on startup
  --date <YYYY-MM-DD>     Backdate git commits to this date (noon UTC)
  --no-cleanup            Disable cleanup mode (default: cleanup is ON)
  --cleanup-threshold <n> Open PR count threshold to trigger cleanup (default: 50)
  -h, --help              Show this help message

Cleanup Mode (default: ON):
  When open PR count exceeds the threshold, the tool prioritizes completing
  existing PRs over creating new ones. Drafts are published first.

Note: --date only affects git commit timestamps. PRs, comments, and votes
are server-assigned and will show actual execution time.

Examples:
  # Preview what would be created
  npx ts-node src/cli.ts --dry-run

  # Run with direct naming (re-use existing repos)
  npx ts-node src/cli.ts --naming direct

  # Backdate commits to simulate historical activity
  npx ts-node src/cli.ts --run-id day-1 --date 2026-01-10

  # Disable cleanup mode
  npx ts-node src/cli.ts --no-cleanup
`);
}

async function main(): Promise<void> {
    const args = parseArgs();

    // Load version from package.json
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = resolve(__dirname, '../package.json');
    let version = 'unknown';
    try {
        if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            version = pkg.version;
        }
    } catch { }

    console.log(`🌱 ADO Git Repo Seeder (v${version})\n`);

    // Load config
    console.log(`📄 Loading config from: ${args.config}`);
    let config;
    try {
        config = loadConfig(args.config, args.runId);
        // Apply CLI overrides to global config
        if (args.repoNaming) {
            config.repoNaming = args.repoNaming;
        }
    } catch (error) {
        console.error(`❌ Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }

    // Handle purge-stale
    if (args.purgeStale) {
        const { rmSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { tmpdir } = await import('node:os');
        const rootTemp = join(tmpdir(), 'ado-seeder');
        console.log(`🧹 Purging stale working directory: ${rootTemp}`);
        try {
            rmSync(rootTemp, { recursive: true, force: true });
        } catch { }
    }

    console.log(`   Organization: ${config.org}`);
    console.log(`   Run ID: ${config.runId}`);
    console.log(`   Projects: ${config.projects.length}`);
    console.log('');
    console.log('   Users (env-var resolution):');
    for (const user of config.resolvedUsers) {
        const isSet = !!process.env[user.patEnvVar];
        const status = isSet ? '✓ set' : '✗ unset';
        console.log(`     ${user.email} → ${user.patEnvVar} (${status})`);
    }
    console.log('');

    // Create plan
    console.log('📋 Creating seeding plan...');
    const plan = createPlan(config);
    console.log(`   Planned repos: ${plan.repos.length}`);
    console.log(`   Planned PRs: ${plan.repos.reduce((sum, r) => sum + r.prs.length, 0)}`);
    console.log('');

    // Dry run mode
    if (args.dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be made\n');
        console.log('=== PLANNED OPERATIONS ===\n');

        for (const repo of plan.repos) {
            console.log(`📁 ${repo.project}/${repo.repoName} [Strategy: ${repo.resolvedNaming}]`);
            console.log(`   Branches: ${repo.branches.map(b => b.name).join(', ')}`);
            console.log(`   PRs:`);
            for (const pr of repo.prs) {
                console.log(`     - "${pr.title}" by ${pr.creatorEmail}`);
                console.log(`       Reviewers: ${pr.reviewers.map(r => `${r.email}(${r.vote})`).join(', ')}`);
                console.log(`       Comments: ${pr.comments.length}, Outcome: ${pr.outcome}, Follow-up: ${pr.followUpCommits}`);
            }
            console.log('');
        }

        // Write plan to JSON
        const planPath = resolve(args.outputDir, `plan-${config.runId}.json`);
        writeFileSync(planPath, JSON.stringify(plan, null, 2));
        console.log(`📝 Plan written to: ${planPath}`);

        process.exit(0);
    }

    // Execute seeding
    console.log('🚀 Executing seeding plan...\n');

    // Check for fixtures
    let fixturesPath = args.fixturesPath;
    if (!fixturesPath) {
        const defaultFixtures = resolve(dirname(args.config), 'fixtures');
        if (existsSync(defaultFixtures)) {
            fixturesPath = defaultFixtures;
            console.log(`📂 Using fixtures from: ${fixturesPath}`);
        } else {
            console.log('⚠️  No fixtures path provided, using synthetic content generation');
        }
    }

    const runner = new SeedRunner(config, plan, fixturesPath, version, args.targetDate, {
        cleanupEnabled: !args.noCleanup,
        cleanupThreshold: args.cleanupThreshold,
    });
    const summary = await runner.run();

    // Output results
    console.log('\n=== SEED COMPLETE ===\n');
    printSummary(summary);

    // Write summary files
    const jsonPath = resolve(args.outputDir, `summary-${config.runId}.json`);
    const mdPath = resolve(args.outputDir, `summary-${config.runId}.md`);

    writeSummary(summary, jsonPath);
    writeFileSync(mdPath, generateMarkdownSummary(summary));

    console.log(`\n📝 Summary written to:`);
    console.log(`   JSON: ${jsonPath}`);
    console.log(`   Markdown: ${mdPath}`);

    // Exit with error code if fatal failure
    if (summary.fatalFailure) {
        console.error(`\n❌ Seeding failed with fatal error`);
        process.exit(1);
    }

    const totalFailures = summary.repos.reduce((sum, r) => sum + r.failures.length, 0);
    if (totalFailures > 0) {
        console.warn(`\n⚠️  Completed with ${totalFailures} non-fatal failures`);
        process.exit(0);
    }

    console.log('\n✅ Seeding completed successfully');
}

main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
