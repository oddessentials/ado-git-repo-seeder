# Multi-Run Accumulation Patterns (Canonical Guide v1.1.0)

The ADO Git Repo Seeder is designed to support multi-day activity simulation through idempotent runs. This guide explains how to use `repoNaming: direct` and `runId` to accumulate activity safely.

## The "Golden" Accumulation Strategy

To simulate multiple days of activity on the same repository, use the same repository name but **increment the Run ID** (and keep the global seed fixed).

### Day 1: Initial Seeding
Config (`seed.config.json`):
```json
{
  "seed": 12345,
  "repoNaming": "direct",
  "projects": [
    {
      "name": "ProjectAlpha",
      "repos": ["MainService"]
    }
  ]
}
```
Command:
```bash
npm start -- --run-id day-1
```
Result: `MainService` is created. 1 PR is opened with branches named `.../day-1-0`.

### Day 2: Accumulating Activity
Keep the config identical (specifically the `seed`).
Command:
```bash
npm start -- --run-id day-2
```
Result: `MainService` already exists, so it is reused. New activity is pushed to branches named `.../day-2-0`. A second PR is opened.

---

## Why this is Safe

### 1. Fixed Seeding
By keeping the `seed` fixed in the config, the tool generates deterministic but **unique** branch names and commit content for each `runId`. 
- `runId: day-1` -> `branch: feature/day-1-0`
- `runId: day-2` -> `branch: feature/day-2-0`

### 2. Collision Guard
If you accidentally run `day-1` again on the same repo, the tool will perform a `git ls-remote` check. It will see `feature/day-1-0` already exists on the server and will terminate with a **FATAL ERROR** to prevent corruption.

### 3. Idempotent PRs
Since branch names include the `runId`, the PRs are naturally idempotent per run. 

## Activity-Only Mode
If you want to run PR activity against repositories that already existed *before* you started using the seeder, use `repoNaming: direct` and ensure your `seed.config.json` listed repo names EXACTLY match ADO.
