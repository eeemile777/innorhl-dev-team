# Skill: Self-Improving Framework (ACE Pattern)

**Used by**: Gemini (Antigravity)
**When**: After every major completed session — before asking "what's next?"
**Why**: Static instruction files get stale. This framework should get smarter after every session, not stay the same forever.

---

## The Idea

Inspired by the ACE framework (arXiv:2510.04618): agents that improve their own operating context over time.

- **JOURNAL.md** = the Reflector (Claude writes what happened, what failed, what worked)
- **This skill** = the Curator (Gemini reads the journal and proposes improvements to the framework itself)
- **CLAUDE.md / GEMINI.md** = the living playbook (gets better over time)

After every meaningful session, Gemini runs this skill. The framework evolves. In 3 months, your CLAUDE.md will be dramatically smarter than the day you started.

---

## When to Run This

Run after any session where:
- Something took longer than expected
- Claude hit a blocker that felt avoidable
- A pattern emerged that would help future sessions
- A rule in CLAUDE.md turned out to be wrong or missing
- A new tool or technique was discovered that worked well

Don't run after trivial sessions (1-2 task completions with no surprises).

---

## The 4-Step Process

### Step 1: Read the Evidence
```
Read JOURNAL.md — last 2-3 sessions
Read PLAN.md — were there blockers? what was hard?
Read AGENT_STATUS.md — did anything error out?
```

### Step 2: Extract Insights
Answer these questions from the evidence:

**What friction did Claude hit?**
- Did it read files it didn't need to?
- Did it ask questions that CLAUDE.md should have answered?
- Did it make a decision it shouldn't have made alone?
- Did it miss something it should have checked?

**What worked unusually well?**
- Any technique or approach that was faster or cleaner than expected?
- Any tool combination that saved significant time?

**What's missing from the framework?**
- A rule that would have prevented a blocker
- A skill that was needed but didn't exist
- A workflow step that was skipped but would have helped

**What's wrong in the framework?**
- A rule that turned out to be too strict or too loose
- A skill that gave bad advice
- A workflow that doesn't match reality

### Step 3: Propose Delta Edits

Write your proposals as specific, minimal changes — not rewrites. Format:

```markdown
## Framework Improvement Proposals — [Date]

### CLAUDE.md
- **ADD** to Token Efficiency Rules: "When working in a Next.js project, always check
  `app/` directory first before `pages/` — the App Router is the modern pattern."
- **CHANGE** Sub-Agent Usage: remove `explorer.md` from the list — use GitNexus query() instead, it's faster
- **ADD** new rule: "When PLAN.md has >8 tasks, split into phases before starting —
  sessions that long always lose context quality after task 6"

### GEMINI.md
- **ADD** to Workflow Detection table: "User says 'it's slow' or mentions performance →
  Profile first with GitNexus query('performance bottleneck') before writing any plan"

### New skill needed
- `.agents/skills/nextjs-patterns.md` — Next.js specific patterns that kept
  coming up this week (App Router, server components, etc.)
```

### Step 4: Present to User + Get Approval

Don't modify files silently. Present the proposals:

> "I reviewed the last few sessions and have some improvements for the framework. Here's what I'm proposing: [list the delta edits]. Want me to apply these? I can also skip any you disagree with."

Apply only the approved ones. Write them to the actual files.

---

## Anti-Patterns (don't do these)

- ❌ Rewrite entire CLAUDE.md — propose targeted additions only
- ❌ Remove rules that worked fine — only remove things that actively caused problems
- ❌ Add rules that are project-specific, not general — put project-specific context in PROJECT_CONTEXT.md instead
- ❌ Add more than 3-4 changes at once — small, frequent improvements beat big rewrites
- ❌ Make changes without user approval — always present first

---

## The Long-Term Effect

| Session | What happens |
|---------|-------------|
| Week 1 | Framework works as designed |
| Week 2 | 2-3 improvements from real sessions |
| Month 1 | Framework knows your tech stack preferences, your risk tolerance, your team's patterns |
| Month 3 | CLAUDE.md is customized to your exact project — mistakes from Month 1 don't happen anymore |

The goal is a CLAUDE.md that's tuned to your specific codebase and working style, not a generic template.
