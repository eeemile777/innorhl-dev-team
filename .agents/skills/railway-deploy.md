# Skill: Railway Deployment

**Used by**: Claude Code (executor)
**When**: Gemini's deploy plan specifies Railway as the target platform
**CLI**: `railway` (Railway CLI) — already in permissions

---

## Prerequisites Check (always run first)

```bash
railway whoami          # confirms you're logged in
railway status          # confirms project link
```

If `railway whoami` fails → write to PLAN.md Blockers: "Railway not authenticated. User must run: `railway login`"
If `railway status` shows no project → run `railway link` or `railway init` (first deploy only)

---

## First Deploy (new project, never deployed before)

```bash
# 1. Login (user must do this once — ask them to run it)
railway login

# 2. Initialize and link to a Railway project
railway init            # creates new Railway project
# OR link to existing:
railway link            # select from list of existing projects

# 3. Set environment variables from .env.example
# NEVER set secrets directly in terminal — use Railway dashboard or:
railway variables set KEY=value   # for non-secret config

# 4. Deploy
railway up              # deploys current directory

# 5. Get the live URL
railway domain          # shows assigned domain
# OR set a custom domain in Railway dashboard
```

---

## Redeploy (existing project)

```bash
# Option A: direct deploy from local
railway up

# Option B: trigger via git push (if GitHub is linked)
git push origin main    # Railway auto-deploys on push if configured
```

---

## Environment Variables

```bash
# List all vars
railway variables

# Set a variable
railway variables set DATABASE_URL="postgresql://..."

# Set multiple from .env file
railway variables set --file .env.production
```

**Rule**: NEVER commit `.env` files. NEVER hardcode secrets. Always use `railway variables set`.

---

## Logs & Monitoring

```bash
# Stream live logs
railway logs --follow

# Last 100 lines
railway logs -n 100

# Logs for a specific service
railway logs --service api
```

---

## Rollback

```bash
# List recent deployments
railway deployments

# Rollback to previous deployment
railway rollback
# Railway will ask you to confirm the target deployment
```

---

## Health Check After Deploy

After every deploy, Claude MUST verify the app is actually running:

```bash
# Get the public URL
DOMAIN=$(railway domain 2>/dev/null | grep -oP 'https?://[^\s]+' | head -1)

# Hit the health endpoint
curl -s -o /dev/null -w "%{http_code}" "$DOMAIN/health"
# OR just the root
curl -s -o /dev/null -w "%{http_code}" "$DOMAIN"
```

- If response is `200` → write to PLAN.md: "Deploy verified: $DOMAIN is live ✅"
- If response is not `200` → write Blocker: "Deploy health check failed — got [status]. Check Railway logs."

---

## Common Errors & Fixes

| Error | Fix |
|-------|-----|
| `Error: Not logged in` | Run `railway login` |
| `Error: No project linked` | Run `railway link` or `railway init` |
| `Build failed` | Check `railway logs` — usually missing env var or build script |
| `Port not found` | App must listen on `process.env.PORT` — Railway injects this |
| `Deployment crashed` | `railway logs --follow` immediately after deploy |
| `Out of memory` | Upgrade plan in Railway dashboard or optimize app |

---

## Port Binding Rule

Railway injects `PORT` automatically. Your app MUST bind to it:

```javascript
// Node.js
const port = process.env.PORT || 3000;
app.listen(port);

// Python
port = int(os.environ.get("PORT", 8080))
```

If the app hardcodes a port → write to Blockers: "App hardcodes port [X]. Must use process.env.PORT for Railway."

---

## After Successful Deploy — Update These Files

1. `PROJECT_CONTEXT.md` → add under `## Deployment`:
   ```
   Platform: Railway
   Live URL: [url]
   Service name: [name]
   Region: [region]
   ```
2. `CODEBASE_INDEX.md` → update deployment section
3. Write to JOURNAL.md end-of-session: "Deployed to Railway: [url]"
