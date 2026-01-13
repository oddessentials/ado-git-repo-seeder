# ADO Git Repo Seeder

Configurable tool to seed realistic, multi-user pull-request activity on Azure DevOps (v1.1.0).

## 1. Prerequisites
- **Node.js**: Ensure you have Node.js 18 or 20 installed.
- **Azure DevOps PAT**: You need a Personal Access Token with `Code (Read, Write, & Manage)` and `Pull Request Threads (Read & Write)` scopes.
- **Git**: Git must be installed and available in your system's PATH.

## 2. Setup
Install dependencies and build the project:
```bash
npm install
npm run build
```

## 3. Configuration
Create a `seed.config.json` in the root directory. Use `repoNaming: direct` for authentic accumulation on existing repos:

```json
{
  "org": "your-org-name",
  "projects": [
    {
      "name": "YourProjectName",
      "repos": ["YourRepoName"],
      "repoNaming": "direct"
    }
  ],
  "users": [
    { "email": "dev-user@example.com", "patEnvVar": "ADO_PAT" }
  ],
  "seed": 42,
  "repoNaming": "direct"
}
```

## 4. Environment Variables
Set the environment variable for your PAT (matching the `patEnvVar` in your config):

**Windows (PowerShell):**
```powershell
$env:ADO_PAT = "your-personal-access-token"
```

**Linux/macOS:**
```bash
export ADO_PAT="your-personal-access-token"
```

## 5. Running the Seeder

### Initial Run (Day 1)
Run the seeder with a unique `run-id`.
```bash
npm start -- --run-id day-1
```

### Accumulation Run (Day 2)
To add more activity to the same repos without deleting Day 1, simply increment the `run-id`:
```bash
npm start -- --run-id day-2
```

### Preview Mode (Dry Run)
Preview the seeding plan without making any changes in ADO:
```bash
npm start -- --dry-run
```

## 6. Results
- **Console Summary**: A Markdown summary is printed to the terminal.
- **Summary Files**: Detailed reports are saved as `summary-{runId}.json` and `summary-{runId}.md`.
- **Safety**: If you try to run the same `runId` twice against the same repository, the tool will trigger a **Fatal Collision Guard** to prevent corruption.

---

> [!TIP]
> **Versioning**: This version (v1.1.0) includes hardened `GIT_ASKPASS` authentication and strict runId semantics.
