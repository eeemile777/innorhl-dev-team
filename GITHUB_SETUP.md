# GitHub Setup & Usage

## One-Time Setup (do this once, never again)

### 1. Accept Xcode license (if git is blocked)
```bash
sudo xcodebuild -license accept
```

### 2. Push the template to GitHub
```bash
cd ~/Desktop/GOD_template
git init
git add .
git commit -m "feat: InnoRHL dev team template — complete"
gh repo create innorhl-dev-team --public --source=. --push
```

### 3. Mark it as a template on GitHub
Go to: `github.com/your-username/innorhl-dev-team`
→ **Settings** → scroll down → check **"Template repository"** → Save

---

## Every Future Project

### New project from scratch
```bash
gh repo create my-new-app --template your-username/innorhl-dev-team --private
```

### Existing project (already has a repo)
```bash
cd your-existing-project
npx degit your-username/innorhl-dev-team --force
```

---

## After Cloning — First Thing To Do

```bash
cd your-project
cp .env.example .env       # fill in your tokens
cd autopilot && npm install && cd ..
```

Then open Antigravity (Gemini) and say:
> "Let's onboard this codebase" — for existing projects
> "I want to build [your idea]" — for new projects

Gemini takes it from there.
