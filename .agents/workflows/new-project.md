# Workflow: New Project

**Trigger**: `/new-project` in Antigravity
**Lead**: Gemini (Antigravity)
**Goal**: Go from zero to a working, testable scaffold with first feature implemented

---

## Phase 0: Requirements Gathering (Gemini)

**Use `.agents/skills/requirements-gathering.md` for the full process.**

Short version:
1. Let the user describe the idea — listen first, don't interrupt
2. Reflect back what you heard in one sentence — confirm understanding
3. Ask all clarifying questions at once (product, users, scale, auth, DB, deadline, constraints)
4. Summarize and get user confirmation before moving to architecture
5. Check if user has dropped any docs (PRD, wireframes) — index in NotebookLM if so

Do NOT move to Phase 1 until the user says "yes that's right."

---

## Phase 0.25: UI Design with Stitch (Gemini — only if project has significant UI)

**Skip this phase for: API-only projects, CLI tools, backend services, data pipelines.**

**Use this phase for: SaaS apps, dashboards, consumer apps, anything the user will look at.**

1. **Ask the user one question**: "Does this project have a UI? If yes, describe what the main screen should feel like — modern/minimal, dark/light, data-heavy or simple?"
2. **Use the Stitch MCP** to generate 2–3 key screens from the project description:
   ```
   generate_screen("description of the main app screen and overall aesthetic")
   extract_design_context(screen_id)   → gets color palette, typography, spacing
   get_screen_code(screen_id)          → gets production HTML/Tailwind
   ```
3. **Show the user the Stitch output link** — they can iterate on the design at stitch.withgoogle.com
4. **Extract the design tokens** (primary color, font family, border radius, spacing scale) and write them into `PROJECT_CONTEXT.md` under a `## Design System` section
5. **Tell Claude** (in PLAN.md): "Use the design tokens in PROJECT_CONTEXT.md ## Design System for all UI components. Do not invent your own colors or fonts."

> **Why do this before picking a stack?** The design output tells you if you need complex animations (→ Framer Motion), a component library (→ shadcn/ui), or mobile-first (→ Expo). The design informs the stack, not the other way around.

---

## Phase 0.5: Stack Selection (Gemini)

**Use `.agents/skills/stack-advisor.md` for the full process.**

Short version:
1. Map requirements to constraints (scale, speed, real-time, budget)
2. If Phase 0.25 was run — factor in design complexity when choosing frontend (animations → Framer Motion, components → shadcn/ui, etc.)
3. Web search for current best options — don't recommend from memory
4. Recommend one stack with reasoning for each layer — not a menu of options
5. Write ADR: `ADR/001-stack-choice.md` after user approves

---

## Phase 1: Architecture Design (Gemini)

Based on confirmed requirements + approved stack:

1. **Design the directory structure** — where does what go?
2. **Design the data model** — entities, relationships, key fields
3. **Design the API surface** — key routes/endpoints (if applicable)
4. **Identify MCP tools needed** — add to `.mcp.json`
5. **Write `PROJECT_CONTEXT.md`** — fill in the template with project details
6. **Initialize `.autopilot-state.json`** — set status to `in_progress` with task counts

Write `PLAN.md` Phase 1: Scaffold (see Phase 0 scaffolding below)

---

## Phase 1 Plan Content — Phase 0 Scaffold (Gemini writes)

This is the standard Phase 0 scaffold checklist. Every new project starts with this. No skipping.

```markdown
# Plan: [Project Name] — Phase 0: Foundation

## Context
[Project purpose from requirements gathering]

## Architecture Decisions
- **Stack**: [Framework + Language + DB + Hosting] — see ADR/001-stack-choice.md
- **Directory structure**: [describe the structure]
- **Auth approach**: [chosen approach and why]
- **DB approach**: [ORM, schema strategy]

## Tasks
- [ ] T1: Initialize project (`npm create`, `npx create-next-app`, etc.) — files: `package.json`
- [ ] T2: Configure TypeScript strict mode — files: `tsconfig.json`
- [ ] T3: Set up ESLint + Prettier — files: `.eslintrc.json`, `.prettierrc`
- [ ] T4: Set up test runner (Vitest or Jest) with a sample passing test — files: `vitest.config.ts`
- [ ] T5: Set up GitHub Actions CI (run tests + build on every PR) — files: `.github/workflows/ci.yml`
- [ ] T6: Create `.env.example` with all required variables listed — files: `.env.example`
- [ ] T7: Set up database schema / ORM (Prisma, Drizzle, etc.) — files: `prisma/schema.prisma`
- [ ] T8: Set up Sentry error monitoring — files: `sentry.client.config.ts`, `sentry.server.config.ts`
- [ ] T9: Generate `CODEBASE_INDEX.md` (run codebase-onboard skill) and run `gitnexus analyze`

## Constraints
- DO NOT implement business logic yet — that's Phase 1
- DO NOT skip tests (T4) — tests must run from day one even if there are none
- DO NOT skip CI (T5) — broken CI is worse than no CI
- DO NOT skip Sentry (T8) — monitoring from day one catches regressions early

## Test Criteria
- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts without errors
- [ ] `npm test` runs (even with 1 dummy test) without errors
- [ ] `npm run build` compiles with zero TypeScript errors
- [ ] GitHub Actions CI passes on a test PR
- [ ] Sentry dashboard shows the project receiving events
```

---

## Phase 2: Core Feature (Claude executes Phase 1, Gemini writes Phase 2)

After Claude completes Phase 1 and runs `/onboard`:

1. Gemini reviews `CODEBASE_INDEX.md`
2. Gemini writes `PLAN.md` Phase 2 with the first real feature
3. Claude executes Phase 2

Repeat until MVP is complete.

---

## Phase N+1: Deploy to Production (Gemini triggers deploy workflow)

When the MVP is built and tested, Gemini runs the deploy workflow:

→ See `.agents/workflows/deploy.md` for the full process.

Short version:
1. Gemini asks: **Railway or Google Cloud Run?**
2. Gemini runs pre-deploy checklist (build passes, tests pass, PORT is dynamic, health endpoint exists)
3. Gemini writes PLAN.md deploy tasks
4. Claude executes using `railway-deploy.md` or `cloudrun-deploy.md` skill
5. Claude verifies live URL returns 200
6. Gemini reports live URL to user

**Never skip the health check.** A deploy that hasn't been verified is not a deploy.

---

## Phase Cadence

```
Phase 1: Scaffold (foundation, no business logic)
Phase 2: Core feature #1 (auth, main data flow, etc.)
Phase 3: Core feature #2
Phase N: Polish (error handling, logging, monitoring setup)
Phase N+1: Deploy to production (Railway or Google Cloud Run)
Phase N+2+: Iterate — new features go back to Phase 2 cycle
```

---

## Tips
- Resist the urge to build everything at once — phases keep it manageable
- If Gemini's plan has >10 tasks, it needs to be split into sub-phases
- Production readiness is its own phase — don't mix it with feature work
- After first deploy, every new feature cycle ends with a redeploy — it becomes automatic
