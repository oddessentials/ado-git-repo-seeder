# ADO Git Repo Seeder - Execution Guide

## What We Did

### Run 1: Initial Test (Isolated)
```powershell
npm start -- --run-id day-1
```
- Used default `repoNaming: "isolated"`
- Created repos with `-day-1` suffix: `marketing-site-day-1`, `core-api-day-1`, etc.
- Result: 7 repos, 35 branches, 28 PRs

### Run 2-4: Accumulation (Direct)
Updated `seed.config.json` with `"repoNaming": "direct"`, then:
```powershell
npm start -- --run-id day-1  # Creates base repos
npm start -- --run-id day-2  # Adds more activity
npm start -- --run-id day-3  # Adds even more
```
- Creates repos WITHOUT suffix: `marketing-site`, `core-api`, etc.
- Each run adds new branches: `feature/day-N-0`, `bugfix/day-N-1`, etc.

---

## To Continue Adding Data

### Option A: Add More Days
```powershell
npm start -- --run-id day-4
npm start -- --run-id day-5
# etc.
```

### Option B: Use Sprint Names
```powershell
npm start -- --run-id sprint-1
npm start -- --run-id sprint-2
```

### Option C: Use Dates
```powershell
npm start -- --run-id 2026-01-14
npm start -- --run-id 2026-01-15
```

---

## Key Rules

1. **Never reuse a runId** - the tool will FATAL if you try
2. **Direct naming** = activity accumulates on same repos
3. **Isolated naming** = each run creates new repos with suffix
4. **PATs must be set** before each session:
   ```powershell
   $env:ADO_PAT_DEV1 = "..."
   $env:ADO_PAT_DEV2 = "..."
   $env:ADO_PAT_DEV3 = "..."
   ```

---

## Current Config Scale

| Setting | Value | Per Run Result |
|---------|-------|----------------|
| branchesPerRepo | 8 | ~56 branches total |
| prsPerRepo | 6 | ~42 PRs total |
| commitsPerBranch | 3-12 | ~300+ commits |
| commentsPerPr | 2-6 | ~150+ comments |

To scale up further, increase these values in `seed.config.json`.
