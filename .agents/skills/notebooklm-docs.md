# Skill: NotebookLM — External Knowledge & Documentation

**Used by**: Both Gemini (Antigravity) and Claude Code
**Purpose**: Query external API docs, PRDs, ADRs, and any design documents that live outside the codebase.
**MCP server**: `notebooklm` (configured in `.mcp.json`)
**Install**: `uv tool install notebooklm-mcp-cli`

---

## Why NotebookLM vs. GitNexus

These two tools are complementary — never redundant. Use the right one for the right job:

| Question | Use |
|----------|-----|
| How does `UserService` relate to `AuthController`? | **GitNexus** (`context()`, `impact()`) |
| What does the Stripe API expect for webhook payloads? | **NotebookLM** |
| Which files call `validateToken()`? | **GitNexus** (`query()`) |
| What did the PRD say about rate limiting? | **NotebookLM** |
| What's the blast radius of changing `PaymentSchema`? | **GitNexus** (`impact()`) |
| What does the ADR say about why we chose PostgreSQL? | **NotebookLM** |

---

## Rule 1 — Division of Knowledge

**When investigating CODEBASE structure, dependencies, or call chains → use GitNexus.**

```
context("SymbolName")    → full picture of a class/function
impact("SymbolName")     → blast radius before changing something
query("what does X do?") → find relevant code by description
```

**When reading external API documentation, PRDs, ADRs, or architecture docs → use NotebookLM.**

```
notebooklm_query("what are the required fields for the Stripe PaymentIntent API?")
notebooklm_query("what does the PRD say about the user onboarding flow?")
notebooklm_query("which ADR covers the database choice?")
```

Never use GitNexus to understand external APIs. Never use NotebookLM to trace code structure. The division is strict.

---

## Rule 2 — Context Ingestion Before Implementation

When a user drops a new document into the repository (API reference, design doc, PRD, third-party spec), **query NotebookLM before writing any implementation code.**

Workflow:
1. User adds `docs/stripe-api-reference.pdf` or `docs/feature-spec.md` to the repo
2. Before touching any code: query NotebookLM to extract the relevant requirements
   ```
   notebooklm_query("summarize the authentication requirements from the Stripe API reference")
   notebooklm_query("what are the acceptance criteria from the feature spec for the checkout flow?")
   ```
3. Use the extracted requirements to populate the `## Context` and `## Architecture Decisions` sections of PLAN.md
4. Only then begin implementation

**Never implement from memory or assumption when a source document exists.** If a doc was added but not indexed in NotebookLM yet, flag it as a blocker in PLAN.md before proceeding.

---

## Rule 3 — Journaling & Status Reports

When writing to `JOURNAL.md` or creating `STATUS_REPORT.md`, query NotebookLM first to pull historical context so reports are accurate and continuous — not isolated snapshots.

### For JOURNAL.md entries:
```
notebooklm_query("what decisions were made in the last journal entry?")
notebooklm_query("what was the last known state of the authentication refactor?")
```
Use the results to ensure the new entry connects to prior context and doesn't repeat or contradict past decisions.

### For STATUS_REPORT.md:
```
notebooklm_query("what is the current status of the payment feature according to past reports?")
notebooklm_query("what blockers were previously identified for this sprint?")
```
This ensures Gemini's status reports to the user build on history rather than starting blank each session.

---

## What to Index in NotebookLM

Index these document types (add as sources in your NotebookLM notebook):

| Document | When to index |
|----------|---------------|
| External API references (Stripe, Twilio, OpenAI, etc.) | When integrating a new service |
| PRDs / Feature specs | At project start or when new feature is scoped |
| ADRs (`ADR/NNN-*.md`) | After each ADR is written |
| `PROJECT_CONTEXT.md` | After Gemini writes/updates it |
| `JOURNAL.md` | Continuously, after each session |
| Third-party SDK docs | Before implementing integrations |
| Design files / wireframe notes | When UI requirements are defined |

---

## MCP Tool Reference

The `notebooklm` MCP server (via `notebooklm-mcp-cli`) exposes tools for querying notebooks. Common patterns:

```
# Query a notebook for specific information
notebooklm_query("your question here")

# List available notebooks
notebooklm_list_notebooks()

# Get a specific source from a notebook
notebooklm_get_source("source name or URL")
```

See `.agents/skills/docs-lookup.md` for query templates optimized for Claude Code documentation specifically.

---

## Integration with the Two-Agent Loop

**Gemini uses NotebookLM during the planning phase:**
- Before writing PLAN.md: query for PRD requirements, ADR constraints, API specs
- Before suggesting a stack: query for past stack decisions and their rationale
- Before writing JOURNAL.md: query for prior session history

**Claude uses NotebookLM during the execution phase:**
- Before implementing an API integration: query for the external API's spec
- Before writing a status update: query for historical context
- When a task references a document: query it before writing code
