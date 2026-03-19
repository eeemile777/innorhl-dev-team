# Skill: Plan Writer

**Used by**: Gemini (Antigravity)
**Purpose**: Guidelines for writing high-quality PLAN.md files that Claude can execute without ambiguity

---

## Before You Write

Run through this investigation checklist:
- [ ] Read `CODEBASE_INDEX.md` — understand project structure
- [ ] Identify which files will be touched
- [ ] Check if similar features/patterns already exist in the codebase
- [ ] Clarify any ambiguous requirements with the user
- [ ] Decide on approach (don't leave this to Claude)

---

## Task Writing Formula

Every task must follow this pattern:

```
- [ ] **T[N]**: [Verb] [specific thing] in [specific function/class] — files: `path/to/file.ext`
```

### Good tasks:
```
- [ ] **T1**: Add `refreshAccessToken(refreshToken: string): Promise<AuthTokens>` method to `AuthService` — files: `src/auth/auth.service.ts`
- [ ] **T2**: Add `POST /auth/refresh` endpoint that calls `AuthService.refreshAccessToken()` — files: `src/auth/auth.controller.ts`
- [ ] **T3**: Write unit tests for `refreshAccessToken()` covering: valid token, expired token, invalid token — files: `src/auth/auth.service.spec.ts`
```

### Bad tasks (too vague — Claude will make wrong assumptions):
```
- [ ] T1: Fix the auth refresh
- [ ] T2: Update controller
- [ ] T3: Test it
```

---

## Task Ordering Rules

1. **Foundation first**: database schema changes before code that uses them
2. **Types before implementations**: TypeScript interfaces/types before code using them
3. **Services before controllers**: business logic before API layer
4. **Implementation before tests**: write code, then test it
5. **Cleanup last**: remove deprecated code only after new code works

---

## Plan Size Rules

- **Max 10 tasks per plan** — if more are needed, create phases
- **Phase naming**: `Phase 1 of 3`, `Phase 2 of 3`, etc.
- **Phase 1** always sets up the foundation (types, schemas, core services)
- **Phase 2** implements features on top of Phase 1
- **Phase 3** polishes (tests, docs, cleanup, performance)

---

## Required Sections Checklist

Before finalizing the plan, verify:

- [ ] **Context**: explains the WHY, not just the WHAT
- [ ] **Architecture Decisions**: at least one entry explaining key choices
- [ ] **Tasks**: all tasks have specific file paths
- [ ] **Constraints**: at least one entry (even if just "don't change public API")
- [ ] **Test Criteria**: at least one runnable command + one behavioral check
- [ ] **Blockers**: section exists but is empty (Claude will fill it)

---

## Architecture Decisions Section

Document the decisions Claude cannot make:
- Which library to use and why
- Data model structure
- API contract (request/response shape)
- Which existing patterns to follow vs. deviate from
- Performance trade-offs chosen

Example:
```markdown
## Architecture Decisions
- **Token storage**: Store refresh tokens in DB (not Redis) — we don't have Redis in prod yet.
  Use `refresh_tokens` table with `user_id`, `token_hash`, `expires_at`, `revoked_at`.
- **Token hashing**: bcrypt with 10 rounds — consistent with how we hash passwords.
- **Expiry**: Access token = 15min, refresh token = 30 days — standard practice.
```

---

## Constraints Section

Always specify what Claude must NOT change:
```markdown
## Constraints
- DO NOT modify the existing `login()` or `logout()` methods
- DO NOT change the `AuthTokens` interface (other services depend on it)
- DO NOT add new environment variables without adding them to `.env.example`
- Keep the existing test setup — don't change `jest.config.js`
```

---

## Test Criteria Section

Tests must be verifiable without ambiguity:
```markdown
## Test Criteria
- [ ] `npm test -- --testPathPattern=auth` passes with no failures
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] POST /auth/refresh with valid refresh token returns 200 + new access token
- [ ] POST /auth/refresh with expired token returns 401 with `TOKEN_EXPIRED` error code
- [ ] POST /auth/refresh with revoked token returns 401 with `TOKEN_REVOKED` error code
```

---

## Red Flags — Rewrite the Plan If:
- Any task says "update as needed" or "handle edge cases"
- Test criteria say "it should work correctly" (not verifiable)
- No files are specified for any task
- Architecture Decisions section is empty
- Constraints section is empty
- There are more than 10 tasks (split into phases)
