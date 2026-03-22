/**
 * InnoRHL Control Room — Client
 * Multi-session, multi-terminal split-screen dashboard
 */

// ─── State ───────────────────────────────────────────────────────────────────

let ws = null;
let reconnectDelay      = 1000;
let activeProjectId     = null;
let activeSessionId     = null;     // replaces activeAgentsSession
let activePanel         = 'overview'; // replaces tab-based navigation
let projects            = [];
let sidebarOpen         = false;
let allSessions         = []; // list of {sessionId, name, status, ...} from server
const ptyBuffers        = new Map(); // sessionId -> accumulated PTY output

// Agent Flow inline terminal state
let agentFlowTerminal = null;
let agentFlowFitAddon = null;

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
    if (!loginScreen.classList.contains('hidden')) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Enter';
      if (loginError) { loginError.textContent = 'Connection failed. Is the server running?'; loginError.style.display = 'block'; }
      return;
    }
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

    case 'error': {
      const loginScreen = $('login-screen');
      if (loginScreen && loginScreen.style.display !== 'none') {
        // During login — show in login UI
        const errEl = $('login-error');
        if (errEl) { errEl.textContent = msg.text; errEl.style.display = 'block'; }
      } else {
        // Post-auth — show as toast notification
        showToast(msg.text, 'error');
      }
      break;
    }

    case 'overview':
      projects = msg.projects || [];
      renderProjectList();
      if (!activeProjectId && projects.length > 0) selectProject(projects[0].id);
      if (msg.gemini_available === false) {
        showToast('Warning: Gemini CLI not found — autopilot Q&A disabled', 'warn');
      }
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
      if (ssIdx === -1) break; // not in our current project's sessions — ignore
      allSessions[ssIdx] = { ...allSessions[ssIdx], ...msg };
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
      // Auto-select the newly created session
      setTimeout(() => selectActiveSession(msg.sessionId), 100);
      break;

    case 'session-started':
      if (msg.sessionId === activeModalSessionId) onModalGeminiStarted();
      break;

    case 'session-closed':
      allSessions = allSessions.filter(s => s.sessionId !== msg.sessionId);
      if (activeSessionId === msg.sessionId) clearActiveSession();
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
      // Handle modal terminal
      if (sessionId === activeModalSessionId && modalTerminal) {
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
      }
      // Handle inline agent-flow terminal
      if (sessionId === agentFlowSessionId && agentFlowTerminal) {
        if (text === 'ready') {
          agentFlowReady = true;
          agentFlowTerminal.focus();
          try { agentFlowFitAddon.fit(); } catch {}
          if (ws) ws.send(JSON.stringify({
            type: 'resize', sessionId,
            cols: agentFlowTerminal.cols, rows: agentFlowTerminal.rows
          }));
          const rbtn = $('btn-restart-gemini');
          if (rbtn) { rbtn.textContent = '↺ Restart Gemini'; rbtn.disabled = false; }
        } else if (text && text.startsWith('ended')) {
          agentFlowReady = false;
          agentFlowTerminal.write(`\r\n\x1b[31mGemini ${text}\x1b[0m\r\n`);
          const rbtn = $('btn-restart-gemini');
          if (rbtn) { rbtn.textContent = '↺ Restart Gemini'; rbtn.disabled = false; }
        }
      }
      break;
    }

    case 'pty-data': {
      const { sessionId, data } = msg;
      if (sessionId === activeModalSessionId && modalTerminal) {
        modalTerminal.write(data);
      }
      // Also write to inline agent-flow terminal
      if (sessionId === agentFlowSessionId && agentFlowTerminal) {
        agentFlowTerminal.write(data);
      }
      // Buffer PTY data per session
      if (!ptyBuffers.has(sessionId)) ptyBuffers.set(sessionId, '');
      ptyBuffers.set(sessionId, ptyBuffers.get(sessionId) + data);
      break;
    }

    case 'agents-data':
      // Populate modal conversation tab if it's for the active modal session
      if (msg.sessionId && msg.sessionId === activeModalSessionId) {
        const convPanel = $('modal-panel-conv');
        if (convPanel) convPanel.innerHTML = renderAgentConversationHTML(msg.conversation || []);
      }
      // Also update Agents tab if relevant
      if ((msg.sessionId && msg.sessionId === activeSessionId) ||
          (!msg.sessionId && !activeSessionId && msg.projectId === activeProjectId)) {
        renderAgentConversation(msg.conversation || []);
      }
      break;

    case 'graph-data':
      if (msg.projectId === activeProjectId) renderCodeGraph(msg);
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

    case 'autopilot-status': {
      // Real-time autopilot state transitions from the server reactor
      const { projectId, sessionId, status, reason, exitCode } = msg;

      // Update agent badge in header
      if (projectId === activeProjectId || !projectId) {
        updateAgentBadge(status);
      }

      // Notifications for important state changes
      if (status === 'completed') {
        notify('Autopilot Complete', `All tasks finished${sessionId ? ` (${sessionId})` : ''}`);
      } else if (status === 'blocked') {
        notify('Autopilot Blocked', reason || 'Manual intervention needed');
      } else if (status === 'running') {
        // Claude just spawned — update UI
        appendLog('info', `Claude spawned${sessionId ? ` for session ${sessionId}` : ''}`, new Date().toISOString());
      }

      // Refresh project state to get latest data
      if (ws && projectId === activeProjectId) {
        ws.send(JSON.stringify({ type: 'select-project', projectId }));
      }
      break;
    }

    case 'locks-updated':
      renderLocks(msg.locks || {});
      break;

    case 'autopilot-started':
      showToast('Autopilot started — Claude is executing the plan', 'info');
      break;

    case 'merge-success':
      notify('Merge Complete', `Session "${msg.sessionId}" merged to main`);
      if (ws) ws.send(JSON.stringify({ type: 'list-sessions' }));
      break;

    case 'info':
      showToast(msg.text || msg.message, 'info');
      break;
  }
}

// ─── Project List ─────────────────────────────────────────────────────────────

function updateProjectInList(msg) {
  const si = projects.findIndex(p => p.id === msg.id);
  if (si !== -1) { projects[si] = { ...projects[si], ...msg }; renderProjectList(); }
}

function renderProjectList() {
  projectList.innerHTML = '';
  projects.forEach(p => {
    const status = p.autopilot?.status || 'idle';
    const active = p.id === activeProjectId ? 'active' : '';
    const taskInfo = p.total > 0 ? `${p.done}/${p.total}` : '';
    const item = document.createElement('div');
    item.className = `project-item ${active}`;
    item.innerHTML = `
      <span class="project-dot ${status}"></span>
      <span class="project-name">${escHtml(p.name)}</span>
      ${taskInfo ? `<span class="project-tasks">${taskInfo}</span>` : ''}
    `;
    item.addEventListener('click', () => selectProject(p.id));
    if (p.id !== 'innorhl') {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-xs danger';
      removeBtn.title = 'Remove project';
      removeBtn.textContent = '×';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Remove project "${p.name}" from dashboard?`)) {
          ws.send(JSON.stringify({ type: 'remove-project', projectId: p.id }));
        }
      };
      item.appendChild(removeBtn);
    }
    projectList.appendChild(item);
  });
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

  clearActiveSession();
  codeGraphData = null; // reset so code graph reloads for new project
  logOutput.innerHTML = '<div class="log-entry dimmed">Waiting for events...</div>';
  const agentConv = $('agent-conversation');
  if (agentConv) agentConv.innerHTML = '<div class="dimmed" style="padding:12px">Loading...</div>';
  if (window.innerWidth <= 700) { sidebar.classList.remove('open'); sidebarOpen = false; }

  // Close project dropdown and navigate to overview
  const dropdown = $('project-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  const selectorName = $('project-selector-name');
  if (selectorName && project) selectorName.textContent = project.name;
  const selectorDot = $('project-selector-dot');
  if (selectorDot) {
    selectorDot.className = 'project-dot ' + (project?.autopilot?.status || 'idle');
  }
  navigateToPanel('overview');
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

// ─── Panel Navigation ─────────────────────────────────────────────────────────
const SESSION_PANELS = ['agent-flow', 'tasks', 'log', 'usage'];

function navigateToPanel(panelName) {
  if (SESSION_PANELS.includes(panelName) && !activeSessionId) return;
  activePanel = panelName;

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navBtn = $('nav-' + panelName);
  if (navBtn) navBtn.classList.add('active');

  // Update panels
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = $('panel-' + panelName);
  if (panel) panel.classList.add('active');

  // Update header context
  const ctx = $('header-session-context');
  if (ctx) {
    if (SESSION_PANELS.includes(panelName) && activeSessionId) {
      const sess = allSessions.find(s => s.sessionId === activeSessionId);
      ctx.textContent = '\u2192 ' + (sess?.name || activeSessionId);
      ctx.classList.remove('hidden');
    } else {
      ctx.classList.add('hidden');
    }
  }

  // Trigger data fetches
  if (panelName === 'agent-flow' && activeSessionId) {
    requestAgentsData();
    renderAgentFlow();
    initAgentFlowTerminal(activeSessionId);
  }
  if (panelName === 'code-graph' && !codeGraphData) requestCodeGraph();
  if (panelName === 'usage') {
    if (activeSessionId) renderUsageTab();
    else if (ws && ws.readyState === WebSocket.OPEN && activeProjectId)
      ws.send(JSON.stringify({ type: 'get-usage', projectId: activeProjectId }));
  }
  if (panelName === 'tasks') renderSessionTasksInTab();
  if (panelName === 'log') renderLogTab();
  if (panelName === 'sessions') {
    // Refresh session list
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'list-sessions' }));
  }
}
window.navigateToPanel = navigateToPanel;

// ─── Session Selection ────────────────────────────────────────────────────────

function selectActiveSession(sessionId) {
  activeSessionId = sessionId;

  // Enable session nav items
  document.querySelectorAll('.nav-item.session-scoped').forEach(btn => {
    btn.classList.remove('disabled');
  });

  // Update session label in sidebar
  const sess = allSessions.find(s => s.sessionId === sessionId);
  const nameEl = $('session-nav-name');
  if (nameEl) nameEl.textContent = sess?.name || sessionId;

  // Update session header bar in agent-flow panel
  const headerName = $('session-active-name');
  if (headerName) headerName.textContent = sess?.name || sessionId;

  // Navigate to agent-flow
  navigateToPanel('agent-flow');
}
window.selectActiveSession = selectActiveSession;

function clearActiveSession() {
  activeSessionId = null;
  document.querySelectorAll('.nav-item.session-scoped').forEach(btn => {
    btn.classList.add('disabled');
    btn.classList.remove('active');
  });
  const nameEl = $('session-nav-name');
  if (nameEl) nameEl.textContent = 'No session selected';

  if (SESSION_PANELS.includes(activePanel)) {
    navigateToPanel('sessions');
  }
}

// ─── Project Dropdown Toggle ──────────────────────────────────────────────────

function toggleProjectDropdown() {
  const dropdown = $('project-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}
window.toggleProjectDropdown = toggleProjectDropdown;

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = $('project-dropdown');
  const btn = $('project-selector-btn');
  if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// ─── Activity Drawer Toggle ───────────────────────────────────────────────────

function toggleActivityDrawer() {
  const drawer = $('activity-drawer');
  if (drawer) drawer.classList.toggle('open');
}
window.toggleActivityDrawer = toggleActivityDrawer;

// ─── Agent Badge ──────────────────────────────────────────────────────────────

const badgeMap = {
  idle: 'idle', in_progress: 'running', testing: 'testing',
  waiting_for_gemini: 'gemini', awaiting_review: 'reviewing',
  needs_revision: 'revision', needs_restart: 'restarting',
  blocked: 'blocked', complete: 'complete', completed: 'complete',
  partial: 'partial', error: 'error', stopped: 'idle',
};
const badgeLabels = {
  idle: 'IDLE', in_progress: 'CLAUDE RUNNING', testing: 'RUNNING TESTS',
  waiting_for_gemini: 'GEMINI ANSWERING', awaiting_review: 'GEMINI REVIEWING',
  needs_revision: 'REVISION NEEDED', needs_restart: 'RESTARTING',
  blocked: 'BLOCKED', complete: 'COMPLETE', completed: 'COMPLETE',
  partial: 'PARTIAL', error: 'ERROR', stopped: 'STOPPED',
};

function updateAgentBadge(status) {
  if (!agentBadge) return;
  agentBadge.className = 'agent-badge';
  agentBadge.classList.add(badgeMap[status] || 'idle');
  agentBadge.textContent = badgeLabels[status] || status.replace(/_/g, ' ').toUpperCase();
}

// ─── State rendering ──────────────────────────────────────────────────────────

function renderProjectState(state) {
  const ap     = state.autopilot || {};
  const status = ap.status || 'idle';

  const statusColors = {
    idle: 'var(--text-muted)', in_progress: 'var(--accent)',
    testing: 'var(--cyan)', waiting_for_gemini: 'var(--purple)',
    awaiting_review: 'var(--yellow)', needs_revision: 'var(--orange)',
    needs_restart: 'var(--cyan)', blocked: 'var(--orange)',
    complete: 'var(--green)', completed: 'var(--green)',
    partial: 'var(--yellow)', error: 'var(--red)', stopped: 'var(--text-muted)',
  };

  const hero = $('status-hero');
  const icon = $('status-icon');
  if (hero) hero.className = 'status-hero state-' + status;

  const statusIcons = {
    idle: '⏸', in_progress: '⚡', testing: '🧪',
    waiting_for_gemini: '🧠', awaiting_review: '🔍',
    needs_revision: '✏️', needs_restart: '🔄', blocked: '🚧',
    complete: '✅', completed: '✅', partial: '⏳', error: '❌', stopped: '⏹',
  };
  if (icon) icon.textContent = statusIcons[status] || '⏸';

  autopilotStatus.textContent = status.replace(/_/g, ' ');
  autopilotStatus.style.color = statusColors[status] || 'var(--text)';

  updateAgentBadge(status);

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

  const btnStart = $('btn-start-autopilot');
  if (btnStart) {
    btnStart.style.display = ['idle','completed','complete','stopped'].includes(status) ? '' : 'none';
  }

  updateAgentGraph(state);
}

// Render tasks for the active session only
function renderSessionTasksInTab() {
  const el = $('task-list');
  if (!el) return;
  if (!activeSessionId) {
    el.innerHTML = '<div class="dimmed">Select a session to view tasks</div>';
    return;
  }
  const sess = allSessions.find(s => s.sessionId === activeSessionId);
  if (!sess || !sess.tasks || sess.tasks.length === 0) {
    el.innerHTML = '<div class="dimmed">No tasks for this session</div>';
    return;
  }
  const tasks = sess.tasks;
  const done = tasks.filter(t => t.done).length;
  const firstPending = tasks.findIndex(t => !t.done);

  el.innerHTML = `
    <div class="card-label" style="margin-bottom:8px">${escHtml(sess.name)} — ${done}/${tasks.length} complete</div>
    ${tasks.map((t, i) => {
      const state = t.done ? 'done' : (i === firstPending ? 'active' : 'pending');
      const icon = t.done ? '✓' : (i === firstPending ? '▶' : '○');
      return `<div class="task-item ${state}">
        <span class="task-check ${state}">${icon}</span>
        <span class="task-text ${t.done ? 'done' : ''}">${escHtml(t.text)}</span>
      </div>`;
    }).join('')}
  `;
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
  // Support both old and new badge IDs
  const badge = $('nav-sessions-badge') || $('sessions-count-badge');
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

    return `<div class="sc-card ${isActive ? 'sc-card--active' : ''}" onclick="selectActiveSession('${escAttr(s.sessionId)}')">
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
        <button class="sc-btn" onclick="event.stopPropagation();selectActiveSession('${escAttr(s.sessionId)}')">Open →</button>
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
    return `<div class="session-card" style="cursor:pointer" onclick="selectActiveSession('${escAttr(s.sessionId)}')">
      <div class="session-card-header">
        <span class="session-card-name">${icon} ${escHtml(s.name)}</span>
        <span class="session-card-status" style="color:${color}">${escHtml(s.status || 'idle')}</span>
      </div>
      <div class="session-card-footer">
        <span class="session-card-tasks">${s.done || 0}/${s.total || 0} tasks</span>
        <button class="btn-xs" onclick="event.stopPropagation();selectActiveSession('${escAttr(s.sessionId)}')">Open →</button>
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
  else { sel.value = ''; }
}

// onAgentsSessionChange removed — session selection now handled by selectActiveSession

function requestAgentsData() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (activeSessionId) {
    ws.send(JSON.stringify({ type: 'get-agents', sessionId: activeSessionId }));
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
  if (window._modalResizeObserver) {
    window._modalResizeObserver.disconnect();
    window._modalResizeObserver = null;
  }
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
    if (window._modalResizeObserver) window._modalResizeObserver.disconnect();
    window._modalResizeObserver = new ResizeObserver(() => {
      if (!modalTerminal || !modalFitAddon) return;
      try {
        modalFitAddon.fit();
        if (modalReady && ws) ws.send(JSON.stringify({
          type: 'resize', sessionId: activeModalSessionId,
          cols: modalTerminal.cols, rows: modalTerminal.rows
        }));
      } catch {}
    });
    window._modalResizeObserver.observe(canvas);
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

  const btnExec = $('btn-execute-plan');
  if (btnExec) {
    btnExec.style.display = (session.status === 'idle') ? '' : 'none';
  }

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

// Tab switching removed — replaced by navigateToPanel() above

// ─── Agent Flow Inline Terminal ──────────────────────────────────────────────

let agentFlowReady    = false;
let agentFlowSessionId = null;

function initAgentFlowTerminal(sessionId) {
  if (agentFlowTerminal && agentFlowSessionId === sessionId) return;
  if (agentFlowTerminal) { try { agentFlowTerminal.dispose(); } catch {} agentFlowTerminal = null; agentFlowFitAddon = null; }
  agentFlowReady = false;
  agentFlowSessionId = sessionId;

  const canvas = $('agent-flow-terminal');
  if (!canvas) return;
  canvas.innerHTML = '';

  agentFlowTerminal = new Terminal({
    cursorBlink: true, fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: { background: '#060a10', foreground: '#e2e8f0', cursor: '#4f8ef7' },
    convertEol: true, scrollback: 2000,
  });
  agentFlowFitAddon = new FitAddon.FitAddon();
  agentFlowTerminal.loadAddon(agentFlowFitAddon);
  agentFlowTerminal.open(canvas);
  agentFlowTerminal.write('\x1b[36mConnecting to Gemini...\x1b[0m\r\n');

  setTimeout(() => {
    try { agentFlowFitAddon.fit(); } catch {}
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start-gemini', sessionId, force: false }));
    }
  }, 80);

  agentFlowTerminal.onData(data => {
    if (ws && ws.readyState === WebSocket.OPEN && agentFlowReady) {
      ws.send(JSON.stringify({ type: 'pty-input', sessionId: agentFlowSessionId, data }));
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    if (window._afResizeObserver) window._afResizeObserver.disconnect();
    window._afResizeObserver = new ResizeObserver(() => {
      if (!agentFlowTerminal || !agentFlowFitAddon) return;
      try {
        agentFlowFitAddon.fit();
        if (agentFlowReady && ws) ws.send(JSON.stringify({
          type: 'resize', sessionId: agentFlowSessionId,
          cols: agentFlowTerminal.cols, rows: agentFlowTerminal.rows
        }));
      } catch {}
    });
    window._afResizeObserver.observe(canvas);
  }
}

function sendAgentFlowInput() {
  const input = $('agent-flow-input');
  if (!input || !input.value.trim() || !agentFlowReady) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'pty-input', sessionId: agentFlowSessionId, data: input.value + '\n' }));
    input.value = '';
  }
}
window.sendAgentFlowInput = sendAgentFlowInput;

document.addEventListener('DOMContentLoaded', () => {
  const input = $('agent-flow-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentFlowInput(); }
    });
  }
});

function executeSessionPlan() {
  if (!activeSessionId || !ws) return;
  ws.send(JSON.stringify({ type: 'start-autopilot', sessionId: activeSessionId }));
}
window.executeSessionPlan = executeSessionPlan;

function restartSessionGemini() {
  if (!activeSessionId || !ws || ws.readyState !== WebSocket.OPEN) return;
  agentFlowReady = false;
  if (agentFlowTerminal) { try { agentFlowTerminal.clear(); } catch {} agentFlowTerminal.write('\x1b[33mRestarting Gemini...\x1b[0m\r\n'); }
  ws.send(JSON.stringify({ type: 'start-gemini', sessionId: activeSessionId, force: true }));
  const btn = $('btn-restart-gemini');
  if (btn) { btn.textContent = 'Starting...'; btn.disabled = true; }
}
window.restartSessionGemini = restartSessionGemini;

function closeActiveSession() {
  if (!activeSessionId) return;
  if (!confirm('Close this session?')) return;
  if (ws) ws.send(JSON.stringify({ type: 'close-session', sessionId: activeSessionId }));
  // Clean up agent flow terminal
  if (agentFlowTerminal) {
    try { agentFlowTerminal.dispose(); } catch {}
    agentFlowTerminal = null; agentFlowFitAddon = null;
  }
  agentFlowReady = false;
  agentFlowSessionId = null;
  const canvas = $('agent-flow-terminal');
  if (canvas) canvas.innerHTML = '';
  clearActiveSession();
}
window.closeActiveSession = closeActiveSession;

// ─── Log Tab — Session Journals ───────────────────────────────────────────────

function renderLogTab() {
  const el = $('log-output');
  if (!el) return;
  if (!activeSessionId) {
    el.innerHTML = '<div class="log-entry dimmed">Select a session to view log</div>';
    return;
  }
  const sess = allSessions.find(s => s.sessionId === activeSessionId);
  if (!sess || !sess.journalEntries || sess.journalEntries.length === 0) {
    el.innerHTML = '<div class="log-entry dimmed">No journal entries for this session</div>';
    return;
  }
  el.innerHTML = sess.journalEntries.map(e => `
    <div class="journal-entry" style="margin-bottom:16px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${escHtml(e.date || '')}</div>
      <div style="font-size:13px;color:var(--text-dim);line-height:1.6;white-space:pre-wrap">${escHtml(e.content || '')}</div>
    </div>
  `).join('');
}

// appendLog is a no-op stub; real-time events are shown via showToast or activity feed
function appendLog(level, text, time) {}

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

function startAutopilot() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'start-autopilot', projectId: activeProjectId }));
}
window.startAutopilot = startAutopilot;

// ─── Add Project Modal ────────────────────────────────────────────────────────

function refreshAllTemplates() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'refresh-template' })); // no projectId = all projects
}
window.refreshAllTemplates = refreshAllTemplates;

function analyzeCurrentProject() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!activeProjectId) { showToast('Select a project first', 'warn'); return; }
  const btn = $('btn-analyze-project');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing...'; setTimeout(() => { btn.disabled = false; btn.textContent = '⚡ Build Code Graph'; }, 30000); }
  ws.send(JSON.stringify({ type: 'analyze-project', projectId: activeProjectId }));
}
window.analyzeCurrentProject = analyzeCurrentProject;

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

// switchAgentsSubtab removed — replaced by navigateToPanel()

// ─── Agent Flow Graph (SVG, hand-crafted pipeline) ───────────────────────────

let lastFlowStatus = 'idle';

function renderAgentFlow(status) {
  if (status) lastFlowStatus = status;
  else status = lastFlowStatus;
  const container = $('agent-flow-svg');
  if (!container) return;

  const w = container.clientWidth || 600;
  const h = 300;
  const cx = w / 2;

  // Spatial layout: agents top, artifacts middle/bottom
  const nodes = [
    { id: 'gemini',  x: cx - 140, y: 70,  r: 38, label: 'Gemini',     sub: 'PLANNER',   emoji: '\u{1F9E0}', size: 'lg' },
    { id: 'plan',    x: cx,       y: 70,  r: 26, label: 'PLAN.md',    sub: 'CONTRACT',  emoji: '\u{1F4CB}', size: 'md' },
    { id: 'claude',  x: cx + 140, y: 70,  r: 38, label: 'Claude',     sub: 'EXECUTOR',  emoji: '\u{1F916}', size: 'lg' },
    { id: 'code',    x: cx + 140, y: 175, r: 26, label: 'Code',       sub: 'WORKSPACE', emoji: '\u{1F4C1}', size: 'md' },
    { id: 'journal', x: cx,       y: 235, r: 20, label: 'JOURNAL.md', sub: 'MEMORY',    emoji: '\u{1F4D3}', size: 'sm' },
    { id: 'inbox',   x: cx - 140, y: 175, r: 20, label: 'INBOX',      sub: 'Q&A',       emoji: '\u{1F4E8}', size: 'sm' },
  ];

  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  // Edge states
  const isRunning = ['in_progress', 'needs_restart'].includes(status);
  const isGemini = status === 'waiting_for_gemini';
  const isBlocked = status === 'blocked';
  const isDone = ['completed', 'complete'].includes(status);

  // Bezier edge definitions
  const edges = [
    { from: 'gemini', to: 'plan',    active: isGemini,  color: 'purple' },
    { from: 'plan',   to: 'claude',  active: isRunning, color: 'orange' },
    { from: 'claude', to: 'code',    active: isRunning, color: 'orange' },
    { from: 'claude', to: 'journal', active: isRunning, color: 'orange' },
    { from: 'claude', to: 'inbox',   active: isGemini,  color: 'purple' },
    { from: 'inbox',  to: 'gemini',  active: isGemini,  color: 'purple', reverse: true },
  ];

  // Node state
  const nodeState = (id) => {
    if (isDone) return 'complete';
    if (isBlocked && id === 'claude') return 'blocked';
    if (isRunning && (id === 'claude' || id === 'code')) return 'active';
    if (isGemini && (id === 'gemini' || id === 'inbox')) return 'active';
    return '';
  };

  // Color for node based on identity + state
  const nodeColor = (id, state) => {
    if (!state) return 'var(--border)';
    const isGeminiNode = id === 'gemini' || id === 'inbox';
    if (state === 'complete') return 'var(--green)';
    if (state === 'blocked') return 'var(--accent)';
    return isGeminiNode ? 'var(--purple)' : 'var(--accent)';
  };

  // SVG defs: filters, arrow markers, grid pattern
  const defs = `
    <filter id="af-glow-orange" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="af-glow-purple" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="af-glow-green" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="af-node-fill" cx="40%" cy="35%">
      <stop offset="0%" stop-color="var(--surface-3)"/>
      <stop offset="100%" stop-color="var(--surface)"/>
    </radialGradient>
    <radialGradient id="af-node-fill-active-orange" cx="40%" cy="35%">
      <stop offset="0%" stop-color="rgba(255,120,31,0.18)"/>
      <stop offset="100%" stop-color="var(--surface)"/>
    </radialGradient>
    <radialGradient id="af-node-fill-active-purple" cx="40%" cy="35%">
      <stop offset="0%" stop-color="rgba(167,139,250,0.18)"/>
      <stop offset="100%" stop-color="var(--surface)"/>
    </radialGradient>
    <radialGradient id="af-node-fill-complete" cx="40%" cy="35%">
      <stop offset="0%" stop-color="rgba(34,211,160,0.15)"/>
      <stop offset="100%" stop-color="var(--surface)"/>
    </radialGradient>
    <marker id="af-arrow" viewBox="0 -3 6 6" refX="6" refY="0" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,-3L6,0L0,3" fill="var(--border)"/>
    </marker>
    <marker id="af-arrow-orange" viewBox="0 -3 6 6" refX="6" refY="0" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,-3L6,0L0,3" fill="var(--accent)"/>
    </marker>
    <marker id="af-arrow-purple" viewBox="0 -3 6 6" refX="6" refY="0" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,-3L6,0L0,3" fill="var(--purple)"/>
    </marker>
    <marker id="af-arrow-green" viewBox="0 -3 6 6" refX="6" refY="0" markerWidth="5" markerHeight="5" orient="auto">
      <path d="M0,-3L6,0L0,3" fill="var(--green)"/>
    </marker>
    <pattern id="af-grid" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="0.5" fill="var(--border)" opacity="0.3"/>
    </pattern>
  `;

  // Build bezier path between two nodes
  function edgePath(from, to) {
    const a = nodeMap[from], b = nodeMap[to];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / dist, ny = dy / dist;
    // Start/end on circle boundary
    const x1 = a.x + nx * a.r, y1 = a.y + ny * a.r;
    const x2 = b.x - nx * b.r, y2 = b.y - ny * b.r;
    // Control point: offset perpendicular for curvature
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const perpX = -ny, perpY = nx;
    const curvature = dist * 0.15;
    const qx = mx + perpX * curvature, qy = my + perpY * curvature;
    return `M${x1},${y1} Q${qx},${qy} ${x2},${y2}`;
  }

  // Background grid
  const bgSvg = `<rect width="${w}" height="${h}" fill="url(#af-grid)"/>`;

  // Render edges
  const edgeSvg = edges.map(e => {
    const d = edgePath(e.from, e.to);
    const activeClass = e.active ? `active ${e.color}` : '';
    const arrowId = e.active
      ? (e.color === 'purple' ? 'af-arrow-purple' : (e.color === 'green' ? 'af-arrow-green' : 'af-arrow-orange'))
      : 'af-arrow';
    const colorVar = e.color === 'purple' ? 'var(--purple)' : (e.color === 'green' ? 'var(--green)' : 'var(--accent)');

    let particle = '';
    if (e.active) {
      particle = `<path class="af-particle${e.reverse ? ' reverse' : ''}" d="${d}" stroke="${colorVar}" opacity="0.9"/>`;
    }
    return `<path class="af-edge ${activeClass}" d="${d}" marker-end="url(#${arrowId})"/>${particle}`;
  }).join('');

  // Render nodes
  const nodesSvg = nodes.map(n => {
    const state = nodeState(n.id);
    const isGeminiNode = n.id === 'gemini' || n.id === 'inbox';
    const color = nodeColor(n.id, state);

    // Choose fill gradient
    let fillId = 'af-node-fill';
    if (state === 'active') fillId = isGeminiNode ? 'af-node-fill-active-purple' : 'af-node-fill-active-orange';
    if (state === 'complete') fillId = 'af-node-fill-complete';

    // Choose glow filter
    let filterAttr = '';
    if (state === 'active') filterAttr = isGeminiNode ? 'filter="url(#af-glow-purple)"' : 'filter="url(#af-glow-orange)"';
    if (state === 'complete') filterAttr = 'filter="url(#af-glow-green)"';

    // Ripple animations for active nodes
    const rippleAnim = n.size === 'lg' ? 'af-ripple' : (n.size === 'md' ? 'af-ripple-md' : 'af-ripple-sm');
    let ripples = '';
    if (state === 'active') {
      ripples = `
        <circle class="af-ripple" cx="${n.x}" cy="${n.y}" r="${n.r}" stroke="${color}" opacity="0"
          style="animation: ${rippleAnim} 2s ease-out infinite;"/>
        <circle class="af-ripple" cx="${n.x}" cy="${n.y}" r="${n.r}" stroke="${color}" opacity="0"
          style="animation: ${rippleAnim} 2s ease-out 0.7s infinite;"/>
        <circle class="af-ripple" cx="${n.x}" cy="${n.y}" r="${n.r}" stroke="${color}" opacity="0"
          style="animation: ${rippleAnim} 2s ease-out 1.4s infinite;"/>`;
    }

    // Outer ring
    const ringClass = state === 'active' ? 'af-node-ring active' : 'af-node-ring';

    const emojiClass = n.size === 'lg' ? 'af-emoji large' : 'af-emoji';

    return `<g class="flow-node" data-id="${n.id}" ${filterAttr}>
      ${ripples}
      <circle class="${ringClass}" cx="${n.x}" cy="${n.y}" r="${n.r + 5}" stroke="${color}"/>
      <circle class="af-node" cx="${n.x}" cy="${n.y}" r="${n.r}"
        fill="url(#${fillId})" stroke="${state ? color : 'var(--border)'}" stroke-width="${state ? 1.8 : 1}"/>
      <text class="${emojiClass}" x="${n.x}" y="${n.y}">${n.emoji}</text>
      <text class="af-label" x="${n.x}" y="${n.y + n.r + 16}">${n.label}</text>
      <text class="af-sublabel" x="${n.x}" y="${n.y + n.r + 27}">${n.sub}</text>
    </g>`;
  }).join('');

  // Status indicator
  const statusColors = {
    idle: 'var(--text-muted)', in_progress: 'var(--accent)', needs_restart: 'var(--accent)',
    waiting_for_gemini: 'var(--purple)', blocked: 'var(--accent)',
    completed: 'var(--green)', complete: 'var(--green)',
  };
  const statusLabel = {
    idle: 'Idle', in_progress: 'Claude Executing', needs_restart: 'Restarting',
    waiting_for_gemini: 'Gemini Answering', blocked: 'Blocked',
    completed: 'Complete', complete: 'Complete',
  };
  const sColor = statusColors[status] || 'var(--text-muted)';
  const sLabel = statusLabel[status] || status;
  const statusSvg = `
    <circle cx="${cx - 42}" cy="${h - 12}" r="3" fill="${sColor}" opacity="0.9"/>
    <text class="af-status-text" x="${cx}" y="${h - 8}" fill="${sColor}">${sLabel.toUpperCase()}</text>`;

  container.innerHTML = `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>${defs}</defs>
    ${bgSvg}
    ${edgeSvg}
    ${nodesSvg}
    ${statusSvg}
  </svg>`;
}

// ─── Code Graph (D3 force-directed, GitNexus data) ───────────────────────────

let codeGraphData = null;
let codeGraphEnv = null;

const CLUSTER_COLORS = [
  '#4f8ef7', '#22d3a0', '#a78bfa', '#f59e0b', '#f43f5e',
  '#06b6d4', '#fb923c', '#84cc16', '#e879f9', '#6366f1',
  '#14b8a6', '#f472b6', '#facc15', '#38bdf8', '#ef4444',
  '#8b5cf6', '#10b981',
];

const CLUSTER_LABELS = {};

function requestCodeGraph() {
  if (!ws || !activeProjectId) return;
  const container = document.getElementById('code-graph-container');
  if (container) {
    container.innerHTML = `<div class="dimmed" style="padding:40px;text-align:center">
      <div style="font-size:24px;margin-bottom:12px;animation:pulse 2s infinite">⚡</div>
      <div style="font-size:14px;color:var(--text-muted)">Querying Code Graph...</div>
    </div>`;
  }
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('cg-nodes', '—'); setTxt('cg-edges', '—'); setTxt('cg-clusters', '—'); setTxt('cg-flows', '—');
  ws.send(JSON.stringify({ type: 'get-graph', projectId: activeProjectId }));
}
window.requestCodeGraph = requestCodeGraph;

function codeGraphZoomFit() {
  if (!codeGraphEnv) { requestCodeGraph(); return; }
  const { svg, g, zoomBehavior, width, height, nodes } = codeGraphEnv;
  if (!nodes || nodes.length === 0) return;

  // Compute bounding box of actual node positions
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach(d => {
    const r = d.size || 5;
    if (d.x == null || d.y == null) return;
    x0 = Math.min(x0, d.x - r);
    y0 = Math.min(y0, d.y - r);
    x1 = Math.max(x1, d.x + r);
    y1 = Math.max(y1, d.y + r);
  });

  if (!isFinite(x0)) return; // nodes not positioned yet — retry after sim settles
  const pad = 40;
  const bw = x1 - x0 + pad * 2;
  const bh = y1 - y0 + pad * 2;
  const scale = Math.min(width / bw, height / bh, 2);
  const tx = width  / 2 - scale * (x0 + bw / 2 - pad);
  const ty = height / 2 - scale * (y0 + bh / 2 - pad);

  svg.transition().duration(600).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(tx, ty).scale(scale)
  );
}
window.codeGraphZoomFit = codeGraphZoomFit;

function renderCodeGraph(data) {
  if (data.error) {
    const container = $('code-graph-container');
    if (container) container.innerHTML = `<div class="dimmed" style="padding:40px;text-align:center">
      <div style="font-size:32px;margin-bottom:12px">\u{1F50D}</div>
      <div style="font-size:14px;margin-bottom:8px">${data.error === 'no-index' ? 'No GitNexus index found' : 'Error loading graph'}</div>
      <div style="font-size:12px;color:var(--text-muted)">Run <code>gitnexus analyze</code> in the project to generate the code graph</div>
    </div>`;
    return;
  }

  codeGraphData = data;
  const { functions = [], callEdges = [], clusters = [], membership = [], meta = {}, processes = [] } = data;

  // Update stats
  const setTxt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setTxt('cg-nodes', meta.nodes || functions.length);
  setTxt('cg-edges', meta.edges || callEdges.length);
  setTxt('cg-clusters', meta.communities || clusters.length);
  setTxt('cg-flows', meta.processes || processes.length);

  // Build cluster membership map
  const fnCluster = {};
  membership.forEach(m => { fnCluster[m.fn] = m.cluster; });

  // Assign cluster colors
  clusters.forEach((c, i) => {
    CLUSTER_LABELS[c.id] = c.label || `Cluster ${i}`;
  });

  // Build nodes
  const fnSet = new Set(functions.map(f => f.id));
  const nodes = functions.map(f => {
    const cluster = fnCluster[f.id] || 'unknown';
    const clusterIdx = clusters.findIndex(c => c.id === cluster);
    const color = CLUSTER_COLORS[clusterIdx % CLUSTER_COLORS.length] || '#4f8ef7';
    const isExported = f.exported === 'true';
    const size = isExported ? 8 : 5;
    return { id: f.id, name: f.name, file: f.file, line: f.line, cluster, color, size, exported: isExported };
  });

  // Build edges (only where both src & tgt exist)
  const links = callEdges
    .filter(e => fnSet.has(e.src) && fnSet.has(e.tgt))
    .map(e => ({ source: e.src, target: e.tgt, conf: parseFloat(e.conf) || 0.5 }));

  // Render legend
  const legendEl = $('code-graph-legend');
  if (legendEl) {
    const uniqueClusters = [...new Set(membership.map(m => m.cluster))];
    legendEl.innerHTML = uniqueClusters.map(cId => {
      const idx = clusters.findIndex(c => c.id === cId);
      const color = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
      const label = CLUSTER_LABELS[cId] || cId;
      const count = membership.filter(m => m.cluster === cId).length;
      return `<span class="cg-legend-item" data-cluster="${cId}" onclick="highlightCluster('${cId}')">
        <span class="cg-legend-dot" style="background:${color}"></span>
        <span class="cg-legend-label">${label}</span>
        <span class="cg-legend-count">${count}</span>
      </span>`;
    }).join('');
  }

  // D3 force graph
  const container = $('code-graph-container');
  if (!container) return;
  container.innerHTML = '';

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 560;

  // Pre-compute connection counts for node sizing
  const connCount = {};
  links.forEach(l => {
    const sId = typeof l.source === 'object' ? l.source.id : l.source;
    const tId = typeof l.target === 'object' ? l.target.id : l.target;
    connCount[sId] = (connCount[sId] || 0) + 1;
    connCount[tId] = (connCount[tId] || 0) + 1;
  });
  nodes.forEach(n => {
    const base = n.exported ? 10 : 5;
    const conn = connCount[n.id] || 0;
    n.radius = base + Math.min(conn * 0.8, 6);
  });

  // Compute cluster centers for cluster force
  const clusterIds = [...new Set(nodes.map(n => n.cluster))];
  const clusterAngle = {};
  clusterIds.forEach((cId, i) => {
    const angle = (2 * Math.PI * i) / clusterIds.length;
    clusterAngle[cId] = angle;
  });

  const svg = d3.select(container).append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', [0, 0, width, height]);

  const defs = svg.append('defs');

  // Background radial gradient
  const bgGrad = defs.append('radialGradient')
    .attr('id', 'cg-bg-grad')
    .attr('cx', '50%').attr('cy', '50%').attr('r', '60%');
  bgGrad.append('stop').attr('offset', '0%').attr('stop-color', '#111119');
  bgGrad.append('stop').attr('offset', '100%').attr('stop-color', '#050508');

  svg.insert('rect', ':first-child')
    .attr('width', width).attr('height', height)
    .attr('fill', 'url(#cg-bg-grad)');

  // Drop shadow filter
  const dropShadow = defs.append('filter')
    .attr('id', 'cg-drop-shadow')
    .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  dropShadow.append('feDropShadow')
    .attr('dx', 0).attr('dy', 1).attr('stdDeviation', 2)
    .attr('flood-color', '#000').attr('flood-opacity', 0.6);

  // Glow filter for hover
  const glowFilter = defs.append('filter')
    .attr('id', 'cg-glow')
    .attr('x', '-100%').attr('y', '-100%').attr('width', '300%').attr('height', '300%');
  glowFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 4).attr('result', 'blur');
  const glowMerge = glowFilter.append('feMerge');
  glowMerge.append('feMergeNode').attr('in', 'blur');
  glowMerge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Radial gradient per cluster color for glowing orb look
  const uniqueColors = [...new Set(nodes.map(n => n.color))];
  uniqueColors.forEach(color => {
    const id = 'cg-orb-' + color.replace('#', '');
    const grad = defs.append('radialGradient')
      .attr('id', id)
      .attr('cx', '40%').attr('cy', '35%').attr('r', '60%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#fff').attr('stop-opacity', 0.35);
    grad.append('stop').attr('offset', '30%').attr('stop-color', color).attr('stop-opacity', 0.9);
    grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);
  });

  // Arrow markers per color
  uniqueColors.forEach(color => {
    const id = 'cg-arrow-' + color.replace('#', '');
    defs.append('marker')
      .attr('id', id)
      .attr('viewBox', '0 -3 6 6')
      .attr('refX', 14).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('fill', color)
      .attr('fill-opacity', 0.6)
      .attr('d', 'M0,-3L6,0L0,3');
  });
  // Default arrow
  defs.append('marker')
    .attr('id', 'cg-arrow')
    .attr('viewBox', '0 -3 6 6')
    .attr('refX', 14).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path')
    .attr('fill', '#555')
    .attr('fill-opacity', 0.5)
    .attr('d', 'M0,-3L6,0L0,3');

  // Zoom
  const g = svg.append('g');
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.15, 4])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoomBehavior);

  // Render edges as curved paths
  const linkG = g.append('g').attr('class', 'cg-links');
  const linkSel = linkG.selectAll('path')
    .data(links)
    .join('path')
    .attr('class', d => 'cg-edge cg-edge-active')
    .attr('stroke', d => {
      const sNode = nodes.find(n => n.id === (typeof d.source === 'object' ? d.source.id : d.source));
      return sNode ? sNode.color : '#555';
    })
    .attr('stroke-width', d => 0.5 + d.conf * 0.8)
    .attr('stroke-opacity', d => 0.12 + d.conf * 0.25)
    .attr('stroke-dasharray', '6 4')
    .attr('marker-end', d => {
      const sNode = nodes.find(n => n.id === (typeof d.source === 'object' ? d.source.id : d.source));
      if (sNode) return `url(#cg-arrow-${sNode.color.replace('#', '')})`;
      return 'url(#cg-arrow)';
    });

  // Render nodes
  const nodeG = g.append('g').attr('class', 'cg-nodes');
  const nodeSel = nodeG.selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'cg-node-group')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  // Outer glow circle (large, low opacity, blurred cluster color)
  nodeSel.append('circle')
    .attr('class', 'cg-glow-circle')
    .attr('r', d => d.radius * 2.5)
    .attr('fill', d => d.color)
    .attr('fill-opacity', 0.08);

  // Exported node ring/halo
  nodeSel.filter(d => d.exported).append('circle')
    .attr('class', 'cg-node-ring')
    .attr('r', d => d.radius + 3)
    .attr('stroke', d => d.color)
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.4)
    .attr('stroke-dasharray', '3 2');

  // Main filled circle (first <circle> without a filter class for .select('circle') compat)
  // Note: .select('circle') returns the first match, which is glow — so we use a class-based approach
  // We insert the main circle and use .selectAll('.cg-node-circle') in highlight functions
  nodeSel.append('circle')
    .attr('r', d => d.radius)
    .attr('fill', d => `url(#cg-orb-${d.color.replace('#', '')})`)
    .attr('stroke', d => d.color)
    .attr('stroke-width', 0.8)
    .attr('fill-opacity', 0.85)
    .attr('filter', 'url(#cg-drop-shadow)')
    .attr('class', 'cg-node-circle');

  // Specular highlight dot (top-left for 3D illusion)
  nodeSel.append('circle')
    .attr('class', 'cg-node-highlight')
    .attr('cx', d => -d.radius * 0.3)
    .attr('cy', d => -d.radius * 0.3)
    .attr('r', d => d.radius * 0.22)
    .attr('fill', '#fff')
    .attr('fill-opacity', 0.35);

  // Labels — only visible for exported nodes by default
  nodeSel.append('text')
    .attr('class', d => 'cg-node-label' + (d.exported ? ' cg-label-visible' : ''))
    .attr('dy', d => d.radius + 12)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-muted)')
    .attr('font-size', '8px')
    .text(d => d.name);

  // Tooltips
  nodeSel.append('title').text(d => `${d.name}\n${d.file}:${d.line}\nCluster: ${CLUSTER_LABELS[d.cluster] || d.cluster}`);

  // Hover effects via D3
  nodeSel.on('mouseenter', function(e, d) {
    const sel = d3.select(this);
    sel.select('.cg-node-circle')
      .transition().duration(150)
      .attr('r', d.radius * 1.3)
      .attr('filter', 'url(#cg-glow)');
    sel.select('.cg-glow-circle')
      .transition().duration(150)
      .attr('r', d.radius * 3.5)
      .attr('fill-opacity', 0.18);
    sel.select('.cg-node-highlight')
      .transition().duration(150)
      .attr('r', d.radius * 0.3)
      .attr('fill-opacity', 0.5);
    // Dim non-connected nodes and edges
    const connected = new Set([d.id]);
    links.forEach(l => {
      const sId = l.source.id || l.source;
      const tId = l.target.id || l.target;
      if (sId === d.id) connected.add(tId);
      if (tId === d.id) connected.add(sId);
    });
    nodeSel.filter(n => !connected.has(n.id))
      .select('.cg-node-circle').transition().duration(150).attr('fill-opacity', 0.2);
    nodeSel.filter(n => !connected.has(n.id))
      .select('.cg-glow-circle').transition().duration(150).attr('fill-opacity', 0.02);
    linkSel.transition().duration(150)
      .attr('stroke-opacity', l => {
        const sId = l.source.id || l.source;
        const tId = l.target.id || l.target;
        return (sId === d.id || tId === d.id) ? 0.6 : 0.03;
      });
  }).on('mouseleave', function(e, d) {
    const sel = d3.select(this);
    sel.select('.cg-node-circle')
      .transition().duration(300)
      .attr('r', d.radius)
      .attr('filter', 'url(#cg-drop-shadow)');
    sel.select('.cg-glow-circle')
      .transition().duration(300)
      .attr('r', d.radius * 2.5)
      .attr('fill-opacity', 0.08);
    sel.select('.cg-node-highlight')
      .transition().duration(300)
      .attr('r', d.radius * 0.22)
      .attr('fill-opacity', 0.35);
    // Restore all
    nodeSel.select('.cg-node-circle').transition().duration(300).attr('fill-opacity', 0.85);
    nodeSel.select('.cg-glow-circle').transition().duration(300).attr('fill-opacity', 0.08);
    linkSel.transition().duration(300)
      .attr('stroke-opacity', l => 0.12 + l.conf * 0.25);
  });

  // Click handler for detail panel
  nodeSel.on('click', (e, d) => {
    e.stopPropagation();
    showCodeGraphDetail(d, links, nodes);
    // Highlight connected
    const connected = new Set();
    connected.add(d.id);
    links.forEach(l => {
      const sId = l.source.id || l.source;
      const tId = l.target.id || l.target;
      if (sId === d.id) connected.add(tId);
      if (tId === d.id) connected.add(sId);
    });
    nodeSel.select('.cg-node-circle')
      .attr('fill-opacity', n => connected.has(n.id) ? 1 : 0.1)
      .attr('stroke-width', n => n.id === d.id ? 2.5 : 0.8);
    nodeSel.select('.cg-glow-circle')
      .attr('fill-opacity', n => connected.has(n.id) ? 0.15 : 0.01);
    linkSel
      .attr('stroke-opacity', l => {
        const sId = l.source.id || l.source;
        const tId = l.target.id || l.target;
        return (sId === d.id || tId === d.id) ? 0.8 : 0.03;
      })
      .attr('stroke', l => {
        const sId = l.source.id || l.source;
        const tId = l.target.id || l.target;
        return (sId === d.id || tId === d.id) ? d.color : '#333';
      });
  });

  // Click background to reset
  svg.on('click', () => {
    nodeSel.select('.cg-node-circle').attr('fill-opacity', 0.85).attr('stroke-width', 0.8);
    nodeSel.select('.cg-glow-circle').attr('fill-opacity', 0.08);
    linkSel
      .attr('stroke-opacity', l => 0.12 + l.conf * 0.25)
      .attr('stroke', d => {
        const sNode = nodes.find(n => n.id === (d.source.id || d.source));
        return sNode ? sNode.color : '#555';
      });
    const detail = $('code-graph-detail');
    if (detail) detail.innerHTML = '<div class="dimmed" style="padding:12px;font-size:12px">Click a node to see details</div>';
  });

  // Simulation with cluster force
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id)
      .distance(d => {
        const s = typeof d.source === 'object' ? d.source : nodes.find(n => n.id === d.source);
        const t = typeof d.target === 'object' ? d.target : nodes.find(n => n.id === d.target);
        return (s && t && s.cluster === t.cluster) ? 35 : 80;
      })
      .strength(0.4))
    .force('charge', d3.forceManyBody().strength(-120))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.radius + 4))
    .force('x', d3.forceX(d => {
      const angle = clusterAngle[d.cluster] || 0;
      return width / 2 + Math.cos(angle) * width * 0.15;
    }).strength(0.08))
    .force('y', d3.forceY(d => {
      const angle = clusterAngle[d.cluster] || 0;
      return height / 2 + Math.sin(angle) * height * 0.15;
    }).strength(0.08))
    .on('tick', () => {
      linkSel.attr('d', d => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 2;
        return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
      });
      nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    });

  codeGraphEnv = { svg, g, sim, zoomBehavior, width, height, nodeSel, linkSel, nodes, links };

  // Initial zoom to fit after settling
  setTimeout(() => {
    sim.alpha(0.3).restart();
    setTimeout(codeGraphZoomFit, 1500);
  }, 100);
}

function showCodeGraphDetail(node, links, allNodes) {
  const detail = $('code-graph-detail');
  if (!detail) return;
  const callers = [], callees = [];
  links.forEach(l => {
    const sId = l.source.id || l.source;
    const tId = l.target.id || l.target;
    if (sId === node.id) callees.push(tId);
    if (tId === node.id) callers.push(sId);
  });
  const nameOf = id => { const n = allNodes.find(n => n.id === id); return n ? n.name : id; };
  detail.innerHTML = `
    <div class="cg-detail-header">
      <span class="cg-detail-dot" style="background:${node.color}"></span>
      <span class="cg-detail-name">${escHtml(node.name)}</span>
      ${node.exported ? '<span class="cg-detail-tag">exported</span>' : ''}
    </div>
    <div class="cg-detail-file">${escHtml(node.file)}:${node.line}</div>
    <div class="cg-detail-cluster">Cluster: ${escHtml(CLUSTER_LABELS[node.cluster] || node.cluster)}</div>
    ${callers.length ? `<div class="cg-detail-section"><span class="cg-detail-section-label">Called by (${callers.length})</span>${callers.map(c => `<span class="cg-detail-ref">${escHtml(nameOf(c))}</span>`).join('')}</div>` : ''}
    ${callees.length ? `<div class="cg-detail-section"><span class="cg-detail-section-label">Calls (${callees.length})</span>${callees.map(c => `<span class="cg-detail-ref">${escHtml(nameOf(c))}</span>`).join('')}</div>` : ''}
  `;
}

function highlightCluster(clusterId) {
  if (!codeGraphEnv) return;
  const { nodeSel, linkSel, nodes, links } = codeGraphEnv;
  const inCluster = new Set(nodes.filter(n => n.cluster === clusterId).map(n => n.id));
  if (inCluster.size === 0) return;
  nodeSel.select('.cg-node-circle')
    .attr('fill-opacity', n => inCluster.has(n.id) ? 1 : 0.1)
    .attr('stroke-width', n => inCluster.has(n.id) ? 2.5 : 0.8);
  nodeSel.select('.cg-glow-circle')
    .attr('fill-opacity', n => inCluster.has(n.id) ? 0.18 : 0.01);
  linkSel
    .attr('stroke-opacity', l => {
      const s = l.source.id || l.source, t = l.target.id || l.target;
      return (inCluster.has(s) && inCluster.has(t)) ? 0.8 : 0.03;
    });
  // Show cluster detail
  const detail = $('code-graph-detail');
  if (detail) {
    const fns = nodes.filter(n => n.cluster === clusterId);
    detail.innerHTML = `
      <div class="cg-detail-header">
        <span class="cg-detail-dot" style="background:${fns[0]?.color || '#4f8ef7'}"></span>
        <span class="cg-detail-name">${escHtml(CLUSTER_LABELS[clusterId] || clusterId)}</span>
        <span class="cg-detail-tag">${fns.length} symbols</span>
      </div>
      <div class="cg-detail-section">${fns.map(f => `<span class="cg-detail-ref">${escHtml(f.name)}</span>`).join('')}</div>
    `;
  }
}
window.highlightCluster = highlightCluster;

// ─── Compatibility: updateAgentGraph called from renderProjectState ──────────

function updateAgentGraph(state) {
  const status = state?.autopilot?.status || 'idle';
  renderAgentFlow(status);
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
  // Only write time fields — count fields are owned by renderUsageTab
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('usage-today-time',  fmtTime(stats.today?.minutes));
  set('usage-week-time',   fmtTime(stats.week?.minutes));
  set('usage-total-time',  fmtTime(stats.total?.minutes));

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

// Render Usage tab — session-scoped when activeSessionId is set, aggregated otherwise
function renderUsageTab() {
  const listEl = $('usage-session-list');
  if (!listEl) return;

  if (activeSessionId) {
    // Single-session usage view
    const sess = allSessions.find(s => s.sessionId === activeSessionId);
    if (!sess) {
      listEl.innerHTML = '<div class="dimmed" style="padding:12px">Session not found.</div>';
      return;
    }
    const color = STATUS_COLOR?.[sess.status] || 'var(--text-muted)';
    const icon  = STATUS_ICON?.[sess.status]  || '○';
    const pct   = sess.total > 0 ? Math.round((sess.done / sess.total) * 100) : 0;
    const created = sess.createdAt ? new Date(sess.createdAt).toLocaleDateString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    const updated = sess.updatedAt ? new Date(sess.updatedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—';

    const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
    set('usage-today-sessions', (sess.status || 'idle').replace(/_/g, ' '));
    set('usage-week-sessions', `${sess.done || 0}/${sess.total || 0}`);
    set('usage-total-sessions', created);

    listEl.innerHTML = `<div class="usage-session-row">
      <div class="usr-icon">${icon}</div>
      <div class="usr-info">
        <div class="usr-name">${escHtml(sess.name)}</div>
        <div class="usr-meta">Created ${escHtml(created)} · Last active ${escHtml(updated)}</div>
        <div class="usr-bar"><div class="usr-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>
      <div class="usr-stat">
        <div style="color:${color};font-weight:700;font-size:11px">${escHtml((sess.status||'idle').replace(/_/g,' ').toUpperCase())}</div>
        <div style="color:var(--text-dim);font-size:11px">${sess.done||0}/${sess.total||0} tasks</div>
      </div>
    </div>`;
    return;
  }

  // Aggregated usage view (no session selected)
  if (!allSessions.length) {
    listEl.innerHTML = '<div class="dimmed" style="padding:12px">No sessions yet.</div>';
    return;
  }

  // Summary stats
  const total    = allSessions.length;
  const complete = allSessions.filter(s => s.status === 'complete').length;
  const active   = allSessions.filter(s => ['in_progress','testing','waiting_for_gemini','awaiting_review'].includes(s.status)).length;
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('usage-today-sessions', active);
  set('usage-week-sessions',  complete);
  set('usage-total-sessions', total);

  // Per-session list
  listEl.innerHTML = allSessions.map(s => {
    const color = STATUS_COLOR?.[s.status] || 'var(--text-muted)';
    const icon  = STATUS_ICON?.[s.status]  || '○';
    const pct   = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
    const created = s.createdAt ? new Date(s.createdAt).toLocaleDateString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
    const updated = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—';
    return `<div class="usage-session-row" onclick="selectActiveSession('${escAttr(s.sessionId)}')">
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

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const bg = type === 'error' ? '#e55' : type === 'warn' ? '#e93' : '#2a9d8f';
  toast.style.cssText = `background:${bg};color:#fff;padding:12px 18px;border-radius:8px;font-size:13px;max-width:340px;box-shadow:0 4px 16px rgba(0,0,0,0.4);cursor:pointer;`;
  toast.textContent = message;
  toast.onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

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
// ─── Live Locks ──────────────────────────────────────────────────────────────

function renderLocks(locks) {
  const el = $('live-locks-content');
  if (!el) return;
  const entries = Object.entries(locks);
  if (entries.length === 0) {
    el.innerHTML = 'No active file locks.';
    el.className = 'dimmed';
    el.style.padding = '12px';
    return;
  }
  el.className = '';
  el.style.padding = '0';
  el.innerHTML = `
    <table class="locks-table" style="width:100%; border-collapse:collapse; font-size:12px;">
      <thead style="background:rgba(255,255,255,0.05)">
        <tr>
          <th style="padding:8px; text-align:left; border-bottom:1px solid var(--border)">File Path</th>
          <th style="padding:8px; text-align:left; border-bottom:1px solid var(--border)">Locked By (Session)</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(([file, sessionId]) => `
          <tr>
            <td style="padding:8px; border-bottom:1px solid var(--border); font-family:var(--font-mono)">${escHtml(file)}</td>
            <td style="padding:8px; border-bottom:1px solid var(--border)">
              <span class="badge" style="background:var(--accent); color:white; padding:2px 6px; border-radius:4px">${escHtml(sessionId)}</span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ─── Epic Planning ───────────────────────────────────────────────────────────

function submitEpic() {
  const input = $('epic-prompt');
  const btn = $('btn-submit-epic');
  const prompt = input?.value.trim();
  if (!prompt) { if (input) input.focus(); return; }

  if (!confirm('Launch Gemini swarm architect? This will spawn multiple parallel sessions.')) return;

  btn.disabled = true;
  btn.textContent = '🚀 Architecting...';

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'plan-epic', prompt }));
  }

  // Reset UI after a delay (server will send info/error messages)
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = 'Launch Swarm ⚡';
    if (input) input.value = '';
  }, 5000);
}
window.submitEpic = submitEpic;
