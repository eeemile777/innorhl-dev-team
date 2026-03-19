# SETUP — How to Use This Template

> One-time read. After this, you never need to remember anything.
> Your agents handle everything. Your job is to have ideas.

---

## What This Is

A two-agent development system:

- **Gemini (Antigravity)** = the brain. Investigates, plans, briefs you, remembers everything.
- **Claude (Code)** = the hands. Executes plans, writes code, runs tests, journals every session.
- **You** = the supervisor. You have ideas. You approve plans. You watch it happen.

---

## One-Time Setup (do this once per machine)

### 1. Install global tools

```bash
# GitNexus — codebase knowledge graph
npm install -g gitnexus

# NotebookLM CLI — external docs query tool
uv tool install notebooklm-mcp-cli

# Claude Code CLI — the AI that executes your plans
npm install -g @anthropic-ai/claude-code
```

### 2. Set up your environment variables

```bash
cp .env.example .env
# Open .env and fill in your tokens:
# - GITHUB_TOKEN
# - SUPABASE_ACCESS_TOKEN
# - SENTRY_AUTH_TOKEN
```

### 3. Install autopilot dependencies

```bash
cd autopilot
npm install
cd ..
```

### 4. (Optional) Set up Google Stitch — for projects with UI

Stitch is Gemini's UI design tool. It generates real screens and design systems from text descriptions. Skip if you only build APIs or CLIs.

```bash
# Step 1: Install gcloud CLI (if you don't have it)
# https://cloud.google.com/sdk/docs/install

# Step 2: Authenticate
gcloud auth login
gcloud auth application-default login

# Step 3: Run the Stitch MCP setup wizard (handles everything else)
npx @_davideast/stitch-mcp init
```

After setup, Gemini will automatically use Stitch at the start of new UI projects to generate a design system before any code is written.

### 5. (Optional) Set up NotebookLM

Create a notebook in [NotebookLM](https://notebooklm.google.com/) called **"Claude Code — Full Documentation"** and add the Claude Code docs as a source. Gemini will query this to know exactly how to prompt Claude.

---

## How to Start a NEW Project

1. **Copy this template** into your new project folder
2. **Open Antigravity** (Gemini) — it will read `GEMINI.md` automatically
3. **Say anything** — describe your idea in plain language
4. Gemini will ask questions, recommend a stack, write a plan
5. When Gemini says "ready to start?" — **start the autopilot**:
   ```bash
   cd autopilot && npm run full
   ```
6. The dashboard opens at `http://localhost:3001` — watch your agents work

---

## How to Start on an EXISTING Project

1. **Copy this template** into your existing project folder
2. **Open Antigravity** — say "let's work on this project"
3. Gemini will say "let me map the codebase first" and trigger onboarding
4. **Start the autopilot** (same as above) — Claude will generate `CODEBASE_INDEX.md`
5. After onboarding: Gemini briefs you on what exists, asks what you want to do
6. You describe what you need → Gemini plans → Claude executes

---

## The Daily Loop (once set up)

```
You open Antigravity
        ↓
Gemini reads JOURNAL.md and briefs you:
"Last time we did X. Next is Y. What do you want?"
        ↓
You say what you want (in plain language)
        ↓
Gemini investigates → writes PLAN.md + initializes .autopilot-state.json
        ↓
Autopilot detects the plan → spawns Claude → Claude executes
        ↓
Dashboard shows live progress
        ↓
Claude finishes → writes JOURNAL.md → AGENT_STATUS.md = complete
        ↓
Gemini reads the result → tells you what happened → asks what's next
```

---

## Key Files — What They Are

| File | What it's for |
|------|--------------|
| `GEMINI.md` | Gemini's instructions — loads automatically in Antigravity |
| `CLAUDE.md` | Claude's instructions — loads automatically in Claude Code |
| `PLAN.md` | The current task list — Gemini writes, Claude executes |
| `JOURNAL.md` | Project memory — Claude writes, Gemini reads on startup |
| `STATUS_REPORT.md` | Plain English project status — Gemini writes for you |
| `PROJECT_CONTEXT.md` | Architecture knowledge — Gemini fills this in |
| `CODEBASE_INDEX.md` | Technical map — Claude generates during onboarding |
| `.autopilot-state.json` | Machine state — don't touch manually |
| `AGENT_STATUS.md` | Is Claude done? — Gemini reads this |
| `GEMINI_INBOX.md` | Messages from the dashboard to Gemini |
| `ADR/` | Architecture Decision Records — why things were built the way they were |
| `.mcp.json` | Tool connections (GitHub, Sentry, Supabase, GitNexus, etc.) |

---

## Commands You Actually Need

```bash
# Start everything (watcher + dashboard)
cd autopilot && npm run full

# Start dashboard only (if watcher is already running)
cd autopilot && npm run dashboard

# Index the codebase with GitNexus (run once per project, re-run after big changes)
gitnexus analyze

# Regenerate the full project dump (useful for pasting into NotebookLM)
python3 scrape_to_md.py
```

---

## When Something Goes Wrong

| Problem | Solution |
|---------|---------|
| Claude is blocked | Open dashboard → read the blocker message → tell Gemini what to do → click Resume |
| Something broke after a Claude run | Dashboard → click Rollback (reverts to the git snapshot before Claude ran) |
| Gemini forgot the project context | It reads `JOURNAL.md` and `PROJECT_CONTEXT.md` automatically on startup |
| Dashboard not updating | Refresh the browser — WebSocket reconnects automatically |
| GitNexus is stale | Run `gitnexus analyze --force` in the project root |

---

## You Never Need to Remember

- ❌ No slash commands
- ❌ No workflow names
- ❌ No trigger words
- ❌ No implementation details from previous sessions
- ✅ Just open Antigravity and talk

Gemini remembers everything. Claude executes everything. You supervise.
