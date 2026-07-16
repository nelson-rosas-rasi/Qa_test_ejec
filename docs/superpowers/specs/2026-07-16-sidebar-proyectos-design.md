# Sidebar de proyectos — lista fija y modal a petición

**Fecha:** 2026-07-16
**Estado:** aprobado, pendiente de plan de implementación

## Problema

Dos fricciones en el punto de entrada de la app, ambas en el renderer:

1. **El modal de traer el repositorio se abre solo.** Al arrancar sin ningún
   proyecto, `init()` llama a `openProjectModal(true)` y el modal aparece encima
   de una app que el usuario todavía no ha visto. El argumento `required = true`
   además le quita el botón Cancelar, así que no hay forma de cerrarlo: la
   primera pantalla es un formulario obligatorio.
2. **La lista de proyectos está escondida.** Los proyectos disponibles viven
   dentro de un desplegable (`.project-switcher`) que hay que abrir con un clic.
   La opción para traer un repositorio nuevo es la última fila de ese menú, dos
   niveles de profundidad desde la vista inicial.

El resultado es que lo obligatorio (el modal) se impone y lo opcional (elegir
entre proyectos) se esconde. Este diseño invierte las dos cosas.

## Alcance

Sólo renderer: `renderer/index.html`, `renderer/renderer.js`, `renderer/styles.css`.

**Fuera de alcance:** el contenido del modal (campos, "Traer carpeta clonada",
"Validar e inicializar", manejo de errores) queda igual; el backend
(`main/projects.js`, `main/ipc.js`) no se toca; el flujo de sincronización
(`sync-pill`, modal de actualización) no se toca.

## Diseño

### 1. El modal sale sólo a petición

Se quita `openProjectModal(true)` del arranque en `init()`. Sin proyectos, la app
muestra el sidebar y la pantalla de bienvenida (`renderEmptyProject()`), sin nada
encima. El modal se abre desde dos lugares, ambos por decisión del usuario:

- el botón **"Traer repositorio"** del sidebar,
- el botón de la pantalla de bienvenida.

### 2. `openProjectModal` pierde el parámetro `required`

`required` existe únicamente para esconder el botón Cancelar. Como el modal ya
nunca es obligatorio, el parámetro deja de tener sentido: la firma pasa a
`openProjectModal()` y el botón Cancelar se renderiza siempre. Se actualizan las
tres llamadas actuales.

### 3. El sidebar pasa de desplegable a lista fija

`.project-switcher` se reemplaza por una lista siempre visible bajo el título
`PROYECTOS`:

```
PROYECTOS
 ● ERP          ✓     ← activo: check + fondo suave
   rama main
 ● Medical
 ● Finanzas

 [ + Traer repositorio ]
```

Cada fila mantiene el punto de color de `projectColor(p)` y el nombre. El
proyecto activo muestra el check (`checkSvg`) y la rama debajo — la rama sólo
aparece en el activo, para no convertir la lista en un muro de texto.

Al hacer clic en un proyecto, el comportamiento es el de hoy:
`loadProject(id)` → `loadProfiles()` → `renderScreen()`. Si `loadProject` falla,
la selección no cambia.

Desaparecen: el estado `state.projectMenuOpen`, el elemento `project-trigger`, el
chevron `project-chev`, el contenedor `project-menu` y el wiring del trigger en
`wireSidebar()`.

### 4. Estado vacío del sidebar

Sin proyectos, la lista muestra un texto tenue —"Todavía no hay proyectos"—
sobre el botón, en lugar de un hueco vacío. El sidebar explica qué hacer en vez
de verse roto.

### 5. Copy

El botón dice **"Traer repositorio"**, no "Inicializar proyecto": sigue el
lenguaje del equipo de QA y la regla del README de evitar jerga técnica. El
título del modal por dentro no cambia en esta rebanada.

## Riesgos

- `renderProjectSwitcher()` se llama desde seis sitios (líneas 53, 112, 129, 149,
  155 y 555). Dos desaparecen con este cambio —el wiring del trigger (112) y la
  fila "+ Inicializar proyecto" del menú (155)—; los otros cuatro deben seguir
  pasando por la nueva función de render.
- `styles.css` tiene reglas de `.project-*` que quedarán huérfanas; se eliminan
  las que ya no aplican para no dejar CSS muerto.

## Verificación

Los tests actuales (`test/*.test.js`) cubren main, no el renderer, así que no
protegen este cambio. La verificación es manual, levantando la app:

1. Sin proyectos: arranca sin modal encima; el sidebar dice "Todavía no hay
   proyectos" y muestra el botón.
2. El botón "Traer repositorio" abre el modal; Cancelar lo cierra.
3. El botón de la pantalla de bienvenida abre el mismo modal.
4. Con varios proyectos: se listan todos, el activo tiene check y rama.
5. Clic en otro proyecto: cambia el activo y recarga el árbol de pruebas.
