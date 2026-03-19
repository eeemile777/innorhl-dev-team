# Division of Labor — Who Does What

## The Core Principle
**Gemini thinks. Claude acts.** These roles never cross.

---

## Gemini's Domain (Antigravity)

| Responsibility | How |
|---------------|-----|
| Codebase investigation | Read files, search web, analyze patterns |
| Requirements analysis | Talk with user, clarify intent |
| Architecture decisions | Choose libraries, patterns, data models |
| Writing PLAN.md | Full plan with tasks, constraints, test criteria |
| Reviewing Claude's output | Check completed tasks, close or continue plan |
| Adapting the plan | Resolve blockers, write follow-up phases |
| Generating CODEBASE_INDEX.md | High-level map of the project structure |
| Writing PROJECT_CONTEXT.md | Architecture understanding, tech debt, hotspots |

**Gemini does NOT**: Write implementation code, run shell commands, edit source files.

---

## Claude's Domain (Claude Code)

| Responsibility | How |
|---------------|-----|
| Reading and executing PLAN.md | Task by task, in order |
| Writing and editing source code | All languages, all files |
| Running tests | And fixing failures |
| Running builds | And fixing errors |
| Installing dependencies | Via package managers |
| Git operations | Commits, branches, PRs |
| Generating CODEBASE_INDEX.md | When triggered by onboard skill |
| Marking tasks complete | Updating PLAN.md checkboxes |
| Writing blockers | When stuck, not spinning |

**Claude does NOT**: Make architecture decisions, design data models, choose libraries, talk to the user about requirements.

---

## Handoff Protocol

### Gemini → Claude (assigning work)
1. Gemini writes complete `PLAN.md`
2. Notifies user: "Plan is ready, ask Claude to execute it"
3. User tells Claude: "Execute PLAN.md"
4. Claude reads PLAN.md and begins

### Claude → Gemini (reporting blockers)
1. Claude writes to `PLAN.md → ## Blockers`
2. Claude moves to the next unblocked task
3. User notifies Gemini: "Claude has blockers"
4. Gemini reads PLAN.md, resolves blockers, updates plan
5. Claude resumes

### Completion
1. All tasks checked off → Claude reports "Plan complete"
2. Gemini reviews output
3. Gemini either: closes the plan, writes a follow-up phase, or flags issues

---

## Conflict Resolution

**If Claude disagrees with an architecture decision:**
→ Write it in Blockers. Never override. Gemini decides.

**If Gemini's plan is ambiguous:**
→ Claude picks the interpretation most consistent with existing codebase patterns.
→ Documents the choice in a Blocker note for Gemini to review.

**If requirements change mid-execution:**
→ User tells Gemini. Gemini updates PLAN.md. Claude continues from current state.
→ Never restart from scratch if partial work can be preserved.
