# Plan: [Task Name]

**Status**: `[ ] In Progress` | `[ ] Blocked` | `[ ] Done`
**Date**: YYYY-MM-DD
**Requested by**: [user / Gemini]
**Assigned to**: Claude Code
**Phase**: 1 of N

---

## Context
_Why this is being done. What problem is being solved. What the user asked for._

---

## Architecture Decisions
_Key design decisions made by Gemini. Claude must not deviate from these without writing a Blocker first._

- **Decision 1**: [what and why]
- **Decision 2**: [what and why]

---

## Tasks
- [ ] **T1**: [Specific action] — files: `path/to/file.ts`, `path/to/other.ts`
- [ ] **T2**: [Specific action] — files: `path/to/file.ts`
- [ ] **T3**: Write/update tests for T1 and T2 — files: `path/to/file.test.ts`

---

## Constraints
_Things Claude must NOT touch or change._

- DO NOT modify: `[file or area]`
- DO NOT change: `[pattern or behavior]`
- Keep backward compatible: `[interface or API]`

---

## Blockers
_Claude writes here when stuck. Gemini reads and resolves._

<!-- Format: - [YYYY-MM-DD] T# blocked: [description of problem and what decision is needed] -->

---

## Test Criteria
_Verifiable conditions that confirm the plan is complete._

- [ ] `npm test` passes with no failures
- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] [Specific behavior]: [how to verify it]
- [ ] No regressions in [related area]
