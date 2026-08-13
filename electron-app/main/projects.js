const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { appError } = require('./errors');
const { isManaged } = require('./projects-root');
const { resolveCommand } = require('./runtime/windows-paths');
const { checkBrowsers } = require('./playwright/browsers');

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout, stderr });
    });
  });
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'proyecto';
}

function uniqueProjectId(name, existingIds) {
  const base = slugify(name);
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function parseDefaultBranch(output) {
  const match = String(output).match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/m);
  if (!match) throw appError('DEFAULT_BRANCH_NOT_FOUND', 'El repositorio no informa una rama principal.');
  return match[1].trim();
}

function lockHash(repoPath) {
  const lockPath = path.join(repoPath, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
}

/** Acepta una raíz o varias: al cambiar de carpeta, las anteriores siguen valiendo. */
function validateManagedPath(repoPath, roots) {
  const lista = Array.isArray(roots) ? roots : [roots];
  if (!isManaged(repoPath, lista)) throw appError('UNMANAGED_REPOSITORY', 'La carpeta del proyecto no está administrada por QA Test Runner.');
}

/**
 * GitHub responde 404 —no 403— ante un repositorio privado sin acceso, para no
 * filtrar su existencia. Desde fuera es imposible distinguir "no existe" de "no
 * tienes permiso", así que el mensaje cubre los dos casos sin fingir que sí.
 */
const ACCESS_DENIED = /(repository not found|authentication failed|could not read username|403 forbidden|terminal prompts disabled)/i;

function friendlyCommandError(code, message, err) {
  const stderr = String(err?.stderr || err?.message || '');
  if (ACCESS_DENIED.test(stderr)) {
    return appError('REPOSITORY_ACCESS_DENIED', 'Este proyecto no existe o tu cuenta no tiene acceso. Pídeselo al responsable.');
  }
  const detail = stderr.trim().split(/\r?\n/).slice(-2).join(' ');
  return appError(code, detail ? `${message} ${detail}` : message);
}

/** Por defecto no inyecta nada: sin cuenta conectada, git se invoca como siempre. */
const NO_AUTH = { args: () => [], env: () => ({}) };

/**
 * Node >=20.12 (arreglo de CVE-2024-27980) se niega a ejecutar archivos .cmd/.bat
 * sin shell en Windows, y npm en Windows *es* npm.cmd: sin esto, `spawn EINVAL`.
 *
 * Pasar por el shell concatena los argumentos en vez de escaparlos, así que sólo
 * es seguro porque los de npm son constantes (`ci`, `--no-audit`, `--no-fund`) y
 * la ruta del repo viaja en `cwd`, no en la línea de comandos. Si algún día un
 * argumento pasa a venir del usuario, esto deja de valer.
 */
const needsShell = (command) => /\.(cmd|bat)$/i.test(command);

/**
 * Con `shell: true`, Node arma la línea de comando uniendo [comando, ...args]
 * con espacios y sin encomillar el ejecutable: una ruta como
 * "C:\Program Files\nodejs\npm.cmd" —justo donde deja npm RunQA Setup— hace que
 * cmd.exe corte en el espacio y no encuentre nada. Encomillarla alcanza.
 */
const quoteForShell = (command) => (command.includes(' ') ? `"${command}"` : command);

function createProjectManager({
  projectsDir,
  managedRoots,
  gitPath = resolveCommand('git'),
  npmPath = resolveCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm'),
  run = runFile,
  auth = NO_AUTH,
}) {
  // La carpeta puede llegar como función: el QA la cambia en Configuración y el
  // cambio tiene que valer sin reiniciar la app.
  const dir = () => (typeof projectsDir === 'function' ? projectsDir() : projectsDir);
  const roots = () => (managedRoots ? managedRoots() : [dir()]);

  const git = (args, cwd) => run(gitPath, [...auth.args(), ...args], {
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...auth.env() },
  });

  async function installDependencies(repoPath, previousHash) {
    const currentHash = lockHash(repoPath);
    if (!currentHash) throw appError('LOCKFILE_NOT_FOUND', 'El proyecto necesita un package-lock.json para instalar dependencias de forma reproducible.');
    const playwrightCli = path.join(repoPath, 'node_modules', 'playwright', 'cli.js');
    if (currentHash !== previousHash || !fs.existsSync(playwrightCli)) {
      const shell = needsShell(npmPath);
      try { await run(shell ? quoteForShell(npmPath) : npmPath, ['ci', '--no-audit', '--no-fund'], { cwd: repoPath, shell }); }
      catch (err) { throw friendlyCommandError('DEPENDENCIES_FAILED', 'No fue posible instalar las dependencias del proyecto.', err); }
    }
    if (!fs.existsSync(playwrightCli)) throw appError('PLAYWRIGHT_NOT_INSTALLED', 'El proyecto no incluye Playwright entre sus dependencias.');
    const navegadores = checkBrowsers({ repoPath });
    // Faltar y estar desalineados se arreglan distinto: lo primero es correr el
    // Setup con la cuenta correcta, lo segundo es alinear la versión. Un mensaje
    // único para los dos manda al QA a repetir lo que ya hizo.
    if (!navegadores.ok && navegadores.reason === 'missing') {
      throw appError(
        'BROWSERS_NOT_INSTALLED',
        'No hay navegadores de Playwright instalados para tu cuenta de Windows. Abrí RunQA Setup con tu propia cuenta de administrador para instalarlos.',
      );
    }
    if (!navegadores.ok) {
      throw appError(
        'BROWSERS_VERSION_MISMATCH',
        `Este proyecto necesita los navegadores de Playwright ${navegadores.expected} y están instalados los ${navegadores.installed}. Abrí RunQA Setup y ejecutalo de nuevo para alinearlos.`,
      );
    }
    return currentHash;
  }

  async function initialize({ id, name, repoUrl }) {
    if (!name?.trim() || !repoUrl?.trim()) throw appError('INVALID_PROJECT', 'Escribe el nombre y la dirección del repositorio.');
    let defaultBranch;
    try { defaultBranch = parseDefaultBranch((await git(['ls-remote', '--symref', repoUrl.trim(), 'HEAD'])).stdout); }
    catch (err) {
      if (err.code === 'DEFAULT_BRANCH_NOT_FOUND') throw err;
      throw friendlyCommandError('REPOSITORY_UNAVAILABLE', 'No fue posible acceder al repositorio.', err);
    }
    fs.mkdirSync(dir(), { recursive: true });
    const repoPath = path.join(dir(), id);
    if (fs.existsSync(repoPath)) throw appError('PROJECT_FOLDER_EXISTS', 'Ya existe una carpeta administrada para este proyecto.');
    try {
      await git(['clone', '--origin', 'origin', '--branch', defaultBranch, '--single-branch', repoUrl.trim(), repoPath]);
      if (!fs.existsSync(path.join(repoPath, 'package.json'))) throw appError('PACKAGE_NOT_FOUND', 'La carpeta elegida no contiene un package.json en su raíz. Selecciona el repositorio de pruebas Playwright.');
      const dependencyLockHash = await installDependencies(repoPath, null);
      const { stdout } = await git(['rev-parse', 'HEAD'], repoPath);
      return { id, name: name.trim(), repoUrl: repoUrl.trim(), repoPath, defaultBranch, dependencyLockHash, commit: stdout.trim(), initializedAt: new Date().toISOString() };
    } catch (err) {
      fs.rmSync(repoPath, { recursive: true, force: true });
      if (err.isAppError) throw err;
      throw friendlyCommandError('PROJECT_INITIALIZATION_FAILED', 'No fue posible inicializar el proyecto.', err);
    }
  }

  async function importExisting({ id, sourcePath }) {
    const localPath = path.resolve(sourcePath || '');
    if (!fs.existsSync(path.join(localPath, '.git'))) throw appError('NOT_A_GIT_REPOSITORY', 'La carpeta seleccionada no es un repositorio Git clonado.');
    let repoUrl;
    let defaultBranch;
    try {
      try {
        repoUrl = (await git(['remote', 'get-url', 'origin'], localPath)).stdout.trim();
      } catch {
        // Un repositorio local también es una fuente Git válida aunque no tenga origin.
        repoUrl = localPath;
      }
      if (!repoUrl) repoUrl = localPath;
      defaultBranch = parseDefaultBranch((await git(['ls-remote', '--symref', repoUrl, 'HEAD'])).stdout);
    } catch (err) {
      if (err.isAppError) throw err;
      throw friendlyCommandError('LOCAL_REPOSITORY_INVALID', 'No fue posible determinar la rama activa de la carpeta seleccionada.', err);
    }
    const name = path.basename(localPath);
    fs.mkdirSync(dir(), { recursive: true });
    const repoPath = path.join(dir(), id);
    if (fs.existsSync(repoPath)) throw appError('PROJECT_FOLDER_EXISTS', 'Ya existe una carpeta administrada para este proyecto.');
    try {
      await git(['clone', '--branch', defaultBranch, '--single-branch', localPath, repoPath]);
      await git(['remote', 'set-url', 'origin', repoUrl], repoPath);
      if (!fs.existsSync(path.join(repoPath, 'package.json'))) throw appError('PACKAGE_NOT_FOUND', 'La carpeta elegida no contiene un package.json en su raíz. Selecciona el repositorio de pruebas Playwright.');
      const dependencyLockHash = await installDependencies(repoPath, null);
      const { stdout } = await git(['rev-parse', 'HEAD'], repoPath);
      return { id, name, repoUrl, repoPath, defaultBranch, dependencyLockHash, commit: stdout.trim(), importedFrom: localPath, initializedAt: new Date().toISOString() };
    } catch (err) {
      fs.rmSync(repoPath, { recursive: true, force: true });
      if (err.isAppError) throw err;
      throw friendlyCommandError('PROJECT_IMPORT_FAILED', 'No fue posible importar el repositorio.', err);
    }
  }
  async function prepare(project) {
    if (!project?.repoPath || !project?.repoUrl || !project?.defaultBranch) throw appError('PROJECT_NOT_INITIALIZED', 'El proyecto no está inicializado correctamente.');
    validateManagedPath(project.repoPath, roots());
    if (!fs.existsSync(path.join(project.repoPath, '.git'))) throw appError('REPOSITORY_NOT_FOUND', 'No se encontró el repositorio local. Inicializa nuevamente el proyecto.');
    try {
      const defaultBranch = parseDefaultBranch((await git(['ls-remote', '--symref', project.repoUrl, 'HEAD'])).stdout);
      const remote = await git(['remote', 'get-url', 'origin'], project.repoPath);
      if (remote.stdout.trim() !== project.repoUrl) throw appError('REMOTE_MISMATCH', 'El repositorio local no corresponde al remoto configurado.');
      await git(['fetch', '--prune', 'origin', `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`], project.repoPath);
      await git(['checkout', '--detach', `origin/${defaultBranch}`], project.repoPath);
      await git(['reset', '--hard', `origin/${defaultBranch}`], project.repoPath);
      await git(['clean', '-fd'], project.repoPath);
      const dependencyLockHash = await installDependencies(project.repoPath, project.dependencyLockHash);
      const { stdout } = await git(['rev-parse', 'HEAD'], project.repoPath);
      return { defaultBranch, dependencyLockHash, commit: stdout.trim(), lastSyncedAt: new Date().toISOString() };
    } catch (err) {
      if (err.isAppError) throw err;
      throw friendlyCommandError('PROJECT_SYNC_FAILED', 'No fue posible actualizar la rama principal del proyecto.', err);
    }
  }
  /**
   * Verificación ligera (sin tocar el working tree ni reinstalar dependencias):
   * hace `fetch` de la rama principal y compara el commit local con el remoto.
   * Sirve para saber, por repositorio, si hay pruebas nuevas/refinadas por traer
   * antes de decidir hacer el pull real (`prepare`).
   */
  async function checkStatus(project) {
    if (!project?.repoPath || !project?.repoUrl || !project?.defaultBranch) throw appError('PROJECT_NOT_INITIALIZED', 'El proyecto no está inicializado correctamente.');
    validateManagedPath(project.repoPath, roots());
    if (!fs.existsSync(path.join(project.repoPath, '.git'))) throw appError('REPOSITORY_NOT_FOUND', 'No se encontró el repositorio local. Inicializa nuevamente el proyecto.');
    const branch = project.defaultBranch;
    try {
      await git(['fetch', '--prune', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], project.repoPath);
      const localCommit = (await git(['rev-parse', 'HEAD'], project.repoPath)).stdout.trim();
      const remoteCommit = (await git(['rev-parse', `refs/remotes/origin/${branch}`], project.repoPath)).stdout.trim();
      const behind = Number((await git(['rev-list', '--count', `HEAD..refs/remotes/origin/${branch}`], project.repoPath)).stdout.trim()) || 0;
      return { updateAvailable: localCommit !== remoteCommit, behind, localCommit, remoteCommit, checkedAt: new Date().toISOString() };
    } catch (err) {
      if (err.isAppError) throw err;
      throw friendlyCommandError('PROJECT_STATUS_FAILED', 'No fue posible verificar si hay cambios nuevos en el repositorio.', err);
    }
  }

  function remove(project) {
    if (!project?.repoPath) throw appError('PROJECT_NOT_INITIALIZED', 'El proyecto no está inicializado correctamente.');
    validateManagedPath(project.repoPath, roots());
    fs.rmSync(project.repoPath, { recursive: true, force: true });
  }

  return { initialize, importExisting, prepare, checkStatus, remove };
}

module.exports = { createProjectManager, parseDefaultBranch, uniqueProjectId, validateManagedPath };

