/**
 * autopilot/dashboard.js
 *
 * Enhanced Mission Control (v3) — GitNexus Edition
 * Features Live D3 Neural Graphing, Agent Context Viewer, and GitNexus Stats.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import chokidar from 'chokidar';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const PORT = process.env.DASHBOARD_PORT || 3001;

// Watched files
const FILES = {
  state:    resolve(PROJECT_ROOT, '.autopilot-state.json'),
  status:   resolve(PROJECT_ROOT, 'AGENT_STATUS.md'),
  plan:     resolve(PROJECT_ROOT, 'PLAN.md'),
  journal:  resolve(PROJECT_ROOT, 'JOURNAL.md'),
  inbox:    resolve(PROJECT_ROOT, 'GEMINI_INBOX.md'),
  gitnexus: resolve(PROJECT_ROOT, '.gitnexus/meta.json'), // Core graph source of truth
};

const AGENT_DIRS = {
  rules:  resolve(PROJECT_ROOT, '.agents/rules'),
  skills: resolve(PROJECT_ROOT, '.agents/skills'),
}

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

function getAgentsContext() {
  const rules = existsSync(AGENT_DIRS.rules) ? readdirSync(AGENT_DIRS.rules).filter(f => f.endsWith('.md')) : [];
  const skills = existsSync(AGENT_DIRS.skills) ? readdirSync(AGENT_DIRS.skills).filter(f => f.endsWith('.md')) : [];
  return {
    rules: rules.map(r => r.replace('.md', '')),
    skills: skills.map(s => s.replace('.md', ''))
  };
}

function getFullState() {
  const state    = safeJSON(FILES.state);
  const plan     = safeRead(FILES.plan);
  const journal  = safeRead(FILES.journal);
  const gnMeta   = safeJSON(FILES.gitnexus);
  const tasks    = parseTasks(plan);
  const done     = tasks.filter(t => t.done).length;
  const latest   = parseJournalLatest(journal);
  const agents   = getAgentsContext();

  return {
    type: 'state',
    autopilot: state || { status: 'idle', remaining_tasks: 0, total_steps: 0 },
    tasks,
    done,
    total: tasks.length,
    journal: latest,
    plan: plan ? plan.slice(0, 2000) : null,
    gitnexus: gnMeta || null,
    agents: agents,
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

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(getFullState()));
  ws.on('message', (raw) => { try { handleClientMessage(JSON.parse(raw.toString())); } catch {} });
  ws.on('close', () => clients.delete(ws));
});

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
      } catch (e) { broadcast({ type: 'log', level: 'error', text: `Rollback failed: ${e.message}` }); }
      break;
    }
    case 'message': {
      const ts = new Date().toISOString();
      const existing = safeRead(FILES.inbox) || '# Gemini Inbox\n\n';
      writeFileSync(FILES.inbox, existing + `\n---\n**[${ts}]** ${msg.text}\n`);
      broadcast({ type: 'log', level: 'info', text: `Message sent to Gemini: "${msg.text}"` });
      break;
    }
  }
}

// Watch both individual files & the whole agents folder
const watcher = chokidar.watch([
  ...Object.values(FILES),
  AGENT_DIRS.rules,
  AGENT_DIRS.skills
], {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
});

watcher.on('change', (path) => {
  broadcast(getFullState());
  let label = 'Agents logic';
  for (const [k, v] of Object.entries(FILES)) { if (path === v) label = k; }
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
<title>GitNexus Mission Control</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
  :root {
    --bg: #050510;
    --bg2: #0a0a1a;
    --bg3: #111122;
    --border: #223366;
    --green: #00ffcc;
    --green-dim: #0088aa;
    --cyan: #00d4ff;
    --yellow: #ff00cc;
    --red: #ff3333;
    --gray: #667799;
    --text: #e0e0ff;
    --font: 'Courier New', 'Lucida Console', monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg); color: var(--green); font-family: var(--font); font-size: 13px; height: 100vh;
    display: flex; flex-direction: column; overflow: hidden;
  }

  /* ── Header ── */
  #header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--bg2); flex-shrink: 0; box-shadow: 0 0 20px rgba(0,212,255,0.1); }
  #header .logo { color: var(--green); font-size: 14px; font-weight: bold; letter-spacing: 3px; text-shadow: 0 0 10px var(--cyan); }
  #header .logo span { color: var(--cyan); }
  #status-badge { display: flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: 1px; }
  #status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--gray); box-shadow: 0 0 6px var(--gray); transition: all 0.3s; }
  #status-dot.running  { background: var(--cyan);  box-shadow: 0 0 12px var(--cyan); }
  #status-dot.blocked  { background: var(--yellow); box-shadow: 0 0 12px var(--yellow); animation: pulse 1s infinite; }
  #status-dot.complete { background: var(--green);   box-shadow: 0 0 12px var(--green); }
  #status-dot.idle     { background: var(--gray); }
  
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }

  /* ── Main Layout ── */
  #upper-grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr; flex: 1; overflow: hidden; border-bottom: 1px solid var(--border);
  }
  #lower-grid { flex: 1.4; overflow: hidden; display: flex; border-bottom: 1px solid var(--border); position: relative; }

  .panel { border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; flex: 1; background: rgba(5,5,16,0.8); }
  .panel:last-child { border-right: none; }

  .panel-header {
    padding: 6px 12px; background: rgba(17,17,34,0.8); border-bottom: 1px solid var(--border); color: var(--cyan); font-size: 11px; letter-spacing: 2px; text-transform: uppercase; flex-shrink: 0; display: flex; align-items: center; gap: 8px; backdrop-filter: blur(4px);
  }
  .panel-header .indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 4px var(--cyan); }
  .panel-body { padding: 12px; flex: 1; overflow-y: auto; color: var(--text); line-height: 1.6; }
  
  .panel-body::-webkit-scrollbar { width: 4px; }
  .panel-body::-webkit-scrollbar-track { background: var(--bg); }
  .panel-body::-webkit-scrollbar-thumb { background: var(--border); }

  /* ── Custom Elements ── */
  #gemini-status { color: var(--green-dim); font-size: 11px; margin-bottom: 8px; letter-spacing: 1px; }
  #gemini-thought { color: var(--text); font-size: 12px; border-left: 2px solid var(--green-dim); padding-left: 8px; min-height: 40px; white-space: pre-wrap; }
  .progress-label { font-size: 11px; color: var(--green); margin-bottom: 4px; }
  .progress-bar { margin: 10px 0; background: var(--bg3); border: 1px solid var(--border); height: 16px; position: relative; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green-dim); transition: width 0.5s; }
  .progress-fill::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 2px; background: var(--green); box-shadow: 0 0 8px var(--cyan); }
  .task-list { list-style: none; margin-top: 8px; }
  .task-list li { padding: 2px 0; font-size: 12px; display: flex; align-items: flex-start; gap: 6px; color: var(--gray); text-shadow: 0 0 4px rgba(255,255,255,0.1); }
  .task-list li.done { color: var(--green-dim); }
  .task-list li.active { color: var(--cyan); text-shadow: 0 0 8px rgba(0,212,255,0.5); }

  /* ── Agent Badges ── */
  .badge-container { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .badge { background: rgba(0,212,255,0.05); border: 1px solid var(--cyan); color: var(--cyan); padding: 2px 6px; border-radius: 4px; font-size: 10px; text-transform: uppercase; box-shadow: 0 0 8px rgba(0,212,255,0.2); }
  .badge.rule { border-color: var(--yellow); color: var(--yellow); box-shadow: 0 0 8px rgba(255,0,204,0.2); }

  /* ── GitNexus Graph UI ── */
  #d3-container { width: 100%; height: 100%; background: radial-gradient(circle at center, #111125 0%, #050510 100%); position: relative; }
  .gn-overlay { position: absolute; top: 12px; left: 12px; display: flex; flex-direction: column; gap: 8px; z-index: 10; pointer-events: none; }
  .gn-stat { background: rgba(10,10,26,0.8); border: 1px solid var(--border); padding: 6px 12px; border-radius: 4px; font-size: 11px; color: var(--cyan); backdrop-filter: blur(4px); box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
  .gn-stat span { color: var(--text); font-weight: bold; font-size: 14px; margin-right: 6px; text-shadow: 0 0 8px var(--green); }
  
  /* ── Footer ── */
  #journal-strip { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 8px 16px; flex-shrink: 0; font-size: 12px; color: var(--text); display: flex; gap: 16px; align-items: baseline; }
  #journal-strip .label { color: var(--green); letter-spacing: 1px; font-size: 11px; flex-shrink: 0; }
  #log-strip { background: var(--bg); border-bottom: 1px solid var(--border); padding: 4px 16px; flex-shrink: 0; font-size: 11px; height: 24px; overflow: hidden; color: var(--green-dim); font-style: italic; }
  #bottom-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg2); flex-shrink: 0; border-top: 1px solid var(--border); box-shadow: 0 -4px 12px rgba(0,212,255,0.05); }
  #chat-input { flex: 1; background: rgba(5,5,16,0.8); border: 1px solid var(--border); color: var(--cyan); font-family: var(--font); font-size: 13px; padding: 6px 10px; outline: none; transition: 0.2s; }
  #chat-input:focus { border-color: var(--cyan); box-shadow: 0 0 10px rgba(0,212,255,0.2); }
  .btn { background: transparent; border: 1px solid var(--border); color: var(--text); font-family: var(--font); font-size: 12px; padding: 6px 14px; cursor: pointer; letter-spacing: 1px; transition: all 0.2s; border-radius: 2px; }
  .btn:hover { border-color: var(--cyan); color: var(--cyan); box-shadow: 0 0 10px rgba(0,212,255,0.3); }
  .btn.primary { border-color: var(--cyan); color: var(--cyan); }
  .btn.warn { border-color: var(--yellow); color: var(--yellow); }
  .btn.danger { border-color: var(--red); color: var(--red); }
  #blocked-banner { display: none; background: #2a0022; border: 1px solid var(--yellow); color: var(--text); padding: 8px 16px; font-size: 12px; letter-spacing: 1px; text-align: center; flex-shrink: 0; animation: pulse 1.5s infinite; text-shadow: 0 0 8px var(--yellow); }
  #blocked-banner.visible { display: block; }
  .empty { color: var(--gray); font-size: 12px; font-style: italic; padding: 8px 0; }
</style>
</head>
<body>

<div id="header">
  <div class="logo">◉ MISSION <span>CONTROL [GitNexus.v3]</span></div>
  <div id="status-badge"><div id="status-dot" class="idle"></div><span id="status-text">IDLE</span></div>
</div>
<div id="blocked-banner">⚠ AUTOPILOT BLOCKED — Tell Gemini what's wrong, then click RESUME</div>

<div id="upper-grid">
  <div class="panel">
    <div class="panel-header"><div class="indicator"></div> GEMINI BRAIN</div>
    <div class="panel-body">
      <div id="gemini-status">STANDING BY</div>
      <div id="gemini-thought" class="empty">Waiting for plan...</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-header"><div class="indicator" style="background:var(--cyan); box-shadow:0 0 6px var(--cyan);"></div> CLAUDE HANDS</div>
    <div class="panel-body">
      <div class="progress-label">Tasks: <span id="tasks-done">0</span> / <span id="tasks-total">0</span></div>
      <div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div>
      <ul class="task-list" id="task-list"><li class="empty">No tasks loaded</li></ul>
    </div>
  </div>
  <div class="panel">
    <div class="panel-header"><div class="indicator" style="background:var(--yellow); box-shadow:0 0 6px var(--yellow);"></div> ENGINE ROOM (CAPABILITIES)</div>
    <div class="panel-body">
      <div style="font-size:11px; margin-bottom:4px; color:var(--gray);">Foundational Rules</div>
      <div class="badge-container" id="rules-list"><div class="empty">Loading...</div></div>
      <div style="font-size:11px; margin-bottom:4px; margin-top:8px; color:var(--gray);">Active Skills</div>
      <div class="badge-container" id="skills-list"><div class="empty">Loading...</div></div>
    </div>
  </div>
</div>

<div id="lower-grid">
  <div class="panel" style="border-right:none;">
    <div class="panel-header"><div class="indicator" style="background:var(--green); box-shadow:0 0 6px var(--green);"></div> GITNEXUS NEURAL GRAPH</div>
    <div class="panel-body" style="padding:0; position:relative;">
      <div class="gn-overlay">
        <div class="gn-stat"><span id="gn-nodes">0</span> NODES INDEXED</div>
        <div class="gn-stat"><span id="gn-edges">0</span> RELATIONSHIPS</div>
        <div class="gn-stat"><span id="gn-clusters">0</span> COMMUNITIES</div>
      </div>
      <div id="d3-container"></div>
    </div>
  </div>
</div>

<div id="journal-strip"><span class="label">JOURNAL</span><span class="content" id="journal-content">No entries yet</span></div>
<div id="log-strip">Connecting to GitNexus...</div>

<div id="bottom-bar">
  <input type="text" id="chat-input" placeholder="> Input query or command to the agents..." autocomplete="off">
  <button class="btn primary" onclick="sendMessage()">SEND</button>
  <button class="btn warn" id="pause-btn" onclick="togglePause()">PAUSE</button>
  <button class="btn danger" onclick="rollback()">ROLLBACK</button>
</div>

<script>
  let ws, isPaused = false, currentStatus = 'idle';
  let graphInitialized = false;

  function connect() {
    ws = new WebSocket('ws://' + location.host);
    ws.onopen = () => setLog('info', 'Connected to Mission Control [GitNexus Engine]');
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') renderState(msg);
      if (msg.type === 'log') setLog(msg.level, msg.text);
    };
    ws.onclose = () => { setLog('error', 'Signal lost — retrying in 3s...'); setTimeout(connect, 3000); };
  }

  function renderState(state) {
    const s = state.autopilot?.status || 'idle';
    currentStatus = s;
    const dot = document.getElementById('status-dot');
    dot.className = ''; dot.classList.add(s === 'in_progress' ? 'running' : s);
    document.getElementById('status-text').textContent = s.toUpperCase().replace('_', ' ');

    const banner = document.getElementById('blocked-banner');
    s === 'blocked' ? banner.classList.add('visible') : banner.classList.remove('visible');

    const pauseBtn = document.getElementById('pause-btn');
    if (s === 'blocked') { pauseBtn.textContent = 'RESUME'; pauseBtn.className = 'btn primary'; isPaused = true; }
    else { pauseBtn.textContent = 'PAUSE'; pauseBtn.className = 'btn warn'; isPaused = false; }

    const gStatus = document.getElementById('gemini-status');
    const gThought = document.getElementById('gemini-thought');
    if (s === 'in_progress') { gStatus.textContent = 'ACTIVE — PLAN IN EXECUTION'; gStatus.style.color = 'var(--cyan)'; }
    else if (s === 'blocked') { gStatus.textContent = '⚠ WAITING FOR REVIEW'; gStatus.style.color = 'var(--yellow)'; }
    else { gStatus.textContent = 'STANDING BY'; gStatus.style.color = 'var(--green-dim)'; }

    if (state.autopilot?.blockers) {
      gThought.textContent = '⚠ ' + state.autopilot.blockers;
      gThought.style.color = 'var(--yellow)'; gThought.style.borderLeftColor = 'var(--yellow)';
    } else if (state.plan) {
      const ctxMatch = state.plan.match(/## Context\\n([\\s\\S]*?)(?=##|$)/);
      gThought.textContent = ctxMatch ? ctxMatch[1].trim().slice(0, 300) : state.plan.slice(0, 300) + '...';
      gThought.style.color = 'var(--text)'; gThought.style.borderLeftColor = 'var(--cyan)';
    } else { gThought.textContent = 'Waiting for plan...'; gThought.className = 'empty'; }

    const done = state.done || 0, total = state.total || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    document.getElementById('tasks-done').textContent = done;
    document.getElementById('tasks-total').textContent = total;
    document.getElementById('progress-fill').style.width = pct + '%';

    const tl = document.getElementById('task-list');
    if (state.tasks && state.tasks.length > 0) {
      tl.innerHTML = state.tasks.map((t, i) => {
        const isActive = !t.done && state.tasks.slice(0, i).every(x => x.done);
        const cls = t.done ? 'done' : (isActive ? 'active' : '');
        const tick = t.done ? '✔' : (isActive ? '▸' : '○');
        return \`<li class="\${cls}"><span class="tick">\${tick}</span><span>\${escHtml(t.text.slice(0, 80))}</span></li>\`;
      }).join('');
    } else { tl.innerHTML = '<li class="empty">No tasks loaded</li>'; }

    if (state.agents) {
      document.getElementById('rules-list').innerHTML = state.agents.rules.length > 0 
        ? state.agents.rules.map(r => \`<div class="badge rule">\${r}</div>\`).join('') : '<div class="empty">No universal rules defined.</div>';
      document.getElementById('skills-list').innerHTML = state.agents.skills.length > 0 
        ? state.agents.skills.map(s => \`<div class="badge">\${s}</div>\`).join('') : '<div class="empty">No active skills available.</div>';
    }

    if (state.gitnexus && state.gitnexus.stats) {
      const st = state.gitnexus.stats;
      document.getElementById('gn-nodes').textContent = st.nodes.toLocaleString();
      document.getElementById('gn-edges').textContent = st.edges.toLocaleString();
      document.getElementById('gn-clusters').textContent = st.communities.toLocaleString();
      if (!graphInitialized) { initD3Graph(st); graphInitialized = true; }
    }

    if (state.journal) document.getElementById('journal-content').textContent = state.journal.date + ' — ' + state.journal.content.slice(0, 120).replace(/\\n/g, ' ');
  }

  // Generate a procedural D3 background visualization reflecting the GitNexus stats
  function initD3Graph(stats) {
    const width = document.getElementById('d3-container').clientWidth;
    const height = document.getElementById('d3-container').clientHeight;
    const nodeCount = Math.min(stats.nodes, 300); // Visual proxy
    
    const svg = d3.select("#d3-container").append("svg").attr("width", "100%").attr("height", "100%");
    const nodes = Array.from({length: nodeCount}, () => ({ r: Math.random() * 3 + 2, cluster: Math.floor(Math.random() * 5) }));
    const links = [];
    for(let i=0; i<Math.min(stats.edges, Math.floor(nodeCount*1.5)); i++) {
       links.push({ source: Math.floor(Math.random()*nodeCount), target: Math.floor(Math.random()*nodeCount) });
    }

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).distance(30))
      .force("charge", d3.forceManyBody().strength(-15))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(d => d.r + 2));

    const link = svg.append("g").selectAll("line").data(links).join("line")
      .attr("stroke", "rgba(0, 212, 255, 0.1)").attr("stroke-width", 1);

    const node = svg.append("g").selectAll("circle").data(nodes).join("circle")
      .attr("r", d => d.r)
      .attr("fill", d => ["#00d4ff", "#00ffcc", "#ff00cc", "#667799", "#0088aa"][d.cluster])
      .attr("opacity", 0.8)
      .call(d3.drag()
        .on("start", d => { if(!d.active) simulation.alphaTarget(0.3).restart(); d.subject.fx = d.subject.x; d.subject.fy = d.subject.y; })
        .on("drag", d => { d.subject.fx = d.x; d.subject.fy = d.y; })
        .on("end", d => { if(!d.active) simulation.alphaTarget(0); d.subject.fx = null; d.subject.fy = null; }));

    simulation.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("cx", d => d.x).attr("cy", d => d.y);
    });
  }

  function setLog(level, text) {
    const el = document.getElementById('log-strip');
    const colors = { info: 'var(--cyan)', warn: 'var(--yellow)', error: 'var(--red)' };
    el.style.color = colors[level] || 'var(--cyan)';
    el.textContent = '[' + new Date().toTimeString().slice(0, 8) + '] ' + text;
  }

  function sendMessage() {
    const input = document.getElementById('chat-input');
    if (!input.value.trim() || !ws) return;
    ws.send(JSON.stringify({ action: 'message', text: input.value.trim() }));
    input.value = '';
    setLog('info', 'Command sent to Agent Matrix');
  }

  function togglePause() { ws && ws.send(JSON.stringify({ action: isPaused ? 'resume' : 'pause' })); }
  function rollback() { if (confirm('Deploy rollback routine?') && ws) ws.send(JSON.stringify({ action: 'rollback' })); }
  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  document.getElementById('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
  window.addEventListener('resize', () => { document.getElementById('d3-container').innerHTML = ''; graphInitialized = false; });

  connect();
</script>
</body>
</html>`;
}

server.listen(PORT, () => {
  console.log(`\n  ◉ GITNEXUS MISSION CONTROL [v3]`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Dashboard: http://localhost:${PORT}`);
  console.log(`  ─────────────────────────────\n`);
});

process.on('SIGINT', () => { watcher.close(); server.close(); process.exit(0); });
