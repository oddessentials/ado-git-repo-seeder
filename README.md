# ado-git-repo-seeder

Configurable tool to seed realistic, multi-user pull-request activity on Azure DevOps.

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your PATs
npm run start -- --config seed.config.json
```

## Dry Run

Preview the seeding plan without making any changes:

```bash
npm run start -- --config seed.config.json --dry-run
```

## Configuration

See `seed.config.json` for all available options.
