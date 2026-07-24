const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { validateManagedPath } = require('../projects');

function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout, stderr });
    });
  });
}

const NO_AUTH = { args: () => [], env: () => ({}) };

/** Ramas de un `git ls-remote --heads`, ordenadas. */
function parseHeads(output) {
  return String(output).split(/\r?\n/)
    .map((l) => l.match(/refs\/heads\/(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Sube drafts al repo de pruebas del QA en un clon aislado (no toca el clon de
 * ejecución). El token viaja por entorno vía `auth` (createGitAuth).
 */
function createRecordingsUploader({ baseDir, gitPath = 'git', run = runFile, auth = NO_AUTH }) {
  const uploadDir = (projectId) => path.join(baseDir, projectId);
  const git = (args, cwd) => run(gitPath, [...auth.args(), ...args], {
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...auth.env() },
  });

  async function listBranches(project) {
    const { stdout } = await git(['ls-remote', '--heads', project.repoUrl]);
    return parseHeads(stdout);
  }

  async function ensureClone(project) {
    const dir = uploadDir(project.id);
    validateManagedPath(dir, baseDir);
    if (!fs.existsSync(path.join(dir, '.git'))) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      await git(['clone', project.repoUrl, dir]);
    } else {
      await git(['remote', 'set-url', 'origin', project.repoUrl], dir);
    }
    await git(['fetch', '--prune', 'origin'], dir);
    return dir;
  }

  async function upload({ project, draftPath, repoRelPath, branch, isNew, message, identity }) {
    const dir = await ensureClone(project);
    const base = isNew ? `origin/${project.defaultBranch}` : `origin/${branch}`;
    await git(['checkout', '-B', branch, base], dir);
    const dest = path.join(dir, repoRelPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(draftPath, dest);
    await git(['add', '--', repoRelPath], dir);
    const name = (identity && (identity.name || identity.login)) || 'RunQA';
    const email = (identity && identity.email) || `${(identity && identity.login) || 'runqa'}@users.noreply.github.com`;
    await git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-m', message], dir);
    await git(['push', '-u', 'origin', branch], dir);
    return { ok: true, branch };
  }

  return { listBranches, upload, uploadDir };
}

module.exports = { createRecordingsUploader, parseHeads };
