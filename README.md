# ADO Git Repo Seeder (v1.1.0)

<!-- BADGES:START -->
[![CI](https://github.com/oddessentials/ado-git-repo-seeder/actions/workflows/ci.yml/badge.svg)](https://github.com/oddessentials/ado-git-repo-seeder/actions/workflows/ci.yml) [![Coverage](https://img.shields.io/badge/coverage-81%25-brightgreen)](./coverage/index.html) [![Version](https://img.shields.io/badge/version-1.1.0-blue)](./package.json) [![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green)](./package.json)
<!-- BADGES:END -->

A professional, configurable Node.js tool to seed realistic, multi-user Pull Request activity in Azure DevOps.

---

## 🏗️ Documentation Hub

This documentation follows a **Normative vs. Descriptive** architecture. Technical logic is centralized in normative contracts.

### 📜 Normative Contracts (The Law)
- **[Configuration Reference](docs/configuration.md)**: Exhaustive schema documentation, hierarchical overrides, and the "Law of Idempotency."
- **[Multi-Run Accumulation](docs/accumulation-patterns.md)**: Normative rules for simulating development activity over multiple days/runs.

### 📘 Guidance & Security
- **[Multi-User Simulation & Security](docs/multi-user.md)**: Simulating real developers, identity resolution, and critical security "DO NOTs."

### 📂 Examples

| Example | Users | Strategy | Use Case |
|---------|-------|----------|----------|
| [single-user](examples/single-user/) | 1 | isolated | Quick demo, solo dev |
| [multi-user-team](examples/multi-user-team/) | 5 | isolated | Team simulation |
| [enterprise](examples/enterprise/) | 10 | isolated | Large-scale testing |
| [accumulation](examples/accumulation/) | 2 | direct | Multi-day activity |
| [isolated-greenfield](examples/isolated-greenfield/) | 1 | isolated | Fresh repos per run |

### 🔬 Architecture
- **[Architecture Diagrams](docs/internal/MERMAID.md)**: Visual Mermaid diagrams of execution flows, module dependencies, and security patterns.

---

## ⚡ Quick Start (3 Min)

### 1. Install & Build
```bash
npm install && npm run build
```

> [!CAUTION]
> **Your ADO project must already exist.** The seeder creates repos within existing projects, not projects themselves. See [Prerequisites](docs/configuration.md#prerequisites-normative).

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
