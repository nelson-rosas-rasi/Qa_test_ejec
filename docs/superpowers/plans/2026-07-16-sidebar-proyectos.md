# Sidebar de proyectos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el modal de traer el repositorio salga sólo cuando el usuario lo pida, y que los proyectos disponibles se vean como una lista fija en el sidebar izquierdo.

**Architecture:** Cambio contenido al renderer de Electron. El desplegable `.project-switcher` (trigger + chevron + menú oculto) se reemplaza por una lista siempre visible más un botón "Traer repositorio". El estado `state.projectMenuOpen` desaparece. El modal deja de abrirse desde `init()` y pierde el parámetro `required`, que sólo servía para esconder el botón Cancelar.

**Tech Stack:** Electron 30, JS de navegador sin framework ni bundler, CSS plano. Sin dependencias nuevas.

**Verificación:** manual, levantando la app. El renderer no tiene harness de tests (no hay jsdom; los 11 tests de `test/` cubren sólo `main/`, y `renderer.js` es un script sin exports que llama a `init()` al cargarse). Montar ese harness se decidió explícitamente como fuera de alcance: es reestructurar un archivo de 1013 líneas para un cambio visual de ~80. Cada tarea termina con una comprobación manual concreta en vez de un test automático.

**Cómo levantar la app:** desde `electron-app/`, `npm start`. Si arranca con el error `Cannot read properties of undefined (reading 'whenReady')`, la variable `ELECTRON_RUN_AS_NODE=1` está en el entorno (la ponen los hosts de VS Code); ejecuta `unset ELECTRON_RUN_AS_NODE` antes de `npm start`.

---

### Task 1: El modal deja de abrirse solo y siempre se puede cancelar

Primero se corta el bloqueo de arranque. Al terminar esta tarea la app abre sin modal encima; la lista del sidebar sigue siendo el desplegable de hoy (se cambia en la Task 2).

**Files:**
- Modify: `electron-app/renderer/renderer.js:53` (llamada en `init`)
- Modify: `electron-app/renderer/renderer.js:536` (botón de la pantalla de bienvenida)
- Modify: `electron-app/renderer/renderer.js:538` (firma de `openProjectModal`)
- Modify: `electron-app/renderer/renderer.js:548` (botón Cancelar)
- Modify: `electron-app/renderer/renderer.js:587` (wiring del Cancelar)
- Modify: `electron-app/renderer/renderer.js:155` (fila "+ Inicializar proyecto")

- [ ] **Step 1: Quitar el modal del arranque**

En `init()`, línea 53. Antes:

```js
    renderProjectSwitcher(); renderSidebarStatus(); renderEmptyProject(); openProjectModal(true); return;
```

Después:

```js
    renderProjectSwitcher(); renderSidebarStatus(); renderEmptyProject(); return;
```

- [ ] **Step 2: Quitar el parámetro `required` de la firma**

Línea 538. Antes:

```js
function openProjectModal(required) {
```

Después:

```js
function openProjectModal() {
```

- [ ] **Step 3: El botón Cancelar se renderiza siempre**

Línea 548. Antes:

```js
    <div class="modal-actions"><button class="btn btn-secondary" id="project-import-folder">Traer carpeta clonada</button>${required ? '' : '<button class="btn btn-secondary" id="project-init-cancel">Cancelar</button>'}<button class="btn btn-primary" id="project-init-confirm">Validar e inicializar</button></div>
```

Después:

```js
    <div class="modal-actions"><button class="btn btn-secondary" id="project-import-folder">Traer carpeta clonada</button><button class="btn btn-secondary" id="project-init-cancel">Cancelar</button><button class="btn btn-primary" id="project-init-confirm">Validar e inicializar</button></div>
```

- [ ] **Step 4: El wiring del Cancelar deja de ser condicional**

Línea 587. Antes:

```js
  if (!required) document.getElementById('project-init-cancel').onclick = closeModal;
```

Después:

```js
  document.getElementById('project-init-cancel').onclick = closeModal;
```

- [ ] **Step 5: Actualizar las dos llamadas que pasaban argumento**

Línea 536, dentro de `renderEmptyProject()`. Antes:

```js
  document.getElementById('btn-init-project').onclick = () => openProjectModal(true);
```

Después:

```js
  document.getElementById('btn-init-project').onclick = () => openProjectModal();
```

Línea 155, la fila "+ Inicializar proyecto" del menú (esta fila desaparece en la Task 2, pero debe quedar coherente ahora para que la app funcione entre tareas). Antes:

```js
  add.onclick = (e) => { e.stopPropagation(); state.projectMenuOpen=false; renderProjectSwitcher(); openProjectModal(false); };
```

Después:

```js
  add.onclick = (e) => { e.stopPropagation(); state.projectMenuOpen=false; renderProjectSwitcher(); openProjectModal(); };
```

- [ ] **Step 6: Verificar que no quedan referencias a `required`**

Run: `cd electron-app && grep -n "openProjectModal\|required" renderer/renderer.js`
Expected: tres llamadas `openProjectModal()` sin argumentos (líneas ~155, ~536) más la definición `function openProjectModal() {`. Ninguna aparición de `required` ligada al modal.

- [ ] **Step 7: Comprobación manual**

Run: `cd electron-app && npm start`
Expected:
- La app abre **sin modal encima** (con o sin proyectos configurados).
- Si no hay proyectos, se ve la pantalla "Inicializa tu primer proyecto" y el sidebar dice "Sin proyecto inicializado".
- El botón "Inicializar proyecto" de esa pantalla abre el modal.
- El modal ahora **tiene botón Cancelar** y Cancelar lo cierra sin romper nada.

- [ ] **Step 8: Commit**

```bash
git add electron-app/renderer/renderer.js
git commit -m "fix: el modal de traer el repositorio ya no se abre solo al arrancar"
```

---

### Task 2: El sidebar pasa de desplegable a lista fija

**Files:**
- Modify: `electron-app/renderer/index.html:37-50` (bloque del switcher)
- Modify: `electron-app/renderer/renderer.js:18` (estado `projectMenuOpen`)
- Modify: `electron-app/renderer/renderer.js:108-130` (`wireSidebar`)
- Modify: `electron-app/renderer/renderer.js:132-157` (`renderProjectSwitcher`)
- Modify: `electron-app/renderer/styles.css:86-100` (estilos del switcher)

- [ ] **Step 1: Reemplazar el markup del sidebar**

En `index.html`, sustituir el bloque completo de las líneas 37 a 50 (desde `<div class="sidebar-label">Proyecto</div>` hasta el `</div>` que cierra `project-switcher`) por:

```html
      <div class="sidebar-label">Proyectos</div>
      <div class="project-list" id="project-list"></div>
      <button class="project-add" id="project-add">
        <span class="project-add-icon">+</span>
        <span>Traer repositorio</span>
      </button>
```

- [ ] **Step 2: Quitar el estado del desplegable**

En `renderer.js`, línea 18, borrar esta línea del objeto `state`:

```js
  projectMenuOpen: false,
```

- [ ] **Step 3: Reescribir el render de la lista**

Sustituir la función `renderProjectSwitcher` completa (líneas 132-157) por:

```js
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
    const row = document.createElement('div');
    row.className = 'project-item' + (active ? ' active' : '');

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = projectColor(project);

    const text = document.createElement('div');
    text.className = 'project-item-text';
    const name = document.createElement('div');
    name.className = 'project-item-name';
    name.textContent = project.name;
    text.appendChild(name);
    if (active) {
      const branch = document.createElement('div');
      branch.className = 'project-item-branch';
      branch.textContent = `rama ${project.defaultBranch}`;
      text.appendChild(branch);
    }

    row.append(dot, text);
    if (active) row.insertAdjacentHTML('beforeend', checkSvg(projectColor(project)));

    row.onclick = async () => {
      if (project.id === state.project) return;
      if (!await loadProject(project.id)) return;
      state.project = project.id;
      renderProjectSwitcher();
      await loadProfiles();
      renderScreen();
    };
    list.appendChild(row);
  });
}
```

Nota: el clic sale temprano si el proyecto ya está activo — sin eso, volver a hacer clic en el proyecto actual dispararía `loadProject` (que hace fetch y `npm ci`) sin motivo.

- [ ] **Step 4: Recablear el sidebar**

Sustituir la función `wireSidebar` completa (líneas 108-130) por:

```js
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

  renderProjectSwitcher();
}
```

- [ ] **Step 5: Reemplazar los estilos**

En `styles.css`, sustituir las líneas 86 a 100 (desde `.project-switcher` hasta `.project-menu-item span.label`, ambas incluidas) por:

```css
.project-list { display: flex; flex-direction: column; gap: 2px; }
.project-item { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 7px; cursor: pointer; }
.project-item:hover { background: #eef2f8; }
.project-item.active { background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,.06); cursor: default; }
.project-item .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.project-item-text { flex: 1; min-width: 0; }
.project-item-name { font-size: 12.5px; font-weight: 600; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.project-item-branch { font-size: 10.5px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.project-empty { font-size: 11.5px; color: #a2adbd; padding: 8px; }

.project-add {
  display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px;
  padding: 8px; border: 1px dashed #cbd5e1; border-radius: 7px; background: none;
  font-family: inherit; font-size: 12.5px; font-weight: 600; color: var(--accent);
  cursor: pointer; text-align: left;
}
.project-add:hover { background: var(--accent-light); border-color: var(--accent); }
.project-add-icon { font-size: 15px; line-height: 1; }
```

Dos cosas que NO se tocan, verificadas contra el código:

- `.chev` (líneas 93-94) se queda: no es exclusivo del switcher, lo usa el
  acordeón de fallos en `renderer.js:803`.
- La función `projectSuite()` (`renderer.js:94`) se queda. Se parece al nombre de
  la clase `.project-suite` que sí se borra, pero no tienen relación: la función
  la usan cinco pantallas (`renderer.js` líneas 254, 459, 662, 754, 779).

- [ ] **Step 6: Verificar que no quedan referencias muertas**

Run: `cd electron-app && grep -rn "projectMenuOpen\|project-trigger\|project-chev\|project-menu\|project-switcher\|project-suite\|project-name" renderer/`
Expected: **cero resultados**. Cualquier resultado es una referencia huérfana que rompe el render (`.project-switcher` y `.project-name` sólo existían para el desplegable; `.profile-*` es otra familia de clases y no debe aparecer aquí).

- [ ] **Step 7: Comprobación manual**

Run: `cd electron-app && npm start`
Expected:
- El sidebar muestra el título "PROYECTOS" y debajo la lista de proyectos, **sin desplegar nada**.
- El proyecto activo tiene fondo blanco, check de color y la rama debajo del nombre; los demás sólo punto y nombre.
- Debajo de la lista está el botón punteado "+ Traer repositorio", y abre el modal.
- Clic en otro proyecto: cambia el activo (check y rama se mueven) y el árbol de pruebas del centro se recarga.
- Clic en el proyecto ya activo: no pasa nada (no se recarga).
- Sin proyectos: la lista dice "Todavía no hay proyectos" y el botón sigue visible.

- [ ] **Step 8: Commit**

```bash
git add electron-app/renderer/index.html electron-app/renderer/renderer.js electron-app/renderer/styles.css
git commit -m "feat: los proyectos disponibles se listan fijos en el sidebar"
```

---

### Task 3: Verificación final

**Files:** ninguno (sólo comprobación)

- [ ] **Step 1: Los tests de main siguen pasando**

Run: `cd electron-app && npm test`
Expected: los 11 archivos de `test/` pasan. Este cambio no toca `main/`, así que un fallo aquí significa que se tocó algo que no correspondía.

- [ ] **Step 2: Recorrido completo de los 5 criterios del spec**

Run: `cd electron-app && npm start`
Expected, en orden:
1. Arranca sin modal encima.
2. "+ Traer repositorio" abre el modal; Cancelar lo cierra.
3. El botón de la pantalla de bienvenida (sin proyectos) abre el mismo modal.
4. Con varios proyectos: se listan todos; el activo tiene check y rama.
5. Clic en otro proyecto: cambia el activo y recarga el árbol de pruebas.

- [ ] **Step 3: Sin errores en la consola del renderer**

Con la app abierta, pulsa `Ctrl+Shift+I` para abrir DevTools y mira la pestaña Console.
Expected: sin excepciones. Un `Cannot read properties of null (reading 'style')` indica un `getElementById` apuntando a un id que se borró en la Task 2.
