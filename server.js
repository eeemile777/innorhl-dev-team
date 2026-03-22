/**
 * InnoRHL Dev Dashboard — Multi-Project + Multi-Session Control Room
 *
 * Features:
 * - Multi-project registry with per-project state
 * - Multi-session support: N Gemini PTY sessions per project, each in its own worktree
 * - File watching per project and per session (autopilot state, PLAN.md, JOURNAL.md)
 * - Split-screen terminal layout for parallel sessions
 * - Real-time activity feed across all projects and sessions
 * - Password auth
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import chokidar from 'chokidar';
import pty from 'node-pty-prebuilt-multiarch';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, symlinkSync, unlinkSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync, exec, spawn } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_TEAM_ROOT      = __dirname;
const INNORHL_ROOT       = resolve(__dirname, '..'); // /Users/milo/Desktop/InnoRHL
const PROJECTS_ROOT      = resolve(INNORHL_ROOT, 'projects'); // where cloned projects live
const PORT               = process.env.DASHBOARD_PORT || 3001;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;
if (!DASHBOARD_PASSWORD) {
  console.error('  ❌ DASHBOARD_PASSWORD env var is required. Set it in .env');
  process.exit(1);
}
const PROJECTS_FILE      = resolve(DEV_TEAM_ROOT, 'projects.json');
const PROJECTS_DATA_DIR  = resolve(DEV_TEAM_ROOT, '.projects');
const SESSIONS_DIR       = resolve(DEV_TEAM_ROOT, 'sessions'); // legacy / dev-team's own sessions

// ─── Autopilot Constants ─────────────────────────────────────────────────────
const AUTOPILOT_COOLDOWN_MS     = 5000;     // 5s minimum between Claude restarts
const AUTOPILOT_MAX_RETRIES     = 10;       // max consecutive restarts without progress
const AUTOPILOT_MAX_RUNTIME_MS  = 600000;   // 10min max per Claude run
const activeClaudeProcesses     = new Map(); // sessionKey → { process, startTime, projectId }
const autopilotLocks            = new Set(); // sessionKeys currently being handled

// Ensure projects root exists
if (!existsSync(PROJECTS_ROOT)) mkdirSync(PROJECTS_ROOT, { recursive: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeRead(path) {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null; } catch { return null; }
}

function safeJSON(path) {
  try { const t = safeRead(path); return t ? JSON.parse(t) : null; } catch { return null; }
}

function parseTasks(planContent) {
  if (!planContent) return [];
  const tasksSection = planContent.split('## Tasks')[1];
  if (!tasksSection) return [];
  const tasksOnly = tasksSection.split('##')[0];
  return tasksOnly.split('\n')
    .filter(l => /^- \[[ x]\]/.test(l))
    .map(l => ({
      done: l.startsWith('- [x]'),
      text: l.replace(/^- \[[ x]\]\s*/, '').replace(/\*\*/g, '').trim()
    }));
}

function parseJournalLatest(journalContent) {
  if (!journalContent) return null;
  const match = journalContent.match(/## Session: (.+?)\n([\s\S]*?)(?=## Session:|$)/);
  if (!match) return null;
  return { date: match[1].trim(), content: match[2].trim().slice(0, 500) };
}

function parseJournalEntries(journalContent) {
  if (!journalContent) return [];
  const matches = [...journalContent.matchAll(/## Session: (.+?)\n([\s\S]*?)(?=## Session:|$)/g)];
  return matches.map(m => ({
    date: m[1].trim(),
    content: m[2].trim().slice(0, 800),
  })).reverse(); // most recent first
}

function getPlanContext(planContent) {
  if (!planContent) return null;
  const ctxMatch = planContent.match(/## Context\n([\s\S]*?)(?=\n---|\n##)/);
  return ctxMatch ? ctxMatch[1].trim().slice(0, 300) : null;
}

function stripAnsi(str) {
  return str
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[\(\)][A-Z0-9]/g, '')
    .replace(/\x1B[>=]/g, '')
    .replace(/\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '')
    .replace(/\x1B[^[\]()>=]/g, '')
    .replace(/\x1B/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x00/g, '');
}

function findGeminiPath() {
  const envPath = process.env.GEMINI_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  try { return execSync('which gemini', { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

const GEMINI_PATH = findGeminiPath();

// ─── Project Registry ────────────────────────────────────────────────────────

if (!existsSync(PROJECTS_DATA_DIR)) mkdirSync(PROJECTS_DATA_DIR, { recursive: true });
if (!existsSync(SESSIONS_DIR))      mkdirSync(SESSIONS_DIR, { recursive: true });

function loadProjects() {
  const projects = safeJSON(PROJECTS_FILE);
  if (!projects || !Array.isArray(projects)) {
    const defaults = [{
      id: 'innorhl', name: 'InnoRHL', path: DEV_TEAM_ROOT,
      description: 'The dev-team system itself', createdAt: new Date().toISOString()
    }];
    writeFileSync(PROJECTS_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return projects;
}

function saveProjects(projects) {
  writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

function getProjectDataDir(projectId) {
  const dir = resolve(PROJECTS_DATA_DIR, projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getProjectFiles(project) {
  if (project.id === 'innorhl') {
    return {
      state:   resolve(DEV_TEAM_ROOT, '.autopilot-state.json'),
      plan:    resolve(DEV_TEAM_ROOT, 'PLAN.md'),
      journal: resolve(DEV_TEAM_ROOT, 'JOURNAL.md'),
      bugs:    resolve(DEV_TEAM_ROOT, 'KNOWN_BUGS.md'),
      gitnexus: resolve(DEV_TEAM_ROOT, '.gitnexus/meta.json'),
    };
  }
  const dataDir = getProjectDataDir(project.id);
  return {
    state:   resolve(dataDir, '.autopilot-state.json'),
    plan:    resolve(dataDir, 'PLAN.md'),
    journal: resolve(dataDir, 'JOURNAL.md'),
    bugs:    resolve(dataDir, 'KNOWN_BUGS.md'),
    gitnexus: resolve(project.path || dataDir, '.gitnexus/meta.json'),
  };
}

function getProjectState(project) {
  const files   = getProjectFiles(project);
  const state   = safeJSON(files.state);
  const plan    = safeRead(files.plan);
  const journal = safeRead(files.journal);
  const gnMeta  = safeJSON(files.gitnexus);
  const tasks   = parseTasks(plan);
  const done    = tasks. filter(t => t.done).length;
  return {
    id: project.id, name: project.name, path: project.path, description: project.description,
    autopilot: state || { status: 'idle', remaining_tasks: 0 },
    tasks, done, total: tasks.length,
    journal: parseJournalLatest(journal),
    planContext: getPlanContext(plan),
    gitnexus: gnMeta || null,
  };
}

// ─── Session Management ──────────────────────────────────────────────────────

// Get the sessions directory for a project (per-project isolation)
function getProjectSessionsDir(projectId) {
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (project?.path) return resolve(project.path, 'sessions');
  return SESSIONS_DIR; // fallback to dev-team sessions
}

// Session map: sessionId → projectId (so we can find the right dir)
const sessionProjectMap = new Map();

function getSessionDir(sessionId, projectId) {
  // If projectId given, use that project's sessions dir
  if (projectId) return resolve(getProjectSessionsDir(projectId), sessionId);
  // If we have it in the map, use that
  const knownProjectId = sessionProjectMap.get(sessionId);
  if (knownProjectId) return resolve(getProjectSessionsDir(knownProjectId), sessionId);
  // Fallback: check dev-team sessions
  return resolve(SESSIONS_DIR, sessionId);
}

function createSessionDir(sessionId, sessionName, projectId) {
  sessionProjectMap.set(sessionId, projectId);
  const sessionsDir = projectId ? getProjectSessionsDir(projectId) : SESSIONS_DIR;
  mkdirSync(sessionsDir, { recursive: true });
  const dir = resolve(sessionsDir, sessionId);
  mkdirSync(dir, { recursive: true });

  const planPath = resolve(dir, 'PLAN.md');
  if (!existsSync(planPath)) {
    writeFileSync(planPath, `# Plan: ${sessionName}

## Context
<!-- Describe what this session is trying to achieve -->

## Architecture Decisions
<!-- Key technical decisions made during planning -->

## Tasks
- [ ] Task 1

## Blockers
<!-- Claude writes here if stuck -->

## Test Criteria
<!-- How to verify success -->
`);
  }

  const statePath = resolve(dir, '.autopilot-state.json');
  if (!existsSync(statePath)) {
    writeFileSync(statePath, JSON.stringify({
      status: 'idle',
      session_name: sessionName,
      remaining_tasks: 0,
      blockers: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, null, 2));
  }
  return dir;
}

function listAllSessions(projectId) {
  const sessionsDir = projectId ? getProjectSessionsDir(projectId) : SESSIONS_DIR;
  if (!existsSync(sessionsDir)) return [];
  try {
    return readdirSync(sessionsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        const sessionId = d.name;
        const dir   = resolve(sessionsDir, sessionId);
        const state = safeJSON(resolve(dir, '.autopilot-state.json'));
        const plan  = safeRead(resolve(dir, 'PLAN.md'));
        const tasks = parseTasks(plan);
        const done  = tasks.filter(t => t.done).length;
        const journal  = safeRead(resolve(dir, 'JOURNAL.md'));
        const entries  = parseJournalEntries(journal);
        return {
          sessionId,
          name: state?.session_name || sessionId,
          status: state?.status || 'idle',
          remaining: state?.remaining_tasks || 0,
          done, total: tasks.length,
          tasks,
          journalEntries: entries,
          createdAt: state?.created_at || null,
          updatedAt: state?.updated_at || null,
        };
      })
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } catch { return []; }
}

function getSessionState(sessionId) {
  const dir   = getSessionDir(sessionId);
  const state = safeJSON(resolve(dir, '.autopilot-state.json'));
  const plan  = safeRead(resolve(dir, 'PLAN.md'));
  const tasks = parseTasks(plan);
  const done  = tasks.filter(t => t.done).length;
  return {
    sessionId,
    name: state?.session_name || sessionId,
    autopilot: state || { status: 'idle' },
    tasks, done, total: tasks.length,
    planContext: getPlanContext(plan),
  };
}

// ─── Usage Tracking ──────────────────────────────────────────────────────────

function getUsageFile(projectId) {
  return resolve(getProjectDataDir(projectId), 'usage.json');
}

function loadUsageData(projectId) {
  return safeJSON(getUsageFile(projectId)) || { sessions: [] };
}

function saveUsageData(projectId, data) {
  try { writeFileSync(getUsageFile(projectId), JSON.stringify(data, null, 2)); } catch {}
}

function recordSessionStart(projectId) {
  const data = loadUsageData(projectId);
  data._pendingStart = new Date().toISOString();
  saveUsageData(projectId, data);
}

function recordSessionEnd(projectId, projectName, endStatus) {
  const data = loadUsageData(projectId);
  const start = data._pendingStart ? new Date(data._pendingStart) : new Date();
  const durationMin = Math.max(1, Math.round((Date.now() - start.getTime()) / 1000 / 60));
  delete data._pendingStart;
  if (!data.sessions) data.sessions = [];
  data.sessions.push({ start: start.toISOString(), end: new Date().toISOString(), durationMin, endStatus });
  if (data.sessions.length > 200) data.sessions = data.sessions.slice(-200);
  saveUsageData(projectId, data);
}

function getUsageStats(projectId) {
  const data    = loadUsageData(projectId);
  const sessions = data.sessions || [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const todaySess  = sessions.filter(s => new Date(s.start) >= todayStart);
  const weekSess   = sessions.filter(s => new Date(s.start) >= weekStart);
  const sum = (arr) => arr.reduce((a, b) => a + (b.durationMin || 0), 0);
  return {
    today: { count: todaySess.length, minutes: sum(todaySess) },
    week:  { count: weekSess.length,  minutes: sum(weekSess) },
    total: { count: sessions.length,  minutes: sum(sessions) },
    recent: sessions.slice(-30).reverse(),
  };
}

// ─── Agent Conversation Parser ────────────────────────────────────────────────

function parseAgentConversationFromFiles(planContent, journalContent) {
  const messages = [];

  if (planContent) {
    const titleMatch   = planContent.match(/^# Plan: (.+)/m);
    const title        = titleMatch ? titleMatch[1].trim() : 'Active Plan';
    const contextMatch = planContent.match(/## Context\n([\s\S]*?)(?=\n##)/);
    const archMatch    = planContent.match(/## Architecture Decisions\n([\s\S]*?)(?=\n##|$)/);
    const tasksSection = planContent.split('## Tasks')[1];
    const tasksOnly    = tasksSection ? tasksSection.split('##')[0] : '';
    const totalTasks   = (tasksOnly.match(/^- \[[ x]\]/gm) || []).length;
    const doneTasks    = (tasksOnly.match(/^- \[x\]/gm) || []).length;

    messages.push({
      agent: 'gemini', type: 'plan', title,
      context:      contextMatch ? contextMatch[1].trim().slice(0, 500) : null,
      architecture: archMatch    ? archMatch[1].trim().slice(0, 400) : null,
      totalTasks, doneTasks,
    });

    const blockersMatch = planContent.match(/## Blockers\n([\s\S]*?)(?=\n##|$)/);
    if (blockersMatch) {
      const raw = blockersMatch[1]
        .replace(/<!--.*?-->/gs, '').replace(/^_.*_$/gm, '').replace(/^---$/gm, '').trim();
      if (raw.length > 3) {
        messages.push({ agent: 'claude', type: 'blocker', content: raw.slice(0, 600) });
      }
    }
  }

  if (journalContent) {
    const sessionRegex = /## Session: (.+?)\n([\s\S]*?)(?=## Session:|$)/g;
    let m;
    while ((m = sessionRegex.exec(journalContent)) !== null) {
      const date = m[1].trim();
      const raw  = m[2].trim();
      const statusMatch = raw.match(/\*\*Status\*\*:\s*(.+)/);
      const tasksMatch  = raw.match(/\*\*Tasks completed\*\*:\s*(.+)/);
      const body = raw.replace(/\*\*[^*]+\*\*:.+\n?/g, '').trim();
      messages.push({
        agent: 'claude', type: 'session-report', date,
        status: statusMatch ? statusMatch[1].trim() : null,
        tasksCompleted: tasksMatch ? tasksMatch[1].trim() : null,
        content: body.slice(0, 600),
      });
    }
  }

  return messages;
}

function parseAgentConversation(project) {
  const files = getProjectFiles(project);
  return parseAgentConversationFromFiles(safeRead(files.plan), safeRead(files.journal));
}

function parseSessionConversation(sessionId) {
  const dir = getSessionDir(sessionId);
  const plan    = safeRead(resolve(dir, 'PLAN.md'));
  const journal = safeRead(resolve(dir, 'JOURNAL.md'));
  return parseAgentConversationFromFiles(plan, journal);
}

// ─── Activity Feed ───────────────────────────────────────────────────────────

const activityLog = [];
const MAX_ACTIVITY = 200;

function addActivity(projectId, projectName, level, text) {
  const entry = { time: new Date().toISOString(), projectId, projectName, level, text };
  activityLog.push(entry);
  if (activityLog.length > MAX_ACTIVITY) activityLog.shift();
  const msg = JSON.stringify({ type: 'activity', ...entry });
  for (const [ws, client] of clients) {
    if (client.authenticated && ws.readyState === ws.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

// ─── Autopilot Reactor ───────────────────────────────────────────────────────
//
// Watches .autopilot-state.json changes and drives the autonomous loop:
//   needs_restart      → spawn Claude Code
//   waiting_for_gemini → feed Gemini the question, write answer, restart
//   completed          → log + broadcast
//   blocked            → log + broadcast, wait for human

function findClaudePath() {
  try { return execSync('which claude', { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

const CLAUDE_PATH = findClaudePath();

function getAutopilotDir(sessionId, projectId) {
  if (sessionId) return getSessionDir(sessionId, projectId);
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  return project?.path || DEV_TEAM_ROOT;
}

function handleAutopilotStateChange(sessionId, projectId) {
  const key = sessionId || projectId;
  if (autopilotLocks.has(key)) return;

  const dir = getAutopilotDir(sessionId, projectId);
  const state = safeJSON(resolve(dir, '.autopilot-state.json'));
  if (!state) return;

  const projectName = projectId || 'innorhl';

  switch (state.status) {
    case 'needs_restart':
      scheduleClaudeRestart(sessionId, projectId, state, dir);
      break;

    case 'waiting_for_gemini':
      feedGeminiQuestion(sessionId, projectId, dir);
      break;

    case 'completed':
      addActivity(projectName, projectName, 'info',
        `Autopilot completed — all ${state.total_tasks || 0} tasks done${sessionId ? ` (session: ${sessionId})` : ''}`);
      if (projectId) recordSessionEnd(projectId, projectName, 'completed');
      broadcastAll({ type: 'autopilot-status', projectId, sessionId, status: 'completed' });
      break;

    case 'blocked':
      addActivity(projectName, projectName, 'warn',
        `Autopilot blocked${state.blocker_reason ? ': ' + state.blocker_reason.slice(0, 200) : ''}${sessionId ? ` (session: ${sessionId})` : ''}`);
      broadcastAll({ type: 'autopilot-status', projectId, sessionId, status: 'blocked', reason: state.blocker_reason });
      break;

    // in_progress, idle — do nothing
  }
}

function scheduleClaudeRestart(sessionId, projectId, state, dir) {
  const key = sessionId || projectId;

  if (!CLAUDE_PATH) {
    addActivity(projectId || 'innorhl', projectId || 'innorhl', 'error',
      'Claude CLI not found — cannot auto-restart. Install Claude Code or set PATH.');
    return;
  }

  // Cooldown check
  const lastExit = state.last_claude_exit ? new Date(state.last_claude_exit).getTime() : 0;
  const elapsed = Date.now() - lastExit;
  if (elapsed < AUTOPILOT_COOLDOWN_MS) {
    setTimeout(() => scheduleClaudeRestart(sessionId, projectId, state, dir),
      AUTOPILOT_COOLDOWN_MS - elapsed);
    return;
  }

  // Retry guard (on-claude-stop.js handles this too, but double-check)
  if ((state.retry_count || 0) >= AUTOPILOT_MAX_RETRIES) {
    writeFileSync(resolve(dir, '.autopilot-state.json'), JSON.stringify({
      ...state, status: 'blocked',
      blocker_reason: `Server-side: max retries (${AUTOPILOT_MAX_RETRIES}) reached`,
      updated_at: new Date().toISOString(),
    }, null, 2));
    return;
  }

  autopilotLocks.add(key);

  // Mark in_progress before spawning
  writeFileSync(resolve(dir, '.autopilot-state.json'), JSON.stringify({
    ...state, status: 'in_progress',
    last_claude_start: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, null, 2));

  const projectPath = dir;
  const env = { ...process.env, SESSION_ID: sessionId || '', PROJECT_DIR: projectPath };

  addActivity(projectId || 'innorhl', projectId || 'innorhl', 'info',
    `Autopilot spawning Claude Code${sessionId ? ` (session: ${sessionId})` : ''} — ${state.remaining_tasks || '?'} tasks left`);

  const claudeProcess = spawn(CLAUDE_PATH, [
    '--print',
    '--dangerously-skip-permissions',
    'Read PLAN.md and execute the next unchecked task. Follow the CLAUDE.md startup checklist.',
  ], { cwd: projectPath, env, stdio: ['pipe', 'pipe', 'pipe'] });

  activeClaudeProcesses.set(key, { process: claudeProcess, startTime: Date.now(), projectId });

  broadcastAll({ type: 'autopilot-status', projectId, sessionId, status: 'running' });

  // Kill timer — prevent runaway Claude
  const killTimer = setTimeout(() => {
    if (claudeProcess.exitCode === null) {
      addActivity(projectId || 'innorhl', projectId || 'innorhl', 'warn',
        `Autopilot killing Claude — exceeded ${AUTOPILOT_MAX_RUNTIME_MS / 60000}min runtime limit`);
      claudeProcess.kill('SIGTERM');
      setTimeout(() => { if (claudeProcess.exitCode === null) claudeProcess.kill('SIGKILL'); }, 5000);
    }
  }, AUTOPILOT_MAX_RUNTIME_MS);

  claudeProcess.on('exit', (code) => {
    clearTimeout(killTimer);
    activeClaudeProcesses.delete(key);
    autopilotLocks.delete(key);

    addActivity(projectId || 'innorhl', projectId || 'innorhl', 'info',
      `Claude exited (code ${code})${sessionId ? ` — session: ${sessionId}` : ''}`);
    broadcastAll({ type: 'autopilot-status', projectId, sessionId, status: 'stopped', exitCode: code });

    // The Stop hook (on-claude-stop.js) will write the next state,
    // which triggers the file watcher, which calls handleAutopilotStateChange again.
    // The loop continues automatically.
  });

  // Capture stdout/stderr for activity log
  let outputBuffer = '';
  claudeProcess.stdout.on('data', (data) => {
    outputBuffer += data.toString();
    if (outputBuffer.length > 10000) outputBuffer = outputBuffer.slice(-10000);
  });
  claudeProcess.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) addActivity(projectId || 'innorhl', projectId || 'innorhl', 'warn', `Claude stderr: ${line.slice(0, 300)}`);
  });

  // Store output for later retrieval
  claudeProcess.on('exit', () => {
    if (outputBuffer.trim()) {
      const outputPath = resolve(dir, '.last-claude-output.txt');
      try { writeFileSync(outputPath, outputBuffer); } catch {}
    }
  });
}

async function feedGeminiQuestion(sessionId, projectId, dir) {
  const key = sessionId || projectId;
  autopilotLocks.add(key);

  const inboxPath  = resolve(dir, 'GEMINI_INBOX.md');
  const answerPath = resolve(dir, 'CLAUDE_INBOX.md');
  const planPath   = resolve(dir, 'PLAN.md');
  const statePath  = resolve(dir, '.autopilot-state.json');

  if (!existsSync(inboxPath)) {
    writeFileSync(statePath, JSON.stringify({
      status: 'blocked', blocker_reason: 'GEMINI_INBOX.md not found',
      updated_at: new Date().toISOString(),
    }, null, 2));
    autopilotLocks.delete(key);
    return;
  }

  if (!GEMINI_PATH) {
    writeFileSync(statePath, JSON.stringify({
      status: 'blocked', blocker_reason: 'Gemini CLI not found — cannot answer question',
      updated_at: new Date().toISOString(),
    }, null, 2));
    autopilotLocks.delete(key);
    return;
  }

  const question = readFileSync(inboxPath, 'utf8');
  const planContext = existsSync(planPath) ? readFileSync(planPath, 'utf8').slice(0, 3000) : '';

  const prompt = [
    'Claude Code is asking you this question while executing a plan.',
    'Here is the current PLAN.md for context:',
    '---',
    planContext,
    '---',
    'Claude\'s question:',
    question,
    '---',
    'Provide a clear, specific answer that Claude can act on immediately.',
    'If you need to make an architecture decision, be decisive — don\'t hedge.',
  ].join('\n');

  addActivity(projectId || 'innorhl', projectId || 'innorhl', 'info',
    `Feeding Gemini Claude's question${sessionId ? ` (session: ${sessionId})` : ''}`);

  try {
    const { stdout } = await execPromise(
      `${GEMINI_PATH} -p ${JSON.stringify(prompt)}`,
      { cwd: dir, timeout: 120000 }
    );

    writeFileSync(answerPath, `## Gemini's Answer\n\n${stdout}\n`);

    // Set state to needs_restart → triggers Claude restart via watcher
    const state = safeJSON(statePath) || {};
    writeFileSync(statePath, JSON.stringify({
      ...state,
      status: 'needs_restart',
      updated_at: new Date().toISOString(),
    }, null, 2));

    addActivity(projectId || 'innorhl', projectId || 'innorhl', 'info',
      `Gemini answered — Claude will restart${sessionId ? ` (session: ${sessionId})` : ''}`);

  } catch (err) {
    writeFileSync(statePath, JSON.stringify({
      status: 'blocked',
      blocker_reason: `Gemini failed: ${err.message}`,
      updated_at: new Date().toISOString(),
    }, null, 2));
    addActivity(projectId || 'innorhl', projectId || 'innorhl', 'error',
      `Gemini failed: ${err.message.slice(0, 200)}`);
  }

  autopilotLocks.delete(key);
}

// ─── Express + WebSocket ─────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));
const server = createServer(app);
const wss    = new WebSocketServer({ server });

const clients = new Map(); // ws → { authenticated, activeProject, geminiSessions: Map }

function broadcastToProject(projectId, data) {
  const msg = JSON.stringify(data);
  for (const [ws, client] of clients) {
    if (client.authenticated && client.activeProject === projectId && ws.readyState === ws.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  for (const [ws, client] of clients) {
    if (client.authenticated && ws.readyState === ws.OPEN) {
      try { ws.send(msg); } catch {}
    }
  }
}

function sendOverview(ws) {
  const projects = loadProjects();
  const overview = projects.map(p => getProjectState(p));
  ws.send(JSON.stringify({ type: 'overview', projects: overview }));
}

function sendProjectState(ws, projectId) {
  const projects = loadProjects();
  const project  = projects.find(p => p.id === projectId);
  if (!project) return;
  ws.send(JSON.stringify({ type: 'project-state', ...getProjectState(project) }));
}

function sendSessionList(ws, projectId) {
  const sessions = listAllSessions(projectId);
  ws.send(JSON.stringify({ type: 'session-list', sessions }));
}

// ─── WebSocket handler ───────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  const client = {
    authenticated: false,
    activeProject: null,
    geminiSessions: new Map(), // sessionId → { ptyProcess, name }
  };
  clients.set(ws, client);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Auth handshake
    if (!client.authenticated) {
      if (msg.type === 'auth' && msg.password === DASHBOARD_PASSWORD) {
        client.authenticated = true;
        ws.send(JSON.stringify({ type: 'status', text: 'authenticated' }));
        sendOverview(ws);
        sendSessionList(ws);
        ws.send(JSON.stringify({ type: 'activity-history', entries: activityLog.slice(-50) }));
      } else {
        ws.send(JSON.stringify({ type: 'error', text: 'Invalid password' }));
        ws.close();
      }
      return;
    }

    // Authenticated actions
    switch (msg.type) {

      case 'select-project':
        client.activeProject = msg.projectId;
        sendProjectState(ws, msg.projectId);
        sendSessionList(ws, msg.projectId); // send sessions for this project
        break;

      case 'add-project': {
        const projects = loadProjects();
        const id = (msg.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
        if (projects.find(p => p.id === id)) {
          ws.send(JSON.stringify({ type: 'error', text: `Project "${id}" already exists` }));
          break;
        }

        let projectPath;
        const githubUrl = msg.githubUrl?.trim();
        const localPath = msg.path?.trim();

        if (githubUrl) {
          // Clone GitHub repo into InnoRHL/projects/{id}/
          projectPath = resolve(PROJECTS_ROOT, id);
          ws.send(JSON.stringify({ type: 'info', text: `Cloning ${githubUrl}…` }));
          try {
            mkdirSync(projectPath, { recursive: true });
            await execPromise(`git clone "${githubUrl}" "${projectPath}"`, { timeout: 120000 });
            ws.send(JSON.stringify({ type: 'info', text: 'Clone complete. Injecting dev-team template…' }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', text: `Git clone failed: ${err.message}` }));
            break;
          }
        } else if (localPath) {
          projectPath = resolve(localPath);
          if (!existsSync(projectPath)) {
            ws.send(JSON.stringify({ type: 'error', text: `Path does not exist: ${projectPath}` }));
            break;
          }
        } else {
          ws.send(JSON.stringify({ type: 'error', text: 'Provide a GitHub URL or local path.' }));
          break;
        }

        // Inject dev-team template into the project
        injectProjectTemplate(projectPath);

        const newProject = {
          id, name: msg.name || id,
          path: projectPath,
          githubUrl: githubUrl || null,
          description: msg.description || '',
          createdAt: new Date().toISOString()
        };
        projects.push(newProject);
        saveProjects(projects);
        getProjectDataDir(id);
        setupProjectWatcher(newProject);
        addActivity(id, newProject.name, 'info', githubUrl ? `Project cloned from ${githubUrl}` : 'Project added to dashboard');
        sendOverview(ws);
        break;
      }

      case 'refresh-template': {
        // Refresh template symlinks for one project (or all if no projectId)
        const projects = loadProjects();
        const targets  = msg.projectId
          ? projects.filter(p => p.id === msg.projectId)
          : projects.filter(p => p.path && existsSync(p.path));
        let count = 0;
        for (const p of targets) {
          if (refreshProjectTemplate(p.path)) count++;
        }
        ws.send(JSON.stringify({ type: 'info', text: `Template refreshed for ${count} project(s).` }));
        break;
      }

      case 'remove-project': {
        const projects = loadProjects();
        const idx = projects.findIndex(p => p.id === msg.projectId);
        if (idx === -1 || msg.projectId === 'innorhl') break;
        const removed = projects.splice(idx, 1)[0];
        saveProjects(projects);
        teardownProjectWatcher(msg.projectId);
        addActivity(msg.projectId, removed.name, 'warn', 'Project removed from dashboard');
        sendOverview(ws);
        break;
      }

      // ── Session management ─────────────────────────────────────────────────

      case 'create-session': {
        const projectId = client.activeProject || 'innorhl';
        const name      = (msg.name || 'New Session').trim().slice(0, 50);
        const sessionId = slugify(name) + '-' + Date.now().toString(36).slice(-4);
        createSessionDir(sessionId, name, projectId);
        setupSessionFileWatcher(sessionId, projectId);
        addActivity(projectId, projectId, 'info', `Session created: ${name}`);
        sendSessionList(ws, projectId);
        // No auto-start: Gemini starts when the user opens the session modal
        ws.send(JSON.stringify({ type: 'session-created', sessionId, name }));
        break;
      }

      case 'close-session': {
        const { sessionId } = msg;
        const projectId = client.activeProject || 'innorhl';
        if (!sessionId) break;
        const sess = client.geminiSessions.get(sessionId);
        if (sess?.ptyProcess) {
          try { sess.ptyProcess.kill(); } catch {}
        }
        client.geminiSessions.delete(sessionId);
        if (client.ptyBuffers) client.ptyBuffers.delete(sessionId);
        sessionProjectMap.delete(sessionId);
        ws.send(JSON.stringify({ type: 'session-closed', sessionId }));
        addActivity(projectId, projectId, 'info', `Session closed: ${sess?.name || sessionId}`);
        sendSessionList(ws, projectId);
        break;
      }

      case 'list-sessions':
        sendSessionList(ws, client.activeProject);
        break;

      case 'get-settings': {
        const { projectId } = msg;
        if (!projectId) break;
        const project = loadProjects().find(p => p.id === projectId);
        if (project) {
          const envPath = resolve(project.path || DEV_TEAM_ROOT, '.env');
          const mcpPath = resolve(project.path || DEV_TEAM_ROOT, '.mcp.json');
          // Mask secret values in .env before sending to browser
          const rawEnv = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
          const envContent = rawEnv.replace(/^([A-Z_]+=)(.+)$/gm, (_, key, val) => {
            const safeKeys = ['NODE_ENV', 'PORT', 'DASHBOARD_PORT', 'PROJECT_ROOT', 'NEXTAUTH_URL'];
            const keyName = key.replace('=', '');
            return safeKeys.includes(keyName) ? key + val : key + '••••••••';
          });
          const mcpContent = existsSync(mcpPath) ? readFileSync(mcpPath, 'utf-8') : '';
          ws.send(JSON.stringify({ type: 'settings-data', projectId, env: envContent, mcp: mcpContent }));
        }
        break;
      }

      case 'save-settings': {
        const { projectId, mcp } = msg;
        if (!projectId) break;
        const project = loadProjects().find(p => p.id === projectId);
        if (project) {
          // Only allow saving MCP config via dashboard — .env must be edited manually
          const mcpPath = resolve(project.path || DEV_TEAM_ROOT, '.mcp.json');
          if (mcp != null) writeFileSync(mcpPath, mcp, 'utf-8');
          ws.send(JSON.stringify({ type: 'settings-saved', projectId }));
        }
        break;
      }

      case 'get-session-state': {

        const { sessionId } = msg;
        if (sessionId && existsSync(getSessionDir(sessionId))) {
          ws.send(JSON.stringify({ type: 'session-state', ...getSessionState(sessionId) }));
        }
        break;
      }

      case 'merge-session': {
        const { sessionId } = msg;
        if (!sessionId) break;
        try {
          const worktreePath = resolve(DEV_TEAM_ROOT, '.worktrees', sessionId);
          const branchName   = `session/${sessionId}`;
          if (existsSync(worktreePath)) {
            await execPromise(`git checkout main && git merge ${branchName} --no-edit`, {
              cwd: resolve(DEV_TEAM_ROOT, '..')
            });
            await execPromise(`git worktree remove "${worktreePath}" --force`, {
              cwd: resolve(DEV_TEAM_ROOT, '..')
            });
            addActivity(client.activeProject || 'innorhl', 'innorhl', 'info', `Session "${sessionId}" merged to main`);
            ws.send(JSON.stringify({ type: 'merge-success', sessionId }));
          }
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', text: `Merge failed: ${e.message}` }));
        }
        break;
      }

      // ── Gemini PTY ────────────────────────────────────────────────────────

      case 'start-gemini': {
        const sessionId = msg.sessionId;
        const force     = msg.force !== false; // default true unless explicitly false
        if (sessionId) {
          const dir   = getSessionDir(sessionId);
          const state = safeJSON(resolve(dir, '.autopilot-state.json'));
          const name  = state?.session_name || sessionId;
          startGeminiSession(ws, client, sessionId, name, force);
        } else {
          // Legacy: single session called 'default'
          startGeminiSession(ws, client, 'default', 'Default', force);
        }
        break;
      }

      case 'pty-input': {
        const { sessionId, data } = msg;
        const sess = client.geminiSessions.get(sessionId || 'default');
        if (sess?.ptyProcess) sess.ptyProcess.write(data);
        break;
      }

      case 'resize': {
        const { sessionId, cols, rows } = msg;
        const sess = client.geminiSessions.get(sessionId || 'default');
        if (sess?.ptyProcess) sess.ptyProcess.resize(cols || 120, rows || 30);
        break;
      }

      // ── Other actions ─────────────────────────────────────────────────────

      case 'action':
        handleAction(msg.action, msg.projectId || client.activeProject, ws);
        break;

      case 'get-overview':
        sendOverview(ws);
        break;

      case 'get-agents': {
        if (msg.sessionId && existsSync(getSessionDir(msg.sessionId))) {
          // Per-session conversation
          const conversation = parseSessionConversation(msg.sessionId);
          ws.send(JSON.stringify({ type: 'agents-data', sessionId: msg.sessionId, conversation }));
        } else {
          // Per-project conversation (root files)
          const targetId = msg.projectId || client.activeProject;
          if (targetId) {
            const proj = loadProjects().find(p => p.id === targetId);
            if (proj) {
              const conversation = parseAgentConversation(proj);
              ws.send(JSON.stringify({ type: 'agents-data', projectId: targetId, conversation }));
            }
          }
        }
        break;
      }

      case 'get-usage': {
        const targetId = msg.projectId || client.activeProject;
        if (targetId) {
          const stats = getUsageStats(targetId);
          ws.send(JSON.stringify({ type: 'usage-data', projectId: targetId, ...stats }));
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    // Kill all Gemini sessions for this client
    for (const [sessionId, sess] of client.geminiSessions) {
      if (sess?.ptyProcess) {
        try { sess.ptyProcess.kill(); } catch {}
      }
    }
    clients.delete(ws);
  });
});

// ─── Gemini PTY session ──────────────────────────────────────────────────────

const PTY_BUFFER_MAX = 60000; // 60KB scrollback per session

function startGeminiSession(ws, client, sessionId, sessionName, force = true) {
  if (!GEMINI_PATH) {
    ws.send(JSON.stringify({ type: 'error', text: 'Gemini CLI not found. Install it or set GEMINI_PATH env var.' }));
    return;
  }

  if (!client.ptyBuffers) client.ptyBuffers = new Map();

  // Reconnect mode: if PTY is already alive and force=false, replay buffer instead of restarting
  if (!force) {
    const existing = client.geminiSessions.get(sessionId);
    if (existing?.ptyProcess) {
      ws.send(JSON.stringify({ type: 'session-started', sessionId, name: existing.name }));
      const buf = client.ptyBuffers.get(sessionId) || '';
      if (buf) ws.send(JSON.stringify({ type: 'pty-data', sessionId, data: buf }));
      ws.send(JSON.stringify({ type: 'gemini-status', sessionId, text: 'ready' }));
      return;
    }
    // PTY is dead — fall through and start a fresh one
  } else {
    // Force restart: kill existing PTY and clear buffer
    const existing = client.geminiSessions.get(sessionId);
    if (existing?.ptyProcess) {
      try { existing.ptyProcess.kill(); } catch {}
    }
    client.ptyBuffers.delete(sessionId);
  }

  // Determine working directory
  const sessionDir = getSessionDir(sessionId);
  const cwd = existsSync(sessionDir) ? sessionDir : DEV_TEAM_ROOT;

  try {
    let state = 'booting';
    let responseBuffer = '';

    const spawnCmd  = process.platform === 'darwin' ? process.execPath : GEMINI_PATH;
    const spawnArgs = process.platform === 'darwin' ? ['--no-warnings=DEP0040', GEMINI_PATH] : [];

    const ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-256color', cols: 120, rows: 30, cwd,
      env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    client.geminiSessions.set(sessionId, { ptyProcess, name: sessionName });
    addActivity(client.activeProject || 'innorhl', 'innorhl', 'info',
      `Gemini started for session: ${sessionName}`);

    ptyProcess.onData((data) => {
      // Buffer output for reconnect replay
      let buf = client.ptyBuffers.get(sessionId) || '';
      buf += data;
      if (buf.length > PTY_BUFFER_MAX) buf = buf.slice(buf.length - PTY_BUFFER_MAX);
      client.ptyBuffers.set(sessionId, buf);

      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify({ type: 'pty-data', sessionId, data }));

      if (state === 'booting') {
        responseBuffer += data;
        const clean = stripAnsi(responseBuffer);
        if (clean.includes('Type your message') || clean.includes('@path/to/file')) {
          state = 'ready';
          ws.send(JSON.stringify({ type: 'gemini-status', sessionId, text: 'ready' }));
          responseBuffer = '';
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'gemini-status', sessionId, text: `ended (exit ${exitCode})` }));
      }
      addActivity(client.activeProject || 'innorhl', 'innorhl', 'info',
        `Gemini exited for session: ${sessionName} (${exitCode})`);
      const sess = client.geminiSessions.get(sessionId);
      if (sess) client.geminiSessions.set(sessionId, { ...sess, ptyProcess: null });
    });

    ws.send(JSON.stringify({ type: 'session-started', sessionId, name: sessionName }));

  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', text: `Failed to start Gemini: ${err.message}` }));
  }
}

// ─── Dashboard actions ───────────────────────────────────────────────────────

async function handleAction(action, projectId, ws) {
  const projects = loadProjects();
  const project  = projects.find(p => p.id === projectId);
  if (!project) return;
  const files = getProjectFiles(project);

  switch (action) {
    case 'pause': {
      const state = safeJSON(files.state) || {};
      writeFileSync(files.state, JSON.stringify(
        { ...state, status: 'blocked', updated_at: new Date().toISOString() }, null, 2
      ));
      addActivity(projectId, project.name, 'warn', 'Autopilot PAUSED by user');
      break;
    }
    case 'resume': {
      const state    = safeJSON(files.state) || {};
      const remaining = state.remaining_tasks || 0;
      writeFileSync(files.state, JSON.stringify(
        { ...state, status: remaining > 0 ? 'needs_restart' : 'idle',
          retry_count: 0, blocker_reason: null,
          updated_at: new Date().toISOString() }, null, 2
      ));
      addActivity(projectId, project.name, 'info', 'Autopilot RESUMED');
      break;
    }
    case 'rollback': {
      try {
        await execPromise('git reset --hard HEAD~1', { cwd: project.path });
        addActivity(projectId, project.name, 'warn', 'Rolled back to previous git snapshot');
      } catch (e) {
        addActivity(projectId, project.name, 'error', `Rollback failed: ${e.message}`);
      }
      break;
    }
  }
}

// ─── Per-project file watchers ───────────────────────────────────────────────

const projectWatchers = new Map();

// ─── Project Template Injection ───────────────────────────────────────────────
//
// Template lives at: InnoRHL/core-template/
// Injection uses SYMLINKS for dynamic files (dirs + key files).
// This means editing the template instantly affects ALL projects.
// Only starter files (JOURNAL.md, KNOWN_BUGS.md) are copied (project-specific).

const TEMPLATE_DIR = resolve(INNORHL_ROOT, 'core-template');

// Items that become SYMLINKS in the project (dynamic — always in sync with template)
const TEMPLATE_SYMLINKS = [
  { name: 'CLAUDE.md',            isDir: false },
  { name: 'GEMINI.md',            isDir: false },
  { name: '.mcp.json',            isDir: false },
  { name: '.claude/settings.json', isDir: false },
  { name: '.agents',              isDir: true  },
  { name: '.claude/agents',       isDir: true  },
  { name: '.claude/skills',       isDir: true  },
];

// Items that are COPIED once (project-specific, can be modified)
const TEMPLATE_COPIES = [
  { name: '.env.example',         dest: '.env.example' },
  { name: 'JOURNAL.md',           dest: 'JOURNAL.md'   },
  { name: 'KNOWN_BUGS.md',        dest: 'KNOWN_BUGS.md' },
  { name: '.gitignore.template',  dest: '.gitignore'    },
];

function makeSymlink(src, dest) {
  try {
    if (existsSync(dest)) return; // don't overwrite anything existing
    const parent = resolve(dest, '..');
    mkdirSync(parent, { recursive: true });
    symlinkSync(src, dest); // absolute symlink — always points to template
  } catch (err) {
    console.error(`  Symlink failed ${dest}: ${err.message}`);
  }
}

function injectProjectTemplate(projectPath) {
  try {
    if (!existsSync(TEMPLATE_DIR)) {
      console.error('  Template dir not found:', TEMPLATE_DIR);
      return;
    }

    // 1. Create symlinks for dynamic template files/dirs
    for (const item of TEMPLATE_SYMLINKS) {
      const src  = resolve(TEMPLATE_DIR, item.name);
      const dest = resolve(projectPath, item.name);
      if (existsSync(src)) makeSymlink(src, dest);
    }

    // 2. Copy starter files (project-specific, not symlinked)
    for (const item of TEMPLATE_COPIES) {
      const src  = resolve(TEMPLATE_DIR, item.name);
      const dest = resolve(projectPath, item.dest);
      if (existsSync(src) && !existsSync(dest)) {
        mkdirSync(resolve(dest, '..'), { recursive: true });
        copyFileSync(src, dest);
      }
    }

    // 3. Create sessions/ directory for this project
    mkdirSync(resolve(projectPath, 'sessions'), { recursive: true });

    console.log(`  ✅ Template injected (symlinks) into: ${projectPath}`);
  } catch (err) {
    console.error(`  Template injection failed: ${err.message}`);
  }
}

// Refresh template for a project: re-apply symlinks (safe, non-destructive)
// Copies are NOT overwritten — only symlinks are refreshed
function refreshProjectTemplate(projectPath) {
  try {
    for (const item of TEMPLATE_SYMLINKS) {
      const src  = resolve(TEMPLATE_DIR, item.name);
      const dest = resolve(projectPath, item.name);
      if (!existsSync(src)) continue;
      // Remove old symlink if it exists, re-create it
      try { unlinkSync(dest); } catch (e) { if (e.code !== 'ENOENT') console.error('unlinkSync error', dest, e); }
      makeSymlink(src, dest);
    }
    console.log(`  ✅ Template refreshed for: ${projectPath}`);
    return true;
  } catch (err) {
    console.error(`  Template refresh failed: ${err.message}`);
    return false;
  }
}

function setupProjectWatcher(project) {
  if (projectWatchers.has(project.id)) return;
  const files = getProjectFiles(project);
  const paths = Object.values(files);
  const initState = safeJSON(files.state);
  const stateTracker = { prevStatus: initState?.status || null };

  const watcher = chokidar.watch(paths, {
    persistent: true, ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  });

  watcher.on('change', (changedPath) => {
    const label = Object.entries(files).find(([, v]) => v === changedPath)?.[0] || 'file';

    if (changedPath === files.state) {
      const newState  = safeJSON(files.state);
      const newStatus = newState?.status;
      if (stateTracker.prevStatus !== 'in_progress' && newStatus === 'in_progress') {
        recordSessionStart(project.id);
      } else if (stateTracker.prevStatus === 'in_progress' && newStatus !== 'in_progress') {
        recordSessionEnd(project.id, project.name, newStatus || 'unknown');
      }
      stateTracker.prevStatus = newStatus;

      // Autopilot reactor — drive the autonomous loop
      handleAutopilotStateChange(null, project.id);
    }

    addActivity(project.id, project.name, 'info', `${label} updated`);
    const state = getProjectState(project);
    broadcastToProject(project.id, { type: 'project-state', ...state });
    broadcastAll({ type: 'project-summary', id: project.id, ...state });
  });

  projectWatchers.set(project.id, watcher);
}

function teardownProjectWatcher(projectId) {
  const watcher = projectWatchers.get(projectId);
  if (watcher) { watcher.close(); projectWatchers.delete(projectId); }
}

// ─── Per-session file watchers ────────────────────────────────────────────────

const sessionFileWatchers = new Map();

function setupSessionFileWatcher(sessionId, projectId) {
  if (sessionFileWatchers.has(sessionId)) return;
  if (projectId) sessionProjectMap.set(sessionId, projectId);
  const dir = getSessionDir(sessionId, projectId);
  if (!existsSync(dir)) return;

  const watchPaths = [
    resolve(dir, '.autopilot-state.json'),
    resolve(dir, 'PLAN.md'),
    resolve(dir, 'JOURNAL.md'),
    resolve(dir, 'TEST_RESULTS.md'),
    resolve(dir, 'GEMINI_REVIEW.md'),
    resolve(dir, 'GEMINI_INBOX.md'),
    resolve(dir, 'CLAUDE_INBOX.md'),
  ];

  const watcher = chokidar.watch(watchPaths, {
    persistent: true, ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on('change', (changedPath) => {
    const label = changedPath.split('/').pop();
    addActivity(projectId || 'innorhl', `session:${sessionId}`, 'info', `[${sessionId}] ${label} updated`);

    // Autopilot reactor — drive the autonomous loop for this session
    if (changedPath.endsWith('.autopilot-state.json')) {
      handleAutopilotStateChange(sessionId, projectId);
    }

    // Broadcast updated session state to all clients
    const state = getSessionState(sessionId);
    const msg   = JSON.stringify({ type: 'session-state', ...state });
    for (const [ws, client] of clients) {
      if (client.authenticated && ws.readyState === ws.OPEN) {
        try { ws.send(msg); } catch {}
      }
    }
  });

  sessionFileWatchers.set(sessionId, watcher);
}

// Initialize watchers for all existing sessions
function initSessionWatchers() {
  if (!existsSync(SESSIONS_DIR)) return;
  try {
    readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .forEach(d => setupSessionFileWatcher(d.name));
  } catch {}
}

// ─── Stale session recovery ──────────────────────────────────────────────────
// On startup, any session stuck in "in_progress" is stale (Claude was killed
// when the server stopped). Reset them to "needs_restart" so the loop resumes.

function recoverStaleSessions() {
  const projects = loadProjects();
  for (const project of projects) {
    const sessions = listAllSessions(project.id);
    for (const sess of sessions) {
      if (sess.status === 'in_progress') {
        const dir = getSessionDir(sess.sessionId, project.id);
        const statePath = resolve(dir, '.autopilot-state.json');
        const state = safeJSON(statePath) || {};
        writeFileSync(statePath, JSON.stringify({
          ...state, status: 'needs_restart',
          updated_at: new Date().toISOString(),
        }, null, 2));
        console.log(`  ↻ Recovered stale session: ${sess.name || sess.sessionId}`);
      }
    }

    // Also check project-level state
    const files = getProjectFiles(project);
    const projState = safeJSON(files.state);
    if (projState?.status === 'in_progress') {
      writeFileSync(files.state, JSON.stringify({
        ...projState, status: 'needs_restart',
        updated_at: new Date().toISOString(),
      }, null, 2));
      console.log(`  ↻ Recovered stale project: ${project.name}`);
    }
  }
}

// ─── Start server ────────────────────────────────────────────────────────────

const projects = loadProjects();
recoverStaleSessions();
for (const project of projects) {
  setupProjectWatcher(project);
}
initSessionWatchers();

server.listen(PORT, () => {
  console.log(`\n  InnoRHL Control Room`);
  console.log(`  ─────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Gemini CLI : ${GEMINI_PATH || 'NOT FOUND'}`);
  console.log(`  Claude CLI : ${CLAUDE_PATH || 'NOT FOUND'}`);
  console.log(`  Autopilot  : ${CLAUDE_PATH && GEMINI_PATH ? 'READY' : 'DEGRADED (missing CLI)'}`);
  console.log(`  Projects   : ${projects.length}`);
  projects.forEach(p => console.log(`    - ${p.name} (${p.path})`));
  console.log(`  Sessions   : ${listAllSessions().length} active`);
  console.log(`  ─────────────────────\n`);
});

process.on('SIGINT', () => {
  // Kill all active Claude autopilot processes
  for (const [, entry] of activeClaudeProcesses) {
    if (entry.process) { try { entry.process.kill(); } catch {} }
  }
  for (const [, w] of projectWatchers) w.close();
  for (const [, w] of sessionFileWatchers) w.close();
  for (const [, client] of clients) {
    for (const [, sess] of client.geminiSessions) {
      if (sess?.ptyProcess) { try { sess.ptyProcess.kill(); } catch {} }
    }
  }
  server.close();
  process.exit(0);
});
