# Skill: Google Cloud Run Deployment

**Used by**: Claude Code (executor)
**When**: Gemini's deploy plan specifies Google Cloud Run as the target platform
**CLI**: `gcloud` (Google Cloud CLI) — add to permissions if not present

---

## Prerequisites Check (always run first)

```bash
gcloud auth list                    # confirms you're authenticated
gcloud config get-value project     # confirms active project
gcloud run services list            # lists existing services
```

If not authenticated → write Blocker: "GCloud not authenticated. User must run: `gcloud auth login && gcloud auth application-default login`"
If no project set → write Blocker: "No GCloud project set. User must run: `gcloud config set project PROJECT_ID`"

---

## Enable Required APIs (first deploy only)

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

These are idempotent — safe to run on every first deploy.

---

## First Deploy — Deploy from Source (simplest, no Dockerfile needed)

```bash
# Deploy directly from source code — Cloud Build handles the container
gcloud run deploy SERVICE_NAME \
  --source . \
  --region europe-west8 \
  --platform managed \
  --allow-unauthenticated \
  --project PROJECT_ID
```

**Region choices for InnoRHL** (EU-first, GDPR-friendly):
- `europe-west8` — Milan (closest to North Africa / EU clients)
- `europe-west1` — Belgium
- `us-central1` — US Central (fallback)

Ask Gemini which region to use — it should be in PROJECT_CONTEXT.md.

---

## First Deploy — With Dockerfile (full control)

```bash
# Build and push the container
gcloud builds submit --tag gcr.io/PROJECT_ID/SERVICE_NAME

# Deploy the container
gcloud run deploy SERVICE_NAME \
  --image gcr.io/PROJECT_ID/SERVICE_NAME \
  --region europe-west8 \
  --platform managed \
  --allow-unauthenticated
```

---

## Redeploy (existing service)

```bash
# Redeploy from source (most common)
gcloud run deploy SERVICE_NAME --source . --region europe-west8

# Or trigger via Cloud Build (if CI/CD configured)
git push origin main
```

---

## Environment Variables

```bash
# Set env vars on deploy
gcloud run deploy SERVICE_NAME \
  --source . \
  --region europe-west8 \
  --set-env-vars "KEY1=val1,KEY2=val2"

# Update env vars on existing service (no redeploy needed)
gcloud run services update SERVICE_NAME \
  --region europe-west8 \
  --set-env-vars "DATABASE_URL=postgresql://..."

# List current env vars
gcloud run services describe SERVICE_NAME \
  --region europe-west8 \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Rule**: NEVER put secrets in env vars as plain text in production. Use Google Secret Manager:
```bash
gcloud secrets create SECRET_NAME --data-file=./secret.txt
# Then reference in Cloud Run:
--set-secrets "ENV_VAR_NAME=SECRET_NAME:latest"
```

---

## Logs & Monitoring

```bash
# Stream live logs
gcloud run services logs tail SERVICE_NAME --region europe-west8

# Query recent logs
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME" \
  --limit 50 \
  --format "table(timestamp, textPayload)"

# Error logs only
gcloud logging read \
  "resource.type=cloud_run_revision AND severity>=ERROR" \
  --limit 20
```

---

## Traffic & Rollback

```bash
# List all revisions
gcloud run revisions list --service SERVICE_NAME --region europe-west8

# Rollback: send 100% traffic to previous revision
gcloud run services update-traffic SERVICE_NAME \
  --region europe-west8 \
  --to-revisions=PREVIOUS_REVISION_NAME=100

# Gradual rollout: split traffic (canary deploy)
gcloud run services update-traffic SERVICE_NAME \
  --region europe-west8 \
  --to-revisions=NEW_REVISION=20,OLD_REVISION=80
```

---

## Health Check After Deploy

After every deploy, Claude MUST verify:

```bash
# Get the service URL
SERVICE_URL=$(gcloud run services describe SERVICE_NAME \
  --region europe-west8 \
  --format="value(status.url)")

echo "Live at: $SERVICE_URL"

# Verify health
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/health")
echo "Health check: $HTTP_STATUS"
```

- If `200` → write to PLAN.md: "Deploy verified: $SERVICE_URL is live ✅"
- If not `200` → write Blocker: "Cloud Run health check failed — got $HTTP_STATUS. Check logs."

---

## Common Errors & Fixes

| Error | Fix |
|-------|-----|
| `Permission denied` | Run `gcloud auth login && gcloud auth application-default login` |
| `API not enabled` | Run `gcloud services enable run.googleapis.com` |
| `Container failed to start` | Check logs — usually missing env var or wrong PORT |
| `Quota exceeded` | Check billing in Google Cloud Console |
| `Build failed` | Check `gcloud builds list` for build logs |
| `No traffic served` | Check if revision is healthy: `gcloud run revisions list` |

---

## Port Binding Rule

Cloud Run injects `PORT` (default 8080). Your app MUST bind to it:

```javascript
const port = process.env.PORT || 8080;
app.listen(port);
```

```python
port = int(os.environ.get("PORT", 8080))
```

---

## After Successful Deploy — Update These Files

1. `PROJECT_CONTEXT.md` → add under `## Deployment`:
   ```
   Platform: Google Cloud Run
   Live URL: [service URL]
   Service name: [name]
   Project ID: [gcp project id]
   Region: [region]
   ```
2. `CODEBASE_INDEX.md` → update deployment section
3. Write to JOURNAL.md: "Deployed to Cloud Run: [url]"
