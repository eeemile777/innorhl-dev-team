# Workflow: Debug & Fix

**Trigger**: `/debug [issue description]` in Antigravity
**Lead**: Gemini (investigate + plan) → Claude (fix) → Gemini (verify)
**Goal**: Root cause identified, fix implemented, regression test added

---

## Step 1: Gather Information (Gemini)

Before hypothesizing, collect:

1. **Error message**: exact text, stack trace, error code
2. **Reproduction steps**: how to trigger the bug reliably
3. **When it started**: recent deployment? code change? new dependency?
4. **Environment**: production only? dev too? specific user/data?
5. **Frequency**: every time? intermittent? under specific conditions?

If available, check:
- Sentry (via MCP) for error details and frequency
- Logs for context around the error
- Git log: `git log --oneline -10` — what changed recently?
- Recent PRs or deployments

---

## Step 2: Form a Hypothesis (Gemini)

Based on the information:
1. **Identify the most likely root cause** — not symptoms, the underlying problem
2. **Identify the affected files** — where does the bug live?
3. **Identify the fix approach** — minimal change that solves the root cause
4. **Identify edge cases** — what else could break or needs a regression test?

Do NOT write a plan that just "tries things" — form a clear hypothesis first.

---

## Step 3: Write PLAN.md (Gemini)

```markdown
# Plan: Fix [bug description]

## Context
[Bug description, how to reproduce, when it started]

## Root Cause
[Your hypothesis of what's actually wrong and why]

## Architecture Decisions
- **Fix approach**: [minimal targeted fix vs. larger refactor] — chosen because [reason]
- **NOT changing**: [list what you're deliberately not touching to keep blast radius small]

## Tasks
- [ ] T1: [Specific fix] in [specific location] — files: `path/to/file`
- [ ] T2: Add regression test that verifies the bug is fixed — files: `path/to/file.test`
- [ ] T3: Check for same pattern elsewhere that could have the same bug — files: [grep target]

## Constraints
- Fix must be minimal — do not refactor surrounding code
- DO NOT change public API contracts
- Keep the fix in 1-2 files if possible

## Test Criteria
- [ ] The original bug is no longer reproducible via [specific steps]
- [ ] `npm test` passes with no regressions
- [ ] The new regression test specifically catches this bug class
```

---

## Step 4: Claude Fixes It

Claude:
1. Reads the bug context + root cause in PLAN.md
2. Implements the minimal fix
3. Writes the regression test first (TDD for bugs — write a failing test, then fix)
4. Verifies fix works
5. Checks for the same pattern in other files if T3 exists

---

## Step 5: Gemini Verifies

1. Review the fix — is it minimal? Does it address root cause?
2. Review the regression test — does it actually catch the bug class?
3. Check if the fix introduces any new risks
4. If all good → close the plan
5. If the fix reveals a deeper issue → escalate to a refactor workflow

---

## Debugging Heuristics

### "Works locally, fails in prod"
→ Check: env vars, secrets, external service URLs, database connection strings, CORS configs

### "Worked before, broken after deploy"
→ Check: git diff between last good deploy and current, dependency version changes, DB migration side effects

### "Intermittent / race condition"
→ Check: async operations without proper await, shared mutable state, missing mutex/locking

### "Works for some users, not others"
→ Check: user roles/permissions, data-specific edge cases, locale/timezone handling

### "Performance degraded"
→ Check: missing DB indexes, N+1 queries, memory leaks, infinite loops in useEffect/subscriptions

---

## Sentry Integration
If Sentry MCP is configured (`.mcp.json`):
```
Use mcp__sentry__get_issue_details to pull full error context
Use mcp__sentry__search_events to find frequency and affected users
```
