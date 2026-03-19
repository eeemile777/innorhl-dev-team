# Skill: Session Continuity — Never Lose Context

**The core problem this solves**: The user is busy. They don't remember commands, implementation details, or where they left off. The agents must carry the memory — not the user.

**Gemini uses this at session START.**
**Claude uses this at session END.**

---

## For Gemini — Session Start Protocol

### The Golden Rule
The moment a user opens a conversation, assume they remember NOTHING. It's your job to orient them — proactively, before they have to ask.

It doesn't matter what the user says first. Even if they just say "hey", "yo", "I'm back", "what's up", or describe something totally unrelated — **always run this protocol first**.

---

### Step 1: Orient yourself (before responding)

Read these files in this order:
1. `JOURNAL.md` — what happened last session(s)
2. `AGENT_STATUS.md` — is Claude mid-task right now?
3. `.autopilot-state.json` — is autopilot running or blocked?
4. `PROJECT_CONTEXT.md` — architecture understanding (if exists)
5. `CODEBASE_INDEX.md` — technical map (if exists)

If none of these exist → this is a brand new project or first time here.
If JOURNAL.md exists but CODEBASE_INDEX.md doesn't → project exists but wasn't mapped yet.

---

### Step 2: Give the user a briefing

**Always lead with a briefing** before asking what they want. Keep it conversational and plain — no bullet lists of technical jargon.

**Template — returning user, project has history:**
> "Hey! Last time we were working on [thing]. We got [X] done — [brief plain-English description]. [Thing Y] is still in progress / still needs to be done. [If there's something they need to know: 'One thing worth knowing: [surprise/decision/issue].'] Want to pick up where we left off, or is there something else on your mind?"

**Template — returning user, something is blocked:**
> "Hey! Quick heads up — when we last ran the autopilot, it hit a blocker: [plain English description of the blocker]. I need to figure that out before Claude can continue. But tell me what's on your mind and I'll handle it."

**Template — new project (no JOURNAL.md):**
> "Looks like we're starting fresh here. Tell me what you want to build and I'll take it from there — ask you a few questions, map out a plan, and we'll get going."

**Template — existing codebase, never mapped:**
> "I can see there's a codebase here but I haven't mapped it yet — so I don't know what's in it. Give me a minute to scan it and I'll catch you up on what exists. Then tell me what you want to work on."

---

### Step 3: Figure out what the user wants (naturally)

After the briefing, listen. The user might say:
- "Yeah let's continue" → resume from JOURNAL.md "what to do next session"
- "Actually I want to add [new thing]" → switch to feature workflow
- "Something's broken" → switch to debug workflow
- "I don't know, what do you think?" → make a recommendation based on JOURNAL.md
- "Who are you / what is this?" → explain the system in plain English

You figure out the workflow from what they say. They never tell you which workflow to use.

---

### Step 4: If the codebase hasn't been mapped, do it

If `CODEBASE_INDEX.md` doesn't exist, tell the user:
> "Let me map out the codebase first so I know what we're working with — this takes a minute."

Then trigger the onboarding: write a PLAN.md task for Claude to generate `CODEBASE_INDEX.md`, and run `gitnexus analyze` as part of it. After that, read the results and write `PROJECT_CONTEXT.md` with your understanding. Then brief the user on what you found.

---

### What Gemini should NEVER do at session start:
- Ask "what command do you want to run?"
- Say "please run /onboard"
- Start planning without reading JOURNAL.md first
- Assume the user remembers what they were working on
- Ask 5 questions before giving any orientation

---

## For Claude — End of Session Journal Entry

### The Golden Rule
Every session that changes code MUST end with a JOURNAL.md entry. This is non-negotiable. The entry is what lets the user and a fresh Gemini understand what happened without reading code.

---

### When to write
- After marking the last task complete in PLAN.md
- Before exiting — this is the last thing you do
- Even if the session was short or incomplete

---

### How to write the entry

Append to the TOP of JOURNAL.md (newest entries first), below the header comment block:

```markdown
## Session: YYYY-MM-DD

**What we built / fixed:**
- [Concrete, plain English. Not "refactored the handler" but "fixed the bug where users got charged twice by adding an idempotency key to the Stripe call"]

**Decisions made:**
- [Decision in plain English] — reason: [why, briefly]

**Current state of the project:**
| Area | Status | Notes |
|------|--------|-------|
| Payment processing | ✅ Done | Bug fixed, tested with Stripe test mode |
| Discount codes | 🔄 In Progress | DB schema done, API endpoints next |
| User dashboard | ⏳ Not Started | Planned for next phase |

**Known issues / risks:**
- [Anything that could bite someone later, in plain English]

**What to do next session:**
- [The very next concrete step. Specific enough that a fresh Claude can pick it up from PLAN.md without asking questions]

**What the user should know:**
- [Anything surprising, any decision that affects the user, any question that needs their input]
```

---

### What makes a good journal entry vs. a bad one

**Bad (too technical, useless to a non-developer):**
> Refactored PaymentService.processCharge() to use idempotency keys. Updated Stripe SDK call signature. Added error handling for 402 responses.

**Good (plain English, useful to anyone):**
> Fixed the bug where users sometimes got charged twice. The root cause was that our payment system didn't have a way to tell Stripe "I already sent this request" — so if the network hiccupped, it would create a duplicate charge. Now it uses a unique ID per payment attempt so Stripe knows to ignore duplicates.

Write the technical details in code. Write the journal entry for a smart person who doesn't code.

---

### Querying NotebookLM before writing

Per `.agents/skills/notebooklm-docs.md` Rule 3:

Before writing a new journal entry, query NotebookLM for the last entry to ensure continuity:
```
notebooklm_query("what was the last session's status and what was planned for next?")
```

Use the result to make sure the new entry references prior context naturally (e.g., "Continued from last session's work on discount codes...").

---

## The Memory Chain

```
Claude finishes work
        ↓
Claude writes JOURNAL.md entry (plain English, human-readable)
        ↓
[days/weeks pass — user forgets everything]
        ↓
User opens Antigravity and says literally anything
        ↓
Gemini reads JOURNAL.md before responding
        ↓
Gemini briefs user: "Here's where we left off..."
        ↓
User says what they want (or agrees to continue)
        ↓
Gemini plans → Claude executes → journal updated
        ↓
(loop)
```

The user's job in this chain: **say what they want**. That's it. Everything else is handled.
