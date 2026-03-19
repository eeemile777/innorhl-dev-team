# Workflow: Deploy to Production

**Trigger**: User says "deploy", "go live", "push to production", "ship it", or Claude finishes a build phase
**Lead**: Gemini (decides platform, writes plan) → Claude (executes deploy)
**Goal**: Get the app from "built and tested locally" to "live on the internet, verified, monitored"

---

## Step 1 — Ask the User (Gemini)

Before writing any plan, ask ONE question:

> "Where do you want to deploy?
> - **Railway** — simpler, great for Node/Python apps, you're already using this for Mshkltk
> - **Google Cloud Run** — more powerful, scales to zero, better for EU clients and future migration
>
> Also — is this the **first deploy** of this project, or a **redeploy** of something already live?"

Wait for the answer. Do not assume.

**If the user already has a preference in `PROJECT_CONTEXT.md → ## Deployment`** — use that and skip the question. Just confirm: "I'll deploy to [platform] — same as before. Good?"

---

## Step 2 — Pre-Deploy Checklist (Gemini verifies before writing plan)

Before writing PLAN.md, check these in the codebase (use GitNexus or read key files):

### Must-pass before deploy:
- [ ] `npm run build` or equivalent — does it compile without errors?
- [ ] `npm test` — do all tests pass?
- [ ] `.env.example` exists — are all required env vars documented?
- [ ] No hardcoded secrets in code (`grep -r "sk-" .` etc.)
- [ ] Health endpoint exists (`/health` or `/api/health`) — Cloud Run and Railway need this
- [ ] App binds to `process.env.PORT` — not a hardcoded port
- [ ] `package.json` has a `start` script (for Railway/Cloud Run to know how to run the app)

**If any of these fail** — write it in PLAN.md as a pre-deploy fix task BEFORE the deploy tasks. Claude fixes it first, then deploys.

---

## Step 3 — Write the Deploy Plan (Gemini → PLAN.md)

### For Railway:

```markdown
# Plan: Deploy [App Name] to Railway

## Context
[What's being deployed, first deploy or redeploy, any notes]

## Architecture Decisions
- Platform: Railway
- Region: [Railway auto-selects, or specify]
- Service name: [name]

## Tasks
- [ ] T1: Verify prerequisites (railway whoami, railway status) — skill: railway-deploy.md
- [ ] T2: [First deploy only] Run railway init / railway link
- [ ] T3: Set all environment variables from .env.example on Railway
- [ ] T4: Run railway up — deploy the app
- [ ] T5: Run health check — verify live URL returns 200
- [ ] T6: Update PROJECT_CONTEXT.md with live URL and platform info
- [ ] T7: Write deploy entry in JOURNAL.md

## Rollback Plan
If T4 or T5 fails: run `railway rollback` immediately, then write Blocker.
```

### For Google Cloud Run:

```markdown
# Plan: Deploy [App Name] to Google Cloud Run

## Context
[What's being deployed, GCP project ID, region, first deploy or redeploy]

## Architecture Decisions
- Platform: Google Cloud Run
- Region: europe-west8 (Milan) [or as specified]
- GCP Project ID: [project id]
- Service name: [name]
- Deploy method: source (no Dockerfile needed) [or: Dockerfile]

## Tasks
- [ ] T1: Verify prerequisites (gcloud auth list, gcloud config get-value project)
- [ ] T2: [First deploy only] Enable required GCP APIs (run, cloudbuild, containerregistry)
- [ ] T3: Set environment variables via --set-env-vars or Secret Manager for sensitive values
- [ ] T4: Run gcloud run deploy --source . — deploy the app
- [ ] T5: Run health check — verify live URL returns 200
- [ ] T6: Update PROJECT_CONTEXT.md with live URL, service name, GCP project ID
- [ ] T7: Write deploy entry in JOURNAL.md

## Rollback Plan
If T4 or T5 fails: run gcloud run services update-traffic --to-revisions=PREV=100, then write Blocker.
```

---

## Step 4 — Claude Executes (uses the skill)

Claude reads the PLAN.md deploy tasks and uses the appropriate skill:
- Railway deploy → `.agents/skills/railway-deploy.md`
- Cloud Run deploy → `.agents/skills/cloudrun-deploy.md`

**Claude must always run the health check (T5).** A deploy that hasn't been verified is not a deploy.

---

## Step 5 — Post-Deploy (Gemini reports back)

After Claude completes and writes to JOURNAL.md, Gemini reads it and tells the user:

> "✅ [App name] is live.
>
> **URL**: [live url]
> **Platform**: [Railway / Google Cloud Run]
> **Health**: 200 OK
>
> Sentry is monitoring errors. Railway/Cloud Run logs are accessible via CLI.
>
> What do you want to build or fix next?"

---

## Monitoring After Deploy

Gemini should remind the user about these after every first deploy:

| What | How |
|------|-----|
| Error tracking | Sentry — already set up in scaffold (T8 of new-project.md) |
| Live logs | `railway logs --follow` or `gcloud run services logs tail SERVICE` |
| Uptime | Railway dashboard / Google Cloud Console |
| Performance | Cloud Run metrics in GCP Console, or Railway metrics dashboard |
| Rollback | `railway rollback` or `gcloud run services update-traffic --to-revisions=PREV=100` |

---

## Migration: Railway → Google Cloud Run

When the user says "I want to move from Railway to Google Cloud":

1. **Do NOT tear down Railway first** — keep it live until Cloud Run is verified
2. Deploy to Cloud Run as a parallel service (same code, different platform)
3. Verify Cloud Run health check passes
4. Update DNS / custom domain to point to Cloud Run URL
5. Monitor for 24–48 hours — watch Sentry for new errors
6. Only then: shut down Railway service
7. Update `PROJECT_CONTEXT.md` to reflect new platform

> This is a zero-downtime migration. Never cut over before the new platform is verified live.

---

## When to Run This Workflow

| Trigger | Action |
|---------|--------|
| User says "deploy" or "go live" | Full workflow — ask platform, pre-check, plan, execute |
| Claude finishes a feature phase | Gemini suggests: "Build is done — want me to deploy this?" |
| User says "push the update" | Redeploy only — skip platform question, use existing platform |
| User says "roll back" | Skip to rollback steps — no pre-check needed |
| User says "migrate to Cloud Run" | Use the migration section above |
