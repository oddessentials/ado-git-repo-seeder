# Isolated Greenfield Example

Creates fresh, disposable repositories for each run.

## When to Use

- Quick demos without affecting existing repos
- Testing the tool itself
- Proof-of-concept runs
- CI/CD pipeline validation

## How It Works

With `repoNaming: "isolated"`, the tool creates repos named `{name}-{runId}`:
- Run with `--run-id demo-1` → creates `marketing-site-demo-1`
- Run with `--run-id demo-2` → creates `marketing-site-demo-2`

Each run is **completely independent** — no collision risk.

## Setup

> [!CAUTION]
> **Edit `seed.config.json` first** — replace `"your-org"` and `"your-project"` with your actual values. See [Prerequisites](../../docs/configuration.md#prerequisites-normative).

1. Set your PAT:
   ```bash
   $env:ADO_PAT = "your-token"
   ```

2. Run:

   > ⚠️ **Will fail** if `seed.config.json` still contains placeholders.

   ```bash
   npm start -- --config examples/isolated-greenfield/seed.config.json --run-id demo-1
   ```

## Cleanup

Isolated repos can be deleted manually from Azure DevOps after testing.

For the opposite pattern (accumulating on the same repo), see **[Accumulation Example](../accumulation/)**.
