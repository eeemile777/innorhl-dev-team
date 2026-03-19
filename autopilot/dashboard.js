/**
 * autopilot/dashboard.js
 *
 * Mission Control — The supervisor dashboard.
 *
 * Watches the project filesystem and streams real-time state to the browser.
 * Dark terminal UI. No frameworks. One file.
 *
 * Usage:
 *   npm run dashboard        → opens on http://localhost:3001
 *   npm start                → watcher only (no dashboard)
 *   npm run full             → watcher + dashboard together
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import chokidar from 'chokidar';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const PORT = process.env.DASHBOARD_PORT || 3001;

// Watched files
const FILES = {
  state:   resolve(PROJECT_ROOT, '.autopilot-state.json'),
  status:  resolve(PROJECT_ROOT, 'AGENT_STATUS.md'),
  plan:    resolve(PROJECT_ROOT, 'PLAN.md'),
  journal: resolve(PROJECT_ROOT, 'JOURNAL.md'),
  inbox:   resolve(PROJECT_ROOT, 'GEMINI_INBOX.md'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeRead(path) {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null; } catch { return null; }
}

function safeJSON(path) {
  try { const t = safeRead(path); return t ? JSON.parse(t) : null; } catch { return null; }
}

function parseTasks(planContent) {
  if (!planContent) return [];
  const lines = planContent.split('\n');
  return lines
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
  return { date: match[1].trim(), content: match[2].trim() };
}

function parseProjectHealth(planContent) {
  if (!planContent) return [];
  // Look for a health/status table in the plan
  const tasks = parseTasks(planContent);
  return tasks.map(t => ({
    name: t.text.split('—')[0].replace(/\*\*/g, '').trim(),
    done: t.done
  }));
}

function getFullState() {
  const state   = safeJSON(FILES.state);
  const plan    = safeRead(FILES.plan);
  const journal = safeRead(FILES.journal);
  const tasks   = parseTasks(plan);
  const done    = tasks.filter(t => t.done).length;
  const latest  = parseJournalLatest(journal);

  return {
    type: 'state',
    autopilot: state || { status: 'idle', remaining_tasks: 0, total_steps: 0 },
    tasks,
    done,
    total: tasks.length,
    journal: latest,
    plan: plan ? plan.slice(0, 2000) : null, // first 2000 chars for display
    timestamp: new Date().toISOString()
  };
}

// ─── Express + WebSocket ──────────────────────────────────────────────────────

const app = express();
app.use(express.json());
const server = createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => { try { ws.send(msg); } catch {} });
}

// WebSocket connection
wss.on('connection', (ws) => {
  clients.add(ws);
  // Send current state immediately on connect
  ws.send(JSON.stringify(getFullState()));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleClientMessage(msg);
    } catch {}
  });

  ws.on('close', () => clients.delete(ws));
});

// Handle actions from the browser
function handleClientMessage(msg) {
  switch (msg.action) {
    case 'pause': {
      const state = safeJSON(FILES.state) || {};
      writeFileSync(FILES.state, JSON.stringify({ ...state, status: 'blocked', updated_at: new Date().toISOString() }, null, 2));
      broadcast({ type: 'log', level: 'warn', text: 'Autopilot PAUSED by user.' });
      break;
    }
    case 'resume': {
      const state = safeJSON(FILES.state) || {};
      const remaining = state.remaining_tasks || 0;
      writeFileSync(FILES.state, JSON.stringify({ ...state, status: remaining > 0 ? 'in_progress' : 'idle', updated_at: new Date().toISOString() }, null, 2));
      broadcast({ type: 'log', level: 'info', text: 'Autopilot RESUMED.' });
      break;
    }
    case 'rollback': {
      try {
        execSync('git reset --hard HEAD~1', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        broadcast({ type: 'log', level: 'warn', text: '⚠ Rolled back to previous snapshot.' });
        broadcast(getFullState());
      } catch (e) {
        broadcast({ type: 'log', level: 'error', text: `Rollback failed: ${e.message}` });
      }
      break;
    }
    case 'message': {
      // Write user message to GEMINI_INBOX.md for Gemini to pick up
      const ts = new Date().toISOString();
      const existing = safeRead(FILES.inbox) || '# Gemini Inbox\n\n';
      writeFileSync(FILES.inbox, existing + `\n---\n**[${ts}]** ${msg.text}\n`);
      broadcast({ type: 'log', level: 'info', text: `Message sent to Gemini: "${msg.text}"` });
      break;
    }
  }
}

// File watcher → broadcast changes
const watcher = chokidar.watch(Object.values(FILES), {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
});

watcher.on('change', (path) => {
  broadcast(getFullState());
  const label = Object.entries(FILES).find(([,v]) => v === path)?.[0] || 'file';
  broadcast({ type: 'log', level: 'info', text: `${label} updated` });
});

// ─── Serve the dashboard HTML ─────────────────────────────────────────────────

app.get('/', (req, res) => res.send(getDashboardHTML()));

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mission Control</title>
<style>
  :root {
    --bg: #0a0a0a;
    --bg2: #111111;
    --bg3: #1a1a1a;
    --border: #1e3a1e;
    --green: #00ff41;
    --green-dim: #00aa2a;
    --cyan: #00d4ff;
    --yellow: #ffcc00;
    --red: #ff3333;
    --gray: #444;
    --text: #cccccc;
    --font: 'Courier New', 'Lucida Console', monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--green);
    font-family: var(--font);
    font-size: 13px;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ── */
  #header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    flex-shrink: 0;
  }

  #header .logo {
    color: var(--green);
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 3px;
  }

  #header .logo span { color: var(--cyan); }

  #status-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    letter-spacing: 1px;
  }

  #status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--gray);
    box-shadow: 0 0 6px var(--gray);
    transition: all 0.3s;
  }

  #status-dot.running  { background: var(--green);  box-shadow: 0 0 8px var(--green); }
  #status-dot.blocked  { background: var(--yellow); box-shadow: 0 0 8px var(--yellow); animation: pulse 1s infinite; }
  #status-dot.error    { background: var(--red);    box-shadow: 0 0 8px var(--red); }
  #status-dot.complete { background: var(--cyan);   box-shadow: 0 0 8px var(--cyan); }
  #status-dot.idle     { background: var(--gray); }

  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }

  /* ── Main grid ── */
  #main {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr;
    gap: 0;
    flex: 1;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
  }

  .panel {
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel:last-child { border-right: none; }

  .panel-header {
    padding: 6px 12px;
    background: var(--bg3);
    border-bottom: 1px solid var(--border);
    color: var(--cyan);
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .panel-header .indicator {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--cyan);
    box-shadow: 0 0 4px var(--cyan);
  }

  .panel-body {
    padding: 12px;
    flex: 1;
    overflow-y: auto;
    color: var(--text);
    line-height: 1.6;
  }

  .panel-body::-webkit-scrollbar { width: 4px; }
  .panel-body::-webkit-scrollbar-track { background: var(--bg); }
  .panel-body::-webkit-scrollbar-thumb { background: var(--border); }

  /* ── Gemini Panel ── */
  #gemini-status {
    color: var(--green-dim);
    font-size: 11px;
    margin-bottom: 8px;
    letter-spacing: 1px;
  }

  #gemini-thought {
    color: var(--text);
    font-size: 12px;
    border-left: 2px solid var(--green-dim);
    padding-left: 8px;
    min-height: 40px;
  }

  /* ── Claude Panel ── */
  .progress-bar {
    margin: 10px 0;
    background: var(--bg3);
    border: 1px solid var(--border);
    height: 16px;
    position: relative;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--green-dim);
    transition: width 0.5s;
    position: relative;
  }

  .progress-fill::after {
    content: '';
    position: absolute;
    right: 0; top: 0; bottom: 0;
    width: 2px;
    background: var(--green);
    box-shadow: 0 0 6px var(--green);
  }

  .progress-label {
    font-size: 11px;
    color: var(--green);
    margin-bottom: 4px;
  }

  .task-list { list-style: none; margin-top: 8px; }

  .task-list li {
    padding: 2px 0;
    font-size: 12px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: var(--gray);
  }

  .task-list li.done { color: var(--green-dim); }
  .task-list li.active { color: var(--green); }

  .task-list li .tick { flex-shrink: 0; }

  /* ── Health Panel ── */
  .health-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
    border-bottom: 1px solid #1a1a1a;
  }

  .health-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .health-dot.done     { background: var(--green); box-shadow: 0 0 4px var(--green); }
  .health-dot.pending  { background: var(--gray); }
  .health-dot.active   { background: var(--yellow); box-shadow: 0 0 4px var(--yellow); animation: pulse 1.5s infinite; }

  /* ── Journal strip ── */
  #journal-strip {
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 8px 16px;
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text);
    display: flex;
    gap: 16px;
    align-items: baseline;
  }

  #journal-strip .label {
    color: var(--cyan);
    letter-spacing: 1px;
    font-size: 11px;
    flex-shrink: 0;
  }

  #journal-strip .content {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  /* ── Log strip ── */
  #log-strip {
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 4px 16px;
    flex-shrink: 0;
    font-size: 11px;
    height: 24px;
    overflow: hidden;
    color: var(--green-dim);
    font-style: italic;
  }

  /* ── Bottom bar ── */
  #bottom-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg2);
    flex-shrink: 0;
    border-top: 1px solid var(--border);
  }

  #chat-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--green);
    font-family: var(--font);
    font-size: 13px;
    padding: 6px 10px;
    outline: none;
    caret-color: var(--green);
  }

  #chat-input::placeholder { color: var(--gray); }
  #chat-input:focus { border-color: var(--green-dim); }

  .btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font);
    font-size: 12px;
    padding: 6px 14px;
    cursor: pointer;
    letter-spacing: 1px;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .btn:hover { border-color: var(--green); color: var(--green); }
  .btn.primary { border-color: var(--green-dim); color: var(--green); }
  .btn.warn { border-color: var(--yellow); color: var(--yellow); }
  .btn.danger { border-color: var(--red); color: var(--red); }
  .btn.danger:hover { background: #330000; }

  /* ── Blocked overlay ── */
  #blocked-banner {
    display: none;
    background: #1a1200;
    border: 1px solid var(--yellow);
    color: var(--yellow);
    padding: 8px 16px;
    font-size: 12px;
    letter-spacing: 1px;
    text-align: center;
    flex-shrink: 0;
    animation: pulse 2s infinite;
  }

  #blocked-banner.visible { display: block; }

  /* ── Empty states ── */
  .empty {
    color: var(--gray);
    font-size: 12px;
    font-style: italic;
    padding: 8px 0;
  }
</style>
</head>
<body>

<!-- Header -->
<div id="header">
  <div class="logo">◉ MISSION <span>CONTROL</span></div>
  <div id="status-badge">
    <div id="status-dot" class="idle"></div>
    <span id="status-text">IDLE</span>
  </div>
</div>

<!-- Blocked banner -->
<div id="blocked-banner">
  ⚠ AUTOPILOT BLOCKED — Tell Gemini what's wrong, then click RESUME
</div>

<!-- Main 3-panel grid -->
<div id="main">

  <!-- Gemini Panel -->
  <div class="panel">
    <div class="panel-header">
      <div class="indicator"></div>
      GEMINI — BRAIN
    </div>
    <div class="panel-body">
      <div id="gemini-status">STANDING BY</div>
      <div id="gemini-thought" class="empty">Waiting for plan...</div>
      <div style="margin-top:12px; font-size:11px; color:var(--gray);">
        Last plan written: <span id="gemini-last-plan">—</span>
      </div>
    </div>
  </div>

  <!-- Claude Panel -->
  <div class="panel">
    <div class="panel-header">
      <div class="indicator" style="background:var(--green); box-shadow:0 0 4px var(--green);"></div>
      CLAUDE — HANDS
    </div>
    <div class="panel-body">
      <div class="progress-label">
        Tasks: <span id="tasks-done">0</span> / <span id="tasks-total">0</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" id="progress-fill" style="width:0%"></div>
      </div>
      <ul class="task-list" id="task-list">
        <li class="empty">No tasks loaded</li>
      </ul>
    </div>
  </div>

  <!-- Project Health Panel -->
  <div class="panel">
    <div class="panel-header">
      <div class="indicator" style="background:var(--cyan); box-shadow:0 0 4px var(--cyan);"></div>
      PROJECT HEALTH
    </div>
    <div class="panel-body" id="health-panel">
      <div class="empty">No plan loaded</div>
    </div>
  </div>

</div>

<!-- Journal strip -->
<div id="journal-strip">
  <span class="label">JOURNAL</span>
  <span class="content" id="journal-content">No journal entries yet</span>
</div>

<!-- Live log strip -->
<div id="log-strip" id="log-strip">
  Connecting to mission control...
</div>

<!-- Bottom bar: chat + buttons -->
<div id="bottom-bar">
  <input
    type="text"
    id="chat-input"
    placeholder="> Tell Gemini something... (Enter to send)"
    autocomplete="off"
  />
  <button class="btn primary" onclick="sendMessage()">SEND</button>
  <button class="btn warn" id="pause-btn" onclick="togglePause()">PAUSE</button>
  <button class="btn danger" onclick="rollback()">ROLLBACK</button>
</div>

<script>
  let ws;
  let isPaused = false;
  let currentStatus = 'idle';

  function connect() {
    ws = new WebSocket('ws://' + location.host);

    ws.onopen = () => {
      setLog('info', 'Connected to mission control');
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') renderState(msg);
      if (msg.type === 'log') setLog(msg.level, msg.text);
    };

    ws.onclose = () => {
      setLog('error', 'Disconnected — retrying in 3s...');
      setTimeout(connect, 3000);
    };
  }

  function renderState(state) {
    // Status dot + badge
    const s = state.autopilot?.status || 'idle';
    currentStatus = s;
    const dot = document.getElementById('status-dot');
    dot.className = '';
    dot.classList.add(s === 'in_progress' ? 'running' : s);
    document.getElementById('status-text').textContent = s.toUpperCase().replace('_', ' ');

    // Blocked banner
    const banner = document.getElementById('blocked-banner');
    if (s === 'blocked') banner.classList.add('visible');
    else banner.classList.remove('visible');

    // Pause button state
    const pauseBtn = document.getElementById('pause-btn');
    if (s === 'blocked') {
      pauseBtn.textContent = 'RESUME';
      pauseBtn.className = 'btn primary';
      isPaused = true;
    } else {
      pauseBtn.textContent = 'PAUSE';
      pauseBtn.className = 'btn warn';
      isPaused = false;
    }

    // Gemini panel
    const geminiStatus = document.getElementById('gemini-status');
    const geminiThought = document.getElementById('gemini-thought');
    if (s === 'in_progress') {
      geminiStatus.textContent = 'ACTIVE — PLAN IN EXECUTION';
      geminiStatus.style.color = 'var(--green)';
    } else if (s === 'blocked') {
      geminiStatus.textContent = '⚠ WAITING FOR REVIEW';
      geminiStatus.style.color = 'var(--yellow)';
    } else {
      geminiStatus.textContent = 'STANDING BY';
      geminiStatus.style.color = 'var(--green-dim)';
    }

    if (state.autopilot?.blockers) {
      geminiThought.textContent = '⚠ ' + state.autopilot.blockers;
      geminiThought.style.color = 'var(--yellow)';
      geminiThought.style.borderLeftColor = 'var(--yellow)';
    } else if (state.plan) {
      // Extract context from plan
      const ctxMatch = state.plan.match(/## Context\n([\s\S]*?)(?=##|$)/);
      geminiThought.textContent = ctxMatch ? ctxMatch[1].trim().slice(0, 200) : 'Plan active.';
      geminiThought.style.color = 'var(--text)';
      geminiThought.style.borderLeftColor = 'var(--green-dim)';
    } else {
      geminiThought.textContent = 'Waiting for plan...';
      geminiThought.className = 'empty';
    }

    // Claude panel — tasks
    const done = state.done || 0;
    const total = state.total || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    document.getElementById('tasks-done').textContent = done;
    document.getElementById('tasks-total').textContent = total;
    document.getElementById('progress-fill').style.width = pct + '%';

    const taskList = document.getElementById('task-list');
    if (state.tasks && state.tasks.length > 0) {
      taskList.innerHTML = state.tasks.map((t, i) => {
        const isActive = !t.done && state.tasks.slice(0, i).every(x => x.done);
        const cls = t.done ? 'done' : (isActive ? 'active' : '');
        const tick = t.done ? '✔' : (isActive ? '▸' : '○');
        return \`<li class="\${cls}"><span class="tick">\${tick}</span><span>\${escHtml(t.text.slice(0, 60))}</span></li>\`;
      }).join('');
    } else {
      taskList.innerHTML = '<li class="empty">No tasks loaded</li>';
    }

    // Project health panel
    const health = document.getElementById('health-panel');
    if (state.tasks && state.tasks.length > 0) {
      health.innerHTML = state.tasks.map((t, i) => {
        const isActive = !t.done && state.tasks.slice(0, i).every(x => x.done);
        const cls = t.done ? 'done' : (isActive ? 'active' : 'pending');
        const label = t.done ? 'done' : (isActive ? '60% done' : 'pending');
        return \`<div class="health-item">
          <div class="health-dot \${cls}"></div>
          <span style="flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">\${escHtml(t.text.slice(0, 50))}</span>
          <span style="font-size:10px; color:var(--gray); flex-shrink:0;">\${label}</span>
        </div>\`;
      }).join('');
    } else {
      health.innerHTML = '<div class="empty">No plan loaded</div>';
    }

    // Journal strip
    if (state.journal) {
      document.getElementById('journal-content').textContent =
        state.journal.date + ' — ' + state.journal.content.slice(0, 120).replace(/\n/g, ' ');
    }
  }

  function setLog(level, text) {
    const el = document.getElementById('log-strip');
    const colors = { info: 'var(--green-dim)', warn: 'var(--yellow)', error: 'var(--red)' };
    el.style.color = colors[level] || 'var(--green-dim)';
    const ts = new Date().toTimeString().slice(0, 8);
    el.textContent = '[' + ts + '] ' + text;
  }

  function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !ws) return;
    ws.send(JSON.stringify({ action: 'message', text }));
    input.value = '';
    setLog('info', 'Message sent to Gemini inbox');
  }

  function togglePause() {
    if (!ws) return;
    if (isPaused) {
      ws.send(JSON.stringify({ action: 'resume' }));
    } else {
      ws.send(JSON.stringify({ action: 'pause' }));
    }
  }

  function rollback() {
    if (!confirm('Roll back to the last autopilot snapshot? This undoes recent changes.')) return;
    if (ws) ws.send(JSON.stringify({ action: 'rollback' }));
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  connect();
</script>
</body>
</html>`;
}

// ─── Start server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n  ◉ MISSION CONTROL`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`  Watching:  ${PROJECT_ROOT}`);
  console.log(`  ─────────────────────────────\n`);

  // Auto-open browser
  const open = process.platform === 'darwin' ? 'open' :
               process.platform === 'win32'  ? 'start' : 'xdg-open';
  try { execSync(`${open} http://localhost:${PORT}`, { stdio: 'ignore' }); } catch {}
});

process.on('SIGINT', () => {
  watcher.close();
  server.close();
  process.exit(0);
});
