# ADO Git Repo Seeder - Architecture Diagrams

Visual documentation of the seeder's architecture and execution flow.

---

## High-Level Execution Flow

```mermaid
flowchart TD
    A[CLI Entry] --> B[Load Config]
    B --> C[Create Plan]
    C --> D{Dry Run?}
    D -->|Yes| E[Output Plan JSON]
    D -->|No| F{Cleanup Mode Enabled?}
    
    F -->|Yes| G[Count Open PRs]
    G --> H{Count > Threshold?}
    H -->|Yes| I[Run Cleanup Mode]
    H -->|No| J[Normal Seeding]
    
    F -->|No| J
    
    I --> K[Write Summary]
    J --> K
    K --> L[Exit]
```

---

## Cleanup Mode Logic

```mermaid
flowchart TD
    A[Cleanup Mode Triggered] --> B[List All Open PRs]
    B --> C[Sort by Creation Date]
    C --> D[For Each Oldest PR]
    
    D --> E{Is Draft?}
    E -->|Yes| F[Publish Draft]
    F --> G[Continue to Next PR]
    
    E -->|No| H[Get PR Details]
    H --> I[Complete PR]
    I --> J{Target Count Reached?}
    
    J -->|No| D
    J -->|Yes| K[Return Stats]
    G --> J
```

---

## Normal Seeding Flow

```mermaid
flowchart TD
    A[Start Seeding] --> B[Preflight Policy Check]
    B --> C[Resolve User Identities]
    C --> D[For Each Planned Repo]
    
    D --> E[Ensure Repo Exists]
    E --> F[Generate Git Content]
    F --> G[Check Branch Collisions]
    G --> H{Collision?}
    
    H -->|Yes| I[FATAL Error]
    H -->|No| J[Push Branches]
    
    J --> K[For Each Planned PR]
    K --> L[Create PR]
    L --> M[Add Reviewers & Votes]
    M --> N[Add Comments]
    N --> O{Outcome?}
    
    O -->|complete| P[Complete PR]
    O -->|abandon| Q[Abandon PR]
    O -->|leaveOpen| R[Leave Open]
    
    P --> S[Next Repo]
    Q --> S
    R --> S
    S --> D
```

---

## Configuration Hierarchy

```mermaid
flowchart TD
    A[Global Config] --> B[Project Level]
    B --> C[Repo Level]
    
    subgraph "Resolved Properties"
        D[repoNaming]
        E[repoStrategy]
        F[scale]
    end
    
    C --> D
    C --> E
    C --> F
    
    style A fill:#e1f5fe
    style B fill:#b3e5fc
    style C fill:#81d4fa
```

---

## Module Dependencies

```mermaid
graph TD
    CLI[cli.ts] --> Config[config.ts]
    CLI --> Planner[planner.ts]
    CLI --> Runner[runner.ts]
    
    Runner --> PrManager[prs.ts]
    Runner --> RepoManager[repos.ts]
    Runner --> IdentityResolver[identities.ts]
    Runner --> GitGenerator[generator.ts]
    
    GitGenerator --> Deriver[deriver.ts]
    GitGenerator --> Exec[exec.ts]
    
    Planner --> RNG[rng.ts]
    
    subgraph "ADO API Layer"
        PrManager
        RepoManager
        IdentityResolver
    end
    
    subgraph "Git Layer"
        GitGenerator
        Deriver
        Exec
    end
    
    subgraph "Core"
        Config
        Planner
        Runner
    end
```

---

## PR Outcome Distribution

```mermaid
pie title PR Outcomes per Run
    "Complete" : 75
    "Leave Open" : 20
    "Abandon" : 5
```

---

## Multi-User Attribution

```mermaid
sequenceDiagram
    participant CLI
    participant Runner
    participant ADO
    
    Note over CLI: Load PATs from env vars
    CLI->>Runner: resolvedUsers with PATs
    
    Runner->>ADO: Resolve identities (email → identityId)
    
    loop For Each PR
        Runner->>ADO: Create PR (Creator's PAT)
        Runner->>ADO: Add Reviewer (Primary PAT)
        Runner->>ADO: Cast Vote (Reviewer's PAT)
        Runner->>ADO: Add Comment (Commenter's PAT)
    end
```

---

## GitHub Actions Workflow

```mermaid
flowchart LR
    A[Schedule Trigger] --> B[Checkout]
    B --> C[Setup Node.js]
    C --> D[npm ci]
    D --> E[npm run build]
    E --> F[Run Seeder]
    F --> G[Upload Summary Artifact]
    
    subgraph "Runs Twice Daily"
        A
    end
    
    subgraph "10:00 & 18:00 UTC"
        A
    end
```
