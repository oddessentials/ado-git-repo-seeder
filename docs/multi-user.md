# Multi-User Simulation & Security (v1.1.0)

This guide covers how to simulate realistic multi-user activity in Azure DevOps using the `ado-git-repo-seeder`.

## Multi-User Simulation

The tool simulates multiple users by rotating through the `users` array defined in `seed.config.json`. Each user acts as a PR creator, reviewer, or commenter based on the deterministic plan.

### Identity Resolution
The tool performs a **one-time lookup** per run (or utilizes the cache) to map email addresses to internal Azure DevOps Identity IDs. 

### Identity Caching
To reduce API calls, identity mappings are stored in `identities.cache.json`.
- **Note**: If you change the `org`, you should use `--clear-cache` to force a refresh, or manually delete the cache file.

---

## Security Anti-Patterns (The "DO NOT" List)

The `ado-git-repo-seeder` is hardened with `GIT_ASKPASS` and secure redaction logic. However, users must avoid the following high-risk misuses:

> [!CAUTION]
> ### 1. DO NOT Embed PATs in URLs
> Never modify the internal code or configuration to inject PATs directly into Git remote URLs (e.g., `https://PAT@dev.azure.com/...`). The tool is designed to use clean URLs with ephemeral `GIT_ASKPASS` scripts.
>
> ### 2. DO NOT Reuse `runId` for Different Logical Runs
> Reusing a `runId` will trigger a **FATAL ERROR** if activity already exists. Do not try to "force" runs using the same ID; always increment the ID to maintain physical branch isolation.
>
> ### 3. DO NOT Run in Interactive Shells (CI Recommended)
> The tool is optimized for non-interactive execution (CI/CD). Running in an interactive shell where `GIT_TERMINAL_PROMPT` is enabled might lead to hung processes if authentication fails.
>
> ### 4. DO NOT Check-in `seed.config.json` with Real Secrets
> Always use `patEnvVar` to reference environment variables. Never hardcode tokens in the JSON file.

---

## Scaling Users

The number of users in your `users[]` array directly affects simulation richness:

- **1 user**: Solo simulation (no reviewers possible)
- **2+ users**: Enables reviewer rotation
- **5+ users**: Realistic team dynamics

For detailed scaling guidance and env-var configuration, see **[Configuration Reference](configuration.md#scaling-users)**.

---

## Technical Details

### GIT_ASKPASS Implementation
The tool generates a temporary executable script (batch on Windows, shell on Linux) that prints the PAT when Git requests a password. This script is purged immediately after the Git operation concludes.

### Redaction Canary
The tool's test suite includes a "Security Canary" that verifies sentinel PATs are redacted from all summary files and console output.

