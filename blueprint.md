# ado-git-repo-seeder

## Goal

Create a configurable Node.js/TypeScript tool that seeds **realistic, multi-user pull-request activity** across existing Azure DevOps projects:

- marketing
- engineering
- hospitality

The tool must:

- create repos
- generate and push git history
- create PRs
- resolve real user identities by email
- add reviewers, comments, and votes using different users
- complete or abandon a percentage of PRs
- allow adding more users later without code changes

---

## Tech Stack

- **Node.js 18+ / TypeScript**
- **Git CLI**
- **Azure DevOps REST API**
- Azure DevOps CLI: **optional**, for validation/debug only (not required at runtime)

---

## Project Structure

```
ado-seeder/
  package.json
  tsconfig.json
  src/
    cli.ts                  # entry point
    config.ts               # config + env validation
    ado/
      client.ts             # REST wrapper (PAT-based)
      identities.ts         # email → identityId resolution + cache
      repos.ts              # repo CRUD
      prs.ts                # PR, reviewers, comments, votes, completion
    git/
      generator.ts          # local repo + commit/branch generation
    seed/
      runner.ts             # orchestration
      planner.ts            # deterministic plan (who does what)
      summary.ts            # output report
    util/
      rng.ts                # seeded RNG
      exec.ts               # shell execution (git)
  seed.config.json
```

---

## Configuration (single source of truth)

### `seed.config.json`

- org name
- list of projects and repo names
- users:

  - email
  - PAT environment variable name

- scale controls:

  - branches per repo
  - commits per branch
  - PRs per repo
  - reviewers per PR
  - comments per PR (min/max)
  - vote distribution
  - completion / abandon rates

- deterministic seed value

Adding users later = add entry + PAT env var. No code changes.

---

## Authentication & Identity Resolution

1. Read PATs from environment variables.
2. Validate all PATs at startup.
3. Resolve each user’s **Azure DevOps identity ID** using:

   ```
   GET https://vssps.dev.azure.com/{org}/_apis/identities
       ?searchFilter=General
       &filterValue={email}
   ```

4. Cache identity results locally (JSON file) to avoid repeat lookups.

---

## Git History Generation

For each repo:

1. Create a temp local repo.
2. Initialize `main`.
3. Generate N branches (`feature/*`, `bugfix/*`, etc.).
4. Generate commits per branch:

   - varied files (src/, docs/, tests/)
   - deterministic content

5. Push all branches to Azure DevOps repo.

Git actions use CLI (`git init`, `commit`, `push`).

---

## Repo Creation

For each project:

1. Check if repo exists.
2. Create repo if missing:

   ```
   POST /{project}/_apis/git/repositories
   ```

3. Store repo IDs for later PR operations.

---

## Pull Request Seeding

For each repo:

### PR Creation

- Select PR creator (user).
- Create PR from feature branch → main.
- Optionally mark as draft (or “WIP” title).
- Tag PR description with run ID.

### Reviewers

- Select reviewers (exclude creator).
- Add reviewers via REST.

### Comments

- Create 1–N comment threads per PR.
- Each thread created using a **different user’s PAT**.
- Use varied comment text templates.

### Votes

- Cast votes using reviewer’s PAT.
- Use configured probability distribution:

  - approve
  - approve with suggestions
  - reject
  - no vote

### Updates After Comments (optional but important)

- For a percentage of PRs:

  - push additional commits to source branch after comments exist

### Completion / Abandon

- Based on config:

  - complete PR (squash or merge)
  - abandon PR
  - leave open

---

## Execution Flow

1. Load config + validate env.
2. Resolve and cache identity IDs.
3. For each project:

   - ensure repos exist

4. For each repo:

   - generate and push git history
   - create PRs
   - add reviewers
   - add comments
   - cast votes
   - optionally push follow-up commits
   - complete / abandon / leave open

5. Write summary report.

---

## Determinism & Repeatability

- All random choices use a seeded RNG.
- Same config + seed ⇒ same distribution.
- PR descriptions include run ID for traceability.

---

## Output

Generate:

- JSON summary (counts per repo, per user)
- Optional Markdown summary
- Console output with PR URLs

---

## Definition of Done

- Each project has repos with branches and commits.
- PRs show:

  - multiple real users as creators, reviewers, commenters
  - varied vote states
  - completed, abandoned, and open PRs

- Data is visible and queryable by Azure DevOps extensions.
- Reruns are predictable and configurable.
