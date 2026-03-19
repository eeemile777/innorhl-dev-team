# Universal Rules — Both Agents Must Follow

These rules apply to both Gemini (planning) and Claude Code (execution). They are non-negotiable.

---

## Code Quality

### TypeScript / JavaScript
- Strict mode enabled — no `any`, no implicit types
- Prefer `const` over `let`, never use `var`
- Async/await over raw Promises (no `.then()` chains)
- Explicit return types on all exported functions
- Destructure objects/arrays where it improves clarity

### Python
- Type hints on all function signatures
- Use dataclasses or Pydantic models for structured data
- No bare `except:` — always catch specific exceptions
- `black` formatting, `ruff` linting

### General
- Functions do one thing — if it needs a comment to explain what it does, it should be split
- No commented-out code in commits
- No magic numbers — use named constants
- Max 400 lines per file — split if larger

---

## Security (Non-Negotiable)

- **No hardcoded secrets** — credentials, API keys, tokens go in env vars only
- **Validate all external inputs** — user input, webhook payloads, API responses
- **Parameterized queries only** — no string interpolation in SQL
- **No `eval()` or dynamic code execution** with user-controlled input
- **Sanitize before rendering** — no raw HTML injection from external sources
- **HTTPS only** for external API calls in production
- **Principle of least privilege** — request only permissions actually needed

---

## Git Conventions

### Commit format (Conventional Commits)
```
feat: add OAuth2 refresh token support
fix: resolve race condition in queue processor
refactor: extract auth logic into dedicated service
test: add integration tests for payment flow
chore: update dependencies to latest patch versions
docs: update API reference for new endpoints
```

### Branch naming
```
feat/oauth-refresh-tokens
fix/queue-race-condition
refactor/auth-service-extraction
```

### Rules
- Feature branches only — never commit directly to `main` or `master`
- One logical change per commit
- PRs must have passing tests before merge
- Squash merge to keep main history clean

---

## Testing Standards

- Unit tests for all business logic
- Integration tests for API endpoints and DB operations
- Tests live next to the code they test (`*.test.ts` or `*_test.py`)
- Test names describe behavior: `should return 401 when token is expired`
- No skipped tests without a dated TODO comment explaining why
- Minimum: cover the happy path + the most likely failure modes

---

## Documentation Standards

- `CODEBASE_INDEX.md` is the source of truth for project structure
- Update `CODEBASE_INDEX.md` when adding new modules or changing architecture
- Inline comments only for non-obvious logic (not for obvious code)
- Keep `README.md` updated with: how to run, env vars needed, architecture overview

---

## Communication Standards

- Blockers go in `PLAN.md → ## Blockers` with date and specific problem
- Architecture decisions go in `PLAN.md → ## Architecture Decisions` with reasoning
- Never make architectural changes without documenting them
