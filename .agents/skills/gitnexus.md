# Skill: GitNexus — Codebase Knowledge Graph

**Used by**: Both Gemini (Antigravity) and Claude Code
**Purpose**: Replace expensive full-file-reading with precise graph queries. One tool call = complete architectural context on any symbol, file, or change.
**Install**: `npm install -g gitnexus`
**Index a project**: `gitnexus analyze` (run once in project root, re-run after major changes)

---

## Why This Changes Everything for Token Efficiency

Without GitNexus: to understand the impact of changing `UserService.validate()`, you'd need to grep through the codebase, read 10+ files, trace call chains manually — burning hundreds of tokens.

With GitNexus: one call to `impact("UserService.validate")` returns all 47 callers with confidence scores, grouped by depth. Done. One tool call.

---

## Setup (one time per project)

```bash
# Install globally
npm install -g gitnexus

# Index the current project (from project root)
gitnexus analyze

# This automatically:
# - Builds a full knowledge graph of the codebase
# - Installs agent skills to .claude/skills/
# - Registers Claude Code hooks
# - Generates AGENTS.md / CLAUDE.md context updates
```

The index lives in `.gitnexus/` (gitignored). Re-run after major refactors.

---

## 7 MCP Tools Available (via .mcp.json)

| Tool | When to use | Example |
|------|------------|---------|
| `query` | Find anything by keyword or description | `query("where is JWT validation handled?")` |
| `context` | Get 360° view of a symbol | `context("AuthService.validateToken")` |
| `impact` | Blast radius before changing something | `impact("UserSchema")` |
| `detect_changes` | What does a git diff affect? | `detect_changes("HEAD~1..HEAD")` |
| `list_repos` | See all indexed repos | `list_repos()` |
| `rename` | Safe multi-file rename | `rename("oldName", "newName")` |
| `cypher` | Raw graph query for advanced use | `cypher("MATCH (f:Function)-[:CALLS]->(g) WHERE g.name='login' RETURN f")` |

---

## For Gemini (Antigravity) — Planning Phase

Use GitNexus **before writing PLAN.md** to:

### 1. Understand impact before planning
```
Before planning changes to [thing], run:
impact("[thing]")
→ shows exactly which files/functions will be affected
→ use this to populate "files" field in each PLAN.md task
```

### 2. Find where something lives
```
query("how does the password reset flow work?")
→ returns the relevant functions and files
→ no need to read 20 files to find 3 relevant ones
```

### 3. Get full context on a symbol
```
context("PaymentService")
→ all methods, all callers, all dependencies, all imports
→ you now understand the full API surface before designing changes
```

### 4. Spot blast radius for refactors
```
impact("DatabaseConnection") → shows 23 things depend on it
→ refactor must be phased (not one big plan)
→ use this to break the refactor into safe phases
```

---

## For Claude Code — Execution Phase

Use GitNexus **instead of reading files** to understand code before touching it:

```
# Instead of: reading auth.service.ts, searching for all callers, grepping imports
# Do this:
context("AuthService")  → full picture in one call
impact("AuthService.refreshToken")  → what breaks if I change this?
```

GitNexus also auto-installs these skills into `.claude/skills/` when you run `gitnexus analyze`:
- **Exploring** — navigate unfamiliar code via the graph
- **Debugging** — trace bugs through call chains
- **Impact Analysis** — blast radius before changes
- **Refactoring** — plan safe refactors using dependency mapping

---

## Keeping the Index Fresh

```bash
# After significant code changes:
gitnexus analyze --force

# Check staleness:
# Use MCP resource: gitnexus://repo/{name}/context → shows last indexed time
```

The index is fast to rebuild — GitNexus uses Tree-sitter for parsing, not LLM calls. Typically <2 minutes for large repos.

---

## Integration with CODEBASE_INDEX.md

After running `gitnexus analyze`, append a summary to `CODEBASE_INDEX.md`:

```markdown
## Dependency Graph (GitNexus)
- Graph indexed: [date]
- Entry points: [list from gitnexus output]
- Key clusters: [functional communities detected]
- MCP tools available: query, context, impact, detect_changes, rename, cypher
- To re-index: `gitnexus analyze --force`
```

This tells both agents that the graph is available and ready to use.
