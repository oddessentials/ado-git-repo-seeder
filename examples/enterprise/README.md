# Enterprise Example

Large-scale 10-user simulation across multiple business units.

## ⚠️ Throttling Considerations

High-volume PR creation can trigger Azure DevOps 429 (Too Many Requests) responses.

### Recommended Scale Settings

| Setting | Conservative | Moderate | Aggressive |
|---------|-------------|----------|------------|
| `prsPerRepo` | 2-3 | 5-8 | 10+ |
| `branchesPerRepo` | 3-5 | 5-10 | 10+ |
| Total repos | 5-10 | 10-20 | 20+ |

> **This example uses conservative settings** (2 PRs/repo, 3 branches/repo) to avoid rate limiting. Increase gradually based on your ADO tier and observed behavior.

### Mitigation

- The tool includes built-in retry logic with exponential backoff
- Monitor summary output for 429 errors
- Consider running across multiple `runId` sessions

## Setup

> [!CAUTION]
> **Edit `seed.config.json` first** — replace `"your-org"`, project names, and user emails with your actual values. See [Prerequisites](../../docs/configuration.md#prerequisites-normative).

1. Set PATs for all 10 users (or use fewer — adjust the `users` array):
   ```bash
   $env:ADO_PAT_ALICE = "..."
   $env:ADO_PAT_BOB = "..."
   # ... etc for all 10 users
   ```

2. Run:

   > ⚠️ **Will fail** if `seed.config.json` still contains placeholders.

   ```bash
   npm start -- --config examples/enterprise/seed.config.json --run-id enterprise-1
   ```

For PAT setup and scaling guidance, see **[Configuration Reference](../../docs/configuration.md)**.
