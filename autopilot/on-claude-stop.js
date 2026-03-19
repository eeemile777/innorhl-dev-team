/**
 * autopilot/on-claude-stop.js
 *
 * Claude Code hook: fires when a Claude session ends (Stop event).
 *
 * Reads the current PLAN.md state and:
 *   1. Writes .autopilot-state.json (source of truth — watcher reads this)
 *   2. Writes AGENT_STATUS.md (human-readable derived view — Gemini reads this)
 *
 * Configured in .claude/settings.json → hooks → Stop
 *
 * NOTE: readState/writeState are intentionally duplicated from watcher.js
 * to avoid introducing a shared module dependency between the two scripts.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const PLAN_FILE   = resolve(PROJECT_ROOT, 'PLAN.md');
const STATUS_FILE = resolve(PROJECT_ROOT, 'AGENT_STATUS.md');
const STATE_FILE  = resolve(PROJECT_ROOT, '.autopilot-state.json');

// ── JSON State helpers (duplicated from watcher.js intentionally) ─────────────

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

// ── PLAN.md task counting (regex stays here — NOT in watcher) ─────────────────

function countTasks(content) {
  const total = (content.match(/^- \[[ x]\]/gm) || []).length;
  const done  = (content.match(/^- \[x\]/gm) || []).length;
  return { total, done, remaining: total - done };
}

function hasBlockers(content) {
  const blockersSection = content.split('## Blockers')[1];
  if (!blockersSection) return false;
  const nextSection = blockersSection.split('##')[0];
  return nextSection.trim().replace(/<!--.*?-->/gs, '').trim().length > 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

try {
  let status    = 'complete';
  let detail    = 'Session ended.';
  let remaining = 0;
  let blocked   = false;

  if (existsSync(PLAN_FILE)) {
    const plan   = readFileSync(PLAN_FILE, 'utf8');
    const counts = countTasks(plan);
    remaining    = counts.remaining;
    blocked      = hasBlockers(plan);

    if (blocked) {
      status = 'blocked';
      detail = `${counts.done}/${counts.total} tasks done. Blockers present — Gemini review needed.`;
    } else if (remaining > 0) {
      status = 'partial';
      detail = `${counts.done}/${counts.total} tasks done. ${counts.remaining} remaining.`;
    } else {
      status = 'complete';
      detail = `All ${counts.total} tasks done. Gemini: please review output.`;
    }
  }

  // ── 1. Write JSON state FIRST (primary — watcher reads this) ─────────────
  writeState({
    status,
    remaining_tasks: remaining,
    blockers: blocked ? 'See PLAN.md ## Blockers section' : null,
  });

  // ── 2. Write AGENT_STATUS.md (secondary — human-readable for Gemini) ──────
  writeFileSync(STATUS_FILE, `# Agent Status
**Status**: ${status}
**Updated**: ${new Date().toISOString()}
**Detail**: ${detail}

---
_Written by Claude Code Stop hook. Gemini: read this to know Claude is done._
`);

  process.exit(0);
} catch (err) {
  console.error('on-claude-stop.js error:', err.message);
  process.exit(1);
}
