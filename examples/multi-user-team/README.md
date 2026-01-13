# Multi-User Team Example

5-person team simulation with realistic PR activity across multiple projects.

## When to Use

- Simulating realistic team collaboration
- Testing reviewer/commenter rotation
- Demonstrating PR workflows to stakeholders

## Setup

1. Set PATs for each user:
   ```bash
   # Windows
   $env:ADO_PAT_ALICE = "alice-token"
   $env:ADO_PAT_BOB = "bob-token"
   $env:ADO_PAT_CAROL = "carol-token"
   $env:ADO_PAT_DAVE = "dave-token"
   $env:ADO_PAT_EVE = "eve-token"
   ```

2. Run:
   ```bash
   npm start -- --config examples/multi-user-team/seed.config.json --run-id sprint-1
   ```

## Multi-User Dynamics

- PR creators are randomly selected from all 5 users
- Reviewers are selected from users *excluding* the creator (1-2 per PR)
- Commenters can be any user (2-5 per PR)

For PAT setup and identity resolution, see **[Configuration Reference](../../docs/configuration.md)**.
