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
  runOptions: { visualMode: false, stopOnFail: false },
  showRunOptionsModal: false,
  runTarget: 'selected', // 'selected' | 'all'
  showReposModal: false,  // panel de "Actualizar pruebas" (pull por repo)
  reposChecking: false,   // verificando el remoto de cada repo
  reposStatus: [],        // [{ id, name, updateAvailable, behind, error }]
  repoUpdating: null,     // id del repo que se está trayendo ahora mismo
  runLog: [],
  runResults: {}, // testId -> 'running' | 'passed' | 'failed'
  runOrder: [],
  running: false,
  stopping: false,         // detención en curso (para mostrar "Deteniendo…")
  expandedFail: null,
  pendingSave: null,       // { runId, summary } tras terminar una corrida
  resultsView: 'registro', // 'registro' | 'detalle' | 'metrics'
  currentRunId: null,
  results: [],             // corridas guardadas del proyecto abierto
  trackedTests: new Set(), // ids de tests seguidos en la pestaña de métricas
  metricsPickerOpen: false, // "Elige los tests a seguir" desplegado o no
  flash: null,             // aviso breve a mostrar en el detalle (p. ej. n8n no configurado)
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
    // loadProject ya dejó el repo activo en la última versión (prepare hace el pull),
    // así que arrancamos "al día"; el estado real por repo se consulta al abrir el panel.
    state.updateAvailable = false;
    renderSidebarStatus();
    renderScreen();
  } finally {
    state.loadingProject = null;
    renderProjectSwitcher();
  }
}

function wireApiEvents() {
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
  state.results = await api.listResults(projectId);
  return true;
}
function currentProject() { return projects.find((p) => p.id === state.project) || null; }
function projectColor(p) {
  const colors = ['#2563eb','#0d9488','#9333ea','#ea580c','#0891b2'];
  return colors[[...(p?.id || '')].reduce((n,c) => n + c.charCodeAt(0),0) % colors.length];
}
function projectSuite(p) { return p?.name || 'Pruebas automatizadas'; }
/** Nombre del perfil activo (el que se maneja desde el selector de perfil). */
function activeProfileName() { return state.profiles.find((p) => p.id === state.profile)?.name || ''; }

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

/** Todo lo que va al repositorio necesita cuenta; lo local (historial, resultados) no. */
function needsGithub() {
  return !state.github.connected;
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

  const updateRow = document.createElement('div');
  updateRow.className = 'profile-menu-item';
  updateRow.innerHTML = needsGithub()
    ? `<div style="flex:1;min-width:0;"><div class="label">Actualizar pruebas</div><div class="sub">Conecta tu cuenta para traerlas</div></div>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
       <div style="flex:1;min-width:0;"><div class="label">Actualizar pruebas</div><div class="sub">Traer tests refinados de cada repositorio</div></div>`;
  updateRow.onclick = (e) => {
    e.stopPropagation();
    state.profileMenuOpen = false;
    if (needsGithub()) openGithubModal();
    else openReposUpdateModal();
  };
  menu.appendChild(updateRow);

  const separator2 = document.createElement('div');
  separator2.className = 'profile-menu-sep';
  menu.appendChild(separator2);

  const addRow = document.createElement('div');
  addRow.className = 'profile-menu-item';
  addRow.innerHTML = `<div style="flex:1;min-width:0;"><div class="label">Añadir perfil</div><div class="sub">Otro usuario para este proyecto</div></div>`;
  addRow.onclick = (e) => { e.stopPropagation(); state.profileMenuOpen = false; openProfileModal(); };
  menu.appendChild(addRow);

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
  if (needsGithub()) {
    el.className = 'sync-pill';
    el.innerHTML = '<span class="txt">Conecta tu cuenta para actualizar</span>';
    el.onclick = () => openGithubModal();
    return;
  }
  if (!state.project) { el.className = 'sync-pill'; el.innerHTML = '<span class="txt">Sin proyecto inicializado</span>'; el.onclick = null; return; }
  if (state.updateAvailable) {
    el.className = 'sync-pill update';
    el.innerHTML = `<span class="bullet"></span><span class="txt">Actualización disponible</span>`;
    el.onclick = () => openReposUpdateModal();
  } else {
    el.className = 'sync-pill ok';
    el.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      <span class="txt">Pruebas actualizadas</span>`;
    el.onclick = () => openReposUpdateModal();
  }
}

/* ============================================================
   SCREEN ROUTER
   ============================================================ */
function renderScreen() {
  if (!state.project) return renderEmptyProject();
  if (state.project && state.profiles.length === 0) {
    $main.innerHTML = `<div class="screen" style="display:grid;place-items:center;text-align:center;padding:40px">
      <div style="max-width:460px">
        <div class="screen-title">Crea tu perfil para este proyecto</div>
        <div class="screen-subtitle" style="margin:10px 0 22px">Necesitamos tu usuario y tus datos para ejecutar las pruebas con tu cuenta.</div>
        <button class="btn btn-primary" id="btn-create-profile">Crear perfil</button>
      </div></div>`;
    document.getElementById('btn-create-profile').onclick = () => openProfileModal();
    return;
  }
  if (state.screen === 'dashboard') renderDashboard();
  else if (state.screen === 'live') renderLive();
  else if (state.screen === 'results') renderResults();
  else if (state.screen === 'config') renderConfig();
  else if (state.screen === 'recordings') renderRecordings();
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
  if (needsGithub()) { openGithubModal(); return; }
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
function stopIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>`;
}

function renderEmptyProject() {
  $main.innerHTML = `<div class="screen" style="display:grid;place-items:center;text-align:center;padding:40px"><div style="max-width:500px"><div class="screen-title">Inicializa tu primer proyecto</div><div class="screen-subtitle" style="margin:10px 0 22px">Detectaremos la rama principal, crearemos un clon administrado y validaremos Playwright.</div><button class="btn btn-primary" id="btn-init-project">Inicializar proyecto</button></div></div>`;
  document.getElementById('btn-init-project').onclick = () => {
    if (needsGithub()) { openGithubModal(); return; }
    openProjectModal();
  };
}
function openProjectModal() {
  if (needsGithub()) { openGithubModal(); return; }
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

/** Campos cuyo valor se enmascara. Heurística genérica, no específica del repo. */
const SECRET_KEY = /(PASSWORD|TOKEN|SECRET)/i;

/** Claves que ya no se piden por perfil: se gestionan a nivel de proyecto
 *  (la URL de n8n es del proyecto, compartida por todos los perfiles). Debe
 *  coincidir con N8N_ENV_KEY de main/profiles/n8n-env.js. */
const PROJECT_LEVEL_KEYS = new Set(['N8N_WEBHOOK_URL']);

async function openProfileModal(profileId = null) {
  const schema = await api.getProfileSchema(state.project);
  if (!schema.ok) {
    $overlay.hidden = false;
    $overlay.innerHTML = `<div class="modal" style="width:440px"><div class="modal-pad">
      <div class="modal-title">${profileId ? 'No se puede editar el perfil' : 'No se puede crear el perfil'}</div>
      <div class="modal-sub" style="margin-top:8px">${schema.error || 'No fue posible leer la configuración del proyecto.'}</div>
      <div class="modal-actions"><button class="btn btn-primary" id="profile-err-close">Entendido</button></div>
    </div></div>`;
    document.getElementById('profile-err-close').onclick = () => closeModal();
    return;
  }
  const fields = schema.fields.filter((f) => !PROJECT_LEVEL_KEYS.has(f.key));

  const editing = !!profileId;
  let saved = {};
  if (editing) {
    const got = await api.getProfile(state.project, profileId);
    if (!got.ok) {
      $overlay.hidden = false;
      $overlay.innerHTML = `<div class="modal" style="width:440px"><div class="modal-pad">
        <div class="modal-title">No se puede editar el perfil</div>
        <div class="modal-sub" style="margin-top:8px">${got.error || 'No se pudo cargar el perfil.'}</div>
        <div class="modal-actions"><button class="btn btn-primary" id="profile-err-close">Entendido</button></div>
      </div></div>`;
      document.getElementById('profile-err-close').onclick = () => closeModal();
      return;
    }
    saved = got.values;
  }
  const valueFor = (f) => (editing && f.key in saved) ? saved[f.key] : f.value;

  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:560px;max-height:82vh;display:flex;flex-direction:column">
    <div class="modal-pad" style="overflow:auto">
      <div class="modal-title">${editing ? 'Editar perfil' : 'Crea tu perfil para este proyecto'}</div>
      <div class="modal-sub">${editing ? 'Actualiza los datos de este perfil.' : 'La app necesita tus datos para ejecutar las pruebas con tu usuario.'}</div>
      <div id="profile-fields" style="margin-top:16px">
        ${fields.map((f, i) => `
          <label style="display:block;margin-top:12px;font-size:12px;font-weight:700">${f.key}</label>
          <input id="pf-${i}" type="${SECRET_KEY.test(f.key) ? 'password' : 'text'}"
                 value="${String(valueFor(f)).replace(/"/g, '&quot;')}"
                 style="width:100%;margin-top:6px;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
          ${f.help ? `<div style="margin-top:4px;font-size:11px;color:#94a3b8">${f.help}</div>` : ''}
        `).join('')}
      </div>
      <div id="profile-error" style="display:none;margin-top:12px;color:#b91c1c;font-size:12px"></div>
    </div>
    <div class="modal-actions" style="padding:14px 20px;border-top:1px solid #eef2f7">
      <button class="btn btn-secondary" id="profile-cancel">Cancelar</button>
      <button class="btn btn-primary" id="profile-save">${editing ? 'Guardar cambios' : 'Guardar perfil'}</button>
    </div>
  </div>`;

  document.getElementById('profile-cancel').onclick = () => closeModal();
  document.getElementById('profile-save').onclick = async () => {
    // En edición partimos de los valores guardados para no perder claves que ya
    // no estén en el esquema actual (p. ej. si el .env.example del repo cambió).
    const values = editing ? { ...saved } : {};
    fields.forEach((f, i) => { values[f.key] = document.getElementById(`pf-${i}`).value; });
    // Las claves de proyecto (n8n) no se guardan en el perfil: manda el ajuste del proyecto.
    PROJECT_LEVEL_KEYS.forEach((k) => delete values[k]);
    const result = await api.saveProfile(state.project, profileId, values);
    if (!result.ok) {
      const err = document.getElementById('profile-error');
      err.textContent = result.error || 'No fue posible guardar el perfil.';
      err.style.display = 'block';
      return;
    }
    closeModal();
    await loadProfiles();
    if (state.screen === 'config') renderConfig(); else renderScreen();
  };
}

function openDeleteProfileModal(profileId) {
  const p = state.profiles.find((x) => x.id === profileId);
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:460px"><div class="modal-pad">
    <div class="modal-title">Eliminar perfil</div>
    <div class="modal-sub">Se eliminará el perfil ${p ? `«${escapeHtml(p.name)}»` : ''} de este equipo. Esta acción no se puede deshacer.</div>
    <div id="del-profile-error" style="display:none;margin-top:12px;color:#b91c1c;font-size:12px"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="del-profile-cancel">Cancelar</button>
      <button class="btn btn-danger" id="del-profile-confirm">Eliminar</button>
    </div>
  </div></div>`;
  document.getElementById('del-profile-cancel').onclick = () => closeModal();
  document.getElementById('del-profile-confirm').onclick = async () => {
    const res = await api.removeProfile(state.project, profileId);
    if (!res.ok) {
      const err = document.getElementById('del-profile-error');
      err.textContent = res.error || 'No se pudo eliminar el perfil.';
      err.style.display = 'block';
      return;
    }
    closeModal();
    await loadProfiles();
    if (state.screen === 'config') renderConfig(); else renderScreen();
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

/** Ícono ⚠ para alertas y confirmaciones. */
function warnIcon() {
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;margin-top:2px;"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
}

/** Ventana emergente de aviso (un solo botón). */
function openAlert({ title, message, confirmText = 'Entendido' }) {
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:440px"><div class="modal-pad">
    <div style="display:flex;gap:12px;align-items:flex-start;">${warnIcon()}
      <div style="flex:1;min-width:0;">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-sub" style="margin-top:6px;">${escapeHtml(message)}</div>
      </div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" id="alert-ok">${escapeHtml(confirmText)}</button></div>
  </div></div>`;
  document.getElementById('alert-ok').onclick = () => closeModal();
}

/** Ventana emergente de confirmación (Cancelar / acción). */
function openConfirm({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false, onConfirm }) {
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:460px"><div class="modal-pad">
    <div style="display:flex;gap:12px;align-items:flex-start;">${warnIcon()}
      <div style="flex:1;min-width:0;">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-sub" style="margin-top:6px;">${escapeHtml(message)}</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="confirm-cancel">${escapeHtml(cancelText)}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok">${escapeHtml(confirmText)}</button>
    </div>
  </div></div>`;
  document.getElementById('confirm-cancel').onclick = () => closeModal();
  document.getElementById('confirm-ok').onclick = () => { closeModal(); if (onConfirm) onConfirm(); };
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
    stopOnFail: state.runOptions.stopOnFail,
  });
  state.running = false;
  state.stopping = false;
  state.pendingSave = result && result.runId ? { runId: result.runId, summary: result.summary } : null;
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
          ${state.running ? `<button class="btn btn-danger" id="btn-stop" ${state.stopping ? 'disabled' : ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>${state.stopping ? 'Deteniendo…' : 'Detener ejecución'}
          </button>` : ''}
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

  const btnStop = document.getElementById('btn-stop');
  if (btnStop) btnStop.onclick = () => {
    openConfirm({
      title: 'Detener la ejecución',
      message: 'Se cerrará el navegador y las pruebas en curso quedarán sin terminar. ¿Deseas continuar?',
      confirmText: 'Detener',
      cancelText: 'Seguir ejecutando',
      danger: true,
      onConfirm: () => { state.stopping = true; api.stopRun(); renderLive(); },
    });
  };

  if (!state.running && state.pendingSave) renderSaveDecision();
}

function renderSaveDecision() {
  const s = state.pendingSave.summary || { total: 0, passed: 0, failed: 0 };
  const panel = document.createElement('div');
  panel.className = 'report-banner';
  panel.style.marginTop = '16px';
  panel.innerHTML = `
    <div style="flex:1;">
      <div class="report-text-title">La corrida terminó — ${s.passed || 0} de ${s.total || 0} pruebas pasaron</div>
      <div class="report-text-sub" id="save-decision-msg">¿Guardas esta corrida en el registro?</div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-secondary" id="dec-discard">Descartar</button>
      <button class="btn btn-secondary" id="dec-local">Guardar solo local</button>
      <button class="btn btn-primary" id="dec-n8n">Guardar y generar documentación</button>
    </div>`;
  document.querySelector('.screen').appendChild(panel);

  const runId = state.pendingSave.runId;
  const msg = () => document.getElementById('save-decision-msg');
  document.getElementById('dec-discard').onclick = () => {
    state.pendingSave = null;
    goToResults('registro');
  };
  document.getElementById('dec-local').onclick = async () => {
    const r = await api.saveResults(runId, { toN8n: false });
    if (!r.ok) { msg().textContent = r.error || 'No se pudo guardar.'; return; }
    state.pendingSave = null;
    openResultDetail(r.record.id);
  };
  document.getElementById('dec-n8n').onclick = async () => {
    const r = await api.saveResults(runId, { toN8n: true });
    if (!r.ok) { msg().textContent = r.error || 'No se pudo guardar.'; return; }
    // La corrida SIEMPRE se guarda local. Si pediste documentación pero no hay
    // URL de n8n configurada, r.n8nSkipped es true: se avisa en el detalle.
    state.pendingSave = null;
    openResultDetail(r.record.id);
    if (r.n8nSkipped) openAlert({
      title: 'n8n no está configurado',
      message: 'La corrida se guardó localmente. Configura la URL del webhook en Configuración para generar la documentación.',
    });
  };
}

/** Va a Resultados en la vista pedida. */
function goToResults(view) {
  state.resultsView = view;
  state.screen = 'results';
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === 'results'));
  renderScreen();
}

/** Abre el detalle de una corrida guardada. */
function openResultDetail(runId) {
  state.currentRunId = runId;
  goToResults('detalle');
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
async function renderResults() {
  if (state.resultsView === 'detalle' && state.currentRunId) return renderResultDetail();
  state.results = await api.listResults(state.project);
  if (state.resultsView === 'metrics') return renderResultsMetrics();
  return renderResultsRegistry();
}

function resultsTabs(active) {
  return `
    <div class="filter-tabs" style="margin-bottom:14px;">
      <span class="filter-tab ${active === 'registro' ? 'active' : ''}" data-rview="registro">Registro</span>
      <span class="filter-tab ${active === 'metrics' ? 'active' : ''}" data-rview="metrics">Métricas por test</span>
    </div>`;
}
function wireResultsTabs() {
  document.querySelectorAll('[data-rview]').forEach((el) => {
    el.onclick = () => { state.resultsView = el.dataset.rview; state.currentRunId = null; renderResults(); };
  });
}

function runLabel(r) {
  if (r.mode === 'individual') return r.tests && r.tests[0] ? r.tests[0].name : '1 prueba';
  return `${r.summary.total} pruebas`;
}
function n8nBadge(r) {
  if (r.n8n && r.n8n.sent && r.n8n.ok) return `<span class="badge" style="color:var(--accent);background:var(--accent-light);">documentación ✓</span>`;
  if (r.n8n && r.n8n.sent && !r.n8n.ok) return `<span class="badge" style="color:var(--red-dark);background:var(--red-light);border:1px solid var(--red-border);">reintentar envío</span>`;
  return `<span class="badge" style="color:#64748b;background:#f1f5f9;">solo local</span>`;
}

function filteredResults(f) {
  return state.results.filter((r) => {
    if (f.result === 'passed' && r.summary.failed > 0) return false;
    if (f.result === 'failed' && r.summary.failed === 0) return false;
    if (f.mode !== 'all' && r.mode !== f.mode) return false;
    if (f.query && !(r.tests || []).some((t) => t.name.toLowerCase().includes(f.query.toLowerCase()))) return false;
    if (f.date) {
      const d = new Date(r.finishedAt);
      const p = (n) => String(n).padStart(2, '0');
      const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      if (local !== f.date) return false;
    }
    return true;
  });
}

function paintResultsTable() {
  const $table = document.getElementById('results-table');
  if (!$table) return;
  const rows = filteredResults(state.resultsFilter);
  $table.innerHTML = '';
  if (rows.length === 0) {
    $table.innerHTML = `<div style="padding:40px;text-align:center;color:#94a3b8;">Aún no has guardado ninguna corrida.</div>`;
    return;
  }
  rows.forEach((r) => {
    const d = new Date(r.finishedAt);
    const dateStr = d.toLocaleDateString('es-CO', { day:'numeric', month:'short', year:'numeric' }) + ' · ' + d.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
    const row = document.createElement('div');
    row.className = 'history-row';
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <span class="history-date">${dateStr}</span>
      <span class="history-user">${escapeHtml(r.profileName || '')}</span>
      <span class="history-count">${r.mode === 'individual' ? 'Individual' : 'Conjunto'} · ${escapeHtml(runLabel(r))}</span>
      <span>${r.summary.failed > 0
        ? `<span class="badge" style="color:var(--red-dark);background:var(--red-light);border:1px solid var(--red-border);">${r.summary.failed} fallida${r.summary.failed===1?'':'s'}</span>`
        : `<span class="badge" style="color:var(--green-dark);background:var(--green-light);border:1px solid var(--green-border);">Todas pasaron</span>`}</span>
      <span style="text-align:right;">${n8nBadge(r)}</span>`;
    row.onclick = () => { state.currentRunId = r.id; state.resultsView = 'detalle'; renderResults(); };
    $table.appendChild(row);
  });
}

function renderResultsRegistry() {
  const f = state.resultsFilter || (state.resultsFilter = { result: 'all', mode: 'all', query: '', date: '' });
  if (f.date == null) f.date = '';

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header"><div class="screen-title">Resultados</div>
        ${resultsTabs('registro')}
        <div class="filters-row">
          <div class="filter-tabs">
            <span class="filter-tab ${f.result==='all'?'active':''}" data-fr="all">Todas</span>
            <span class="filter-tab ${f.result==='passed'?'active':''}" data-fr="passed">Todas pasaron</span>
            <span class="filter-tab ${f.result==='failed'?'active':''}" data-fr="failed">Con fallos</span>
          </div>
          <div class="filter-tabs">
            <span class="filter-tab ${f.mode==='all'?'active':''}" data-fm="all">Todo modo</span>
            <span class="filter-tab ${f.mode==='individual'?'active':''}" data-fm="individual">Individual</span>
            <span class="filter-tab ${f.mode==='conjunto'?'active':''}" data-fm="conjunto">Conjunto</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <input id="results-date" type="date" value="${escapeHtml(f.date)}" style="padding:8px 10px;border:1px solid #dbe3ef;border-radius:8px;">
            ${f.date ? `<button class="filter-tab" id="results-date-clear" title="Quitar fecha">✕</button>` : ''}
          </div>
          <div class="search-box"><input id="results-search" placeholder="Buscar test…" value="${escapeHtml(f.query)}"></div>
        </div>
      </div>
      <div class="history-body"><div class="history-table" id="results-table"></div></div>
    </div>`;

  paintResultsTable();
  wireResultsTabs();
  document.querySelectorAll('[data-fr]').forEach((el) => el.onclick = () => { f.result = el.dataset.fr; renderResults(); });
  document.querySelectorAll('[data-fm]').forEach((el) => el.onclick = () => { f.mode = el.dataset.fm; renderResults(); });
  document.getElementById('results-search').oninput = (e) => { f.query = e.target.value; paintResultsTable(); };
  document.getElementById('results-date').onchange = (e) => { f.date = e.target.value; renderResults(); };
  const dateClear = document.getElementById('results-date-clear');
  if (dateClear) dateClear.onclick = () => { f.date = ''; renderResults(); };
}

async function renderResultDetail() {
  const r = await api.getResult(state.project, state.currentRunId);
  if (!r) { state.resultsView = 'registro'; return renderResults(); }
  const failed = (r.tests || []).filter((t) => t.status !== 'passed' && t.status !== 'skipped');
  const d = new Date(r.finishedAt);
  const dateStr = d.toLocaleString('es-CO', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const dur = Math.round((r.durationMs || 0) / 1000);

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header" style="padding-bottom:16px;">
        <div class="row">
          <div>
            <div style="font-size:12px;color:var(--accent);cursor:pointer;margin-bottom:6px;" id="back-registro">← Registro</div>
            <div class="screen-title">Resultado — ${r.mode === 'individual' ? 'Individual' : 'Conjunto'}</div>
            <div class="screen-subtitle">${dateStr}${r.profileName ? ` · por ${escapeHtml(r.profileName)}` : ''}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary" id="btn-open-folder">Abrir carpeta</button>
            <button class="btn btn-secondary" id="btn-open-report" ${r.report && r.report.kind === 'template-pdf' ? '' : 'disabled'}>Abrir reporte</button>
            <button class="btn btn-secondary" id="btn-open-playwright" ${(r.reportPlaywright || (r.report && r.report.kind === 'playwright-html')) ? '' : 'disabled'}>Reporte de Playwright</button>
            ${r.n8n && r.n8n.sent && r.n8n.ok
              ? `<span class="badge" style="color:var(--accent);background:var(--accent-light);align-self:center;">documentación ✓</span>`
              : `<button class="btn btn-primary" id="btn-resend">Guardar y generar documentación</button>`}
          </div>
        </div>
      </div>
      <div class="results-body">
        <div class="summary-cards">
          <div class="card"><div class="card-label">Total</div><div class="card-value">${r.summary.total}</div></div>
          <div class="card green"><div class="card-label">${checkSvg('#16a34a')}Exitosos</div><div class="card-value">${r.summary.passed}</div></div>
          <div class="card red"><div class="card-label">Fallidos</div><div class="card-value">${r.summary.failed}</div></div>
          <div class="card"><div class="card-label">Duración</div><div class="card-value">${Math.floor(dur/60)}m ${dur%60}s</div></div>
        </div>
        <div class="section-title"><span class="bdot"></span>Pruebas fallidas (${failed.length})</div>
        <div class="fail-list" id="fail-list"></div>
      </div>
    </div>`;

  if (state.flash) {
    const banner = document.createElement('div');
    banner.className = 'report-banner';
    banner.style.cssText = 'margin-bottom:12px;background:var(--accent-light);';
    banner.innerHTML = `<div style="flex:1;color:var(--accent);font-size:13px;">${escapeHtml(state.flash)}</div>`;
    document.querySelector('.results-body').prepend(banner);
    state.flash = null;
  }

  const $failList = document.getElementById('fail-list');
  if (failed.length === 0) {
    $failList.innerHTML = `<div style="padding:20px;color:#94a3b8;">Ninguna prueba falló en esta corrida.</div>`;
  } else {
    failed.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'fail-item';
      item.innerHTML = `
        <div class="fail-head"><div class="info"><div class="name">${escapeHtml(t.name)}</div>
          <div class="meta">${((t.durationMs||0)/1000).toFixed(1)}s</div></div></div>
        <div class="fail-detail"><div class="box"><div class="msg">${escapeHtml(t.error || 'Sin mensaje de error')}</div></div></div>`;
      $failList.appendChild(item);
    });
  }

  document.getElementById('back-registro').onclick = () => { state.resultsView = 'registro'; state.currentRunId = null; renderResults(); };
  document.getElementById('btn-open-folder').onclick = () => api.openResultFolder(state.project, r.id);
  const rep = document.getElementById('btn-open-report');
  if (r.report && r.report.kind === 'template-pdf') rep.onclick = () => api.openResultReport(state.project, r.id);
  const repPw = document.getElementById('btn-open-playwright');
  if (r.reportPlaywright || (r.report && r.report.kind === 'playwright-html')) repPw.onclick = () => api.openResultPlaywright(state.project, r.id);
  const resend = document.getElementById('btn-resend');
  if (resend) resend.onclick = async () => {
    resend.disabled = true; resend.textContent = 'Generando…';
    const res = await api.resendResultN8n(state.project, r.id);
    if (!res.ok) {
      resend.disabled = false; resend.textContent = 'Guardar y generar documentación';
      openAlert({
        title: res.code === 'N8N_NOT_CONFIGURED' ? 'n8n no está configurado' : 'No se pudo generar la documentación',
        message: res.code === 'N8N_NOT_CONFIGURED'
          ? 'Configura la URL del webhook en Configuración para generar la documentación.'
          : (res.error || 'Ocurrió un error al enviar a n8n.'),
      });
      return;
    }
    renderResults();
  };
}

async function renderResultsMetrics() {
  // Unión de tests vistos en las corridas guardadas (para el selector).
  const seen = new Map();
  state.results.forEach((r) => (r.tests || []).forEach((t) => seen.set(t.id, t.name)));
  const testIds = [...state.trackedTests];
  const metrics = testIds.length ? await api.resultsMetrics(state.project, testIds) : {};

  const selectedCount = state.trackedTests.size;
  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header"><div class="screen-title">Resultados</div>${resultsTabs('metrics')}</div>
      <div class="results-body">
        <div class="picker ${state.metricsPickerOpen ? 'open' : ''}" id="track-picker-wrap">
          <div class="picker-head" id="track-picker-toggle">
            <svg class="picker-chevron" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            <span class="picker-title">Elige los tests a seguir</span>
            ${selectedCount ? `<span class="picker-count">${selectedCount} seleccionado${selectedCount === 1 ? '' : 's'}</span>` : ''}
          </div>
          <div id="track-picker" class="picker-list"></div>
        </div>
        <div id="metrics-cards"></div>
      </div>
    </div>`;

  document.getElementById('track-picker-toggle').onclick = () => {
    state.metricsPickerOpen = !state.metricsPickerOpen;
    document.getElementById('track-picker-wrap').classList.toggle('open', state.metricsPickerOpen);
  };

  const $picker = document.getElementById('track-picker');
  if (seen.size === 0) {
    $picker.innerHTML = `<div style="color:#94a3b8;padding:10px;">Guarda corridas para ver el historial por test.</div>`;
  } else {
    [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')).forEach(([id, name]) => {
      const on = state.trackedTests.has(id);
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;';
      row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}> <span>${escapeHtml(name)}</span> <span style="color:#94a3b8;">${escapeHtml(id)}</span>`;
      row.querySelector('input').onchange = (e) => {
        if (e.target.checked) state.trackedTests.add(id); else state.trackedTests.delete(id);
        renderResultsMetrics();
      };
      $picker.appendChild(row);
    });
  }

  const $cards = document.getElementById('metrics-cards');
  if (testIds.length === 0) {
    $cards.innerHTML = `<div style="color:#94a3b8;padding:10px;">Selecciona uno o más tests para ver su historial de errores.</div>`;
  } else {
    testIds.forEach((id) => {
      const h = metrics[id] || { runs: 0, failures: 0, failRate: 0, lastFailureAt: null, timeline: [], topError: null };
      const spark = h.timeline.map((s) => s === 'fail' ? '█' : '▁').join('');
      const last = h.lastFailureAt ? new Date(h.lastFailureAt).toLocaleDateString('es-CO', { day:'numeric', month:'short' }) : '—';
      const card = document.createElement('div');
      card.className = 'report-banner';
      card.style.cssText = 'display:block;margin-bottom:10px;';
      card.innerHTML = `
        <div style="font-weight:600;color:#0f172a;">${escapeHtml(seen.get(id) || id)} <span style="color:#94a3b8;font-weight:400;">${escapeHtml(id)}</span></div>
        <div style="margin-top:6px;font-size:13px;color:#334155;">
          Falló ${h.failures} de ${h.runs} corrida${h.runs===1?'':'s'} (${Math.round(h.failRate*100)}%)
          &nbsp;·&nbsp; <span style="font-family:monospace;letter-spacing:2px;">${spark || '—'}</span>
        </div>
        <div style="margin-top:4px;font-size:12px;color:#64748b;">Último fallo: ${last}${h.topError ? ` · Error más frecuente: ${escapeHtml(h.topError.message)} (${h.topError.count}×)` : ''}</div>`;
      $cards.appendChild(card);
    });
  }

  wireResultsTabs();
}

async function renderConfig() {
  const cfg = await api.getProjectConfig(state.project);
  const profiles = state.profiles;
  const active = state.profile;

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div class="screen-title">Configuración</div>
        <div class="screen-subtitle">Perfiles y ajustes de ${escapeHtml(projectSuite(currentProject()))}.</div>
      </div>
      <div class="config-body">
        <div class="config-section-title">Perfiles</div>
        <div class="card" id="config-profiles"></div>
        <button class="btn btn-secondary btn-sm" id="config-add-profile" style="margin-top:12px">+ Añadir perfil</button>

        <div class="config-section-title" style="margin-top:26px">Proyecto</div>
        <div class="card">
          <div class="config-label">Documentación (n8n) — URL del webhook</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="config-n8n" type="text" value="${escapeHtml(cfg.n8nWebhookUrl)}" placeholder="https://n8n.tu-servidor/webhook/..." style="flex:1;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
            <button class="btn btn-primary btn-sm" id="config-n8n-save">Guardar</button>
          </div>
          <div class="config-hint">Esta URL se usa para todos los perfiles de este proyecto. Si la dejas vacía, no se generará documentación.</div>
          <div id="config-n8n-status" class="config-hint" style="color:var(--green-dark)"></div>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="config-label">Repositorio</div>
          <button class="btn btn-secondary btn-sm" id="config-open-folder" style="margin-top:10px" ${cfg.hasRepo ? '' : 'disabled'}>Abrir carpeta del repo</button>
          <div id="config-repo-status" class="config-hint" style="color:var(--red-dark)">${cfg.hasRepo ? '' : 'La carpeta del repositorio no está disponible.'}</div>
        </div>
      </div>
    </div>`;

  const list = document.getElementById('config-profiles');
  if (profiles.length === 0) {
    list.innerHTML = `<div class="config-hint" style="margin:0">Este proyecto todavía no tiene perfiles.</div>`;
  } else {
    list.innerHTML = '';
    profiles.forEach((p) => {
      const isActive = p.id === active;
      const row = document.createElement('div');
      row.className = 'config-profile-row';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="config-profile-name">${escapeHtml(p.name)} · ${escapeHtml(p.role)}</div>
          ${isActive ? '<div class="config-profile-active">● activo</div>' : ''}
        </div>
        <button class="btn btn-secondary btn-sm" data-edit="${escapeHtml(p.id)}">Editar</button>
        <button class="btn btn-secondary btn-sm" data-del="${escapeHtml(p.id)}"${isActive ? ' disabled title="Activa otro perfil primero para poder eliminarlo"' : ''}>Eliminar</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-edit]').forEach((el) => { el.onclick = () => openProfileModal(el.dataset.edit); });
    list.querySelectorAll('[data-del]').forEach((el) => { el.onclick = () => openDeleteProfileModal(el.dataset.del); });
  }

  document.getElementById('config-add-profile').onclick = () => openProfileModal();

  document.getElementById('config-n8n-save').onclick = async () => {
    await api.setN8nUrl(state.project, document.getElementById('config-n8n').value);
    const status = document.getElementById('config-n8n-status');
    status.textContent = 'Guardado.';
    setTimeout(() => { if (document.body.contains(status)) status.textContent = ''; }, 2500);
  };

  const openFolder = document.getElementById('config-open-folder');
  if (cfg.hasRepo) {
    openFolder.onclick = async () => {
      const res = await api.openProjectFolder(state.project);
      if (!res.ok) document.getElementById('config-repo-status').textContent = res.error || 'No se pudo abrir la carpeta.';
    };
  }
}

/* ============================================================
   GRABACIONES
   ============================================================ */
async function renderRecordings() {
  const baseUrl = await api.recordingBaseUrl(state.project);
  const recs = await api.listRecordings(state.project);

  $main.innerHTML = `
    <div class="screen">
      <div class="screen-header">
        <div class="screen-title">Grabaciones</div>
        <div class="screen-subtitle">Graba un flujo con el navegador y súbelo al repositorio como borrador.</div>
      </div>
      <div class="config-body">
        <div class="config-section-title">Nueva grabación</div>
        <div class="card">
          <div class="config-label">URL a grabar</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="rec-url" type="text" value="${escapeHtml(baseUrl || '')}" placeholder="https://tu-ambiente/…" style="flex:1;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
            <button class="btn btn-primary btn-sm" id="rec-start">● Grabar</button>
          </div>
          <div class="config-hint">Se abrirá un navegador de grabación. Haz el flujo y cierra la ventana para guardar el borrador.</div>
          <div id="rec-status" class="config-hint" style="color:var(--muted)"></div>
        </div>

        <div class="config-section-title" style="margin-top:26px">Borradores</div>
        <div class="card" id="rec-list"></div>
      </div>
    </div>`;

  const list = document.getElementById('rec-list');
  if (recs.length === 0) {
    list.innerHTML = `<div class="config-hint" style="margin:0">Aún no hay grabaciones. Graba un flujo para empezar.</div>`;
  } else {
    list.innerHTML = '';
    recs.forEach((r) => {
      const date = new Date(r.createdAt).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const uploaded = r.status === 'uploaded' || !!r.uploaded;
      const statusLabel = uploaded ? 'Subida' : 'Borrador';
      const row = document.createElement('div');
      row.className = 'config-profile-row';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="config-profile-name">${escapeHtml(r.name)}</div>
            <span class="recording-status recording-status-${uploaded ? 'uploaded' : 'draft'}">${statusLabel}</span>
          </div>
          <div class="config-hint" style="margin-top:2px">${date}${r.profileName || r.profileId ? ` · ${escapeHtml(r.profileName || r.profileId)}` : ''}${r.uploaded ? ` · rama <b>${escapeHtml(r.uploaded.branch)}</b>` : ''}</div>
        </div>
        <button class="btn btn-secondary btn-sm" data-ren="${escapeHtml(r.id)}">Renombrar</button>
        <button class="btn btn-secondary btn-sm" data-del="${escapeHtml(r.id)}">Eliminar</button>
        <button class="btn ${uploaded ? 'btn-secondary' : 'btn-primary'} btn-sm" data-up="${escapeHtml(r.id)}">${uploaded ? 'Volver a subir' : 'Subir'}</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-ren]').forEach((el) => { el.onclick = () => openRenameRecording(el.dataset.ren, recs.find((r) => r.id === el.dataset.ren)); });
    list.querySelectorAll('[data-del]').forEach((el) => { el.onclick = () => openConfirm({ title: 'Eliminar grabación', message: '¿Eliminar este borrador? No se puede deshacer.', confirmText: 'Eliminar', danger: true, onConfirm: async () => { await api.removeRecording(state.project, el.dataset.del); renderRecordings(); } }); });
    list.querySelectorAll('[data-up]').forEach((el) => { el.onclick = () => openUploadRecording(el.dataset.up); });
  }

  document.getElementById('rec-start').onclick = async () => {
    const url = document.getElementById('rec-url').value.trim();
    const btn = document.getElementById('rec-start');
    const status = document.getElementById('rec-status');
    btn.disabled = true; status.textContent = 'Grabando… (cierra el navegador de grabación para terminar)';
    const res = await api.recordFlow(state.project, { url });
    btn.disabled = false; status.textContent = '';
    if (!res.ok) { openAlert({ title: 'No se pudo grabar', message: res.error || 'Ocurrió un error al grabar.' }); return; }
    renderRecordings();
  };
}

function openRenameRecording(id, rec) {
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:440px"><div class="modal-pad">
    <div class="modal-title">Renombrar grabación</div>
    <input id="ren-name" type="text" value="${escapeHtml(rec ? rec.name : '')}" style="width:100%;margin-top:12px;padding:10px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">
    <div class="modal-actions">
      <button class="btn btn-secondary" id="ren-cancel">Cancelar</button>
      <button class="btn btn-primary" id="ren-ok">Guardar</button>
    </div>
  </div></div>`;
  document.getElementById('ren-cancel').onclick = () => closeModal();
  document.getElementById('ren-ok').onclick = async () => {
    const name = document.getElementById('ren-name').value.trim();
    if (!name) return;
    await api.renameRecording(state.project, id, name);
    closeModal();
    renderRecordings();
  };
}

async function openUploadRecording(id) {
  if (needsGithub()) { openAlert({ title: 'Conecta tu cuenta', message: 'Necesitas conectar tu cuenta de GitHub para subir la grabación.' }); return; }
  $overlay.hidden = false;
  $overlay.innerHTML = `<div class="modal" style="width:480px"><div class="modal-pad">
    <div class="modal-title">Subir grabación</div>
    <div class="modal-sub" style="margin-top:6px">Elige una rama existente o escribe una nueva. Se subirá como borrador.</div>
    <div id="up-body" style="margin-top:14px"><div class="config-hint" style="margin:0">Cargando ramas…</div></div>
    <div id="up-error" style="display:none;margin-top:10px;color:#b91c1c;font-size:12px"></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" id="up-cancel">Cancelar</button>
      <button class="btn btn-primary" id="up-ok" disabled>Subir</button>
    </div>
  </div></div>`;
  document.getElementById('up-cancel').onclick = () => closeModal();

  const res = await api.recordingBranches(state.project);
  const body = document.getElementById('up-body');
  if (!res.ok) { body.innerHTML = `<div class="config-hint" style="margin:0;color:#b91c1c">${escapeHtml(res.error || 'No se pudieron leer las ramas.')}</div>`; return; }
  const options = res.branches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  body.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="radio" name="up-mode" value="existing" checked> Rama existente</label>
    <select id="up-existing" style="width:100%;margin-top:6px;padding:9px;border:1px solid #dbe3ef;border-radius:8px">${options}</select>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:12px"><input type="radio" name="up-mode" value="new"> Rama nueva</label>
    <input id="up-new" type="text" placeholder="drafts/mi-grabacion" disabled style="width:100%;margin-top:6px;padding:9px;border:1px solid #dbe3ef;border-radius:8px;box-sizing:border-box">`;
  const okBtn = document.getElementById('up-ok');
  okBtn.disabled = false;
  const mode = () => $overlay.querySelector('input[name="up-mode"]:checked').value;
  $overlay.querySelectorAll('input[name="up-mode"]').forEach((el) => el.onchange = () => {
    document.getElementById('up-existing').disabled = mode() !== 'existing';
    document.getElementById('up-new').disabled = mode() !== 'new';
  });
  okBtn.onclick = async () => {
    const isNew = mode() === 'new';
    const branch = isNew ? document.getElementById('up-new').value.trim() : document.getElementById('up-existing').value;
    const err = document.getElementById('up-error');
    if (!branch) { err.textContent = 'Escribe el nombre de la rama.'; err.style.display = 'block'; return; }
    okBtn.disabled = true; okBtn.textContent = 'Subiendo…';
    const up = await api.uploadRecording(state.project, { id, branch, isNew });
    if (!up.ok) { okBtn.disabled = false; okBtn.textContent = 'Subir'; err.textContent = up.error || 'No se pudo subir.'; err.style.display = 'block'; return; }
    closeModal();
    openAlert({ title: 'Grabación subida', message: `Se subió a la rama «${up.branch}».` });
    renderRecordings();
  };
}

/* ============================================================
   PANEL "ACTUALIZAR PRUEBAS" — pull de git por repositorio.
   Lista los repos clonados, verifica en el remoto si hay tests
   nuevos/refinados por traer, y los trae a la carpeta de cada uno
   (git fetch + reset --hard a la rama principal, vía prepareProject).
   ============================================================ */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function repoStatusById(id) { return state.reposStatus.find((r) => r.id === id) || {}; }

async function openReposUpdateModal() {
  state.showReposModal = true;
  state.reposChecking = true;
  state.repoUpdating = null;
  // arrancamos con lo que ya conocemos de los proyectos; el estado real se llena al verificar
  state.reposStatus = projects.map((p) => ({ id: p.id, name: p.name }));
  renderReposUpdateModal();
  try {
    const status = await api.reposStatus();
    if (!state.showReposModal) return;             // el usuario ya cerró el panel
    state.reposStatus = status;
    state.updateAvailable = status.some((r) => r.updateAvailable);
    renderSidebarStatus();
  } catch (err) {
    state.reposStatus = state.reposStatus.map((r) => ({ ...r, error: err.message || String(err) }));
  } finally {
    state.reposChecking = false;
    if (state.showReposModal) renderReposUpdateModal();
  }
}

function renderReposUpdateModal() {
  $overlay.hidden = false;

  const rows = state.reposStatus.map((st) => {
    const project = projects.find((p) => p.id === st.id) || st;
    const busy = state.repoUpdating === st.id;
    const checking = state.reposChecking && st.updateAvailable === undefined && !st.error;

    let right;
    if (busy) right = `<span style="font-size:12px;font-weight:600;color:var(--accent);">Trayendo…</span>`;
    else if (checking) right = `<span style="font-size:12px;color:#94a3b8;">Verificando…</span>`;
    else if (st.error) right = `<span style="font-size:11.5px;color:#dc2626;">No se pudo verificar</span>`;
    else if (st.updateAvailable) right = `<button class="btn btn-primary btn-pull" data-id="${escapeHtml(st.id)}" style="padding:6px 12px;font-size:12px;" ${state.repoUpdating ? 'disabled' : ''}>Traer cambios</button>`;
    else right = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--green-dark);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Al día</span>`;

    const sub = st.error ? escapeHtml(st.error)
      : busy ? 'Trayendo cambios a la carpeta…'
      : checking ? 'Consultando el remoto…'
      : st.updateAvailable ? `${st.behind || ''} ${st.behind === 1 ? 'cambio' : 'cambios'} por traer`.trim()
      : 'Sin cambios pendientes';

    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #eef2f7;border-radius:10px;">
        <span style="width:9px;height:9px;border-radius:50%;flex:none;background:${projectColor(project)};"></span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(project.name || st.id)}</div>
          <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sub}</div>
        </div>
        <div style="flex:none;">${right}</div>
      </div>`;
  }).join('');

  const pending = state.reposStatus.filter((r) => r.updateAvailable);
  $overlay.innerHTML = `
    <div class="modal" style="width:520px;max-width:92vw;">
      <div class="modal-pad">
        <div style="display:flex;align-items:center;gap:12px;">
          <div class="modal-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg></div>
          <div style="flex:1;min-width:0;">
            <div class="modal-title">Actualizar pruebas</div>
            <div class="modal-sub" style="margin-top:2px;">Trae a cada carpeta los tests refinados que ya estén en su repositorio.</div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-top:18px;max-height:46vh;overflow:auto;">
          ${rows || `<div style="padding:22px;text-align:center;color:#94a3b8;font-size:13px;">No hay repositorios clonados todavía.</div>`}
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" id="repos-close">Cerrar</button>
          <button class="btn btn-primary" id="repos-update-all" ${pending.length && !state.repoUpdating ? '' : 'disabled'}>
            Traer todos${pending.length ? ` (${pending.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('repos-close').onclick = () => { state.showReposModal = false; closeModal(); };
  const allBtn = document.getElementById('repos-update-all');
  if (allBtn && pending.length && !state.repoUpdating) allBtn.onclick = () => pullRepos(pending.map((r) => r.id));
  if (!state.repoUpdating) {
    document.querySelectorAll('.btn-pull').forEach((b) => { b.onclick = () => pullRepos([b.dataset.id]); });
  }
}

/** Trae los cambios de cada repo (uno por uno) llamando al pull real del backend. */
async function pullRepos(ids) {
  for (const id of ids) {
    if (!state.showReposModal) return;
    state.repoUpdating = id;
    renderReposUpdateModal();
    const st = repoStatusById(id);
    try {
      const result = await api.prepareProject(id);
      if (!result.ok) throw new Error(result.error || 'No fue posible traer los cambios.');
      projects = projects.map((p) => p.id === id ? { ...p, ...result.project } : p);
      st.updateAvailable = false; st.behind = 0; st.error = null;
      // si es el proyecto abierto, refresca el árbol con las pruebas ya actualizadas
      if (id === state.project) {
        state.testTree = await api.getTestTree(id);
        state.expandedSuites = new Set(state.testTree.map((s) => s.id));
      }
    } catch (err) {
      st.error = err.message || String(err);
    }
  }
  state.repoUpdating = null;
  state.updateAvailable = state.reposStatus.some((r) => r.updateAvailable);
  renderSidebarStatus();
  if (state.showReposModal) renderReposUpdateModal();
  if (state.screen === 'dashboard') renderDashboard();
}

/* ============================================================
   BROWSER STUB — permite abrir renderer/index.html directo en un
   navegador (fuera de Electron) para revisar visualmente el diseño.
   En la app real, preload.js sustituye todo esto por IPC real.
   ============================================================ */
function createBrowserStub() {
  const listeners = { log: [], result: [] };
  return {
    async listProjects() { return [{ id:'demo', name:'Proyecto demo', defaultBranch:'main' }, { id:'erp', name:'ERP Ventas', defaultBranch:'main' }]; },
    async initializeProject({ name, repoUrl }) { return { ok:true, project:{ id:'nuevo', name, repoUrl, defaultBranch:'main' } }; },
    async importProjectFolder() { return { canceled:true, ok:false }; },
    async prepareProject(projectId) { await new Promise((r) => setTimeout(r, 600)); return { ok:true, project:{ id:projectId, name:'Proyecto demo', defaultBranch:'main' } }; },
    windowMinimize() {}, windowMaximize() {}, windowClose() {},
    async getTestTree() {
      return fetch('../mock/tests-tree.json').then((r) => r.json()).catch(() => []);
    },
    async reposStatus() {
      await new Promise((r) => setTimeout(r, 500));
      return [
        { id: 'demo', name: 'Proyecto demo', updateAvailable: true, behind: 3 },
        { id: 'erp', name: 'ERP Ventas', updateAvailable: false, behind: 0 },
      ];
    },
    async listProfiles() {
      return [
        { id: 'demo', name: 'María Gómez', role: 'QA Lead' },
        { id: 'otro', name: 'Julián Ríos', role: 'QA Tester' },
      ];
    },
    async getActiveProfile() { return 'demo'; },
    async selectProfile(_projectId, profileId) { return profileId; },
    async getProfileSchema() { return { ok: true, fields: [
      { key: 'TEST_USERNAME', value: 'demo', help: 'Tu usuario del ERP' },
      { key: 'TEST_PASSWORD', value: '', help: '' },
    ] }; },
    async saveProfile(_p, _id, values) { return { ok: true, profile: { id: 'demo', name: values.QA_NOMBRE || 'Demo', role: values.QA_CARGO || 'QA' } }; },
    async getGithubStatus() { return { connected: true, login: 'maria-gomez', name: 'María Gómez' }; },
    async connectGithub() { return { ok: true, account: { login: 'maria-gomez' } }; },
    async cancelGithubConnect() { return { ok: true }; },
    async disconnectGithub() { return { ok: true }; },
    onGithubDeviceCode() {},
    async startRun({ testIds }) {
      let passedCount = 0, failedCount = 0;
      for (const id of testIds) {
        listeners.result.forEach((cb) => cb({ id, status: 'running' }));
        await new Promise((r) => setTimeout(r, 350));
        const passed = Math.random() > 0.15;
        if (passed) passedCount++; else failedCount++;
        listeners.log.forEach((cb) => cb({ level: passed ? 'pass' : 'fail', text: id }));
        listeners.result.forEach((cb) => cb({ id, status: passed ? 'passed' : 'failed' }));
      }
      return { ok: true, runId: 'run-' + Date.now(), summary: { total: testIds.length, passed: passedCount, failed: failedCount, skipped: 0 } };
    },
    stopRun() {},
    onRunLog(cb) { listeners.log.push(cb); },
    onTestResult(cb) { listeners.result.push(cb); },
    async saveResults(runId, { toN8n }) {
      return { ok: true, n8nSkipped: false, record: { id: runId, projectId: 'demo', projectName: 'Demo', profileName: 'María Gómez',
        finishedAt: new Date().toISOString(), durationMs: 42000, mode: 'conjunto',
        summary: { total: 3, passed: 2, failed: 1, skipped: 0 },
        tests: [{ id: 'a.spec.ts:1', name: 'login', status: 'failed', durationMs: 2100, error: 'timeout' }],
        report: null, n8n: { sent: !!toN8n, ok: !!toN8n, at: null, error: null } } };
    },
    async listResults() {
      return [{ id: 'run-1', projectId: 'demo', projectName: 'Demo', profileName: 'María Gómez',
        finishedAt: '2026-07-22T14:00:00Z', durationMs: 42000, mode: 'conjunto',
        summary: { total: 3, passed: 2, failed: 1, skipped: 0 },
        tests: [{ id: 'a.spec.ts:1', name: 'login', status: 'failed', durationMs: 2100, error: 'timeout' }],
        report: null, n8n: { sent: true, ok: true } }];
    },
    async getResult(_p, runId) { return (await this.listResults())[0]; },
    async removeResult() { return { ok: true }; },
    async resultsMetrics(_p, ids) { const o = {}; ids.forEach((id) => o[id] = { runs: 3, failures: 1, failRate: 0.33, lastFailureAt: '2026-07-22T14:00:00Z', timeline: ['pass','fail','pass'], topError: { message: 'timeout', count: 1 } }); return o; },
    async resendResultN8n() { return { ok: true, n8n: { sent: true, ok: true } }; },
    async openResultReport() {}, async openResultPlaywright() {}, async openResultFolder() {},
    async listRecordings() { return []; }, async recordingBaseUrl() { return ''; },
    async recordFlow() { return { ok: false }; }, async renameRecording() {},
    async removeRecording() {}, async recordingBranches() { return { ok: true, branches: [] }; },
    async uploadRecording() { return { ok: false }; },
  };
}
