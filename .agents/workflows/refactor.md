# Workflow: Refactor

**Trigger**: `/refactor [area/description]` in Antigravity
**Lead**: Gemini (audit + phased plan) → Claude (execute phase by phase) → Gemini (review each phase)
**Goal**: Improve code structure without breaking functionality — tests must pass after every phase

---

## The Cardinal Rule
**Never break everything at once.** Refactors happen in small, reversible phases. Tests must pass at the end of every phase. If they don't, the phase is not complete.

---

## Step 1: Audit the Current Code (Gemini)

1. Read the area being refactored in `CODEBASE_INDEX.md` + `PROJECT_CONTEXT.md`
2. Read the actual files (targeted — not the whole codebase)
3. Identify:
   - What's wrong? (duplication, complexity, coupling, performance, security)
   - What's the ideal end state?
   - What's the blast radius? (what breaks if this changes?)
   - Are there tests? (if not, adding tests is Phase 1)
   - What external things depend on this? (APIs, other services, third parties)

---

## Step 2: Write a Phased Plan (Gemini)

Never write a single giant plan for a refactor. Break it into phases:

### Phase 1: Safety Net
If tests are missing or insufficient — add them first.
No tests = no refactor. You need to know if you break something.

```markdown
# Plan: Refactor [area] — Phase 1 of N: Safety Net

## Tasks
- [ ] T1: Write tests covering current behavior of [component] (even if the code is messy)
- [ ] T2: Verify all tests pass against current (unrefactored) code

## Test Criteria
- [ ] `npm test -- --testPathPattern=[area]` passes with coverage >80% of key paths
```

### Phase 2: Structural Change
The actual refactor. One logical change per phase.

```markdown
# Plan: Refactor [area] — Phase 2 of N: [Specific Change]

## Context
[What's changing and why]

## Architecture Decisions
- **Approach**: [strangler fig / extract + replace / rewrite in place] — why?
- **Backward compatibility**: [will public interfaces change?]

## Tasks
- [ ] T1: [Specific structural change] — files: `...`
- [ ] T2: Update all callers — files: `...`
- [ ] T3: Update tests to match new structure

## Constraints
- DO NOT change behavior — only structure
- Tests must pass after this phase

## Test Criteria
- [ ] Same tests from Phase 1 still pass (behavior unchanged)
- [ ] `npm run build` succeeds
```

### Phase 3+: Continue until done, then cleanup
```markdown
# Plan: Refactor [area] — Phase N: Cleanup

## Tasks
- [ ] T1: Remove deprecated code / old files
- [ ] T2: Update `CODEBASE_INDEX.md` to reflect new structure
- [ ] T3: Update README/docs if structure changed significantly
```

---

## Step 3: Claude Executes Phase by Phase

Claude NEVER starts Phase N+1 until:
- All Phase N tasks are checked off
- Tests pass
- Gemini has reviewed and approved Phase N

---

## Step 4: Gemini Reviews Each Phase

After each phase:
1. Verify all tasks are checked off
2. Verify test criteria are met
3. Review the structural change — is it going the right direction?
4. Only then: write PLAN.md for the next phase

---

## Refactor Patterns

### Extract Service / Extract Module
1. Phase 1: Add tests for existing behavior
2. Phase 2: Create new file with extracted logic (don't delete old yet)
3. Phase 3: Update callers to use new location
4. Phase 4: Delete old location, verify nothing breaks

### Replace Library
1. Phase 1: Add tests for current behavior
2. Phase 2: Install new library, create adapter layer
3. Phase 3: Migrate callers to adapter one by one
4. Phase 4: Remove adapter, point directly to new library
5. Phase 5: Remove old library

### Schema Migration (DB)
1. Phase 1: Add migration (keep old + new columns)
2. Phase 2: Update writes to populate both columns
3. Phase 3: Backfill old data into new column
4. Phase 4: Update reads to use new column
5. Phase 5: Remove old column

### Strangler Fig (Big Rewrites)
1. Keep the old system running
2. Build new system alongside it
3. Route 10% of traffic to new system
4. Gradually increase to 100%
5. Decommission old system

---

## Warning Signs (Stop and Reassess)

- Phase plan has more than 10 phases → probably too much at once
- Tests keep failing after a "structural only" phase → you changed behavior
- Every file in the codebase is in the blast radius → need a strangler fig approach
- The refactor keeps growing in scope → freeze scope, do a separate plan for the rest
