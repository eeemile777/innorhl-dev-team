# Skill: Requirements Gathering

**Used by**: Gemini (Antigravity)
**When**: At the start of every NEW project, before writing any plan or recommending any stack.
**Why**: When there's no codebase to investigate, the only source of truth is the user's head. This skill extracts it systematically so nothing important is missed.

---

## The Rule

**Never start planning a new project without running this process first.**

A bad plan from incomplete requirements wastes days. 20 minutes of good questions saves everything.

---

## Step 1: Listen to the Raw Idea

Let the user describe what they want — don't interrupt. Even if it's vague ("I want an app that does X"), just listen first.

After they finish, reflect back what you heard in one sentence:
> "So if I understand right, you want to [restate in your own words]. Does that capture it?"

This catches misunderstandings early.

---

## Step 2: Ask the Core Questions

Ask all of these at once — grouped naturally, not as a numbered list. Make it feel like a conversation.

**About the product:**
- What problem does this solve? Who has this problem?
- Who is the user — a specific type of person, a company, yourself?
- What does "done" look like for version 1? What's the absolute minimum that's useful?
- What's explicitly out of scope for now?

**About scale & constraints:**
- How many users do you expect at launch vs. in 6 months?
- Is this just for you, a small team, or the public?
- Do you have a deadline or timeline in mind?
- Any budget constraints for infrastructure / third-party services?

**About existing context:**
- Does anything like this already exist (even partially)?
- Are there other tools / APIs this needs to connect to?
- Do you have design mockups, a PRD doc, or anything written down?
- Is there a competitor or inspiration app you're thinking of?

**About decisions already made:**
- Do you have a preferred tech stack, or are you open?
- Any strong preferences or things you want to avoid?
- Are you planning to handle payments, auth, file uploads, real-time features?

---

## Step 3: Synthesize Before Moving On

After the user answers, write a short summary back to them:

> "Got it. Here's what I'm planning for:
> - **What it does**: [plain English]
> - **Who uses it**: [user type]
> - **MVP scope**: [what's in v1]
> - **Out of scope**: [what's not in v1]
> - **Constraints**: [timeline, budget, stack preferences]
>
> Does this match what you're thinking? Anything I got wrong or missed?"

Only proceed to stack recommendation + plan after the user confirms.

---

## Step 4: Document as PRD Snippet

After confirmation, write a short PRD section to `PROJECT_CONTEXT.md` under "What This Project Does" and "Known Constraints". This becomes the shared memory that both agents reference throughout the project.

Also check if the user dropped any documents (spec files, wireframes, notes) — if so, index them in NotebookLM before writing the plan. See `.agents/skills/notebooklm-docs.md` Rule 2.

---

## Anti-Patterns to Avoid

- **Don't assume the stack** — ask before recommending. See `.agents/skills/stack-advisor.md`.
- **Don't gold-plate the MVP** — if they say "simple version first", believe them.
- **Don't ask one question at a time** — batch all questions in Step 2 into one message.
- **Don't skip confirmation** — Step 3 is mandatory. Surprises kill projects.
