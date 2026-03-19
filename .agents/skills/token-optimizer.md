# Skill: Token Optimization

**Used by**: Both Gemini and Claude Code
**Goal**: Minimize token consumption without sacrificing understanding or quality

---

## The Golden Rule
Load only what you need, when you need it. The project has a map — use it.

---

## For Both Agents

### Rule 1: Load the Map First
Before exploring any file, read `CODEBASE_INDEX.md`. It tells you:
- Where files live
- What each module does
- Key dependencies and entry points

This saves reading 10+ files just to understand the structure.

### Rule 2: Search Before Reading
Use grep/search tools to find exactly what you need before opening a file:
```bash
# Find where a function is defined
grep -rn "functionName" src/

# Find all files that import a module
grep -rn "import.*AuthService" src/

# Find all API routes
grep -rn "@Get\|@Post\|@Put\|@Delete" src/controllers/
```

### Rule 3: Read Sections, Not Full Files
For large files, read the relevant section only:
- Use `Read` with `offset` and `limit` parameters
- Read the top 50 lines first (imports, class definition, constructor) to orient yourself
- Then read only the specific function or section you need

### Rule 4: Don't Re-Read
If you've already read a file in this session, remember its contents. Don't read it again.
- Keep a mental note of what you've loaded
- Reference your earlier read instead of re-loading

---

## For Gemini (Planning Phase)

### Strategy: Top-Down Investigation
1. Read `CODEBASE_INDEX.md` → understand structure (0 file reads)
2. Read 2-3 key files identified in the index (targeted reads)
3. Grep for patterns relevant to the task (search, not full reads)
4. Write the plan — you likely have enough context

### Avoid
- Reading entire directories file by file
- Loading test files when planning features
- Reading config files unless config is part of the task
- Loading `node_modules` or any dependency source

### For Very Large Codebases
Use GitNexus or equivalent to generate a dependency graph:
1. Export graph as JSON or adjacency list
2. Load the subgraph relevant to your task only
3. Append as `## Dependency Graph` to `CODEBASE_INDEX.md`

---

## For Claude Code (Execution Phase)

### Strategy: Task-Scoped Context
Load only files mentioned in `PLAN.md → ## Tasks`:
```
- [ ] T1: Add `refreshToken()` to `src/auth/auth.service.ts`
- [ ] T2: Update `src/auth/auth.controller.ts` to use it
- [ ] T3: Add test in `src/auth/auth.service.test.ts`
```
→ Load exactly those 3 files. Not the whole `auth/` directory.

### Use Sub-Agents for Parallel Reads
If a task requires understanding 4+ unrelated files, spawn sub-agents:
- Sub-agent A: reads files 1-2, returns summary
- Sub-agent B: reads files 3-4, returns summary
- Main agent: uses summaries to execute the task

### Minimize Re-Reading
- After editing a file, keep the updated version in memory
- Don't re-read to confirm your edit — trust your write

### Test Efficiently
Run only the tests relevant to changed files:
```bash
# Not this (runs everything, slow + expensive):
npm test

# This first (fast, targeted):
npm test -- --testPathPattern=auth.service

# Then run full suite only at the end:
npm test
```

---

## Token Budget Mental Model

| Operation | Token cost |
|-----------|-----------|
| Reading `CODEBASE_INDEX.md` | Low (1 file, structured) |
| Reading a small source file | Low-Medium |
| Reading a large file fully | High — avoid unless necessary |
| Grepping for patterns | Very Low |
| Running full test suite | Low (just the output) |
| Loading full node_modules | Never do this |

**Target**: For a well-indexed project, onboarding should cost <5 full file reads.
