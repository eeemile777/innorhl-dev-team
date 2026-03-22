/**
 * InnoRHL Control Room — Client
 * Multi-session, multi-terminal split-screen dashboard
 */

// ─── State ───────────────────────────────────────────────────────────────────

let ws = null;
let reconnectDelay      = 1000;
let activeProjectId     = null;
let activeAgentsSession = null; // sessionId selected in Agents tab, null = project root
let projects            = [];
let sidebarOpen         = false;
let allSessions         = []; // list of {sessionId, name, status, ...} from server

// Session modal state (one modal at a time)
let activeModalSessionId = null;
let modalTerminal        = null;
let modalFitAddon        = null;
let modalReady           = false;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const loginScreen   = $('login-screen');
const appScreen     = $('app');
const passwordInput = $('password-input');
const loginBtn      = $('login-btn');
const loginError    = $('login-error');

const sidebar       = $('sidebar');
const projectList   = $('project-list');
const projectTitle  = $('project-title');

const statusDot       = $('status-dot');
const agentBadge      = $('agent-badge');
const autopilotStatus = $('autopilot-status');
const progressFill    = $('progress-fill');
const tasksDone       = $('tasks-done');
const tasksTotal      = $('tasks-total');
const planContext     = $('plan-context');
const journalSummary  = $('journal-summary');
const btnPause        = $('btn-pause');
const btnResume       = $('btn-resume');

const sessionsGrid     = $('sessions-grid');
const sessionsOverview = $('sessions-overview');

const taskList    = $('task-list');
const logOutput   = $('log-output');
const activityFeed = $('activity-feed');

// ─── Notifications ───────────────────────────────────────────────────────────

let notificationsEnabled = false;

function requestNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => { notificationsEnabled = (p === 'granted'); });
  } else if ('Notification' in window && Notification.permission === 'granted') {
    notificationsEnabled = true;
  }
}

function notify(title, body) {
  if (!notificationsEnabled || document.hasFocus()) return;
  try { new Notification(title, { body, icon: '●' }); } catch {}
}

// ─── Login ───────────────────────────────────────────────────────────────────

function attemptLogin() {
  const pw = passwordInput.value.trim();
  if (!pw) return;
  loginBtn.disabled = true;
  loginBtn.textContent = 'Connecting...';
  connect(pw);
}

loginBtn.addEventListener('click', attemptLogin);
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });

// ─── WebSocket ───────────────────────────────────────────────────────────────

function connect(password) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', password }));
    reconnectDelay = 1000;
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    statusDot.classList.remove('connected');
    statusDot.classList.add('error');
    if (!loginScreen.classList.contains('hidden')) return;
    setTimeout(() => connect(password), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };

  ws.onerror = () => {};
}

// ─── Message handler ─────────────────────────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {

    case 'status':
      if (msg.text === 'authenticated') {
        loginScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        statusDot.classList.add('connected');
        statusDot.classList.remove('error');
        requestNotifications();
      }
      break;

    case 'error':
      if (!loginScreen.classList.contains('hidden')) {
        loginError.classList.remove('hidden');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Enter';
      }
      break;

    case 'overview':
      projects = msg.projects || [];
      renderProjectList();
      if (!activeProjectId && projects.length > 0) selectProject(projects[0].id);
      break;

    case 'project-state':
      if (msg.id === activeProjectId) renderProjectState(msg);
      updateProjectInList(msg);
      break;

    case 'project-summary':
      updateProjectInList(msg);
      if (msg.id === activeProjectId) renderProjectState(msg);
      break;

    case 'session-list': {
      allSessions = msg.sessions || [];
      renderSessionCards();
      renderSessionsOverview();
      renderAgentsSessionSelect();
      updateSessionsCountBadge();
      renderSessionTasksInTab();
      renderLogTab();
      renderUsageTab();
      break;
    }

    case 'session-state': {
      const ssIdx = allSessions.findIndex(s => s.sessionId === msg.sessionId);
      if (ssIdx !== -1) {
        allSessions[ssIdx] = { ...allSessions[ssIdx], ...msg };
      } else {
        allSessions.push(msg);
      }
      renderSessionCards();
      renderSessionsOverview();
      renderAgentsSessionSelect();
      updateSessionsCountBadge();
      renderSessionTasksInTab();
      renderLogTab();
      renderUsageTab();
      if (msg.sessionId === activeModalSessionId) updateModalContent(msg.sessionId);
      break;
    }

    case 'session-created':
      // Auto-open modal for the newly created session (it's in allSessions now via session-list)
      setTimeout(() => openSessionModal(msg.sessionId), 100);
      break;

    case 'session-started':
      if (msg.sessionId === activeModalSessionId) onModalGeminiStarted();
      break;

    case 'session-closed':
      allSessions = allSessions.filter(s => s.sessionId !== msg.sessionId);
      if (activeAgentsSession === msg.sessionId) activeAgentsSession = null;
      if (activeModalSessionId === msg.sessionId) closeSessionModal();
      renderSessionCards();
      renderSessionsOverview();
      renderAgentsSessionSelect();
      updateSessionsCountBadge();
      break;

    case 'activity':
      appendActivity(msg);
      if (msg.level === 'warn' || msg.level === 'error') {
        notify(msg.projectName || 'InnoRHL', msg.text);
      }
      if (msg.projectId === activeProjectId) {
        appendLog(msg.level, msg.text, msg.time);
      }
      break;

    case 'activity-history':
      renderActivityHistory(msg.entries || []);
      break;

    case 'gemini-status': {
      const { sessionId, text } = msg;
      if (sessionId !== activeModalSessionId || !modalTerminal) break;
      if (text === 'ready') {
        modalReady = true;
        modalTerminal.focus();
        try { modalFitAddon.fit(); } catch {}
        if (ws) ws.send(JSON.stringify({
          type: 'resize', sessionId,
          cols: modalTerminal.cols, rows: modalTerminal.rows
        }));
        const btn = $('modal-restart-btn');
        if (btn) { btn.textContent = '↺ Restart Gemini'; btn.disabled = false; }
      } else if (text && text.startsWith('ended')) {
        modalReady = false;
        modalTerminal.write(`\r\n\x1b[31mGemini ${text}\x1b[0m\r\n`);
        const btn = $('modal-restart-btn');
        if (btn) { btn.textContent = '↺ Restart Gemini'; btn.disabled = false; }
      }
      break;
    }

    case 'pty-data': {
      const { sessionId, data } = msg;
      if (sessionId === activeModalSessionId && modalTerminal) {
        modalTerminal.write(data);
      }
      break;
    }

    case 'agents-data':
      // Populate modal conversation tab if it's for the active modal session
      if (msg.sessionId && msg.sessionId === activeModalSessionId) {
        const convPanel = $('modal-panel-conv');
        if (convPanel) convPanel.innerHTML = renderAgentConversationHTML(msg.conversation || []);
      }
      // Also update Agents tab if relevant
      if ((msg.sessionId && msg.sessionId === activeAgentsSession) ||
          (!msg.sessionId && !activeAgentsSession && msg.projectId === activeProjectId)) {
        renderAgentConversation(msg.conversation || []);
      }
      break;

    case 'usage-data':
      if (msg.projectId === activeProjectId) renderUsage(msg);
      break;

    case 'settings-data':
      if (msg.projectId === activeProjectId) {
        const envEl = $('settings-env');
        const mcpEl = $('settings-mcp');
        if (envEl) envEl.value = msg.env || '';
        if (mcpEl) mcpEl.value = msg.mcp || '';
      }
      break;
      
    case 'settings-saved':
      if (msg.projectId === activeProjectId) {
        const statusMsg = $('settings-status-msg');
        if (statusMsg) {
          statusMsg.style.opacity = '1';
          setTimeout(() => { statusMsg.style.opacity = '0'; }, 3000);
        }
      }
      break;
  }
}

// ─── Project List ─────────────────────────────────────────────────────────────

function updateProjectInList(msg) {
  const si = projects.findIndex(p => p.id === msg.id);
  if (si !== -1) { projects[si] = { ...projects[si], ...msg }; renderProjectList(); }
}

function renderProjectList() {
  projectList.innerHTML = projects.map(p => {
    const status = p.autopilot?.status || 'idle';
    const active = p.id === activeProjectId ? 'active' : '';
    const taskInfo = p.total > 0 ? `${p.done}/${p.total}` : '';
    return `<div class="project-item ${active}" onclick="selectProject('${p.id}')">
      <span class="project-dot ${status}"></span>
      <span class="project-name">${escHtml(p.name)}</span>
      ${taskInfo ? `<span class="project-tasks">${taskInfo}</span>` : ''}
    </div>`;
  }).join('');
}

function selectProject(id) {
  activeProjectId = id;
  const project = projects.find(p => p.id === id);
  if (project) {
    projectTitle.textContent = project.name;
    renderProjectState(project);
  }
  renderProjectList();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'select-project', projectId: id }));
    ws.send(JSON.stringify({ type: 'list-sessions' }));
    ws.send(JSON.stringify({ type: 'get-settings', projectId: id }));
  }

  activeAgentsSession = null;
  logStarted = false;
  logOutput.innerHTML = '<div class="log-entry dimmed">Waiting for events...</div>';
  $('agent-conversation').innerHTML = '<div class="dimmed" style="padding:12px">Loading...</div>';
  $('files-sub').textContent = '—';

  if (window.innerWidth <= 700) { sidebar.classList.remove('open'); sidebarOpen = false; }
  switchView('project');
}

window.selectProject = selectProject;

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('open', sidebarOpen);
}
window.toggleSidebar = toggleSidebar;

document.querySelectorAll('.hamburger').forEach(btn => btn.addEventListener('click', toggleSidebar));
document.addEventListener('click', (e) => {
  if (window.innerWidth <= 700 && sidebarOpen &&
      !sidebar.contains(e.target) && !e.target.classList.contains('hamburger')) {
    sidebar.classList.remove('open'); sidebarOpen = false;
  }
});

// ─── View switching ───────────────────────────────────────────────────────────

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
  const view = $('view-' + viewName);
  const btn  = $('nav-' + viewName);
  if (view) view.classList.add('active');
  if (btn)  btn.classList.add('active');
}

document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ─── State rendering ──────────────────────────────────────────────────────────

function renderProjectState(state) {
  const ap     = state.autopilot || {};
  const status = ap.status || 'idle';

  const statusColors = {
    idle: 'var(--text-muted)', in_progress: 'var(--accent)',
    testing: 'var(--cyan)', waiting_for_gemini: 'var(--purple)',
    awaiting_review: 'var(--yellow)', needs_revision: 'var(--orange)',
    blocked: 'var(--orange)', complete: 'var(--green)',
    partial: 'var(--yellow)', error: 'var(--red)',
  };

  const hero = $('status-hero');
  const icon = $('status-icon');
  if (hero) hero.className = 'status-hero state-' + status;

  const statusIcons = {
    idle: '⏸', in_progress: '⚡', testing: '🧪',
    waiting_for_gemini: '🧠', awaiting_review: '🔍',
    needs_revision: '✏️', blocked: '🚧',
    complete: '✅', partial: '⏳', error: '❌',
  };
  if (icon) icon.textContent = statusIcons[status] || '⏸';

  autopilotStatus.textContent = status.replace(/_/g, ' ');
  autopilotStatus.style.color = statusColors[status] || 'var(--text)';

  const badgeMap = {
    idle: 'idle', in_progress: 'running', testing: 'testing',
    waiting_for_gemini: 'gemini', awaiting_review: 'reviewing',
    needs_revision: 'revision', blocked: 'blocked',
    complete: 'complete', partial: 'partial', error: 'error',
  };
  const badgeLabels = {
    idle: 'IDLE', in_progress: 'CLAUDE RUNNING', testing: 'RUNNING TESTS',
    waiting_for_gemini: 'GEMINI ANSWERING', awaiting_review: 'GEMINI REVIEWING',
    needs_revision: 'REVISION NEEDED', blocked: 'BLOCKED',
    complete: 'COMPLETE', partial: 'PARTIAL', error: 'ERROR',
  };
  agentBadge.className = 'agent-badge';
  agentBadge.classList.add(badgeMap[status] || 'idle');
  agentBadge.textContent = badgeLabels[status] || status.replace(/_/g, ' ').toUpperCase();

  const done  = state.done  || 0;
  const total = state.total || 0;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  tasksDone.textContent  = done;
  tasksTotal.textContent = total;

  planContext.textContent = state.planContext || 'No active plan';
  planContext.classList.toggle('dimmed', !state.planContext);

  if (state.journal) {
    journalSummary.textContent = state.journal.content;
    journalSummary.classList.remove('dimmed');
  } else {
    journalSummary.textContent = 'No entries yet';
    journalSummary.classList.add('dimmed');
  }

  // Don't overwrite Tasks tab — it now shows per-session tasks via renderSessionTasksInTab()

  btnPause.disabled  = !['in_progress','waiting_for_gemini','awaiting_review','needs_revision','testing'].includes(status);
  btnResume.disabled = !['blocked','partial'].includes(status);

  updateAgentGraph(state);
  const filesSubEl = $('files-sub');
  if (filesSubEl) filesSubEl.textContent = (state.tasks || []).length ? `${(state.tasks||[]).length} tasks` : '—';
}

// Render all session tasks in the Tasks tab (grouped by session)
function renderSessionTasksInTab() {
  if (!taskList) return;
  if (!allSessions.length) {
    taskList.innerHTML = '<div class="dimmed" style="padding:16px">No sessions — create a session to get tasks.</div>';
    return;
  }
  const html = allSessions.map(s => {
    const tasks = s.tasks || [];
    const statusColor = STATUS_COLOR?.[s.status] || 'var(--text-dim)';
    const statusIcon  = STATUS_ICON?.[s.status]  || '○';
    const done = tasks.filter(t => t.done).length;
    return `<div class="session-task-group">
      <div class="stg-header" onclick="openSessionModal('${escAttr(s.sessionId)}')">
        <span>${statusIcon}</span>
        <span class="stg-name">${escHtml(s.name)}</span>
        <span style="color:${statusColor};font-size:11px">${done}/${tasks.length}</span>
      </div>
      ${tasks.length ? tasks.map((t, i) => {
        const cls = t.done ? 'done' : (i === tasks.findIndex(x => !x.done) ? 'active' : '');
        return `<div class="task-item ${cls}">
          <span class="task-check ${t.done ? 'done' : cls}">${t.done ? '✓' : cls === 'active' ? '▶' : '○'}</span>
          <span class="task-text ${t.done ? 'done' : ''}">${escHtml(t.text)}</span>
        </div>`;
      }).join('') : '<div class="dimmed" style="padding:8px 16px;font-size:12px">No tasks yet</div>'}
    </div>`;
  }).join('');
  taskList.innerHTML = html;
}

function renderTasks(tasks) {
  if (!tasks.length) { taskList.innerHTML = '<div class="dimmed">No tasks loaded</div>'; return; }
  taskList.innerHTML = tasks.map((t, i) => {
    const cls      = t.done ? 'done' : (i === tasks.findIndex(x => !x.done) ? 'active' : '');
    const checkCls = t.done ? 'done' : (cls === 'active' ? 'active' : 'pending');
    const icon     = t.done ? '✓' : (cls === 'active' ? '▶' : '○');
    return `<div class="task-item ${cls}">
      <span class="task-check ${checkCls}">${icon}</span>
      <span class="task-text ${t.done ? 'done' : ''}">${escHtml(t.text)}</span>
    </div>`;
  }).join('');
}

// ─── Session Cards + Modal System ─────────────────────────────────────────────

function promptNewSession() {
  const modal = $('create-session-modal');
  const input = $('create-session-name');
  if (modal) modal.classList.remove('hidden');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
}
window.promptNewSession = promptNewSession;

function confirmNewSession() {
  const input = $('create-session-name');
  const name  = input?.value.trim();
  if (!name) { if (input) input.focus(); return; }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'create-session', name }));
  }
  cancelNewSession();
}
window.confirmNewSession = confirmNewSession;

function cancelNewSession() {
  const modal = $('create-session-modal');
  if (modal) modal.classList.add('hidden');
}
window.cancelNewSession = cancelNewSession;

// Close create-session modal on backdrop click
document.addEventListener('click', (e) => {
  if (e.target === $('create-session-modal')) cancelNewSession();
});

function updateSessionsCountBadge() {
  const badge = $('sessions-count-badge');
  if (!badge) return;
  badge.textContent = allSessions.length > 0 ? allSessions.length : '';
  badge.style.display = allSessions.length > 0 ? 'inline-flex' : 'none';
}

const STATUS_ICON = {
  idle: '○', in_progress: '⚡', testing: '🧪',
  waiting_for_gemini: '🧠', awaiting_review: '🔍',
  needs_revision: '✏️', blocked: '🚧',
  complete: '✅', partial: '⏳', error: '❌',
};
const STATUS_COLOR = {
  idle: 'var(--text-muted)', in_progress: 'var(--accent)', testing: 'var(--cyan)',
  waiting_for_gemini: 'var(--purple)', awaiting_review: 'var(--yellow)',
  needs_revision: 'var(--orange)', blocked: 'var(--orange)',
  complete: 'var(--green)', partial: 'var(--yellow)', error: 'var(--red)',
};

function renderSessionCards() {
  if (!sessionsGrid) return;
  const emptyEl = $('sessions-empty-state');

  if (!allSessions.length) {
    sessionsGrid.innerHTML = '';
    if (emptyEl) sessionsGrid.appendChild(emptyEl);
    return;
  }

  // Remove empty state if present
  if (emptyEl && emptyEl.parentNode === sessionsGrid) sessionsGrid.removeChild(emptyEl);

  // Render cards (preserve empty state node)
  const cards = allSessions.map(s => {
    const status   = s.status || 'idle';
    const icon     = STATUS_ICON[status] || '○';
    const color    = STATUS_COLOR[status] || 'var(--text-muted)';
    const pct      = s.total > 0 ? Math.round(((s.done || 0) / s.total) * 100) : 0;
    const label    = status.replace(/_/g, ' ').toUpperCase();
    const isActive = status === 'in_progress' || status === 'testing';
    const isLive   = ['in_progress','testing','waiting_for_gemini','awaiting_review'].includes(status);

    return `<div class="sc-card ${isActive ? 'sc-card--active' : ''}" onclick="openSessionModal('${escAttr(s.sessionId)}')">
      <div class="sc-header">
        <span class="sc-icon">${icon}</span>
        <span class="sc-name">${escHtml(s.name)}</span>
        ${isLive ? '<span class="sc-live-dot"></span>' : ''}
      </div>
      <div class="sc-status" style="color:${color}">${label}</div>
      <div class="sc-progress-wrap">
        <div class="sc-progress-bar"><div class="sc-progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="sc-progress-text">${s.done || 0}/${s.total || 0} tasks</span>
      </div>
      <div class="sc-footer">
        <button class="sc-btn" onclick="event.stopPropagation();openSessionModal('${escAttr(s.sessionId)}')">Open →</button>
        ${s.status === 'complete' ? `<button class="sc-btn sc-btn--merge" onclick="event.stopPropagation();mergeSession('${escAttr(s.sessionId)}')">Merge to main</button>` : ''}
        <button class="sc-btn sc-btn--danger" onclick="event.stopPropagation();closeSession(event,'${escAttr(s.sessionId)}')">✕</button>
      </div>
    </div>`;
  }).join('');

  sessionsGrid.innerHTML = cards;
}

function renderSessionsOverview() {
  if (!sessionsOverview) return;
  if (!allSessions.length) {
    sessionsOverview.innerHTML = '<div class="dimmed" style="padding:12px">No sessions yet — create one in the Sessions tab.</div>';
    return;
  }
  sessionsOverview.innerHTML = allSessions.map(s => {
    const color = STATUS_COLOR[s.status] || 'var(--text-muted)';
    const icon  = STATUS_ICON[s.status] || '○';
    return `<div class="session-card" style="cursor:pointer" onclick="openSessionModal('${escAttr(s.sessionId)}')">
      <div class="session-card-header">
        <span class="session-card-name">${icon} ${escHtml(s.name)}</span>
        <span class="session-card-status" style="color:${color}">${escHtml(s.status || 'idle')}</span>
      </div>
      <div class="session-card-footer">
        <span class="session-card-tasks">${s.done || 0}/${s.total || 0} tasks</span>
        <button class="btn-xs" onclick="event.stopPropagation();openSessionModal('${escAttr(s.sessionId)}')">Open →</button>
      </div>
    </div>`;
  }).join('');
}

function renderAgentsSessionSelect() {
  const sel = $('agents-session-select');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Project (root) —</option>' +
    allSessions.map(s =>
      `<option value="${escAttr(s.sessionId)}">${escHtml(s.name)}</option>`
    ).join('');
  // Restore selection if still valid
  if (prev && allSessions.find(s => s.sessionId === prev)) sel.value = prev;
  else { sel.value = ''; activeAgentsSession = null; }
}

function onAgentsSessionChange() {
  const sel = $('agents-session-select');
  if (!sel) return;
  activeAgentsSession = sel.value || null;
  requestAgentsData();
}
window.onAgentsSessionChange = onAgentsSessionChange;

function requestAgentsData() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (activeAgentsSession) {
    ws.send(JSON.stringify({ type: 'get-agents', sessionId: activeAgentsSession }));
  } else if (activeProjectId) {
    ws.send(JSON.stringify({ type: 'get-agents', projectId: activeProjectId }));
  }
}

function closeSession(e, sessionId) {
  if (e) e.stopPropagation();
  if (!confirm('Delete this session?')) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'close-session', sessionId }));
  }
}
window.closeSession = closeSession;

function mergeSession(sessionId) {
  if (!confirm('Merge this session branch to main? Make sure all work is committed.')) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'merge-session', sessionId }));
  }
}
window.mergeSession = mergeSession;

// ─── Session Modal ─────────────────────────────────────────────────────────────

function openSessionModal(sessionId) {
  const session = allSessions.find(s => s.sessionId === sessionId);
  if (!session) return;

  activeModalSessionId = sessionId;
  modalReady = false;

  const overlay = $('session-modal-overlay');
  if (overlay) overlay.classList.remove('hidden');

  const nameEl = $('modal-session-name');
  if (nameEl) nameEl.textContent = session.name;
  const idLabel = $('modal-session-id-label');
  if (idLabel) idLabel.textContent = sessionId;

  const btn = $('modal-restart-btn');
  if (btn) { btn.textContent = '↺ Restart Gemini'; btn.disabled = false; }

  updateModalBadge(session.status || 'idle');
  initModalTerminal(sessionId);
  updateModalContent(sessionId);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'get-agents', sessionId }));
  }

  switchModalTab('status');
  document.body.style.overflow = 'hidden';
}
window.openSessionModal = openSessionModal;

function closeSessionModal() {
  activeModalSessionId = null;
  modalReady = false;
  if (modalTerminal) {
    try { modalTerminal.dispose(); } catch {}
    modalTerminal = null; modalFitAddon = null;
  }
  const canvas = $('modal-terminal-canvas');
  if (canvas) canvas.innerHTML = '';
  const overlay = $('session-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.style.overflow = '';
}
window.closeSessionModal = closeSessionModal;

document.addEventListener('click', (e) => {
  if (e.target === $('session-modal-overlay')) closeSessionModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeModalSessionId) closeSessionModal();
});

function initModalTerminal(sessionId) {
  if (modalTerminal) { try { modalTerminal.dispose(); } catch {} modalTerminal = null; modalFitAddon = null; }
  const canvas = $('modal-terminal-canvas');
  if (!canvas) return;
  canvas.innerHTML = '';

  modalTerminal = new Terminal({
    cursorBlink: true, fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: { background: '#060a10', foreground: '#e2e8f0', cursor: '#4f8ef7' },
    convertEol: true, scrollback: 2000,
  });
  modalFitAddon = new FitAddon.FitAddon();
  modalTerminal.loadAddon(modalFitAddon);
  modalTerminal.open(canvas);
  modalTerminal.write('\x1b[36mConnecting to Gemini...\x1b[0m\r\n');

  setTimeout(() => {
    try { modalFitAddon.fit(); } catch {}
    if (ws && ws.readyState === WebSocket.OPEN) {
      // force: false = reconnect to existing PTY if alive, preserving conversation
      ws.send(JSON.stringify({ type: 'start-gemini', sessionId, force: false }));
    }
  }, 80);

  modalTerminal.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN && modalReady) {
      ws.send(JSON.stringify({ type: 'pty-input', sessionId: activeModalSessionId, data }));
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!modalTerminal || !modalFitAddon) return;
      try {
        modalFitAddon.fit();
        if (modalReady && ws) ws.send(JSON.stringify({
          type: 'resize', sessionId: activeModalSessionId,
          cols: modalTerminal.cols, rows: modalTerminal.rows
        }));
      } catch {}
    });
    ro.observe(canvas);
  }
}

function onModalGeminiStarted() { /* PTY is now running, ready flag set by gemini-status */ }

function restartModalGemini() {
  if (!activeModalSessionId || !ws || ws.readyState !== WebSocket.OPEN) return;
  modalReady = false;
  if (modalTerminal) { try { modalTerminal.clear(); } catch {} modalTerminal.write('\x1b[33mRestarting Gemini...\x1b[0m\r\n'); }
  // force: true = always kill and restart (user explicitly requested restart)
  ws.send(JSON.stringify({ type: 'start-gemini', sessionId: activeModalSessionId, force: true }));
  const btn = $('modal-restart-btn');
  if (btn) { btn.textContent = 'Starting...'; btn.disabled = true; }
}
window.restartModalGemini = restartModalGemini;

function sendModalInput() {
  const input = $('modal-input');
  if (!input || !input.value.trim() || !modalReady) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'pty-input', sessionId: activeModalSessionId, data: input.value + '\n' }));
    input.value = '';
  }
}
window.sendModalInput = sendModalInput;

// Wire modal textarea enter key after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const input = $('modal-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendModalInput(); }
    });
  }
});

function switchModalTab(tab) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.modal-tab[onclick*="${tab}"]`);
  const panel = $(`modal-panel-${tab}`);
  if (btn) btn.classList.add('active');
  if (panel) panel.classList.add('active');
}
window.switchModalTab = switchModalTab;

function updateModalBadge(status) {
  const badge = $('modal-agent-badge');
  if (!badge) return;
  const labels = {
    idle: 'IDLE', in_progress: 'CLAUDE RUNNING', testing: 'RUNNING TESTS',
    waiting_for_gemini: 'GEMINI ANSWERING', awaiting_review: 'GEMINI REVIEWING',
    needs_revision: 'REVISION NEEDED', blocked: 'BLOCKED',
    complete: 'COMPLETE', partial: 'PARTIAL', error: 'ERROR',
  };
  const cls = {
    idle: 'idle', in_progress: 'running', testing: 'testing',
    waiting_for_gemini: 'gemini', awaiting_review: 'reviewing',
    needs_revision: 'revision', blocked: 'blocked',
    complete: 'complete', partial: 'partial', error: 'error',
  };
  badge.className = 'agent-badge ' + (cls[status] || 'idle');
  badge.textContent = labels[status] || status.replace(/_/g, ' ').toUpperCase();
}

function updateModalContent(sessionId) {
  const session = allSessions.find(s => s.sessionId === sessionId);
  if (!session) return;
  updateModalBadge(session.status || 'idle');

  const statusPanel = $('modal-panel-status');
  if (statusPanel) {
    const color = STATUS_COLOR[session.status] || 'var(--text-muted)';
    const pct = session.total > 0 ? Math.round(((session.done || 0) / session.total) * 100) : 0;
    statusPanel.innerHTML = `
      <div class="modal-status-hero" style="color:${color}">
        <span class="modal-status-icon">${STATUS_ICON[session.status] || '○'}</span>
        <span>${(session.status || 'idle').replace(/_/g, ' ')}</span>
      </div>
      <div class="modal-info-row">
        <span class="modal-info-label">Progress</span>
        <div class="sc-progress-bar" style="flex:1"><div class="sc-progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="modal-info-value">${session.done || 0}/${session.total || 0}</span>
      </div>
      ${session.autopilot?.blockers ? `<div class="modal-blockers">🚧 ${escHtml(session.autopilot.blockers)}</div>` : ''}
      <div class="modal-actions-row">
        ${session.status === 'complete' ? `<button class="btn-sm primary" onclick="mergeSession('${escAttr(sessionId)}')">Merge to main</button>` : ''}
        <button class="btn-sm danger" onclick="closeSession(null,'${escAttr(sessionId)}')">Delete</button>
      </div>`;
  }

  const tasksPanel = $('modal-panel-tasks');
  if (tasksPanel) {
    const tasks = session.tasks || [];
    if (!tasks.length) {
      tasksPanel.innerHTML = '<div class="dimmed" style="padding:16px">No tasks yet — chat with Gemini to create a plan.</div>';
    } else {
      tasksPanel.innerHTML = tasks.map((t, i) => {
        const cls  = t.done ? 'done' : (i === tasks.findIndex(x => !x.done) ? 'active' : '');
        const icon = t.done ? '✓' : (cls === 'active' ? '▶' : '○');
        return `<div class="task-item ${cls}">
          <span class="task-check ${t.done ? 'done' : cls}">${icon}</span>
          <span class="task-text ${t.done ? 'done' : ''}">${escHtml(t.text)}</span>
        </div>`;
      }).join('');
    }
  }
}

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $('panel-' + tab.dataset.tab).classList.add('active');

    if (tab.dataset.tab === 'chat') {
      // Sessions tab — nothing special needed
    }
    if (tab.dataset.tab === 'agents') {
      requestAgentsData();
    }
    if (tab.dataset.tab === 'usage' && ws && ws.readyState === WebSocket.OPEN && activeProjectId) {
      ws.send(JSON.stringify({ type: 'get-usage', projectId: activeProjectId }));
    }
  });
});

// ─── Log Tab — Session Journals ───────────────────────────────────────────────

function renderLogTab() {
  if (!logOutput) return;
  if (!allSessions.length) {
    logOutput.innerHTML = '<div class="log-entry dimmed">No sessions yet — journals will appear here after Claude completes work.</div>';
    return;
  }

  const html = allSessions.map(s => {
    const entries = s.journalEntries || [];
    const color   = STATUS_COLOR?.[s.status] || 'var(--text-dim)';
    const icon    = STATUS_ICON?.[s.status]  || '○';
    const entriesHtml = entries.length
      ? entries.map(e => `
          <div class="journal-entry">
            <div class="journal-date">${escHtml(e.date)}</div>
            <div class="journal-content">${escHtml(e.content)}</div>
          </div>`).join('')
      : '<div class="journal-empty">No journal entries yet — Claude writes here after each execution.</div>';

    return `<div class="journal-session-group">
      <div class="journal-session-header" onclick="openSessionModal('${escAttr(s.sessionId)}')">
        <span>${icon}</span>
        <span class="journal-session-name">${escHtml(s.name)}</span>
        <span style="color:${color};font-size:11px;text-transform:uppercase">${escHtml(s.status || 'idle')}</span>
        <span class="journal-entry-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>
      </div>
      <div class="journal-entries">${entriesHtml}</div>
    </div>`;
  }).join('');

  logOutput.innerHTML = html;
}

// Keep appendLog for real-time server events (used internally, not shown in log tab)
let logStarted = false;
function appendLog(level, text, time) {
  logStarted = true; // suppress old behavior silently
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

let activityStarted = false;

function appendActivity(entry) {
  if (!activityStarted) { activityFeed.innerHTML = ''; activityStarted = true; }
  const div = document.createElement('div');
  div.className = 'activity-entry ' + (entry.level || 'info');
  const t = entry.time ? new Date(entry.time).toLocaleTimeString() : '';
  div.innerHTML = `
    <span class="activity-time">${escHtml(t)}</span>
    <span class="activity-project">${escHtml(entry.projectName || '')}</span>
    <span class="activity-text">${escHtml(entry.text || '')}</span>
  `;
  activityFeed.appendChild(div);
  activityFeed.scrollTop = activityFeed.scrollHeight;
}

function renderActivityHistory(entries) {
  activityFeed.innerHTML = '';
  if (!entries.length) {
    activityFeed.innerHTML = '<div class="dimmed" style="padding:20px">No activity yet</div>';
    return;
  }
  activityStarted = true;
  entries.forEach(e => appendActivity(e));
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function doAction(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !activeProjectId) return;
  ws.send(JSON.stringify({ type: 'action', action, projectId: activeProjectId }));
}
window.doAction = doAction;

// ─── Add Project Modal ────────────────────────────────────────────────────────

function refreshAllTemplates() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'refresh-template' })); // no projectId = all projects
}
window.refreshAllTemplates = refreshAllTemplates;

$('btn-add-project').addEventListener('click', () => {
  $('modal-overlay').classList.remove('hidden');
  $('new-project-name').value = '';
  $('new-project-github').value = '';
  $('new-project-path').value = '';
  $('new-project-desc').value = '';
  $('new-project-name').focus();
});

function closeModal() { $('modal-overlay').classList.add('hidden'); }
window.closeModal = closeModal;

function addProject() {
  const name      = $('new-project-name').value.trim();
  const githubUrl = $('new-project-github').value.trim();
  const path      = $('new-project-path').value.trim();
  const desc      = $('new-project-desc').value.trim();
  if (!name) { $('new-project-name').focus(); return; }
  if (!githubUrl && !path) { $('new-project-github').focus(); return; }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'add-project', name,
      githubUrl: githubUrl || undefined,
      path: path || undefined,
      description: desc,
    }));
  }
  closeModal();
}
window.addProject = addProject;

$('new-project-desc').addEventListener('keydown', (e) => { if (e.key === 'Enter') addProject(); });

// ─── Agent Graph ──────────────────────────────────────────────────────────────

let d3Env = null;

function initD3Graph(containerId) {
  if (d3Env && d3Env.simulation) d3Env.simulation.stop();
  const container = $(containerId);
  if (!container) return null;
  container.innerHTML = '';
  
  const width = container.clientWidth || 560;
  const height = container.clientHeight || 250;
  
  const svg = d3.select(container).append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', [0, 0, width, height]);
    
  svg.append('defs').append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('fill', '#4f8ef7')
    .attr('d', 'M0,-5L10,0L0,5');

  const linkGroup = svg.append('g').attr('class', 'links');
  const nodeGroup = svg.append('g').attr('class', 'nodes');

  const simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2));

  return { svg, linkGroup, nodeGroup, simulation, width, height };
}

function updateAgentGraph(state) {
  if (!d3Env) d3Env = initD3Graph('d3-container');
  if (!d3Env) return;

  const status = state.autopilot?.status || 'idle';
  let nodes = [];
  let links = [];

  if (state.gitnexus && state.gitnexus.nodes && state.gitnexus.links) {
    nodes = state.gitnexus.nodes;
    links = state.gitnexus.links;
  } else {
    // Default fallback graph modeling the agents
    nodes = [
      { id: 'gemini', label: 'Gemini Planner', size: 24, color: '#904ff7', icon: '🧠' },
      { id: 'claude', label: 'Claude Executor', size: 24, color: '#4f8ef7', icon: '🤖' },
      { id: 'files', label: 'Workspace Files', size: 18, color: '#2a2f3a', icon: '📁' }
    ];
    links = [
      { source: 'gemini', target: 'claude', label: 'PLAN.md' },
      { source: 'claude', target: 'files', label: 'edits' },
      { source: 'claude', target: 'gemini', label: 'JOURNAL.md' }
    ];
  }

  const { linkGroup, nodeGroup, simulation } = d3Env;

  // Render links
  const linkSelection = linkGroup.selectAll('.link').data(links, d => d.source.id || d.source + '-' + (d.target.id || d.target));
  linkSelection.exit().remove();
  const linkEnter = linkSelection.enter().append('path')
    .attr('class', 'link')
    .attr('stroke', '#4f8ef7')
    .attr('stroke-width', 2)
    .attr('fill', 'none')
    .attr('marker-end', 'url(#arrow)');
    
  const linkUpdate = linkEnter.merge(linkSelection);

  // Render nodes
  const nodeSelection = nodeGroup.selectAll('.node').data(nodes, d => d.id);
  nodeSelection.exit().remove();
  const nodeEnter = nodeSelection.enter().append('g')
    .attr('class', 'node')
    .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

  nodeEnter.append('circle')
    .attr('r', d => d.size || 20)
    .attr('fill', d => d.color || '#333')
    .attr('stroke', '#111')
    .attr('stroke-width', 2)
    .on('mouseover', function(e, d) { d3.select(this).attr('stroke', '#fff'); })
    .on('mouseout', function(e, d) { d3.select(this).attr('stroke', '#111'); });

  nodeEnter.append('text')
    .attr('dy', 5)
    .attr('text-anchor', 'middle')
    .attr('font-size', '16px')
    .style('pointer-events', 'none')
    .text(d => d.icon || '');
    
  nodeEnter.append('text')
    .attr('dy', 38)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .attr('fill', '#aaa')
    .text(d => d.label || d.id);

  const nodeUpdate = nodeEnter.merge(nodeSelection);

  simulation.nodes(nodes).on('tick', () => {
    linkUpdate.attr('d', d => {
      const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y;
      const dr = Math.sqrt(dx * dx + dy * dy);
      const curve = d.label === 'JOURNAL.md' ? `A${dr},${dr} 0 0,1` : 'L';
      return d.label === 'JOURNAL.md' 
        ? `M${d.source.x},${d.source.y} ${curve} ${d.target.x},${d.target.y}`
        : `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`;
    });
    nodeUpdate.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  simulation.force('link').links(links);
  simulation.alpha(1).restart();
  
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
  }
}

// ─── Agent Conversation ───────────────────────────────────────────────────────

function renderAgentConversationHTML(messages) {
  if (!messages || messages.length === 0) {
    return '<div class="dimmed" style="padding:12px">No conversation yet.</div>';
  }
  return messages.map(msg => {
    if (msg.agent === 'gemini' && msg.type === 'plan') {
      return `<div class="conv-msg gemini">
        <div class="conv-header">
          <span class="conv-avatar gemini">🧠</span>
          <span class="conv-name">Gemini</span>
          <span class="conv-tag">PLAN</span>
        </div>
        <div class="conv-body">
          <div class="conv-title">${escHtml(msg.title)}</div>
          ${msg.context ? `<div class="conv-section"><span class="conv-section-label">Context</span><p>${escHtml(msg.context)}</p></div>` : ''}
          ${msg.architecture ? `<div class="conv-section"><span class="conv-section-label">Architecture</span><p>${escHtml(msg.architecture)}</p></div>` : ''}
          <div class="conv-tasks-summary">${msg.doneTasks}/${msg.totalTasks} tasks complete</div>
        </div>
      </div>`;
    }
    if (msg.agent === 'claude' && msg.type === 'blocker') {
      return `<div class="conv-msg claude blocker">
        <div class="conv-header">
          <span class="conv-avatar claude">🤖</span>
          <span class="conv-name">Claude</span>
          <span class="conv-tag warn">BLOCKED</span>
        </div>
        <div class="conv-body">
          <div class="conv-section"><span class="conv-section-label">Blocker</span><p>${escHtml(msg.content)}</p></div>
        </div>
      </div>`;
    }
    if (msg.agent === 'claude' && msg.type === 'session-report') {
      return `<div class="conv-msg claude">
        <div class="conv-header">
          <span class="conv-avatar claude">🤖</span>
          <span class="conv-name">Claude</span>
          <span class="conv-tag">SESSION</span>
          ${msg.date ? `<span class="conv-date">${escHtml(msg.date)}</span>` : ''}
        </div>
        <div class="conv-body">
          ${msg.tasksCompleted ? `<div class="conv-tasks-summary">${escHtml(msg.tasksCompleted)} tasks · ${msg.status ? escHtml(msg.status) : ''}</div>` : ''}
          ${msg.content ? `<p class="conv-content">${escHtml(msg.content)}</p>` : ''}
        </div>
      </div>`;
    }
    return '';
  }).join('');
}

function renderAgentConversation(messages) {
  const container = $('agent-conversation');
  if (container) container.innerHTML = renderAgentConversationHTML(messages);
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function fmtTime(minutes) {
  if (!minutes) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function renderUsage(stats) {
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('usage-today-sessions', stats.today?.count ?? 0);
  set('usage-today-time',     fmtTime(stats.today?.minutes));
  set('usage-week-sessions',  stats.week?.count ?? 0);
  set('usage-week-time',      fmtTime(stats.week?.minutes));
  set('usage-total-sessions', stats.total?.count ?? 0);
  set('usage-total-time',     fmtTime(stats.total?.minutes));

  const listEl = $('usage-session-list');
  if (!listEl) return;
  const recent = stats.recent || [];
  if (!recent.length) {
    listEl.innerHTML = '<div class="dimmed" style="padding:12px">No sessions recorded yet.</div>';
    return;
  }
  listEl.innerHTML = recent.map(s => {
    const start    = new Date(s.start);
    const dateStr  = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeStr  = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusCls = s.endStatus === 'complete' ? 'complete' : s.endStatus === 'blocked' ? 'warn' : '';
    return `<div class="session-item">
      <div class="session-when">${escHtml(dateStr)} <span class="session-time">${escHtml(timeStr)}</span></div>
      <div class="session-duration">${s.durationMin ?? 0} min</div>
      <div class="session-status ${statusCls}">${escHtml(s.endStatus || '—')}</div>
    </div>`;
  }).join('');
}

// Render Usage tab from session data (per-session breakdown)
function renderUsageTab() {
  const listEl = $('usage-session-list');
  if (!listEl) return;

  if (!allSessions.length) {
    listEl.innerHTML = '<div class="dimmed" style="padding:12px">No sessions yet.</div>';
    return;
  }

  // Summary stats
  const total    = allSessions.length;
  const complete = allSessions.filter(s => s.status === 'complete').length;
  const active   = allSessions.filter(s => ['in_progress','testing','waiting_for_gemini','awaiting_review'].includes(s.status)).length;
  const totalTasks = allSessions.reduce((sum, s) => sum + (s.total || 0), 0);
  const doneTasks  = allSessions.reduce((sum, s) => sum + (s.done  || 0), 0);

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('usage-today-sessions', active);
  set('usage-today-time',     `${active} running`);
  set('usage-week-sessions',  complete);
  set('usage-week-time',      `${complete} complete`);
  set('usage-total-sessions', total);
  set('usage-total-time',     `${doneTasks}/${totalTasks} tasks`);

  // Per-session list
  listEl.innerHTML = allSessions.map(s => {
    const color = STATUS_COLOR?.[s.status] || 'var(--text-muted)';
    const icon  = STATUS_ICON?.[s.status]  || '○';
    const pct   = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const created = s.createdAt ? new Date(s.createdAt).toLocaleDateString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    const updated = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—';
    return `<div class="usage-session-row" onclick="openSessionModal('${escAttr(s.sessionId)}')">
      <div class="usr-icon">${icon}</div>
      <div class="usr-info">
        <div class="usr-name">${escHtml(s.name)}</div>
        <div class="usr-meta">Created ${escHtml(created)} · Last active ${escHtml(updated)}</div>
        <div class="usr-bar"><div class="usr-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>
      <div class="usr-stat">
        <div style="color:${color};font-weight:700;font-size:11px">${escHtml((s.status||'idle').replace(/_/g,' ').toUpperCase())}</div>
        <div style="color:var(--text-dim);font-size:11px">${s.done||0}/${s.total||0} tasks</div>
      </div>
    </div>`;
  }).join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function escAttr(str) {
  return escHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Update pane statuses when session-state arrives
// (already handled in the handleMessage switch above via updatePaneStatus call)

// ─── Settings ────────────────────────────────────────────────────────────────
function saveProjectSettings() {
  if (!activeProjectId || !ws || ws.readyState !== WebSocket.OPEN) return;
  const env = $('settings-env')?.value || '';
  const mcp = $('settings-mcp')?.value || '';
  ws.send(JSON.stringify({ type: 'save-settings', projectId: activeProjectId, env, mcp }));
}
window.saveProjectSettings = saveProjectSettings;
