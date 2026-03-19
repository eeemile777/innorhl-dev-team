# Autopilot

The glue layer between Gemini (Antigravity) and Claude Code.

## How it works

```
Gemini writes PLAN.md
        ↓
watcher.js detects change
        ↓
Claude Code auto-launches → executes tasks
        ↓
on-claude-stop.js hook fires → writes AGENT_STATUS.md
        ↓
Gemini reads AGENT_STATUS.md → reviews → writes next phase
        ↓
(loop repeats)
```

## Setup (one time)

```bash
cd autopilot
npm install
```

## Commands

| Command | What it does |
|---------|-------------|
| `npm start` | Watcher only — no dashboard |
| `npm run dashboard` | Dashboard only — opens browser at localhost:3001 |
| `npm run full` | Watcher + dashboard together (recommended) |

## Mission Control Dashboard

The dashboard gives you a real-time supervisor view of your agents.

```
┌──────────────────┬──────────────────┬─────────────────┐
│  GEMINI — BRAIN  │  CLAUDE — HANDS  │  PROJECT HEALTH │
│  live context    │  task progress   │  feature status │
│                  │  ████████░░ 60%  │  ✔ auth done    │
│                  │  T4 of 5         │  ◐ payments...  │
├──────────────────┴──────────────────┴─────────────────┤
│  JOURNAL  Last session: fixed double-charge bug        │
├────────────────────────────────────────────────────────┤
│  > Tell Gemini something...          [PAUSE] [ROLLBACK]│
└────────────────────────────────────────────────────────┘
```

**Buttons:**
- **SEND** — writes your message to `GEMINI_INBOX.md` (Gemini reads this)
- **PAUSE** — immediately blocks the autopilot (Claude won't be re-spawned)
- **RESUME** — resumes from blocked state
- **ROLLBACK** — `git reset --hard` to the last autopilot snapshot

## Files

| File | Purpose |
|------|---------|
| `watcher.js` | Main file watcher — watches state + PLAN.md, launches Claude Code |
| `dashboard.js` | Mission Control — Express server + WebSocket + browser UI |
| `on-claude-stop.js` | Hook: runs when Claude session ends, updates state + AGENT_STATUS.md |
| `on-file-write.js` | Hook: logs task progress when PLAN.md is updated |

## AGENT_STATUS.md

Written by Claude Code after each session. Gemini should check this to know when Claude is done.

Status values:
- `running` — Claude is currently executing
- `complete` — All tasks done, Gemini review needed
- `blocked` — Claude hit blockers, Gemini needs to resolve
- `partial` — Session ended mid-execution
- `error` — Something went wrong

## Preventing runaway loops

- Lock file (`.autopilot.lock`) prevents multiple Claude instances running at once
- The watcher only triggers when PLAN.md has unchecked tasks AND status is "In Progress"
- `SIGINT` (Ctrl+C) cleanly shuts down and removes the lock file
