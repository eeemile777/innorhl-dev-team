/**
 * autopilot/watcher.js
 *
 * The bridge between Gemini and Claude Code.
 *
 * Watches .autopilot-state.json (primary) and PLAN.md (fallback) for changes.
 * Decision logic is 100% regex-free — all state is read from .autopilot-state.json.
 * Falls back to PLAN.md heuristics only when the JSON state file doesn't exist.
 *
 * State machine:
 *   idle       → no active plan, do nothing
 *   in_progress → spawn Claude (with git snapshot first)
 *   blocked    → log alert, do NOT spawn — Gemini must resolve
 *   complete   → do nothing
 *   partial    → do nothing (Gemini must re-initialize)
 *   error      → do nothing (human must intervene)
 *
 * Usage:
 *   cd autopilot && npm install && npm start
 */

import chokidar from 'chokidar';
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const PLAN_FILE   = resolve(PROJECT_ROOT, 'PLAN.md');
const STATUS_FILE = resolve(PROJECT_ROOT, 'AGENT_STATUS.md');
const STATE_FILE  = resolve(PROJECT_ROOT, '.autopilot-state.json');
const LOCK_FILE   = resolve(PROJECT_ROOT, '.autopilot.lock');

let claudeProcess = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ── JSON State (primary source of truth) ──────────────────────────────────────

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(patch) {
  const current = readState() || {
    status: 'idle',
    current_step: 0,
    total_steps: 0,
    remaining_tasks: 0,
    blockers: null,
  };
  const next = { ...current, ...patch, updated_at: new Date().toISOString() };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
}

// ── PLAN.md heuristics (fallback only — used when STATE_FILE doesn't exist) ───

function readPlan() {
  if (!existsSync(PLAN_FILE)) return null;
  return readFileSync(PLAN_FILE, 'utf8');
}

function hasUnfinishedTasks(planContent) {
  return /^- \[ \]/m.test(planContent);
}

function isPlanInProgress(planContent) {
  return planContent.includes('In Progress') || planContent.includes('in_progress');
}

// ── Lock ──────────────────────────────────────────────────────────────────────

function isLocked() {
  return existsSync(LOCK_FILE);
}

function lock() {
  writeFileSync(LOCK_FILE, new Date().toISOString());
}

function unlock() {
  try { execSync(`rm -f "${LOCK_FILE}"`); } catch {}
}

// ── Human-readable AGENT_STATUS.md (secondary, derived view) ─────────────────

function writeStatus(status, detail = '') {
  const content = `# Agent Status
**Status**: ${status}
**Updated**: ${new Date().toISOString()}
**Detail**: ${detail || 'N/A'}

---
_This file is written automatically by the autopilot watcher._
_Gemini: read this to know when Claude is done._
`;
  writeFileSync(STATUS_FILE, content);
  log(`Status → ${status}`);
}

// ─── Git Snapshot (safety net before every Claude run) ───────────────────────

function takeGitSnapshot() {
  try {
    execSync(
      'git add . && git commit -m "chore(autopilot): snapshot before claude execution" --no-verify',
      { cwd: PROJECT_ROOT, stdio: 'pipe' }
    );
    log('Git snapshot committed.');
  } catch (err) {
    // Non-fatal: nothing to commit, or not a git repo — execution continues
    log(`Git snapshot skipped: ${err.message.split('\n')[0]}`);
  }
}

// ─── Claude Code Launcher ─────────────────────────────────────────────────────

function launchClaude() {
  if (isLocked()) {
    log('Claude is already running — skipping duplicate trigger.');
    return;
  }

  // ── Primary path: read from JSON state ────────────────────────────────────
  const state = readState();

  if (!state) {
    // ── Fallback: no state file — use PLAN.md heuristics (backward compat) ──
    log('No .autopilot-state.json found — falling back to PLAN.md heuristics.');
    const plan = readPlan();
    if (!plan || !isPlanInProgress(plan) || !hasUnfinishedTasks(plan)) {
      log('Fallback: no active in-progress tasks in PLAN.md — nothing to do.');
      return;
    }
    log('Fallback: unfinished tasks detected via PLAN.md — launching Claude Code...');
    _spawnClaude();
    return;
  }

  // ── State machine ──────────────────────────────────────────────────────────
  switch (state.status) {
    case 'blocked':
      log('⚠️  Plan is BLOCKED — waiting for Gemini to resolve.');
      log('    Open Antigravity, describe the blocker, and ask Gemini to update PLAN.md + .autopilot-state.json.');
      return;

    case 'idle':
    case 'complete':
      log(`State is "${state.status}" — no active plan. Nothing to do.`);
      return;

    case 'error':
      log('State is "error" — human intervention required. Review PLAN.md and logs before retrying.');
      return;

    case 'partial':
      log('State is "partial" — session ended mid-execution. Ask Gemini to review and re-initialize the plan.');
      return;

    case 'in_progress':
      if (state.remaining_tasks <= 0) {
        log('State is "in_progress" but remaining_tasks is 0 — possible stale state. Skipping spawn.');
        return;
      }
      log(`State is "in_progress" — ${state.remaining_tasks} task(s) remaining. Launching Claude Code...`);
      _spawnClaude();
      return;

    default:
      log(`Unknown state "${state.status}" — skipping.`);
  }
}

function _spawnClaude() {
  lock();
  writeStatus('running', 'Claude Code is executing PLAN.md tasks');

  // Safety net: snapshot the repo state before Claude modifies anything
  takeGitSnapshot();

  claudeProcess = spawn('claude', [
    '--print',
    '--dangerously-skip-permissions',
    'Read PLAN.md and execute all unchecked tasks in order. Follow the instructions in CLAUDE.md.'
  ], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  claudeProcess.on('close', (code) => {
    unlock();
    claudeProcess = null;

    if (code === 0) {
      log('Claude Code finished successfully.');
      // NOTE: on-claude-stop.js hook is the sole writer of JSON state on success.
      // We only write the human-readable AGENT_STATUS.md here.
      writeStatus('complete', 'All tasks in PLAN.md have been executed. Gemini: please review.');
    } else {
      log(`Claude Code exited with code ${code}.`);
      // On non-zero exit, hook may not have fired — write state directly.
      writeState({ status: 'error', blockers: `Claude exited with code ${code}` });
      writeStatus('error', `Claude exited with code ${code}. Check PLAN.md Blockers section.`);
    }
  });

  claudeProcess.on('error', (err) => {
    unlock();
    log(`Failed to launch Claude Code: ${err.message}`);
    writeState({ status: 'error', blockers: `Failed to launch: ${err.message}` });
    writeStatus('error', `Failed to launch: ${err.message}`);
  });
}

// ─── Unified Change Handler ───────────────────────────────────────────────────

function handleStateChange(changedPath) {
  const label = changedPath === STATE_FILE ? '.autopilot-state.json' : 'PLAN.md';
  log(`${label} changed — evaluating state...`);

  if (isLocked()) {
    log('Claude is already running — will re-evaluate when session ends.');
    return;
  }

  launchClaude();
}

// ─── Watcher: watch BOTH files ────────────────────────────────────────────────

log('Autopilot watcher started.');
log(`Primary trigger : ${STATE_FILE}`);
log(`Fallback trigger: ${PLAN_FILE}`);
log('Waiting for Gemini to initialize .autopilot-state.json...\n');

const watcher = chokidar.watch([STATE_FILE, PLAN_FILE], {
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {
    stabilityThreshold: 1000,
    pollInterval: 200
  }
});

watcher.on('change', (changedPath) => handleStateChange(changedPath));
watcher.on('add',    (addedPath)   => handleStateChange(addedPath));

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  log('Shutting down autopilot watcher...');
  if (claudeProcess) claudeProcess.kill();
  unlock();
  process.exit(0);
});
