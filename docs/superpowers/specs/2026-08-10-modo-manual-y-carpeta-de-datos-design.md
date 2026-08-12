# Modo manual en el Setup y carpeta de datos elegible

Fecha: 2026-08-10

Dos cambios que comparten una misma raíz: hoy el QA no tiene salida cuando algo
falla, y no tiene voz sobre dónde queda lo que el equipo produce.

## Problema

**1. El Setup no tiene escape.** `RunQA Setup` sólo sabe instalar en silencio. Si
un paso falla, la única acción disponible es "Reintentar", que ejecuta
exactamente el mismo comando y falla igual. El caso real que lo destapó: el MSI
de Node devolviendo `1603` en dos equipos, dos días distintos, cuatro intentos.
Con `/qn` el instalador no muestra nada, así que el QA queda parado y el líder
recibe un código genérico.

**2. Los datos viven donde Windows decide.** RunQA cuelga todo de
`app.getPath('userData')` (`ipc.js:53-60`): proyectos clonados, resultados,
grabaciones y perfiles. Esa ruta depende de la cuenta de Windows con la que
corre la app, y es la misma razón por la que elevar el Setup con una cuenta
ajena deja los navegadores en el perfil equivocado. El QA no puede mandar los
repos a otro disco cuando `C:` se llena de `node_modules`, ni sabe dónde ir a
buscar los reportes.

## Alcance

Entra:

- Modo manual en el Setup, disponible siempre y resaltado cuando un paso falla.
- Carpeta raíz de datos elegible, para proyectos, resultados y grabaciones.

No entra:

- Elegir dónde se instala el ejecutable de RunQA (lo decide el asistente NSIS).
- Mover perfiles y token de GitHub fuera de `userData`.
- Mover los navegadores de Playwright fuera de `LOCALAPPDATA\ms-playwright`.
- Migrar datos existentes de una carpeta a otra.

## Parte 1 — Modo manual en el Setup

### Comportamiento

Un botón `Hacerlo a mano` fijo junto a `Empezar`, en la pantalla principal. No
es una segunda pantalla ni un segundo modo: es el mismo botón siempre, que
cambia de peso visual. Cuando un paso queda en `error`, el botón se resalta y el
mensaje de error agrega que se puede instalar a mano.

Al tocarlo, el Setup abre `cmd.exe /K` heredando el administrador que ya tiene,
parado en `%TEMP%`, con los comandos impresos en pantalla listos para copiar.

Los comandos son las versiones **no silenciosas** de lo que el Setup habría
corrido solo: `msiexec /i "<msi>" /norestart`, sin `/qn`. El asistente gráfico
se ve y el error deja de ser un número.

Se muestran sólo los pasos que faltan, en orden. Si el QA entró desde un paso
fallado, ese va primero, bajo un encabezado que lo nombra. Si no falta ninguno,
la consola muestra igual el comando de instalar RunQA, que nunca se salta.

La consola hereda el `%TEMP%` del proceso del Setup, que es donde quedaron las
descargas: si el Setup se elevó con otra cuenta, los archivos están en el perfil
de esa cuenta y los comandos apuntan ahí igual, sin depender de quién abra la
consola.

### Verificación

El Setup no espera nada de la consola ni intenta adivinar si funcionó — no
puede: es un proceso suelto que el QA maneja. Muestra un botón `Verificar` que
llama al `refresh()` que ya existe en `main/run.js`, que corre `detect()` y
repinta los pasos. Cero lógica de detección nueva.

### Módulo nuevo: `setup/main/manual.js`

Una función pura `manualCommands({ steps, env, prerequisites })` que devuelve la
lista de comandos como texto. Deriva de `prerequisites.json` y de `binaryPaths`
—las mismas fuentes que usan los instaladores—, de modo que subir la versión de
Node en `prerequisites.json` actualice también lo que dice la consola. Sin eso,
la consola miente en la primera actualización.

Comandos por paso:

| Paso       | Comando manual                                                      |
|------------|---------------------------------------------------------------------|
| `git`      | el `.exe` de Git sin `/VERYSILENT` (asistente visible)               |
| `node`     | `msiexec /i "<msi>" /norestart` (sin `/qn`)                          |
| `browsers` | `"<npx.cmd>" --yes playwright@<version> install`                     |
| `runqa`    | el `.exe` del último release, tal cual                               |

Los archivos que ya se descargaron se reusan: el modo manual **no** vuelve a
descargar. Si el archivo todavía no está en `%TEMP%`, el comando va precedido de
la URL de descarga para que el QA la baje del navegador.

### Errores

Si `cmd.exe` no abre, el Setup cae a mostrar los comandos en su propia ventana
con un botón de copiar. El QA nunca queda sin salida — que es el punto entero de
esta parte.

### Pruebas

- `manualCommands` arma los comandos de Node sin `/qn` y con la versión que dice
  `prerequisites.json`.
- Lista sólo los pasos pendientes, y pone primero el que falló.
- Un paso cuyo archivo no está en `%TEMP%` incluye la URL de descarga.
- Si abrir `cmd.exe` rechaza, el estado publicado incluye los comandos para que
  el renderer los muestre.

## Parte 2 — Carpeta de datos elegible

### Resolución de la raíz

Módulo nuevo `electron-app/main/data-root.js`, con una función pura que recibe
`userData` y el contenido de los dos archivos de configuración y devuelve la
raíz. Precedencia, de mayor a menor:

1. `dataRoot` en el `config.json` del usuario — el QA la cambió en Configuración.
2. `dataRoot` en `C:\ProgramData\RunQA\setup.json` — la eligió el Setup.
3. `app.getPath('userData')` — el comportamiento de siempre.

`ProgramData` es el traspaso entre el Setup y RunQA porque son procesos de
cuentas distintas: el Setup corre elevado (a veces con una cuenta de
infraestructura) y RunQA corre después con la cuenta del QA, así que el
`userData` del Setup no le sirve de nada a RunQA. `ProgramData` lo escribe un
administrador y lo lee cualquier cuenta del equipo. Se descartó el registro
(`HKLM`): mismo alcance, pero obliga a `reg.exe` o a un módulo nativo y no se
puede probar contra un directorio temporal.

Si el archivo de `ProgramData` está corrupto o la ruta que nombra ya no existe,
se ignora y se cae al siguiente nivel. Una raíz inválida nunca deja a RunQA sin
arrancar.

### Qué cuelga de la raíz

```
<raíz>\
  projects\           repos clonados
  results\            resultados de corridas
  grabaciones\        videos
  grabaciones-git\    staging de subida
```

**Los nombres de las subcarpetas no cambian.** Hoy son exactamente esos, colgando
de `userData`. Al pasar a colgar de la raíz, un equipo ya instalado (sin raíz
configurada, raíz = `userData`) obtiene rutas idénticas a las de hoy y no pierde
nada. Es la propiedad que hace que este cambio sea seguro de soltar.

Siguen en `userData`, siempre, sin importar la raíz:

- `perfiles\` y el token de GitHub: cifrados con DPAPI atado a la cuenta de
  Windows (`profiles/store.js`, `github/account.js`). En una carpeta compartida
  se verían pero ninguna otra cuenta podría descifrarlos: aparentarían ser
  portables sin serlo.
- `config.json`: incluye la preferencia de raíz, no puede vivir adentro de lo
  que configura.

Los navegadores siguen en `LOCALAPPDATA\ms-playwright`, que lo decide Playwright.

### En el Setup

Una pantalla antes de `Empezar`: muestra la ruta sugerida (`%SystemDrive%\RunQA`)
y un botón para cambiarla con el selector de carpetas de Electron.

Sólo pregunta si `ProgramData\RunQA\setup.json` todavía no existe. Si ya existe,
muestra la ruta guardada y deja cambiarla, sin volver a insistir.

Validación antes de aceptar una ruta:

- Se tiene que poder crear y escribir.
- **Se rechaza** cualquier ruta dentro de `Program Files`, `Program Files (x86)`
  o `Windows`. El Setup es administrador y escribiría bien ahí, pero RunQA
  después corre sin elevar y fallaría al clonar: un error que aparecería semanas
  más tarde y sin relación visible con esta pantalla.

Al aceptar, el Setup escribe `C:\ProgramData\RunQA\setup.json` con `dataRoot`.

### En RunQA

La ruta aparece en Configuración, junto a la URL del servidor
(`renderer/renderer.js:1842`), con un selector de carpeta.

Cambiarla exige reiniciar la app: todos los stores se construyen una sola vez al
arrancar (`ipc.js:53-60`) y fingir que el cambio es instantáneo sería mentira.
El diálogo lo dice y ofrece reiniciar.

Al reiniciar, RunQA arranca **limpio** en la carpeta nueva:

- La carpeta vieja queda intacta, sin borrar ni copiar nada.
- Los proyectos se vuelven a clonar — git ya los tiene en GitHub.
- Configuración muestra la ruta anterior, para que los reportes viejos se puedan
  ir a buscar.

Se descartó mover los datos: son decenas de GB entre `node_modules` y videos, y
una copia cortada a la mitad deja al QA sin una cosa ni la otra.

### Limitación conocida: dos QA en el mismo equipo

Si dos cuentas comparten el equipo y la raíz de `ProgramData`, cada una tiene su
lista de proyectos (vive en su `config.json`) pero la carpeta es una sola. Al
clonar, si el destino ya existe y no está en el `config.json` de este usuario,
RunQA le pone sufijo (`mi-proyecto-2`) en vez de escribir encima del clon ajeno.
`validateManagedPath` sigue funcionando sin cambios, porque deriva de
`projectsDir`.

### Pruebas

- La precedencia de `data-root.js`: config del usuario gana a `ProgramData`, que
  gana a `userData`.
- Sin ninguna configuración, las rutas son idénticas a las de hoy (la prueba que
  protege a los equipos ya instalados).
- Un `setup.json` corrupto o que apunta a una carpeta inexistente cae al
  siguiente nivel sin lanzar.
- El Setup rechaza una ruta dentro de `Program Files`.
- Clonar cuando el destino ya existe y no es del usuario genera un id con sufijo.

## Archivos afectados

| Archivo                              | Cambio                                    |
|--------------------------------------|-------------------------------------------|
| `setup/main/manual.js`               | nuevo — arma los comandos                 |
| `setup/main/run.js`                  | publica los comandos y expone `verificar` |
| `setup/main.js`, `preload.js`        | IPC para abrir la consola y elegir carpeta|
| `setup/renderer/*`                   | botón `Hacerlo a mano`, `Verificar`, pantalla de carpeta |
| `setup/main/data-root.js`            | nuevo — escribe `ProgramData\RunQA\setup.json` |
| `electron-app/main/data-root.js`     | nuevo — resuelve la raíz                  |
| `electron-app/main/ipc.js`           | las cuatro carpetas cuelgan de la raíz    |
| `electron-app/main/projects.js`      | sufijo cuando el destino ya existe        |
| `electron-app/renderer/renderer.js`  | ruta y selector en Configuración          |

## Orden de implementación

Las dos partes son independientes. La parte 1 va primero: es más chica, y es la
que destraba el `1603` que hoy tiene equipos parados.
