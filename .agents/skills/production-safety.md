# Skill: Production Safety

**Used by**: Gemini (Antigravity) — during planning
**Used by**: Claude (Code) — during execution
**When**: Any time work touches a live, running application with real users or real data.

---

## The Rule

**Production is not a testing environment. Every plan that touches prod must answer: what happens if this goes wrong?**

If you can't answer that question before writing the plan, you're not ready to write the plan.

---

## For Gemini — Before Writing a Production Plan

Before putting a single task in PLAN.md for a production change, answer these:

### 1. What's the blast radius?
Use GitNexus `impact()` to find everything that could break:
```
impact("[thing being changed]")
```
If the blast radius is large → phase the plan. Don't change everything at once.

### 2. Is this a breaking change?
- Does it change a database schema? → Migration required. See DB rules below.
- Does it change an API contract? → Check all callers first.
- Does it change auth logic? → Highest risk. Test coverage must exist before touching.
- Does it change payment logic? → Requires staging test + user approval before prod deploy.

### 3. Is there a staging environment?
- If yes → plan must include a staging deploy + verification step before prod.
- If no → flag this to the user. Deploying untested changes directly to prod is high risk.

### 4. Is there a rollback plan?
Every production PLAN.md **must** include a `## Rollback` section:
```markdown
## Rollback
If something goes wrong after deploying:
1. [Specific command or step to revert]
2. [How to verify the rollback worked]
3. [Who to notify]
```

### 5. Should this use a feature flag?
For large or risky changes, suggest a feature flag so the change can be toggled off instantly without a redeploy. Ask the user if they have feature flag infrastructure.

---

## For Claude — During Execution

### Never do these in production without explicit user approval:
- Run database migrations (`prisma migrate deploy`, `ALTER TABLE`, etc.)
- Delete data or columns
- Change authentication flow
- Modify payment processing logic
- Modify webhook handlers
- Run `git push --force` on the main branch

### Always do these for production changes:
- Run the full test suite before marking any task done
- Verify environment variables are set (check `.env.example` vs actual env)
- Write the rollback steps before touching anything
- If tests don't exist for the area you're changing → write them first (TDD)

### Database migration rules:
1. Always write a migration file — never `ALTER TABLE` manually
2. Test the migration rollback (`prisma migrate reset` or equivalent)
3. Never run migrations in prod without user confirming: "I've backed up the database"
4. Add the migration step as a separate, last PLAN.md task with a note: "Requires manual approval before running in prod"

---

## The Staging Deploy Pattern (put this in PLAN.md)

For any production change, the task list should end like this:

```markdown
- [ ] **T(N-2)**: Deploy to staging — verify [specific behavior] works
- [ ] **T(N-1)**: Run smoke tests on staging — [list what to test]
- [ ] **TN**: Deploy to production — USER APPROVAL REQUIRED before this step
```

Claude marks T(N-2) and T(N-1) done automatically.
T(N) — the prod deploy — requires the user to say "go ahead" explicitly.

---

## Risk Levels

| Change type | Risk | Required before prod |
|-------------|------|---------------------|
| New feature (no DB change) | Low | Tests pass, staging ok |
| Bug fix in non-critical path | Low | Tests pass |
| Bug fix in auth/payments | High | Tests + staging + user approval |
| DB schema change | High | Migration tested, backup confirmed |
| API contract change | Medium | All callers verified, staged first |
| Auth system change | Critical | Full test suite + staging + manual test + user approval |
| Payment logic change | Critical | Test mode verified + staging + user approval |

---

## What to Say to the User

If a plan touches production and is high/critical risk, Gemini should say:

> "This change touches [area] which is in the critical path. Before I write the plan, I want to flag a few things: [risks]. I'll include a staging deploy step and a rollback plan. You'll need to give me the green light before anything hits production. Sound good?"

Don't bury the risk in the plan. Surface it in conversation first.
