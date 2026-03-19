# Workflow: Add a Feature

**Trigger**: `/feature [description]` in Antigravity
**Lead**: Gemini (plan) → Claude (execute) → Gemini (review)
**Goal**: Ship a new feature with tests and no regressions

---

## Step 1: Gemini Investigates (Don't Plan Blind)

Before writing a single task:

1. **Read the relevant section of `CODEBASE_INDEX.md`** — what area does this feature touch?
2. **Find similar features** — is there an existing pattern to follow? (grep for similar functionality)
3. **Check for existing utilities** — don't reinvent what already exists
4. **Identify the impact radius** — what other parts of the system will this affect?
5. **Research if needed** — web search for library recommendations, best practices, known pitfalls
6. **Clarify with user** if requirements are ambiguous — ask once, ask all questions together

---

## Step 2: Gemini Writes PLAN.md

Use the plan-writer skill (`.agents/skills/plan-writer.md`) for quality.

Key decisions to document in `## Architecture Decisions`:
- Where does new code live? (new file vs. extend existing)
- Does this require a new DB migration / schema change?
- Does this add new environment variables?
- Does this change any existing API contracts?
- Which existing patterns does this follow?

---

## Step 3: Claude Executes

Claude Code reads PLAN.md and works through tasks:
- Checks off each task as completed
- Runs tests after each logic-touching task
- Writes to `## Blockers` if stuck (does NOT spin or guess)
- Moves on to next task if blocked (doesn't stop completely)

---

## Step 4: Gemini Reviews

After Claude reports completion:

1. Read the updated `PLAN.md` (all tasks checked? any blockers?)
2. Review the key changed files (not every line — just the key ones)
3. Run `npm test` or equivalent mentally — does the test criteria pass?
4. If issues found → write follow-up tasks in a new PLAN.md Phase
5. If everything looks good → mark plan as Done, notify user

---

## Feature Checklist (Gemini's Review)

Before closing the plan:
- [ ] All PLAN.md tasks are checked off
- [ ] No blockers remain open
- [ ] Test criteria in PLAN.md are all met
- [ ] New code follows existing patterns in the codebase
- [ ] No hardcoded secrets or credentials added
- [ ] `.env.example` updated if new env vars added
- [ ] `CODEBASE_INDEX.md` updated if new modules added (ask Claude to run documenter)

---

## Common Feature Patterns

### Adding a new API endpoint
1. Schema/validation type → 2. Service method → 3. Controller → 4. Route registration → 5. Tests

### Adding a new database table
1. Migration file → 2. Model/entity → 3. Repository/service → 4. API layer → 5. Tests

### Adding a new UI component
1. Component → 2. Types/props → 3. Styles → 4. Integration into parent → 5. Tests

### Adding a new AI agent/tool
1. Tool definition → 2. Tool implementation → 3. Register in agent → 4. Prompt updates → 5. Tests
