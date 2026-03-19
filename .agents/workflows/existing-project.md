# Workflow: Existing Project Onboarding

**Trigger**: `/onboard` in Antigravity
**Lead**: Claude Code (onboarding) → Gemini (analysis)
**Goal**: Both agents have a shared, accurate map of an existing codebase before any work begins

---

## When to Use This
- First time working on an existing repo
- Returning to a project after a long break
- Taking over someone else's codebase
- After a major refactor that changed the structure

---

## Step 1: Claude Generates the Map

Tell Claude Code: "Run the codebase-onboard skill"
→ Claude follows `.agents/skills/codebase-onboard.md`
→ Output: `CODEBASE_INDEX.md` in project root

This takes 5-15 minutes depending on codebase size.

---

## Step 2: Gemini Reads and Analyzes

After `CODEBASE_INDEX.md` exists, Gemini:

1. Reads `CODEBASE_INDEX.md` fully
2. Reads 3-5 key files identified in the index (entry points, main models, main routes)
3. Reads any existing `README.md`, `ARCHITECTURE.md`, or `docs/`
4. Checks git log for recent activity: `git log --oneline -20`
5. Looks for obvious tech debt or problem areas

---

## Step 3: Gemini Writes PROJECT_CONTEXT.md

```markdown
# Project Context
_Written: [date] | Author: Gemini_

## What This Project Does
[2-3 sentence description of the product/system]

## Architecture Summary
[How the system is structured. Data flow. Main components and how they connect.]

## Technology Choices
[Why the stack was chosen — if knowable from code/docs]

## Current State
- **Maturity**: [prototype / early-stage / production / legacy]
- **Test coverage**: [none / partial / good]
- **Documentation**: [none / partial / good]
- **Last active development**: [timeframe]

## Hotspots (Handle With Care)
[Files/areas that are complex, fragile, or critical — be careful here]

## Tech Debt
[Known issues, shortcuts taken, areas that need refactoring]

## How Features Are Added
[Pattern for adding a new feature — where to put what, what to touch]

## Unknowns
[Things unclear from the code alone that need to be clarified with the original team/user]

## Recommended First Steps
[What should be done first? Clean up? Missing tests? Outdated deps? Feature work?]
```

---

## Step 4: Alignment Check

Before writing any PLAN.md, Gemini asks the user:

1. Does the `PROJECT_CONTEXT.md` understanding match reality?
2. What are the most important things to work on first?
3. Are there any constraints I'm missing? (deploy freeze, API contracts, etc.)
4. What's the current pain point that needs addressing?

---

## After Onboarding

Both agents now have:
- `CODEBASE_INDEX.md` — the structural map (Claude's navigation tool)
- `PROJECT_CONTEXT.md` — the architectural understanding (Gemini's planning tool)

Any task workflow (`/feature`, `/debug`, `/refactor`) can now run efficiently without re-scanning the codebase.

---

## Keeping the Index Fresh

Update `CODEBASE_INDEX.md` when:
- New modules or major directories are added
- The database schema changes significantly
- The deployment setup changes
- New required environment variables are added

The documenter sub-agent (`.claude/agents/documenter.md`) can handle incremental updates.
