# Skill: NotebookLM Knowledge Base Setup

**Purpose**: Set up a NotebookLM notebook with Claude Code documentation so Gemini can query it when writing plans.
**Do this once per machine. Then use the `docs-lookup` skill for queries.**

---

## Step 1: Install notebooklm-mcp-cli

```bash
# Requires uv (https://docs.astral.sh/uv/)
uv tool install notebooklm-mcp-cli
```

Verify:
```bash
uvx notebooklm-mcp-cli --help
```

---

## Step 2: Authenticate with Google

```bash
uvx notebooklm-mcp-cli auth
```

This opens a browser — log in with the same Google account as your Google AI Pro subscription.

---

## Step 3: Create the Claude Code Docs Notebook

```bash
uvx notebooklm-mcp-cli notebook create --title "Claude Code CLI — Full Documentation"
```

Save the notebook ID from the output. You'll need it.

---

## Step 4: Add Claude Code Documentation Sources

Add these sources to the notebook (use the MCP tool or CLI):

### Option A: Official docs URL
```bash
# Claude Code documentation
uvx notebooklm-mcp-cli source add --notebook-id <ID> \
  --url "https://docs.anthropic.com/en/docs/claude-code"

# Claude Code hooks docs
uvx notebooklm-mcp-cli source add --notebook-id <ID> \
  --url "https://docs.anthropic.com/en/docs/claude-code/hooks"

# Claude Code settings reference
uvx notebooklm-mcp-cli source add --notebook-id <ID> \
  --url "https://docs.anthropic.com/en/docs/claude-code/settings"

# Claude Code sub-agents
uvx notebooklm-mcp-cli source add --notebook-id <ID> \
  --url "https://docs.anthropic.com/en/docs/claude-code/sub-agents"
```

### Option B: Export Claude Code CLI help and upload as text
```bash
# Export all Claude Code help text
claude --help > /tmp/claude-help.txt
claude --help-all >> /tmp/claude-help.txt 2>/dev/null || true

# Upload as a source
uvx notebooklm-mcp-cli source add --notebook-id <ID> \
  --file /tmp/claude-help.txt --title "Claude Code CLI Help"
```

---

## Step 5: Save the Notebook ID

Add it to your project's `.env.local` (not committed):
```
NOTEBOOKLM_CLAUDE_DOCS_ID=<your-notebook-id>
```

And reference it in GEMINI.md so Antigravity knows which notebook to query.

---

## Optional: Add More Notebooks

You can create additional notebooks for:
- **Project-specific docs**: architecture decisions, API contracts
- **Third-party library docs**: framework docs, library READMEs
- **Team conventions**: internal coding standards, runbooks

Each gets its own notebook. Reference them in GEMINI.md with their IDs.

---

## Keeping Docs Fresh

Claude Code docs update with each release. Re-add sources periodically:
```bash
# Remove old source and re-add
uvx notebooklm-mcp-cli source remove --notebook-id <ID> --source-id <source-id>
uvx notebooklm-mcp-cli source add --notebook-id <ID> --url "..."
```
