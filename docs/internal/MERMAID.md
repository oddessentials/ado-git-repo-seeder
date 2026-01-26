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

## Module Dependencies

```mermaid
graph TD
    CLI[cli.ts] --> Config[config.ts]
    CLI --> Planner[planner.ts]
    CLI --> Runner[runner.ts]
    CLI --> Summary[summary.ts]
    
    Runner --> PrManager[prs.ts]
    Runner --> RepoManager[repos.ts]
    Runner --> IdentityResolver[identities.ts]
    Runner --> GitGenerator[generator.ts]
    Runner --> Summary
    
    GitGenerator --> Deriver[deriver.ts]
    GitGenerator --> Exec[exec.ts]
    
    Planner --> RNG[rng.ts]
    
    PrManager --> Client[client.ts]
    RepoManager --> Client
    IdentityResolver --> Client
    
    subgraph "ADO API Layer"
        Client
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
        Summary
    end
    
    subgraph "Utilities"
        RNG
    end
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
    
    O -->|complete| P[Complete PR w/ Conflict Resolution]
    O -->|abandon| Q[Abandon PR]
    O -->|leaveOpen| R[Leave Open]
    
    P --> S[Next Repo]
    Q --> S
    R --> S
    S --> D
```

---

## Conflict Resolution Flow

```mermaid
flowchart TD
    A[Complete PR Request] --> B{Merge Status?}
    B -->|conflicts| C[Fetch Target Branch]
    C --> D[Merge with -X ours Strategy]
    D --> E[Push Resolved Branch]
    E --> F[Verify Push via ls-remote]
    F --> G{Push Verified?}
    G -->|Yes| H[Wait for ADO Merge Status Update]
    G -->|No| I[Retry or Fail]
    H --> J{Merge Status = succeeded?}
    J -->|Yes| K[Complete PR]
    J -->|No| L[Wait & Retry]
    L --> J
    K --> M[Wait for Completion]
    M --> N[Return Success]
    
    B -->|succeeded| K
    B -->|queued/notSet| O[Wait for Evaluation]
    O --> B
```

---

## ASKPASS Authentication Pattern

```mermaid
sequenceDiagram
    participant Runner
    participant TempFS as Temp Filesystem
    participant Git
    participant ADO
    
    Note over Runner: Create ephemeral ASKPASS script
    Runner->>TempFS: Write script with PAT
    Runner->>TempFS: chmod +x script
    
    Runner->>Git: Execute with GIT_ASKPASS env
    Git->>TempFS: Request credentials
    TempFS->>Git: Return PAT
    Git->>ADO: Authenticated operation
    ADO->>Git: Response
    Git->>Runner: Operation result
    
    Runner->>TempFS: Delete script
    
    Note over Runner: PAT never touches .git/config
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
    H --> I[Complete PR w/ Conflict Resolution]
    I --> J{Target Count Reached?}
    
    J -->|No| D
    J -->|Yes| K[Return Stats]
    G --> J
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

## Summary Output Generation

```mermaid
flowchart LR
    A[Run Complete] --> B[Collect Results]
    
    B --> C[RepoResult per Repo]
    C --> D[PrResult per PR]
    
    D --> E{Cleanup Mode?}
    E -->|Yes| F[Cleanup Stats]
    E -->|No| G[Normal Stats]
    
    F --> H[Generate Markdown]
    G --> H
    
    H --> I[Write JSON Summary]
    H --> J[Print to Console]
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

---

## PR Outcome Distribution

```mermaid
pie title PR Outcomes per Run
    "Complete" : 75
    "Leave Open" : 20
    "Abandon" : 5
```
