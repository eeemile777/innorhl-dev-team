# Skill: Codebase Onboarding

**Triggered by**: `/onboard` workflow
**Executed by**: Claude Code
**Output**: `CODEBASE_INDEX.md` in project root

---

## Purpose
Generate a shared map of an existing codebase so both Gemini and Claude can navigate it efficiently without redundant file scanning. Run once at project start, update when major structural changes occur.

---

## Steps

### Step 1: Generate Directory Tree
```bash
# Max 3 levels deep, exclude common noise
find . -not -path './.git/*' -not -path './node_modules/*' -not -path './.next/*' \
  -not -path './dist/*' -not -path './__pycache__/*' -not -path './venv/*' \
  -not -path './.venv/*' -not -path './target/*' | sort | head -200
```

### Step 2: Identify the Stack
Read these files (whichever exist):
- `package.json` → Node.js/TypeScript stack, scripts, key dependencies
- `requirements.txt` or `pyproject.toml` → Python stack
- `go.mod` → Go stack
- `Cargo.toml` → Rust stack
- `Dockerfile` or `docker-compose.yml` → containerization setup
- `.env.example` or `.env.sample` → required environment variables

### Step 3: Read Existing Documentation
- `README.md` → project purpose, setup instructions
- `docs/` directory → any architecture docs
- `ARCHITECTURE.md` or `DESIGN.md` if they exist
- `CHANGELOG.md` → recent history

### Step 4: Identify Key Entry Points
- **Web apps**: main server file, router/routes file, middleware setup
- **APIs**: controller/handler files, route definitions
- **CLIs**: main entry point, command definitions
- **Libraries**: main export file (`index.ts`, `__init__.py`, `lib.rs`)
- **Agents/AI**: agent definitions, tool registrations, prompt files

### Step 5: Identify Core Models & Schemas
- Database models / ORM entities
- API request/response types
- Core domain types or interfaces

### Step 6: Check for Tests
- Test directory structure
- Test runner and how to run (`npm test`, `pytest`, etc.)
- Coverage status if available

---

## Output Format

Write `CODEBASE_INDEX.md` to the project root:

```markdown
# Codebase Index
_Generated: [date] | Stack: [main language/framework]_

## Stack
- **Language**: [TypeScript / Python / Go / etc.]
- **Framework**: [Next.js / FastAPI / Gin / etc.]
- **Database**: [PostgreSQL / MongoDB / SQLite / etc.]
- **Auth**: [NextAuth / JWT / Supabase Auth / etc.]
- **Deployment**: [Cloudflare Workers / Vercel / Docker / etc.]
- **Key dependencies**: [list 5-10 most important packages]

## How to Run
```bash
# Install
[install command]

# Development
[dev command]

# Tests
[test command]

# Build
[build command]
```

## Required Environment Variables
| Variable | Purpose | Example |
|----------|---------|---------|
| DATABASE_URL | DB connection | postgres://... |
| [etc] | | |

## Architecture Overview
[2-4 sentence description of the overall architecture. How data flows, what the main components are, how they connect.]

## Directory Structure
```
src/
├── [module]/     # [what it does]
├── [module]/     # [what it does]
└── [module]/     # [what it does]
```

## Key Files Map
| File | Purpose |
|------|---------|
| `src/[path]` | [what it does] |
| `src/[path]` | [what it does] |

## API / Routes
[List main routes or API endpoints if applicable]

## Data Models
[List main entities/models with brief descriptions]

## Tech Debt & Hotspots
[Known issues, areas that need refactoring, things to be careful about]

## How to Add Features
[Pattern for adding a new feature in this codebase — where to put what]
```

---

## Notes
- Re-run this skill after major refactors or structural changes
- GitNexus users: export the dependency graph and append it as `## Dependency Graph` section
- Keep the index high-level — this is a navigation map, not a full documentation
