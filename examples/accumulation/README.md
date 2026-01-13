# Accumulation Example

Simulate multiple days of activity on the **same** repository.

## When to Use

- Simulating realistic project history over time
- Building up PR activity for analytics testing
- Creating multi-day development narratives

## How It Works

With `repoNaming: "direct"`, the tool uses **exact repo names** and avoids collision via unique `runId` branch prefixes:

```bash
# Day 1
npm start -- --config examples/accumulation/seed.config.json --run-id day-1
# Creates branches: feature/day-1-0, bugfix/day-1-1, etc.

# Day 2
npm start -- --config examples/accumulation/seed.config.json --run-id day-2
# Creates branches: feature/day-2-0, bugfix/day-2-1, etc.
```

Both runs add activity to the **same** `marketing-site` repo.

## Setup

> [!CAUTION]
> **This example will fail unless you edit `seed.config.json` first:**
> - Replace `"your-org"` with your ADO organization name
> - Replace `"marketing"` with an **existing** ADO project name (case-sensitive!)
> - Replace user emails with actual ADO user emails
>
> See [Prerequisites](../../docs/configuration.md#prerequisites-normative) for mandatory requirements.

1. Set PATs:
   ```bash
   $env:ADO_PAT_DEV1 = "your-token"
   $env:ADO_PAT_DEV2 = "your-token"
   ```

2. Run sequentially with incrementing `runId`:

   > ⚠️ **The commands below will fail** if `seed.config.json` still contains `"your-org"`.

   ```bash
   npm start -- --config examples/accumulation/seed.config.json --run-id day-1
   npm start -- --config examples/accumulation/seed.config.json --run-id day-2
   ```

> ⚠️ **Never reuse a `runId`** — the tool will terminate with a FATAL ERROR if it detects existing branches from a prior run.

For full accumulation rules, see **[Multi-Run Accumulation](../../docs/accumulation-patterns.md)**.
