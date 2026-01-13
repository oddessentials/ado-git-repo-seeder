# ADO Git Repo Seeder (v1.1.0)

A professional, configurable Node.js tool to seed realistic, multi-user Pull Request activity in Azure DevOps.

---

## 🏗️ Documentation Hub

This documentation follows a **Normative vs. Descriptive** architecture. Technical logic is centralized in normative contracts.

### 📜 Normative Contracts (The Law)
- **[Configuration Reference](docs/configuration.md)**: Exhaustive schema documentation, hierarchical overrides, and the "Law of Idempotency."
- **[Multi-Run Accumulation](docs/accumulation-patterns.md)**: Normative rules for simulating development activity over multiple days/runs.

### 📘 Guidance & Security
- **[Multi-User Simulation & Security](docs/multi-user.md)**: Simulating real developers, identity resolution, and critical security "DO NOTs."
- **[Examples](examples/)**: Golden configuration templates for different scenarios.

---

## ⚡ Quick Start (3 Min)

### 1. Install & Build
```bash
npm install && npm run build
```

### 2. Configure
Create a `seed.config.json` (see [Configuration Reference](docs/configuration.md)):
```json
{
  "org": "your-org",
  "projects": [{ "name": "App", "repos": ["ServiceA"] }],
  "users": [{ "email": "dev@corp.com", "patEnvVar": "ADO_PAT" }],
  "seed": 12345
}
```

### 3. Run
Set your PAT in the environment and start the seeder:
```bash
# Windows
$env:ADO_PAT = "your-token"
npm start -- --run-id day-1
```

---

## 🛡️ Key Features

- **Multi-User Simulation**: Rotate between multiple PATs for creators, reviewers, and commenters.
- **Deterministic Drift**: Seeded PRNG ensures diverse but repeatable content generation.
- **Hardened Security**: Ephemeral `GIT_ASKPASS` authentication ensures tokens never touch `.git/config`.
- **Collision Guard**: Built-in `ls-remote` checks prevent data corruption from runId reuse.
- **Best-Effort Preflight**: Scans for branch policies before execution to warn of potential merge blocks.

---

> [!NOTE]
> This tool is part of the **OddEssentials Platform**. For issues or contributions, please refer to the internal repository governance.
