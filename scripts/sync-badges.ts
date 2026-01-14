/**
 * Badge Sync Script
 *
 * Updates README.md badges based on:
 * - Coverage data from coverage/coverage-summary.json
 * - Package version from package.json
 * - Node version from package.json engines field
 *
 * Usage: npx tsx scripts/sync-badges.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

interface CoverageSummary {
    total: {
        statements: { pct: number };
        branches: { pct: number };
        functions: { pct: number };
        lines: { pct: number };
    };
}

function getCoveragePercentage(): number {
    const coveragePath = join(ROOT, 'coverage', 'coverage-summary.json');
    if (!existsSync(coveragePath)) {
        console.warn('⚠️  No coverage data found, using 0%');
        return 0;
    }

    const data: CoverageSummary = JSON.parse(readFileSync(coveragePath, 'utf-8'));
    return Math.round(data.total.statements.pct);
}

function getCoverageColor(pct: number): string {
    if (pct >= 80) return 'brightgreen';
    if (pct >= 60) return 'yellow';
    if (pct >= 40) return 'orange';
    return 'red';
}

function getPackageInfo(): { version: string; nodeVersion: string } {
    const pkgPath = join(ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return {
        version: pkg.version || '0.0.0',
        nodeVersion: pkg.engines?.node || '>=18',
    };
}

function generateBadges(): string {
    const coverage = getCoveragePercentage();
    const coverageColor = getCoverageColor(coverage);
    const { version, nodeVersion } = getPackageInfo();

    // GitHub repo info (hardcoded for this repo)
    const owner = 'oddessentials';
    const repo = 'ado-git-repo-seeder';

    const badges = [
        `[![CI](https://github.com/${owner}/${repo}/actions/workflows/ci.yml/badge.svg)](https://github.com/${owner}/${repo}/actions/workflows/ci.yml)`,
        `[![Coverage](https://img.shields.io/badge/coverage-${coverage}%25-${coverageColor})](./coverage/index.html)`,
        `[![Version](https://img.shields.io/badge/version-${version}-blue)](./package.json)`,
        `[![Node](https://img.shields.io/badge/node-${encodeURIComponent(nodeVersion)}-green)](./package.json)`,
    ];

    return badges.join(' ');
}

function updateReadme(): void {
    const readmePath = join(ROOT, 'README.md');
    let content = readFileSync(readmePath, 'utf-8');

    const badges = generateBadges();

    // Check if badges section exists
    const startMarker = '<!-- BADGES:START -->';
    const endMarker = '<!-- BADGES:END -->';

    if (content.includes(startMarker) && content.includes(endMarker)) {
        // Replace existing badges
        const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'g');
        content = content.replace(regex, `${startMarker}\n${badges}\n${endMarker}`);
    } else {
        // Insert badges after the first heading
        const firstHeadingMatch = content.match(/^# .+$/m);
        if (firstHeadingMatch) {
            const insertPos = (firstHeadingMatch.index ?? 0) + firstHeadingMatch[0].length;
            const before = content.slice(0, insertPos);
            const after = content.slice(insertPos);
            content = `${before}\n\n${startMarker}\n${badges}\n${endMarker}${after}`;
        } else {
            // No heading found, prepend
            content = `${startMarker}\n${badges}\n${endMarker}\n\n${content}`;
        }
    }

    writeFileSync(readmePath, content);
    console.log('✅ README.md badges updated');
    console.log(`   Coverage: ${getCoveragePercentage()}%`);
}

// Run
updateReadme();
