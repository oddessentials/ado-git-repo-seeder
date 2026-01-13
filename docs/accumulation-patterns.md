# Multi-Run Accumulation (Normative Contract v1.1.0)

This document defines the **normative contract** for multi-run activity accumulation in the `ado-git-repo-seeder`.

## Core Principle

To simulate multiple days of development activity on a stable set of repositories, you must maintain a fixed **Project/Repo structure** while simulating time-series activity through incrementing **Run IDs**.

---

## The "Golden" Accumulation Strategy

### 1. Unified Configuration
Maintain a single `seed.config.json` with a fixed `seed` value.
```json
{
  "seed": 12345,
  "repoNaming": "direct",
  "projects": [{ "name": "App", "repos": ["ServiceA"] }]
}
```

### 2. Time-Series Execution
Execute the tool once per simulated "day", passing a unique `--run-id` for each execution.

- **Day 1**: `npm start -- --run-id day-1`
- **Day 2**: `npm start -- --run-id day-2`

### 3. Identity Resolution
Each run independently resolves user identities. To simulate the same developers working across multiple days, ensure your `seed.config.json` contains consistent email addresses across runs.

---

## Idempotency and Safety (Normative)

### Collision Prevention
The tool enforces strict physical isolation between runs via branch naming. 
- Branches for `day-1` are prefixed `.../day-1-0`.
- Branches for `day-2` are prefixed `.../day-2-0`.

> [!CAUTION]
> As per the [Configuration Reference](configuration.md), re-running the tool with an **identical `runId`** on a repository that already contains that run's activity is a **FATAL ERROR**.

### PR Continuity
Each run creates its own set of Pull Requests. The `runId` is injected into the PR title and description to ensure traceability and distinguish Day 1 activity from Day 2 activity on the same repository.

---

## Deferral
For exhaustive details on the `runId` CLI flag and `repoNaming` schema, defer to the [Configuration Reference](configuration.md).
