# Project Context

> Written by Gemini (Antigravity) after onboarding.
> Updated whenever the architecture meaningfully changes.
> Both agents load this at session start.

---

## What This Project Does

<!-- 2-3 sentences. What problem does it solve? Who uses it? -->

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | | |
| Backend | | |
| Database | | |
| Auth | | |
| Hosting | | |
| Payments | | |
| Monitoring | | |

---

## Architecture Summary

<!-- How do the pieces connect? Draw it in words or ASCII. -->

```
[User] → [Frontend] → [API] → [Database]
                    ↓
               [External APIs]
```

---

## Key Files to Know

| File / Folder | What it does |
|---------------|-------------|
| | |

---

## Entry Points

<!-- Where does the app start? What are the main routes? -->

- API: `src/`
- Frontend: `app/` or `pages/`
- Workers/Jobs: `jobs/`

---

## Environment Variables Needed

<!-- List the important ones. Full list in .env.example -->

| Variable | Purpose |
|----------|---------|
| | |

---

## How to Run Locally

```bash
# Install
npm install

# Set up env
cp .env.example .env
# Fill in .env

# Run
npm run dev
```

---

## Test Coverage

<!-- How well is this codebase tested? What's safe to change? -->

- Unit tests: [ ] Yes / [ ] Partial / [ ] None
- Integration tests: [ ] Yes / [ ] Partial / [ ] None
- E2E tests: [ ] Yes / [ ] Partial / [ ] None
- **Safe to change without tests**: _list areas_
- **Never touch without tests first**: _list critical areas (payments, auth, etc.)_

---

## Hot Paths (Critical Code)

<!-- Code that runs on every request or handles money/auth. Extra care here. -->

| Path | Why it's critical | Test coverage |
|------|-------------------|---------------|
| | | |

---

## Known Tech Debt

<!-- Honest list of things that are messy, risky, or wrong. -->

- [ ] _item_

---

## Architecture Decisions

<!-- Link to ADRs that explain WHY things are the way they are. -->

- See `ADR/` folder

---

## What Gemini Should Know Before Planning

<!-- Anything that would surprise a fresh agent. Gotchas, constraints, business rules. -->

-

---

_Last updated by Gemini: <!-- date -->_
