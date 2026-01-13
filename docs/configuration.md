# Configuration Reference (Normative Contract v1.1.0)

This document is the **normative contract** for the `ado-git-repo-seeder` configuration. All other documentation (README, guides) must defer to this reference.

## Prerequisites (Normative)

> [!CAUTION]
> **Mandatory** requirements before running the seeder:
>
> 1. **ADO projects must already exist** — The seeder creates repositories within existing Azure DevOps projects. It does NOT create projects.
> 2. **Project names are case-sensitive** — `marketing` ≠ `Marketing`. Mismatched case causes `404 project not found` errors.
> 3. **PAT scopes (mandatory)**:
>    - `Code (Read, Write & Manage)`
>    - `Identity (Read)`

---


## Identity & Authentication

### `org` (string, required)
The Azure DevOps organization name (e.g., `my-org`).

### `users` (array, required)
A list of user identities used for seeding PRs, comments, and votes.
- `email`: The email address of the ADO user.
- `patEnvVar`: The name of the environment variable containing the Personal Access Token (PAT).

## Environment Variables (Normative)

### PAT Resolution
Each user in the `users[]` array specifies a `patEnvVar` field. This is the **name** of the environment variable containing that user's Personal Access Token.

> [!IMPORTANT]
> Variable names are **completely flexible**. `ADO_PAT_DEV1` is just a convention.
> You can use `MY_TOKEN`, `ALICE_PAT`, `TEAM_LEAD_TOKEN`, or any valid env var name.

### Required vs Optional
- **Required**: At least one user with a valid `patEnvVar` that resolves to a set env var
- **Optional**: Additional users enrich simulation but are not mandatory

### Scaling Users

| Users | Effect |
|-------|--------|
| 1 | Solo simulation (same user creates all PRs, no reviewers possible) |
| 2 | Minimal team (creator + one reviewer) |
| 3-5 | Realistic small team |
| 5-10 | Enterprise team simulation |
| 10+ | Large-scale simulation (see [enterprise example](../examples/enterprise/)) |

### Dry-Run Verification
Use `--dry-run` to verify env-var resolution before running:
```
Users (env-var resolution):
  alice@example.com → ADO_PAT_ALICE (✓ set)
  bob@example.com → ADO_PAT_BOB (✗ unset)
```

## Project & Repository Hierarchy

The config supports hierarchical overrides: **Global > Project > Repo**.

### `projects` (array, required)
A list of ADO projects to seed.
- `name`: Project name.
- `repos`: A list of repository names or repo objects.
  - `name`: Repo name.
  - `repoNaming`: (Optional) Override for this specific repository.

---

## The Law of Idempotency (Normative)

### `runId` (string, required via CLI)
Every execution must have a unique `runId`.

> [!CAUTION]
> **Fatal Collision Rule**: If the tool detects any existing branches or activity in the target repository matching the current `runId` (checked via `git ls-remote`), it will terminate with a **FATAL ERROR**. 
> 
> To accumulate activity on the same repository over multiple runs/days, you **must** increment the `runId` (e.g., `day-1`, `day-2`).

## Command Line Interface (CLI)

The following flags control the execution behavior:

### `--run-id` <id>
Overrides the auto-generated run ID. Required for accumulation runs.

### `--config` <path> (or `-c`)
Path to the `seed.config.json` file (default: `./seed.config.json`).

### `--dry-run` (or `-d`)
Generates the seeding plan and prints the summary without performing any Git or ADO operations.

### `--purge-stale`
Cleans the temporary working directory (`<TMP>/ado-seeder`) before execution.

---

## Strategy Controls

### `repoNaming` (enum: `isolated` | `direct`)
- `isolated`: (Default) Creates brand new repositories named `{name}-{runId}`.
- `direct`: Uses the exact repository names specified. Required for accumulation runs.

### `repoStrategy` (object)
- `createIfMissing`: (boolean, default: true)
- `failIfMissing`: (boolean, default: false)
- `skipIfExists`: (boolean, default: false)

### `branchStrategy` (object)
- `alwaysUseRunId`: (boolean, default: true) Ensures branches are prefixed with the run ID.
- `allowCollisions`: (boolean, default: false) Allow pushing to existing branches (dangerous).

### `activity` (object)
Controls follow-up activity after initial PR creation.
- `pushFollowUpCommits`: (number 0-1, default: 0.3) Probability of adding follow-up commits.
- `followUpCommitsRange`: `{ min: number, max: number }` (default: 1-3).

---

## Scale & Distribution

### `scale` (object)
- `branchesPerRepo`: number
- `commitsPerBranch`: `{ min: number, max: number }`
- `prsPerRepo`: number
- `reviewersPerPr`: `{ min: number, max: number }`
- `commentsPerPr`: `{ min: number, max: number }`

### `voteDistribution` (object)
Weighted probability for PR reviewer votes (sum should be 1.0):
- `approve`
- `approveWithSuggestions`
- `reject`
- `noVote`

### `prOutcomes` (object)
Weighted probability for PR completion (sum should be 1.0):
- `complete` (Squash or Merge)
- `abandon`
- `leaveOpen`

---

## Policy Preflight (Strict Disclaimer)

The `ado-git-repo-seeder` performs a **best-effort pre-check** for branch policies (minimum reviewers, etc.). 

> [!WARNING]
> **Incomplete Design**: Policy checks are **incomplete by design**. The tool does not guarantee that it will catch all potential merge blocks. Completion failures (e.g., "Merge blocked by policy") are recorded as individual repository failures in the summary report.

---

## Determinism
### `seed` (integer, required)
Global seed for the PRNG. Maintaining the same seed across different `runId` values ensures deterministic content diversity.
