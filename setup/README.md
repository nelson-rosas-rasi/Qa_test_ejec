# RunQA Setup

Prepara un equipo Windows para RunQA y termina instalando la app. Es un
ejecutable suelto (no se instala) que pide permisos de administrador una sola
vez, al abrirlo.

## Qué hace

1. Revisa qué falta: la herramienta para traer los proyectos (git), el motor que
   instala sus dependencias (Node) y los navegadores de prueba.
2. Instala en silencio sólo lo que falta.
3. Descarga la última versión publicada de RunQA y la instala.

Volver a abrirlo sirve de reparación: lo que ya está se salta.

## Requisitos

- Windows 10 u 11, 64 bits.
- Cuenta de administrador **propia** del QA. Si se eleva con las credenciales de
  otra cuenta, los navegadores quedan en el perfil equivocado.
- Conexión a internet: descarga desde `github.com` y `nodejs.org`.

## Versiones de los prerequisitos

Todas viven en `prerequisites.json` — versión, dirección de descarga y sha256 de
git y Node, más la versión fijada de Playwright. Actualizar un prerequisito es
editar ese archivo y nada más.

La versión de Playwright debe seguir a la de los repositorios de pruebas: si un
proyecto usa otra, RunQA avisa y hay que volver a ejecutar el setup con el valor
corregido.

## Publicar una versión

```bash
cd setup
npm test
npm version patch --no-git-tag-version
git add package.json && git commit -m "release: RunQA Setup <version>"
git tag setup-v<version>
git push origin main setup-v<version>
```

La etiqueta dispara `.github/workflows/release-setup.yml`, que corre las pruebas,
construye el ejecutable y lo sube al release.

### Construir el ejecutable desde Linux

`npm run dist` necesita Wine, y **el prefijo tiene que ser de 32 bits**: la
herramienta que le pone el ícono y el manifiesto de administrador al `.exe`
(`rcedit-ia32.exe`) no arranca en un prefijo de 64 bits, y falla con
`could not load kernel32.dll`. El repo ya tiene uno preparado:

```bash
WINEPREFIX="$(pwd)/../electron-app/.wine-runqa" npm run dist
```

## Verificación manual antes de publicar

Sobre una máquina virtual limpia de Windows 11 x64, sin git ni Node:

- [ ] El ejecutable pide permisos una sola vez y abre la ventana.
- [ ] La lista muestra los tres requisitos como faltantes.
- [ ] "Empezar" los instala en orden y cada uno queda con su tilde.
- [ ] Cortar la red durante una descarga muestra el mensaje con el nombre del
      servidor, y "Reintentar" retoma ese paso.
- [ ] Al terminar arranca el instalador de RunQA.
- [ ] Reabrir el setup muestra los tres requisitos ya resueltos.
- [ ] Tras instalar, RunQA agrega un proyecto sin errores de git ni de npm.
