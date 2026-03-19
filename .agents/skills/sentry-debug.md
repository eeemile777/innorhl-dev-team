# Skill: Sentry + GitNexus — Production Debug Playbook

**Used by**: Gemini (Antigravity)
**When**: Debugging a production error or unexpected behavior in a live app.
**Tools**: Sentry MCP + GitNexus MCP — use both together. Never one without the other.

---

## Why Both Tools Together

**Sentry alone** tells you WHAT broke and WHEN — the error message, the stack trace, the user impact. But it can't tell you WHY the code is structured the way it is or what else will break if you change the fix.

**GitNexus alone** tells you HOW the code connects — blast radius, call chains, dependencies. But it can't tell you which specific error is happening in production right now.

**Together**: Sentry finds the exact broken line → GitNexus maps the full blast radius → you have everything needed to write a safe, targeted fix.

---

## The 5-Step Debug Process

### Step 1: Find the Error in Sentry

```
search_issues("error message or component name")
get_issue_details("ISSUE-ID")
search_issue_events("ISSUE-ID")
```

Extract from Sentry:
- **Exact error message** — word for word
- **Stack trace** — which file, which line, which function
- **Frequency** — how many times? First seen when? Getting worse?
- **Affected users** — how many? Specific user segments?
- **Environment** — production only? All environments?
- **Recent spike?** — did it start after a recent deploy?

### Step 2: Map the Stack Trace to Code with GitNexus

Take the function names from Sentry's stack trace and run:
```
context("FunctionNameFromStackTrace")
```

This gives you:
- Full function implementation
- All callers (who calls this function)
- All dependencies (what this function calls)
- Recent changes (if git history is indexed)

Run `impact()` on the function that's throwing:
```
impact("BrokenFunctionName")
```

This tells you: if we change this function to fix the bug, what else could break?

### Step 3: Form a Hypothesis

With both Sentry + GitNexus data, answer:

1. **Root cause**: Why is this error happening? (not "what is the error" — WHY)
2. **Trigger**: What user action or data condition causes it?
3. **Scope**: Is this isolated or systemic?
4. **Blast radius**: If we fix it, what else might we affect?

Write the hypothesis explicitly before writing any plan:
> "The error happens because [root cause]. It's triggered when [condition]. Fixing it requires changing [function/file]. The blast radius is [list from GitNexus impact()]. Risk level: [low/medium/high]."

### Step 4: Check for a Regression Pattern

Before writing a fix, check:
```
detect_changes("HEAD~5..HEAD")
```

Did a recent commit introduce this? If yes — the fix might be a revert, not a new change.

Also check Sentry for when the error first appeared:
- If it matches a deploy timestamp → likely a regression from that deploy
- If it's been there forever → likely an edge case that wasn't tested

### Step 5: Write the Fix Plan

Apply production safety rules (see `.agents/skills/production-safety.md`):

```markdown
# Plan: Fix [Error Name]

## Context
Production error: [error message]
Sentry issue: [ISSUE-ID]
Affected users: [count]
Root cause: [your hypothesis]

## Architecture Decisions
- Fix is isolated to [file/function] — verified via GitNexus impact()
- Blast radius: [list of affected things]
- Risk level: [low/medium/high]

## Tasks
- [ ] T1: Write failing test that reproduces the error
- [ ] T2: Implement fix in [specific file]
- [ ] T3: Verify test passes, full suite passes
- [ ] T4: Deploy to staging, verify error doesn't appear
- [ ] T5: Deploy to production — USER APPROVAL REQUIRED

## Rollback
If T5 causes new issues: [specific rollback steps]

## Test Criteria
- [ ] Sentry error rate drops to 0 after deploy
- [ ] No new errors introduced (monitor Sentry for 30min after deploy)
```

---

## Common Sentry Error Patterns and What to Do

| Error pattern | What it usually means | First thing to check |
|--------------|----------------------|---------------------|
| `TypeError: Cannot read properties of undefined` | Something returned null/undefined unexpectedly | Check upstream data — DB query, API call, or missing env var |
| `401 Unauthorized` | Auth token expired or missing | Check token refresh logic and middleware |
| `500 Internal Server Error` on specific route | Unhandled exception in handler | Read the full stack trace — bottom frame is the real cause |
| Database timeout / connection error | Too many connections or slow query | Check connection pool settings, look for N+1 queries |
| Memory out of bounds / heap | Memory leak | Look for event listeners or intervals not being cleaned up |
| CORS error | Frontend/backend URL mismatch | Check env vars for API URLs |

---

## Useful Sentry MCP Queries

```
# Find all open errors
search_issues(query="is:unresolved", limit=20)

# Find errors in a specific file
search_issues(query="TypeError stack.trace:PaymentService")

# Find errors affecting many users
search_issues(query="times_seen:>100 is:unresolved")

# Get full details on one issue
get_issue_details(issue_id="PROJECT-123")

# See recent events for an issue
search_issue_events(issue_id="PROJECT-123", limit=5)

# Use Seer AI to analyze an issue
analyze_issue_with_seer(issue_id="PROJECT-123")
```

---

## After the Fix

Once deployed, verify in Sentry:
1. Check that the error count drops to 0
2. Mark the Sentry issue as `resolved`
3. Set up a Sentry alert if one doesn't exist for this error type
4. Write the fix summary in `JOURNAL.md` — including what the root cause was in plain English
