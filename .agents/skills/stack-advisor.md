# Skill: Stack Advisor

**Used by**: Gemini (Antigravity)
**When**: After requirements are gathered for a new project, before writing PLAN.md.
**Why**: Choosing the wrong stack at the start costs weeks. This skill gives Gemini a research-driven decision process instead of guessing.

---

## The Rule

**Never recommend a stack from memory alone. Always search first.**

Tech changes fast. A stack that was best practice 6 months ago might have a better alternative today. Use web search to validate before recommending.

---

## Step 1: Map Requirements to Constraints

From the requirements gathered (see `.agents/skills/requirements-gathering.md`), extract:

| Dimension | What to extract |
|-----------|----------------|
| **Scale** | Solo tool / small team / public SaaS / high traffic |
| **Speed to ship** | Need MVP in 1 week vs. 3 months |
| **Real-time needed?** | Chat, live updates, collaborative editing |
| **Auth complexity** | Simple login vs. OAuth vs. enterprise SSO |
| **Payment needed?** | Yes/no, one-time vs. subscription |
| **Data model** | Simple / relational / graph / document |
| **User's preference** | Did they mention a language or framework? |
| **Budget** | Cheap infra (serverless/free tier) vs. can pay for servers |

---

## Step 2: Search for Current Best Options

Before recommending, search:
```
"[category] best framework [current year]"
"[option A] vs [option B] [year]"
"[framework] production ready [year]"
```

Look for: community size, maintenance status, DX quality, recent benchmarks.

---

## Step 3: Apply the Decision Trees

### UI Design (run before picking frontend framework)
```
Project has significant UI (app, dashboard, SaaS)? → Use Google Stitch first
  → Prompt Stitch with the app description → get design system + screen mockups
  → Extract design tokens (colors, typography, spacing) → use in frontend code
  → Stitch MCP tools: generate_screen(), extract_design_context(), get_screen_code()
API-only / CLI / backend service? → Skip Stitch entirely
```

### Frontend
```
Need SEO / content? → Next.js (App Router)
Pure dashboard / internal tool? → Vite + React or SvelteKit
Mobile app? → Expo (React Native)
Prototype only? → Next.js (fastest to something real)
```

### Backend / API
```
Already using Next.js? → Next.js API routes or Route Handlers (keep it simple)
Need a separate API? → FastAPI (Python) or Fastify (Node.js)
Serverless preferred? → Cloudflare Workers or Supabase Edge Functions
Heavy compute / ML? → FastAPI + Python
```

### Database
```
Relational data (users, orders, etc.)? → PostgreSQL
Postgres + want zero infra? → Supabase (managed Postgres + auth + storage)
Need real-time sync? → Supabase Realtime or PlanetScale
Edge / serverless focused? → Cloudflare D1
Document data? → MongoDB Atlas
Simple key-value? → Redis or Cloudflare KV
```

### Auth
```
Want it done in 10 minutes? → Clerk (best DX, paid after scale)
Open source, self-hosted? → Auth.js (NextAuth)
Already using Supabase? → Supabase Auth (free, built-in)
Enterprise / SSO needed? → WorkOS or Auth0
```

### Hosting
```
Next.js? → Vercel (zero config, best Next.js support)
Any Node / Python? → Railway (simple, affordable)
Serverless / edge? → Cloudflare Workers + Pages
More control? → Fly.io (runs containers, global)
Cheap but complex? → VPS on DigitalOcean / Hetzner
```

### Payments
```
Standard checkout + subscriptions? → Stripe (always Stripe)
Marketplace / platform? → Stripe Connect
Simple one-time? → Stripe Payment Links (no code needed)
```

---

## Step 4: Recommend With Reasoning

Present the recommended stack clearly with a short "why" for each choice. Offer one alternative per layer if the user might push back:

```
Recommended stack for [project name]:

- Frontend: Next.js 14 (App Router)
  Why: Best DX for React, handles SEO, API routes built-in, deploys to Vercel in seconds.
  Alternative: SvelteKit (faster, smaller bundle, but smaller ecosystem)

- Database: Supabase (Postgres)
  Why: Managed Postgres + auth + storage + real-time, free tier covers you at launch.
  Alternative: PlanetScale (if you need more scale later)

- Auth: Supabase Auth
  Why: Already included in Supabase, zero extra setup.

- Hosting: Vercel
  Why: One-click deploys, free tier, perfectly paired with Next.js.

- Payments: Stripe
  Why: Industry standard. Best docs. Most integration examples.

Total monthly cost at launch: ~$0 (all free tiers)
```

---

## Step 5: Document the Decision

After the user approves the stack, write an ADR:
- File: `ADR/001-stack-choice.md`
- Sections: Context (requirements) → Decision (stack) → Rationale (why each) → Alternatives considered

This gives future Gemini sessions the full reasoning without re-researching.

---

## Common Anti-Patterns to Avoid

| Anti-pattern | Why it's bad |
|-------------|-------------|
| Recommending microservices for an MVP | Premature complexity. Monolith first. |
| Recommending a DB the user doesn't know | Learning curve kills speed |
| Mixing too many new technologies at once | One new thing per project max |
| Recommending paid services for a prototype | Free tier first, upgrade when needed |
| Over-engineering auth | Clerk or Supabase Auth, not a custom JWT system |
