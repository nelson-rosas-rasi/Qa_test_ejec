/* ============================================================
   QA Test Runner — renderer process
   Toda la lógica de UI vive aquí. Los datos vienen de `window.qa`
   (expuesto por preload.js). Si no existe (ej. abriendo este HTML
   directo en un navegador para revisar el diseño), se usa un stub
   con datos de ejemplo para que la interfaz siga siendo navegable.
   ============================================================ */

// No puede llamarse `qa`: contextBridge define window.qa como propiedad no
// configurable, y un `const qa` global colisiona con ella (SyntaxError).
const api = window.qa || createBrowserStub();

let projects = [];

const state = {
  screen: 'dashboard',
  project: null,
  loadingProject: null,
  profiles: [],
  profile: null,
  profileMenuOpen: false,
  github: { connected: false },
  githubDevice: null,     // { userCode, verificationUri } mientras se conecta
  githubError: null,
  updateAvailable: true,
  testTree: [],
  selected: new Set(),
  expandedSuites: new Set(),
  runOptions: { visualMode: false, generateReport: true, stopOnFail: false },
  showRunOptionsModal: false,
  runTarget: 'selected', // 'selected' | 'all'
  showUpdateModal: false,
  updating: false,
  updateProgress: 0,
  runLog: [],
  runResults: {}, // testId -> 'running' | 'passed' | 'failed'
  runOrder: [],
  running: false,
  expandedFail: null,
  history: [],
};

const $main = document.getElementById('main');
const $overlay = document.getElementById('modal-overlay');

/* ---------- boot ---------- */
init();

async function init() {
  wireTitlebar();
  wireSidebar();
  wireApiEvents();
  await loadGithubStatus();
  projects = await api.listProjects();
  state.project = projects[0]?.id || null;
  state.loadingProject = state.project;
  renderProjectSwitcher();
  if (!state.project) {
    renderSidebarStatus(); renderEmptyProject(); return;
  }
  try {
    if (!await loadProject(state.project)) return;
    await loadProfiles();
    const sync = await api.checkSyncStatus();
    state.updateAvailable = sync.updateAvailable;
    renderSidebarStatus();
    renderScreen();
  } finally {
    state.loadingProject = null;
    renderProjectSwitcher();
  }
}

function wireApiEvents() {
  api.onUpdateProgress((pct) => {
    state.updateProgress = pct;
    if (state.showUpdateModal) renderUpdateModal();
  });
  api.onRunLog((entry) => {
    state.runLog.push(entry);
    if (state.screen === 'live') renderConsoleAppend(entry);
  });
  api.onTestResult((entry) => {
    state.runResults[entry.id] = entry.status;
    if (state.screen === 'live') renderLive();
  });
  api.onGithubDeviceCode((device) => {
    state.githubDevice = device;
    renderGithubModal();
  });
}

async function loadProject(projectId) {
  const prepared = await api.prepareProject(projectId);
  if (!prepared.ok) { alert(prepared.error); return false; }
  projects = projects.map((p) => p.id === projectId ? prepared.project : p);
  state.testTree = await api.getTestTree(projectId);
  state.selected = new Set();
  state.expandedSuites = new Set(state.testTree.map((s) => s.id));
  state.history = await api.getHistory();
  return true;
}
function currentProject() { return projects.find((p) => p.id === state.project) || null; }
function projectColor(p) {
  const colors = ['#2563eb','#0d9488','#9333ea','#ea580c','#0891b2'];
  return colors[[...(p?.id || '')].reduce((n,c) => n + c.charCodeAt(0),0) % colors.length];
}
function projectSuite(p) { return p?.name || 'Pruebas automatizadas'; }

/* ============================================================
   TITLEBAR
   ============================================================ */
function wireTitlebar() {
  document.getElementById('btn-min').onclick = () => api.windowMinimize();
  document.getElementById('btn-max').onclick = () => api.windowMaximize();
  document.getElementById('btn-close').onclick = () => api.windowClose();
}

/* ============================================================
   SIDEBAR
   ============================================================ */
function wireSidebar() {
  document.getElementById('project-add').onclick = () => openProjectModal();

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.onclick = () => {
      document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
      el.classList.add('active');
      state.screen = el.dataset.screen;
      renderScreen();
    };
  });

  document.getElementById('profile-trigger').onclick = () => {
    state.profileMenuOpen = !state.profileMenuOpen;
    renderProfileSwitcher();
  };
}

function renderProjectSwitcher() {
  const list = document.getElementById('project-list');
  list.innerHTML = '';

  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'project-empty';
    empty.textContent = 'Todavía no hay proyectos';
    list.appendChild(empty);
    return;
  }

  projects.forEach((project) => {
    const active = project.id === state.project;
    const loading = state.loadingProject === project.id;
    const row = document.createElement('div');
    row.className = 'project-item' + (active ? ' active' : '') + (loading ? ' loading' : '');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = projectColor(project);

    const text = document.createElement('div');
    text.className = 'project-item-text';
    const name = document.createElement('div');
    name.className = 'project-item-name';
    name.textContent = project.name;
    text.appendChild(name);
    if (active || loading) {
      const branch = document.createElement('div');
      branch.className = 'project-item-branch';
      branch.textContent = loading ? 'Trayendo cambios…' : `rama ${project.defaultBranch}`;
      text.appendChild(branch);
    }

    row.append(dot, text);
    if (active && !loading) row.insertAdjacentHTML('beforeend', checkSvg(projectColor(project)));

    row.onclick = async () => {
      if (project.id === state.project || state.loadingProject) return;
      state.loadingProject = project.id;
      renderProjectSwitcher();
      try {
        if (!await loadProject(project.id)) return;
        state.project = project.id;
        await loadProfiles();
        renderScreen();
      } finally {
        state.loadingProject = null;
        renderProjectSwitcher();
      }
    };
    list.appendChild(row);
  });
}

function checkSvg(color) {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
}

function initials(name) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase() || '··';
}

async function loadProfiles() {
  state.profiles = await api.listProfiles(state.project);
  state.profile = await api.getActiveProfile(state.project);
  if (!state.profile && state.profiles.length > 0) {
    state.profile = state.profiles[0].id;
    await api.selectProfile(state.project, state.profile);
  }
  renderProfileSwitcher();
}

async function loadGithubStatus() {
  state.github = await api.getGithubStatus();
  renderProfileSwitcher();
  renderSidebarStatus();
}

function renderProfileSwitcher() {
  const active = state.profiles.find((p) => p.id === state.profile);
  document.getElementById('profile-avatar').firstChild.textContent = active ? initials(active.name) : '··';
  document.getElementById('profile-name').textContent = active ? active.name : 'Sin perfil';
  document.getElementById('profile-role').textContent = active ? active.role : 'Elige un perfil';

  document.getElementById('github-dot').className = `github-dot${state.github.connected ? ' connected' : ''}`;

  const warning = document.getElementById('github-warning');
  warning.hidden = state.github.connected;
  warning.innerHTML = `<div class="title">⚠ Sin cuenta conectada</div><div class="action">Conectar cuenta</div>`;
  warning.onclick = (e) => { e.stopPropagation(); openGithubModal(); };

  const menu = document.getElementById('profile-menu');
  menu.hidden = !state.profileMenuOpen;
  menu.innerHTML = '';
  state.profiles.forEach((profile) => {
    const row = document.createElement('div');
    row.className = 'profile-menu-item';
    row.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="label">${profile.name}</div>
        <div class="sub">${profile.role}</div>
      </div>
      ${profile.id === state.profile ? checkSvg('#2563eb') : ''}
    `;
    row.onclick = async (e) => {
      e.stopPropagation();
      state.profile = profile.id;
      state.profileMenuOpen = false;
      await api.selectProfile(state.project, profile.id);
      renderProfileSwitcher();
    };
    menu.appendChild(row);
  });

  const separator = document.createElement('div');
  separator.className = 'profile-menu-sep';
  menu.appendChild(separator);

  const githubRow = document.createElement('div');
  githubRow.className = 'profile-menu-item';
  githubRow.innerHTML = state.github.connected
    ? `<div style="flex:1;min-width:0;"><div class="label">Desconectar cuenta</div><div class="sub">Conectado como ${state.github.login || ''}</div></div>`
    : `<div style="flex:1;min-width:0;"><div class="label">Conectar cuenta de GitHub</div><div class="sub">Necesaria para traer las pruebas</div></div>`;
  githubRow.onclick = (e) => {
    e.stopPropagation();
    state.profileMenuOpen = false;
    if (state.github.connected) openGithubDisconnectModal();
    else openGithubModal();
  };
  menu.appendChild(githubRow);
}

function renderSidebarStatus() {
  const el = document.getElementById('sync-pill');
  if (!state.project) { el.className = 'sync-pill'; el.innerHTML = '<span class="txt">Sin proyecto inicializado</span>'; el.onclick = null; return; }
  if (state.updateAvailable) {
    el.className = 'sync-pill update';
    el.innerHTML = `<span class="bullet"></span><span class="txt">Actualización disponible</span>`;
    el.onclick = () => openUpdateModal();
  } else {
    el.className = 'sync-pill ok';
    el.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span class="txt">Pruebas actualizadas</span>`;
    el.onclick = null;
  }
}

/* ============================================================
   SCREEN ROUTER
   ============================================================ */
function renderScreen() {
  if (!state.project) return renderEmptyProject();
  if (state.screen === 'dashboard') renderDashboard();
  else if (state.screen === 'live') renderLive();
  else if (state.screen === 'results') renderResults();
  else if (state.screen === 'history') renderHistory();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  const project = currentProject();
  const totalTests = countAllTests();
  const selectedCount = state.selected.size;
  const totalSuites = state.testTree.length;

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div class="row">
          <div>
            <div class="screen-title">Pruebas</div>
            <div class="screen-subtitle">
              <span class="badge" style="color:${projectColor(project)};background:${projectColor(project)}18;border:1px solid ${projectColor(project)}55;">
                <span class="bdot" style="background:${projectColor(project)}"></span>${project.name}
              </span>
              <span style="font-weight:500;">${projectSuite(project)}</span>
              <span style="color:#cbd5e1;">·</span>
              <span style="display:inline-flex;align-items:center;gap:4px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>rama principal
              </span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;justify-content:flex-end;">
            ${state.updateAvailable ? `
              <div style="display:flex;align-items:center;gap:12px;padding:8px 8px 8px 14px;border-radius:10px;background:var(--accent-light);border:1px solid var(--accent-border);white-space:nowrap;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v6"/><path d="m8 6 4-4 4 4"/><path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 9-9"/></svg>
                  <span style="font-size:12.5px;font-weight:600;color:#1d4ed8;">Actualización disponible</span>
                </div>
                <button class="btn btn-primary" id="btn-update-now" style="padding:7px 13px;font-size:12.5px;">Actualizar</button>
              </div>` : `
              <div style="display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px;background:var(--green-light);border:1px solid var(--green-border);white-space:nowrap;">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                <div style="line-height:1.15;"><div style="font-size:12.5px;font-weight:600;color:#15803d;">Actualizado</div><div style="font-size:10.5px;color:#5aa877;">Sincronizado hace 5 min</div></div>
              </div>`}
            <div style="display:flex;align-items:center;gap:7px;padding:5px 11px 5px 5px;border-radius:20px;background:#f8fafc;border:1px solid #eef2f7;white-space:nowrap;">
              <div class="avatar" style="width:24px;height:24px;font-size:9.5px;">MG</div>
              <span style="font-size:12px;font-weight:600;color:#334155;">María</span>
            </div>
          </div>
        </div>

        <div class="action-bar">
          <div style="display:flex;align-items:center;gap:12px;">
            <button class="btn btn-primary" id="btn-run-selected">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="m7 4 12 8-12 8V4z"/></svg>
              Ejecutar seleccionados <span class="btn-count">${selectedCount}</span>
            </button>
            <button class="btn btn-secondary" id="btn-run-all">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 4 12 8-12 8V4z"/></svg>
              Ejecutar todos
            </button>
          </div>
          <div class="search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input placeholder="Buscar prueba…" id="search-input">
          </div>
        </div>
      </div>

      <div class="counters-bar">
        <span style="color:#64748b;white-space:nowrap;"><b style="color:#0f172a;font-weight:700;">${totalTests}</b> pruebas en total</span>
        <span style="color:#cbd5e1;">·</span>
        <span class="sel"><span class="sq"></span>${selectedCount} seleccionadas</span>
        <span style="color:#cbd5e1;">·</span>
        <span style="color:#94a3b8;">${totalSuites} suites</span>
      </div>

      <div class="tree" id="tree"></div>
    </div>
  `;

  renderTree();

  document.getElementById('btn-update-now').onclick = openUpdateModal;
  document.getElementById('btn-run-selected').onclick = () => openRunOptions('selected');
  document.getElementById('btn-run-all').onclick = () => openRunOptions('all');
  document.getElementById('search-input').oninput = (e) => filterTree(e.target.value);
}

function countAllTests() {
  return state.testTree.reduce((n, s) => n + s.files.reduce((m, f) => m + f.tests.length, 0), 0);
}

function suiteSelectionState(suite) {
  const ids = suite.files.flatMap((f) => f.tests.map((t) => t.id));
  const selectedIds = ids.filter((id) => state.selected.has(id));
  if (selectedIds.length === 0) return 'none';
  if (selectedIds.length === ids.length) return 'all';
  return 'partial';
}
function fileSelectionState(file) {
  const ids = file.tests.map((t) => t.id);
  const selectedIds = ids.filter((id) => state.selected.has(id));
  if (selectedIds.length === 0) return 'none';
  if (selectedIds.length === ids.length) return 'all';
  return 'partial';
}

function renderTree() {
  const $tree = document.getElementById('tree');
  $tree.innerHTML = '';

  state.testTree.forEach((suite) => {
    const expanded = state.expandedSuites.has(suite.id);
    const selState = suiteSelectionState(suite);
    const fileCount = suite.files.length;
    const testCount = suite.files.reduce((n, f) => n + f.tests.length, 0);
    const selCount = suite.files.flatMap((f) => f.tests).filter((t) => state.selected.has(t.id)).length;

    const suiteEl = document.createElement('div');
    suiteEl.className = 'suite';
    suiteEl.innerHTML = `
      <div class="suite-header ${expanded ? '' : 'collapsed'}" data-suite="${suite.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${expanded ? 0 : -90}deg)"><path d="m6 9 6 6 6-6"/></svg>
        <span class="checkbox small ${selState === 'all' ? 'checked' : selState === 'partial' ? 'partial' : 'unchecked'}" data-suite-check="${suite.id}">
          ${selState === 'all' ? checkSvg('#fff') : selState === 'partial' ? '<div style="width:9px;height:2px;background:#fff;border-radius:1px;"></div>' : ''}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${selState === 'none' ? '#94a3b8' : '#2563eb'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <span class="suite-title">${suite.name}</span>
        <span class="suite-meta">${fileCount} archivos · ${testCount} pruebas</span>
        ${selCount > 0 ? `<span class="suite-count">${selCount} seleccionadas</span>` : ''}
      </div>
      <div class="suite-body" data-suite-body="${suite.id}" style="${expanded ? '' : 'display:none'}"></div>
    `;
    $tree.appendChild(suiteEl);

    const body = suiteEl.querySelector(`[data-suite-body="${suite.id}"]`);
    suite.files.forEach((file) => {
      const fState = fileSelectionState(file);
      const fileEl = document.createElement('div');
      fileEl.className = 'file-row';
      fileEl.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        <span class="checkbox small ${fState === 'all' ? 'checked' : fState === 'partial' ? 'partial' : 'unchecked'}" data-file-check="${file.id}">
          ${fState === 'all' ? checkSvg('#fff') : fState === 'partial' ? '<div style="width:9px;height:2px;background:#fff;border-radius:1px;"></div>' : ''}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/></svg>
        <span class="file-name">${file.name}</span>
        <span class="file-count">${file.tests.length} pruebas</span>
      `;
      body.appendChild(fileEl);

      file.tests.forEach((test) => {
        const checked = state.selected.has(test.id);
        const testEl = document.createElement('div');
        testEl.className = 'test-row';
        testEl.innerHTML = `
          <span class="checkbox small ${checked ? 'checked' : 'unchecked'}" data-test-check="${test.id}">
            ${checked ? checkSvg('#fff') : ''}
          </span>
          <span class="test-name ${checked ? '' : 'dim'}">${test.name}</span>
        `;
        testEl.onclick = () => {
          toggleTest(test.id);
        };
        body.appendChild(testEl);
      });
    });
  });

  // wire events
  $tree.querySelectorAll('[data-suite]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('[data-suite-check]')) return;
      const id = el.dataset.suite;
      if (state.expandedSuites.has(id)) state.expandedSuites.delete(id);
      else state.expandedSuites.add(id);
      renderTree();
    };
  });
  $tree.querySelectorAll('[data-suite-check]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const suite = state.testTree.find((s) => s.id === el.dataset.suiteCheck);
      const allIds = suite.files.flatMap((f) => f.tests.map((t) => t.id));
      const shouldSelect = suiteSelectionState(suite) !== 'all';
      allIds.forEach((id) => (shouldSelect ? state.selected.add(id) : state.selected.delete(id)));
      renderDashboard();
    };
  });
  $tree.querySelectorAll('[data-file-check]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const file = state.testTree.flatMap((s) => s.files).find((f) => f.id === el.dataset.fileCheck);
      const ids = file.tests.map((t) => t.id);
      const shouldSelect = fileSelectionState(file) !== 'all';
      ids.forEach((id) => (shouldSelect ? state.selected.add(id) : state.selected.delete(id)));
      renderDashboard();
    };
  });
}

function toggleTest(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderDashboard();
}

function filterTree(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.test-row').forEach((row) => {
    const name = row.querySelector('.test-name').textContent.toLowerCase();
    row.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

/* ============================================================
   RUN OPTIONS MODAL
   ============================================================ */
function openRunOptions(target) {
  state.runTarget = target;
  state.showRunOptionsModal = true;
  renderRunOptionsModal();
}

function renderRunOptionsModal() {
  const opts = state.runOptions;
  const count = state.runTarget === 'all' ? countAllTests() : state.selected.size;
  const label = state.runTarget === 'all'
    ? `${countAllTests()} pruebas · ${projectSuite(currentProject())}`
    : `${state.selected.size} pruebas seleccionadas`;

  $overlay.hidden = false;
  $overlay.innerHTML = `
    <div class="modal" style="width:440px;">
      <div class="modal-pad">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="modal-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="#2563eb"><path d="m7 4 12 8-12 8V4z"/></svg></div>
          <div style="flex:1;min-width:0;">
            <div class="modal-title" style="white-space:nowrap;">Opciones de ejecución</div>
            <div class="modal-sub" style="margin-top:2px;">${label}</div>
          </div>
        </div>

        <div style="margin-top:20px;">
          ${optionRow('visualMode', opts.visualMode, 'Modo visual (ver navegador)',
            opts.visualMode ? 'Verás el navegador abrirse durante la ejecución' : 'Las pruebas corren en segundo plano, sin ventanas',
            eyeIcon(opts.visualMode))}
          ${optionRow('generateReport', opts.generateReport, 'Generar reporte Word al finalizar',
            'Se guarda automáticamente y queda en el historial',
            docIcon())}
          ${optionRow('stopOnFail', opts.stopOnFail, 'Detener en el primer fallo',
            opts.stopOnFail ? 'La ejecución se detendrá en cuanto falle una prueba' : 'La ejecución continúa aunque alguna prueba falle',
            stopIcon())}
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" id="run-opts-cancel">Cancelar</button>
          <button class="btn btn-primary" id="run-opts-confirm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="m7 4 12 8-12 8V4z"/></svg>Iniciar ejecución
          </button>
        </div>
      </div>
    </div>
  `;

  $overlay.querySelectorAll('[data-opt]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.opt;
      state.runOptions[key] = !state.runOptions[key];
      renderRunOptionsModal();
    };
  });
  document.getElementById('run-opts-cancel').onclick = closeModal;
  document.getElementById('run-opts-confirm').onclick = () => {
    closeModal();
    startRun();
  };
}

function optionRow(key, on, title, hint, iconSvg) {
  return `
    <div class="option-row">
      <button class="switch ${on ? 'on' : ''}" data-opt="${key}"><span class="switch-thumb"></span></button>
      <span style="color:${on ? '#2563eb' : '#94a3b8'};display:inline-flex;">${iconSvg}</span>
      <div style="flex:1;min-width:0;">
        <div class="option-title">${title}</div>
        <div class="option-hint">${hint}</div>
      </div>
    </div>
  `;
}
function eyeIcon(open) {
  return open
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 11s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
}
function docIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 13h8M8 17h5"/></svg>`;
}
function stopIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;
}

function renderEmptyProject() {
  $main.innerHTML = `<div class="screen" style="display:grid;place-items:center;text-align:center;padding:40px"><div style="max-width:500px"><div class="screen-title">Inicializa tu primer proyecto</div><div class="screen-subtitle" style="margin:10px 0 22px">Detectaremos la rama principal, crearemos un clon administrado y validaremos Playwright.</div><button class="btn btn-primary" id="btn-init-project">Inicializar proyecto</button></div></div>`;
  document.getElementById('btn-init-project').onclick = () => openProjectModal();
}
function openProjectModal() {
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:500px"><div class="modal-pad">
    <div class="modal-title">Inicializar proyecto</div>
    <div class="modal-sub">El repositorio se usará en modo administrado sobre su rama principal remota.</div>
    <label style="display:block;margin-top:20px;font-size:12px;font-weight:700">Nombre</label>
    <input id="project-init-name" placeholder="Portal de clientes" style="width:100%;margin-top:7px;padding:11px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
    <label style="display:block;margin-top:14px;font-size:12px;font-weight:700">Repositorio Git</label>
    <input id="project-init-url" placeholder="https://servidor/equipo/pruebas.git" style="width:100%;margin-top:7px;padding:11px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
    <div id="project-init-error" style="display:none;margin-top:12px;color:#b91c1c;font-size:12px"></div>
    <div class="modal-actions"><button class="btn btn-secondary" id="project-import-folder">Traer carpeta clonada</button><button class="btn btn-secondary" id="project-init-cancel">Cancelar</button><button class="btn btn-primary" id="project-init-confirm">Validar e inicializar</button></div>
  </div></div>`;
  const acceptProject = async (result) => {
    if (!result.ok) return false;
    projects.push(result.project);
    state.project = result.project.id;
    closeModal();
    renderProjectSwitcher();
    if (!await loadProject(state.project)) return true;
    await loadProfiles();
    renderSidebarStatus();
    renderScreen();
    return true;
  };
  document.getElementById('project-import-folder').onclick = async () => {
    const button = document.getElementById('project-import-folder');
    const error = document.getElementById('project-init-error');
    error.style.display = 'none';
    try {
      button.disabled = true;
      button.textContent = 'Validando carpeta…';
      const result = await api.importProjectFolder();
      if (result.canceled) return;
      if (!result.ok) {
        error.textContent = result.error || 'No fue posible importar la carpeta.';
        error.style.display = 'block';
        return;
      }
      await acceptProject(result);
    } catch (err) {
      error.textContent = err.message || String(err);
      error.style.display = 'block';
    } finally {
      if (document.body.contains(button)) {
        button.disabled = false;
        button.textContent = 'Traer carpeta clonada';
      }
    }
  };
  document.getElementById('project-init-cancel').onclick = closeModal;
  document.getElementById('project-init-confirm').onclick = async () => {
    const button=document.getElementById('project-init-confirm'), error=document.getElementById('project-init-error');
    button.disabled=true; button.textContent='Clonando e instalando…'; error.style.display='none';
    const result=await api.initializeProject({name:document.getElementById('project-init-name').value,repoUrl:document.getElementById('project-init-url').value});
    if(!result.ok){error.textContent=result.error;error.style.display='block';button.disabled=false;button.textContent='Validar e inicializar';return;}
    await acceptProject(result);
  };
}

function openGithubModal() {
  state.githubDevice = null;
  state.githubError = null;
  $overlay.hidden = false;
  renderGithubModal();
  api.connectGithub().then((result) => {
    if (result.ok) {
      closeModal();
      loadGithubStatus();
      return;
    }
    if (result.code === 'GITHUB_CONNECT_CANCELLED') return;
    state.githubError = result.error || 'No fue posible conectar la cuenta.';
    renderGithubModal();
  });
}

function renderGithubModal() {
  if ($overlay.hidden) return;
  const device = state.githubDevice;
  $overlay.innerHTML = `<div class="modal" style="width:460px"><div class="modal-pad">
    <div class="modal-title">Conectar tu cuenta de GitHub</div>
    <div class="modal-sub">La app necesita tu cuenta para traer las pruebas del equipo.</div>
    ${device ? `
      <div style="margin-top:20px;font-size:13px">1. Copia este código:</div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <div style="flex:1;text-align:center;padding:14px;border:1px dashed #cbd5e1;border-radius:8px;font-size:22px;font-weight:700;letter-spacing:3px">${device.userCode}</div>
        <button class="btn btn-secondary" id="github-copy">Copiar</button>
      </div>
      <div style="margin-top:14px;font-size:13px">2. Apruébalo en GitHub, que se abrirá en tu navegador.</div>
      <div style="margin-top:16px;font-size:12px;color:#64748b">Esperando tu aprobación…</div>
    ` : `<div style="margin-top:24px;font-size:13px;color:#64748b">Pidiendo el código a GitHub…</div>`}
    ${state.githubError ? `<div style="margin-top:12px;color:#b91c1c;font-size:12px">${state.githubError}</div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-secondary" id="github-cancel">Cancelar</button>
      ${device ? `<button class="btn btn-primary" id="github-open">Abrir GitHub</button>` : ''}
    </div>
  </div></div>`;

  document.getElementById('github-cancel').onclick = async () => {
    await api.cancelGithubConnect();
    closeModal();
  };
  if (device) {
    document.getElementById('github-copy').onclick = () => navigator.clipboard.writeText(device.userCode);
    document.getElementById('github-open').onclick = () => window.open(device.verificationUri, '_blank');
  }
}

function openGithubDisconnectModal() {
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:460px"><div class="modal-pad">
    <div class="modal-title">Desconectar tu cuenta</div>
    <div class="modal-sub">Se olvidará tu cuenta en este equipo y no podrás traer ni actualizar proyectos hasta conectarla otra vez.</div>
    <div style="margin-top:16px;font-size:12px;color:#64748b">
      Tu cuenta seguirá autorizada en GitHub. Para quitarle el permiso del todo, entra a
      <span style="color:#2563eb">github.com/settings/applications</span>.
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="github-disconnect-cancel">Cancelar</button>
      <button class="btn btn-primary" id="github-disconnect-confirm">Desconectar</button>
    </div>
  </div></div>`;
  document.getElementById('github-disconnect-cancel').onclick = () => closeModal();
  document.getElementById('github-disconnect-confirm').onclick = async () => {
    await api.disconnectGithub();
    closeModal();
    await loadGithubStatus();
  };
}

function closeModal() {
  $overlay.hidden = true;
  $overlay.innerHTML = '';
}

/* ============================================================
   RUN — kick off + LIVE screen
   ============================================================ */
async function startRun() {
  const ids = state.runTarget === 'all'
    ? state.testTree.flatMap((s) => s.files).flatMap((f) => f.tests.map((t) => t.id))
    : Array.from(state.selected);

  state.runOrder = ids;
  state.runResults = {};
  ids.forEach((id) => (state.runResults[id] = 'pending'));
  state.runLog = [];
  state.running = true;

  state.screen = 'live';
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === 'live'));
  renderLive();

  const result = await api.startRun({
    projectId: state.project,
    testIds: ids,
    runAll: state.runTarget === 'all',
    visualMode: state.runOptions.visualMode,
    generateReport: state.runOptions.generateReport,
    stopOnFail: state.runOptions.stopOnFail,
  });
  state.running = false;
  if (state.runOptions.generateReport) {
    await api.generateReport('run-' + Date.now());
  }
  if (state.screen === 'live') renderLive();
}

function testNameById(id) {
  for (const s of state.testTree) {
    for (const f of s.files) {
      const t = f.tests.find((t) => t.id === id);
      if (t) return t.name;
    }
  }
  return id;
}

function renderLive() {
  const ids = state.runOrder;
  const done = ids.filter((id) => state.runResults[id] === 'passed' || state.runResults[id] === 'failed').length;
  const pct = ids.length ? Math.round((done / ids.length) * 100) : 0;
  const passCount = ids.filter((id) => state.runResults[id] === 'passed').length;
  const failCount = ids.filter((id) => state.runResults[id] === 'failed').length;
  const pendingCount = ids.length - done - ids.filter((id) => state.runResults[id] === 'running').length;

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div class="row">
          <div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="screen-title">Ejecución en vivo</div>
              ${state.running ? `<span class="badge" style="color:#2563eb;background:var(--accent-light);"><span class="bdot" style="background:#2563eb;animation:qblink 1s infinite;"></span>En curso</span>` : ''}
            </div>
            <div class="screen-subtitle">${projectSuite(currentProject())} · ${ids.length} pruebas seleccionadas</div>
          </div>
          <button class="btn btn-danger" id="btn-stop" ${state.running ? '' : 'disabled'}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>Detener ejecución
          </button>
        </div>
        <div class="live-progress">
          <div class="top">
            <span style="font-size:12.5px;font-weight:600;color:#334155;white-space:nowrap;">${done} de ${ids.length} pruebas completadas</span>
            <span style="font-size:12.5px;font-weight:700;color:var(--accent);">${pct}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="live-legend">
            <span style="color:var(--green-dark);"><span class="lg-dot" style="background:var(--green);"></span>${passCount} exitosas</span>
            <span style="color:var(--red-dark);"><span class="lg-dot" style="background:var(--red);"></span>${failCount} fallidas</span>
            <span style="color:#94a3b8;"><span class="lg-dot" style="background:#cbd5e1;"></span>${Math.max(pendingCount,0)} pendientes</span>
          </div>
        </div>
      </div>

      <div class="live-body">
        <div class="test-list" id="test-list"></div>
        <div class="console">
          <div class="console-header">
            <div class="title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>Consola de ejecución</div>
            <span class="hint">auto-scroll activo</span>
          </div>
          <div class="console-body" id="console-body"></div>
        </div>
      </div>
    </div>
  `;

  const $list = document.getElementById('test-list');
  ids.forEach((id) => {
    const status = state.runResults[id] || 'pending';
    const row = document.createElement('div');
    row.className = `test-list-item ${status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : status === 'running' ? 'running' : ''}`;
    row.innerHTML = `${statusIcon(status)}<span class="name">${testNameById(id)}</span>`;
    $list.appendChild(row);
  });

  const $console = document.getElementById('console-body');
  state.runLog.forEach((entry) => appendLogLine($console, entry));
  $console.scrollTop = $console.scrollHeight;

  document.getElementById('btn-stop').onclick = () => {
    api.stopRun();
    state.running = false;
    renderLive();
  };
}

function statusIcon(status) {
  if (status === 'passed') return `<svg width="17" height="17" viewBox="0 0 24 24" fill="#dcfce7" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
  if (status === 'failed') return `<svg width="17" height="17" viewBox="0 0 24 24" fill="#fee2e2" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`;
  if (status === 'running') return `<svg class="spin" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
  return `<span style="width:17px;height:17px;border-radius:50%;border:1.6px dashed #cbd5e1;flex:none;display:inline-block;"></span>`;
}

function renderConsoleAppend(entry) {
  const $console = document.getElementById('console-body');
  const $list = document.getElementById('test-list');
  if (!$console) return;
  appendLogLine($console, entry);
  $console.scrollTop = $console.scrollHeight;
  renderLive(); // simplest correct way to keep list/progress in sync
}

function appendLogLine($console, entry) {
  const div = document.createElement('div');
  div.className = `line ${entry.level}`;
  div.textContent = (entry.level === 'fail' ? '✗ ' : entry.level === 'pass' ? '✓ ' : '') + entry.text;
  $console.appendChild(div);
}

/* ============================================================
   RESULTS
   ============================================================ */
function renderResults() {
  const ids = state.runOrder.length ? state.runOrder : [];
  const total = ids.length || 30;
  const passed = ids.length ? ids.filter((id) => state.runResults[id] === 'passed').length : 26;
  const failed = ids.length ? ids.filter((id) => state.runResults[id] === 'failed').length : 4;
  const failedIds = ids.length ? ids.filter((id) => state.runResults[id] === 'failed') : ['t3', 't9', 't11', 't10'];

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header" style="padding-bottom:16px;">
        <div class="row">
          <div>
            <div class="screen-title">Resultado de ejecución</div>
            <div class="screen-subtitle">${projectSuite(currentProject())} · ${new Date().toLocaleString('es-CO', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })} · por María Gómez</div>
          </div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-secondary">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>Abrir carpeta
            </button>
            <button class="btn btn-primary" id="btn-open-report">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 13h8M8 17h5"/></svg>Ver reporte Word
            </button>
          </div>
        </div>
      </div>

      <div class="results-body">
        <div class="summary-cards">
          <div class="card"><div class="card-label">Total</div><div class="card-value">${total}</div></div>
          <div class="card green"><div class="card-label">${checkSvg('#16a34a')}Exitosos</div><div class="card-value">${passed}</div></div>
          <div class="card red"><div class="card-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>Fallidos</div><div class="card-value">${failed}</div></div>
          <div class="card"><div class="card-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>Duración</div><div class="card-value">3m 42s</div></div>
        </div>

        <div class="report-banner">
          <div class="report-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 13h8M8 17h5"/></svg></div>
          <div style="flex:1;">
            <div class="report-text-title">Reporte generado automáticamente</div>
            <div class="report-text-sub">Reporte-${projectSuite(currentProject()).replace(/\s+/g,'-')}-${new Date().toISOString().slice(0,10)}.docx · generado al finalizar la ejecución</div>
          </div>
          <button class="btn btn-primary" id="btn-open-doc">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>Abrir documento
          </button>
        </div>

        <div class="section-title"><span class="bdot"></span>Pruebas fallidas (${failedIds.length})</div>
        <div class="fail-list" id="fail-list"></div>
      </div>
    </div>
  `;

  const $failList = document.getElementById('fail-list');
  const sampleErrors = {
    default: 'AssertionError: el resultado no coincide con lo esperado',
  };
  failedIds.forEach((id, i) => {
    const item = document.createElement('div');
    item.className = 'fail-item';
    item.innerHTML = `
      <div class="fail-head" data-fail="${id}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#fee2e2" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>
        <div class="info"><div class="name">${testNameById(id)}</div><div class="meta">${i === 0 ? '2.1s' : (1.5 + i * 0.6).toFixed(1) + 's'}</div></div>
        <span class="chev ${state.expandedFail === id ? 'open' : ''}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
      </div>
      <div class="fail-detail" style="${state.expandedFail === id ? '' : 'display:none'}">
        <div class="box"><div class="msg">${sampleErrors.default}</div></div>
      </div>
    `;
    $failList.appendChild(item);
  });
  $failList.querySelectorAll('[data-fail]').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.fail;
      state.expandedFail = state.expandedFail === id ? null : id;
      renderResults();
    };
  });

  const openDoc = () => api.generateReport('run-' + Date.now());
  document.getElementById('btn-open-report').onclick = openDoc;
  document.getElementById('btn-open-doc').onclick = openDoc;
}

/* ============================================================
   HISTORY
   ============================================================ */
function renderHistory() {
  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div class="screen-title">Historial de ejecuciones</div>
        <div class="filters-row">
          <div class="filter-tabs">
            <span class="filter-tab active" data-filter="all">Todos</span>
            <span class="filter-tab" data-filter="passed">Exitosos</span>
            <span class="filter-tab" data-filter="failed">Con fallos</span>
          </div>
          <div class="date-filter">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>Últimos 30 días
          </div>
        </div>
      </div>
      <div class="history-body">
        <div class="history-table" id="history-table"></div>
      </div>
    </div>
  `;
  renderHistoryTable('all');

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderHistoryTable(tab.dataset.filter);
    };
  });
}

const AVATAR_COLORS = {
  'María Gómez': 'linear-gradient(135deg,#6366f1,#8b5cf6)',
  'Julián Ríos': 'linear-gradient(135deg,#0ea5e9,#2563eb)',
  'Carla Torres': 'linear-gradient(135deg,#f59e0b,#ea580c)',
};
function initials(name) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function renderHistoryTable(filter) {
  const $table = document.getElementById('history-table');
  const rows = state.history.filter((r) => filter === 'all' || r.result === filter);

  $table.innerHTML = `
    <div class="history-row head">
      <span>Fecha</span><span>Usuario</span><span>Pruebas</span><span>Resultado</span><span style="text-align:right;">Reporte</span>
    </div>
  `;
  rows.forEach((r) => {
    const d = new Date(r.date);
    const dateStr = d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <span class="history-date">${dateStr}</span>
      <span class="history-user"><span class="mini-avatar" style="background:${AVATAR_COLORS[r.user] || '#94a3b8'}">${initials(r.user)}</span>${r.user}</span>
      <span class="history-count">${r.count}</span>
      <span>${r.result === 'passed'
        ? `<span class="badge" style="color:var(--green-dark);background:var(--green-light);border:1px solid var(--green-border);">Todas pasaron</span>`
        : `<span class="badge" style="color:var(--red-dark);background:var(--red-light);border:1px solid var(--red-border);">${r.failedCount} fallida${r.failedCount === 1 ? '' : 's'}</span>`}</span>
      <span class="history-doc"><a href="#" data-doc="${r.docPath}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/></svg>.docx</a></span>
    `;
    $table.appendChild(row);
  });

  $table.querySelectorAll('[data-doc]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      api.generateReport(a.dataset.doc);
    };
  });
}

/* ============================================================
   UPDATE MODAL
   ============================================================ */
function openUpdateModal() {
  state.showUpdateModal = true;
  state.updating = false;
  state.updateProgress = 0;
  renderUpdateModal();
}

function renderUpdateModal() {
  $overlay.hidden = false;
  $overlay.innerHTML = `
    <div class="modal" style="width:440px;">
      <div class="modal-pad" style="text-align:center;">
        <div class="modal-icon" style="margin:0 auto 16px;width:60px;height:60px;border-radius:16px;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="m8 7 4-4 4 4"/><path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 9-9"/></svg>
        </div>
        <div class="modal-title">Hay una nueva versión de las pruebas</div>
        <div class="modal-sub">Se agregaron <b style="color:#334155;">3 pruebas nuevas</b> y correcciones. Actualiza para trabajar con la última versión.</div>

        ${state.updating ? `
          <div style="margin-top:22px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <span style="font-size:12.5px;font-weight:600;color:#334155;">Actualizando…</span>
              <span style="font-size:12.5px;font-weight:700;color:var(--accent);">${state.updateProgress}%</span>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width:${state.updateProgress}%"></div></div>
          </div>
        ` : `
          <div class="modal-actions">
            <button class="btn btn-secondary" id="update-later">Más tarde</button>
            <button class="btn btn-primary" id="update-now">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>Actualizar ahora
            </button>
          </div>
        `}
      </div>
    </div>
  `;

  if (!state.updating) {
    document.getElementById('update-later').onclick = () => { closeModal(); state.showUpdateModal = false; };
    document.getElementById('update-now').onclick = async () => {
      state.updating = true;
      renderUpdateModal();
      await api.runUpdate();
      setTimeout(() => {
        state.updateAvailable = false;
        state.showUpdateModal = false;
        closeModal();
        renderSidebarStatus();
        if (state.screen === 'dashboard') renderDashboard();
      }, 500);
    };
  }
}

/* ============================================================
   BROWSER STUB — permite abrir renderer/index.html directo en un
   navegador (fuera de Electron) para revisar visualmente el diseño.
   En la app real, preload.js sustituye todo esto por IPC real.
   ============================================================ */
function createBrowserStub() {
  const listeners = { progress: [], log: [], result: [] };
  return {
    async listProjects() { return [{ id:'demo', name:'Proyecto demo', defaultBranch:'main' }]; },
    async initializeProject({ name, repoUrl }) { return { ok:true, project:{ id:'nuevo', name, repoUrl, defaultBranch:'main' } }; },
    async importProjectFolder() { return { canceled:true, ok:false }; },
    async prepareProject(projectId) { return { ok:true, project:{ id:projectId, name:'Proyecto demo', defaultBranch:'main' } }; },
    windowMinimize() {}, windowMaximize() {}, windowClose() {},
    async getTestTree() {
      return fetch('../mock/tests-tree.json').then((r) => r.json()).catch(() => []);
    },
    async checkSyncStatus() { return { updateAvailable: true }; },
    async runUpdate() {
      for (let p = 0; p <= 100; p += 20) {
        await new Promise((r) => setTimeout(r, 200));
        listeners.progress.forEach((cb) => cb(p));
      }
      return { ok: true };
    },
    onUpdateProgress(cb) { listeners.progress.push(cb); },
    async listProfiles() {
      return [
        { id: 'demo', name: 'María Gómez', role: 'QA Lead' },
        { id: 'otro', name: 'Julián Ríos', role: 'QA Tester' },
      ];
    },
    async getActiveProfile() { return 'demo'; },
    async selectProfile(_projectId, profileId) { return profileId; },
    async getGithubStatus() { return { connected: true, login: 'maria-gomez', name: 'María Gómez' }; },
    async connectGithub() { return { ok: true, account: { login: 'maria-gomez' } }; },
    async cancelGithubConnect() { return { ok: true }; },
    async disconnectGithub() { return { ok: true }; },
    onGithubDeviceCode() {},
    async startRun({ testIds }) {
      for (const id of testIds) {
        listeners.result.forEach((cb) => cb({ id, status: 'running' }));
        await new Promise((r) => setTimeout(r, 350));
        const passed = Math.random() > 0.15;
        listeners.log.forEach((cb) => cb({ level: passed ? 'pass' : 'fail', text: id }));
        listeners.result.forEach((cb) => cb({ id, status: passed ? 'passed' : 'failed' }));
      }
      return { ok: true };
    },
    stopRun() {},
    onRunLog(cb) { listeners.log.push(cb); },
    onTestResult(cb) { listeners.result.push(cb); },
    async generateReport() { return { docPath: '/reportes/demo.docx' }; },
    async getHistory() {
      return fetch('../mock/history.json').then((r) => r.json()).catch(() => []);
    },
  };
}
