# Skill: Docs Lookup (NotebookLM Query)

**Used by**: Gemini (Antigravity)
**When**: Before writing any PLAN.md — query Claude Code docs to get precise command/flag info
**Requires**: `notebooklm-mcp-cli` installed + notebook set up (see `notebooklm-setup.md`)

---

## Purpose

Gemini is the brain but doesn't always know the exact Claude Code CLI flags, hook formats, sub-agent syntax, or permission patterns. Instead of guessing (which leads to plans Claude can't execute), query NotebookLM first.

**Result**: Plans with precise, working Claude Code instructions — not approximations.

---

## When to Query

Query before writing PLAN.md when the task involves:

| Task type | What to query |
|-----------|--------------|
| Claude Code hooks | "How do I configure a PostToolUse hook in settings.json?" |
| Sub-agents | "What is the format for Claude Code sub-agent definitions?" |
| Permissions | "How do I allow npm commands in Claude Code permissions?" |
| CLI flags | "What flags does `claude` CLI support for non-interactive mode?" |
| MCP config | "How do I configure an MCP server in .mcp.json?" |
| Slash commands | "How do Claude Code slash commands work?" |
| Memory/CLAUDE.md | "What format does CLAUDE.md use? What sections are standard?" |
| Task management | "How does Claude Code's TodoWrite tool work?" |

---

## How to Query (via MCP)

Since `notebooklm-mcp-cli` is configured in `.mcp.json`, you have direct MCP tool access.

Use the NotebookLM MCP query tool with your notebook ID:

```
Query: "What is the exact JSON format for Claude Code hooks in settings.json?
        Show me an example of a Stop hook and a PostToolUse hook with matchers."

Notebook: Claude Code CLI — Full Documentation
```

The response gives you the exact syntax → paste into PLAN.md tasks.

---

## Query Templates

Copy these and fill in the `[specific need]`:

**For hook configuration:**
```
In Claude Code's settings.json, how do I configure a [Stop/PreToolUse/PostToolUse] hook
that runs [shell command] when [condition]? Show the exact JSON.
```

**For CLI usage:**
```
What Claude Code CLI flags control [behavior]?
Show the exact command with all relevant flags for [use case].
```

**For sub-agent definition:**
```
What is the format for defining a Claude Code sub-agent in .claude/agents/?
What fields are required? Show a complete example for [type of agent].
```

**For MCP server configuration:**
```
How do I configure [service name] as an MCP server in .mcp.json?
What is the exact mcpServers entry format?
```

**For permissions:**
```
How do I add a permission to allow [command] in Claude Code's settings.json?
Show the exact allow/deny entry format.
```

---

## Embedding Doc Context in PLAN.md

When the lookup returns relevant syntax, embed it directly in the plan:

```markdown
## Architecture Decisions
- **Hook format**: Using PostToolUse hook with matcher "Write|Edit" (verified from Claude Code docs):
  ```json
  { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "node script.js" }] }
  ```
```

This way Claude has the exact syntax in front of it — no guessing.

---

## Building a Local Cheat Sheet

After repeated queries, extract the most-used patterns into `.agents/rules/claude-code-patterns.md`:
- Common hook configurations
- Permission formats that work
- Sub-agent templates that work
- MCP server configs that work

This becomes a local cache — query NotebookLM less over time as the cheat sheet grows.
