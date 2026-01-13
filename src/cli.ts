#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createPlan } from './seed/planner.js';
import { SeedRunner } from './seed/runner.js';
import { writeSummary, printSummary, generateMarkdownSummary } from './seed/summary.js';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

interface CliArgs {
    config: string;
    dryRun: boolean;
    clearCache: boolean;
    runId?: string;
    outputDir: string;
    fixturesPath?: string;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    const result: CliArgs = {
        config: 'seed.config.json',
        dryRun: false,
        clearCache: false,
        outputDir: '.',
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
  -h, --help              Show this help message

Examples:
  # Preview what would be created
  npx ts-node src/cli.ts --dry-run

  # Run with a specific config
  npx ts-node src/cli.ts --config my-config.json

  # Use fixtures from test-fixtures submodule
  npx ts-node src/cli.ts --fixtures ./fixtures
`);
}

async function main(): Promise<void> {
    const args = parseArgs();

    console.log('🌱 ADO Git Repo Seeder\n');

    // Load config
    console.log(`📄 Loading config from: ${args.config}`);
    let config;
    try {
        config = loadConfig(args.config, args.runId);
    } catch (error) {
        console.error(`❌ Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }

    console.log(`   Organization: ${config.org}`);
    console.log(`   Run ID: ${config.runId}`);
    console.log(`   Users: ${config.resolvedUsers.length}`);
    console.log(`   Projects: ${config.projects.length}`);
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
            console.log(`📁 ${repo.project}/${repo.repoName}`);
            console.log(`   Branches: ${repo.branches.map(b => b.name).join(', ')}`);
            console.log(`   PRs:`);
            for (const pr of repo.prs) {
                console.log(`     - "${pr.title}" by ${pr.creatorEmail}`);
                console.log(`       Reviewers: ${pr.reviewers.map(r => `${r.email}(${r.vote})`).join(', ')}`);
                console.log(`       Comments: ${pr.comments.length}, Outcome: ${pr.outcome}`);
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

    const runner = new SeedRunner(config, plan, fixturesPath);
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
