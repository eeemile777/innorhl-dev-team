/**
 * Integration tests for on-claude-stop.cjs
 *
 * Spawns the hook as a child process with controlled CWD, env, and filesystem
 * to verify every status transition path.
 *
 * Uses Node.js built-in node:test and node:assert — no external frameworks.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const HOOK_PATH = path.resolve(__dirname, '../../core-template/on-claude-stop.cjs');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writePlan(dir, content) {
  fs.writeFileSync(path.join(dir, 'PLAN.md'), content, 'utf8');
}

function writeState(dir, state) {
  fs.writeFileSync(
    path.join(dir, '.autopilot-state.json'),
    JSON.stringify(state, null, 2),
    'utf8',
  );
}

function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.autopilot-state.json'), 'utf8'));
}

function writeInbox(dir, content, mtimeMs) {
  const p = path.join(dir, 'GEMINI_INBOX.md');
  fs.writeFileSync(p, content, 'utf8');
  if (mtimeMs !== undefined) {
    const t = new Date(mtimeMs);
    fs.utimesSync(p, t, t);
  }
}

function runHook(cwd, env = {}) {
  return execFileSync(process.execPath, [HOOK_PATH], {
    cwd,
    env: { ...process.env, ...env },
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('on-claude-stop.cjs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // 1. All tasks done → "completed"
  it('sets status to "completed" when all tasks are done', () => {
    writePlan(tmpDir, [
      '# Plan',
      '## Tasks',
      '- [x] T1',
      '- [x] T2',
    ].join('\n'));
    writeState(tmpDir, { status: 'in_progress', completed_tasks: 1 });

    runHook(tmpDir);
    const state = readState(tmpDir);

    assert.equal(state.status, 'completed');
    assert.equal(state.total_tasks, 2);
    assert.equal(state.completed_tasks, 2);
    assert.equal(state.remaining_tasks, 0);
  });

  // 2. Tasks remaining → "needs_restart"
  it('sets status to "needs_restart" when tasks remain', () => {
    writePlan(tmpDir, [
      '# Plan',
      '## Tasks',
      '- [x] T1',
      '- [ ] T2',
    ].join('\n'));
    writeState(tmpDir, { status: 'in_progress', completed_tasks: 0 });

    runHook(tmpDir);
    const state = readState(tmpDir);

    assert.equal(state.status, 'needs_restart');
    assert.equal(state.remaining_tasks, 1);
    assert.equal(state.completed_tasks, 1);
    assert.equal(state.total_tasks, 2);
  });

  // 3. Blockers section with real content → "blocked"
  it('sets status to "blocked" when Blockers section has content', () => {
    writePlan(tmpDir, [
      '# Plan',
      '## Tasks',
      '- [x] T1',
      '- [ ] T2',
      '## Blockers',
      'Cannot proceed because the API key is invalid and needs rotation.',
    ].join('\n'));
    writeState(tmpDir, { status: 'in_progress', completed_tasks: 0 });

    runHook(tmpDir);
    const state = readState(tmpDir);

    assert.equal(state.status, 'blocked');
    assert.ok(state.blocker_reason, 'Expected blocker_reason to be set');
    assert.ok(
      state.blocker_reason.includes('API key'),
      `Expected blocker_reason to contain "API key", got: ${state.blocker_reason}`,
    );
  });

  // 4. GEMINI_INBOX.md written → "waiting_for_gemini" (priority over blockers)
  it('sets status to "waiting_for_gemini" when GEMINI_INBOX.md is newer than last_claude_start', () => {
    const claudeStart = new Date('2025-01-01T00:00:00Z').toISOString();
    const inboxMtime = new Date('2025-06-01T00:00:00Z').getTime();

    writePlan(tmpDir, [
      '# Plan',
      '## Tasks',
      '- [x] T1',
      '- [ ] T2',
      '## Blockers',
      'This blocker should be ignored because GEMINI_INBOX takes priority.',
    ].join('\n'));
    writeState(tmpDir, {
      status: 'in_progress',
      completed_tasks: 0,
      last_claude_start: claudeStart,
    });
    writeInbox(tmpDir, '## My Question\nWhat should I do?', inboxMtime);

    runHook(tmpDir);
    const state = readState(tmpDir);

    assert.equal(state.status, 'waiting_for_gemini');
    // Must NOT be "blocked" even though Blockers section exists
    assert.notEqual(state.status, 'blocked');
  });

  // 5. Idle state → exit early, no changes
  it('does not modify state when status is "idle"', () => {
    writePlan(tmpDir, [
      '# Plan',
      '## Tasks',
      '- [ ] T1',
    ].join('\n'));
    const original = {
      status: 'idle',
      completed_tasks: 0,
      some_field: 'untouched',
    };
    writeState(tmpDir, original);

    runHook(tmpDir);
    const state = readState(tmpDir);

    assert.equal(state.status, 'idle');
    assert.equal(state.some_field, 'untouched');
    // The file should be byte-identical (no updated_at added)
    assert.equal(state.updated_at, undefined);
  });

  // 6. No PLAN.md → still writes state (does not crash)
  it('writes state without crashing when no PLAN.md exists', () => {
    writeState(tmpDir, { status: 'in_progress', completed_tasks: 0 });
    // No PLAN.md written

    runHook(tmpDir);
    const state = readState(tmpDir);

    // Should not crash and should write some status
    assert.ok(state.status, 'Expected a status to be set');
    assert.ok(state.updated_at, 'Expected updated_at to be set');
    // With 0 total and 0 remaining, remaining===0 && total===0 → "idle" path
    // (remaining > 0 is false, remaining === 0 && total > 0 is false → falls to idle)
    assert.equal(state.total_tasks, 0);
  });

  // 7. Circuit breaker — stuck loop
  it('triggers circuit breaker when stuck with no progress across runs', () => {
    writePlan(tmpDir, [
      '# Plan',
      '## Tasks',
      '- [x] T1',
      '- [x] T2',
      '- [ ] T3',
      '- [ ] T4',
    ].join('\n'));
    writeState(tmpDir, {
      status: 'in_progress',
      completed_tasks: 2,        // same as current done count → no progress
      retry_count: 4,            // already retried 4 times
      progress_history: [2, 2, 2, 2],  // last 4 values all identical
    });

    runHook(tmpDir);
    const state = readState(tmpDir);

    assert.equal(state.status, 'blocked');
    assert.ok(state.blocker_reason, 'Expected blocker_reason for circuit breaker');
    assert.ok(
      state.blocker_reason.toLowerCase().includes('stuck') ||
      state.blocker_reason.toLowerCase().includes('loop') ||
      state.blocker_reason.toLowerCase().includes('progress'),
      `Expected circuit breaker message, got: ${state.blocker_reason}`,
    );
  });

  // 8. SESSION_ID env var — reads/writes from sessions/{SESSION_ID}/ subdir
  it('uses sessions/{SESSION_ID}/ subdir when SESSION_ID env var is set', () => {
    const sessionId = 'test-session-42';
    const sessionDir = path.join(tmpDir, 'sessions', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    writePlan(sessionDir, [
      '# Plan',
      '## Tasks',
      '- [x] T1',
      '- [x] T2',
    ].join('\n'));
    writeState(sessionDir, { status: 'in_progress', completed_tasks: 1 });

    // Run with CWD = tmpDir (not sessionDir), SESSION_ID set
    runHook(tmpDir, { SESSION_ID: sessionId });

    // State should be written inside the session subdir, NOT in tmpDir root
    assert.ok(
      fs.existsSync(path.join(sessionDir, '.autopilot-state.json')),
      'Expected state file in session subdir',
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.autopilot-state.json'))
        || JSON.parse(fs.readFileSync(path.join(tmpDir, '.autopilot-state.json'), 'utf8')).status === 'in_progress',
      'Root state should not have been modified',
    );

    const state = readState(sessionDir);
    assert.equal(state.status, 'completed');
    assert.equal(state.total_tasks, 2);
    assert.equal(state.completed_tasks, 2);
  });

  // 9. AUTOPILOT_DIR env var — reads/writes from specified dir, not CWD
  it('uses AUTOPILOT_DIR when set, ignoring CWD', () => {
    // Create a separate autopilot dir (simulates .projects/{id}/ data dir)
    const autopilotDir = makeTempDir();

    writePlan(autopilotDir, [
      '# Plan',
      '## Tasks',
      '- [x] T1',
      '- [ ] T2',
    ].join('\n'));
    writeState(autopilotDir, { status: 'in_progress', completed_tasks: 0 });

    // Run from CWD = tmpDir (different from autopilotDir)
    // AUTOPILOT_DIR tells the hook where control files actually are
    runHook(tmpDir, { AUTOPILOT_DIR: autopilotDir });

    // State should be in autopilotDir, NOT in tmpDir
    const state = readState(autopilotDir);
    assert.equal(state.status, 'needs_restart');
    assert.equal(state.remaining_tasks, 1);

    // tmpDir should have no state file
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.autopilot-state.json')),
      'CWD should not have state file — AUTOPILOT_DIR should be used instead',
    );

    cleanDir(autopilotDir);
  });

  // 10. Zero-task PLAN.md → blocks instead of going idle
  it('blocks when PLAN.md exists but has zero parseable tasks', () => {
    writePlan(tmpDir, [
      '# Plan',
      '## Context',
      'Some context here',
      '## Tasks',
      'No actual checkbox tasks here, just text',
      '## Blockers',
    ].join('\n'));
    writeState(tmpDir, { status: 'in_progress', completed_tasks: 0 });

    runHook(tmpDir);
    const state = readState(tmpDir);

    assert.equal(state.status, 'blocked');
    assert.ok(state.blocker_reason, 'Expected blocker_reason for zero tasks');
    assert.ok(
      state.blocker_reason.includes('no parseable tasks'),
      `Expected zero-task message, got: ${state.blocker_reason}`,
    );
  });
});
