const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectManager, parseDefaultBranch, uniqueProjectId, validateManagedPath } = require('../main/projects');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qatr-projects-'));

test('detecta la rama principal informada por el remoto', () => {
  assert.equal(parseDefaultBranch('ref: refs/heads/trunk\tHEAD\nabc\tHEAD\n'), 'trunk');
});

test('genera ids estables y evita duplicados', () => {
  assert.equal(uniqueProjectId('Médico ERP', new Set()), 'medico-erp');
  assert.equal(uniqueProjectId('ERP', new Set(['erp', 'erp-2'])), 'erp-3');
});

test('rechaza repositorios fuera de la carpeta administrada', () => {
  const root = temp();
  assert.throws(() => validateManagedPath(path.join(root, '..', 'personal'), root), (err) => err.code === 'UNMANAGED_REPOSITORY');
});

test('prepara el clon en detached HEAD de la rama remota', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright', 'cli.js'), '');
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoPath, 'package-lock.json'))).digest('hex');
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args[0] === 'remote') return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const manager = createProjectManager({ projectsDir, run });
  const result = await manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash: hash });
  assert.equal(result.commit, 'abc123');
  assert.deepEqual(calls.map((call) => call.args), [
    ['ls-remote', '--symref', 'https://example.test/qa.git', 'HEAD'],
    ['remote', 'get-url', 'origin'],
    ['fetch', '--prune', 'origin', '+refs/heads/main:refs/remotes/origin/main'],
    ['checkout', '--detach', 'origin/main'],
    ['reset', '--hard', 'origin/main'],
    ['clean', '-fd'],
    ['rev-parse', 'HEAD'],
  ]);
});

test('importa un clon local sin modificar la carpeta original', async () => {
  const projectsDir = temp();
  const sourcePath = temp();
  fs.mkdirSync(path.join(sourcePath, '.git'));
  fs.writeFileSync(path.join(sourcePath, 'cambio-sin-commit.txt'), 'no tocar');
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd });
    if (args[0] === 'remote' && args[1] === 'get-url') return { stdout: 'https://example.test/local.git\n', stderr: '' };
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args[0] === 'clone') {
      const destination = args.at(-1);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'package.json'), '{}');
      fs.writeFileSync(path.join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'ci') {
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'playwright'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'playwright', 'cli.js'), '');
      return { stdout: '', stderr: '' };
    }
    if (args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const manager = createProjectManager({ projectsDir, run });
  const project = await manager.importExisting({ id: 'local', sourcePath });
  assert.equal(project.repoUrl, 'https://example.test/local.git');
  assert.equal(project.defaultBranch, 'main');
  assert.equal(fs.readFileSync(path.join(sourcePath, 'cambio-sin-commit.txt'), 'utf8'), 'no tocar');
  assert.equal(calls.some((call) => call.cwd === sourcePath && ['reset', 'clean', 'checkout'].includes(call.args[0])), false);
});
test('acepta un repositorio local sin origin', async () => {
  const projectsDir = temp();
  const sourcePath = temp();
  fs.mkdirSync(path.join(sourcePath, '.git'));
  const run = async (_command, args, options = {}) => {
    if (args[0] === 'remote' && args[1] === 'get-url') throw Object.assign(new Error('sin origin'), { code: 2 });
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/RamaCas\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args[0] === 'clone') {
      const destination = args.at(-1);
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'package.json'), '{}');
      fs.writeFileSync(path.join(destination, 'package-lock.json'), '{"lockfileVersion":3}');
    }
    if (args[0] === 'ci') {
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'playwright'), { recursive: true });
      fs.writeFileSync(path.join(options.cwd, 'node_modules', 'playwright', 'cli.js'), '');
    }
    if (args[0] === 'rev-parse') return { stdout: 'local123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const project = await createProjectManager({ projectsDir, run }).importExisting({ id: 'local', sourcePath });
  assert.equal(project.repoUrl, sourcePath);
  assert.equal(project.defaultBranch, 'RamaCas');
});

test('git se invoca con la credencial de la cuenta conectada', async () => {
  const projectsDir = temp();
  const repoPath = path.join(projectsDir, 'erp');
  fs.mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'node_modules', 'playwright'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'node_modules', 'playwright', 'cli.js'), '');
  fs.writeFileSync(path.join(repoPath, 'package-lock.json'), '{"lockfileVersion":3}');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoPath, 'package-lock.json'))).digest('hex');
  const calls = [];
  const run = async (command, args, options = {}) => {
    calls.push({ command, args, env: options.env });
    if (args.includes('ls-remote')) return { stdout: 'ref: refs/heads/main\tHEAD\nabc\tHEAD\n', stderr: '' };
    if (args.includes('remote')) return { stdout: 'https://example.test/qa.git\n', stderr: '' };
    if (args.includes('rev-parse')) return { stdout: 'abc123\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const auth = { args: () => ['-c', 'credential.x=y'], env: () => ({ QA_GH_TOKEN: 'tok' }) };
  const manager = createProjectManager({ projectsDir, run, auth });
  await manager.prepare({ repoPath, repoUrl: 'https://example.test/qa.git', defaultBranch: 'main', dependencyLockHash: hash });
  assert.deepEqual(calls[0].args.slice(0, 2), ['-c', 'credential.x=y']);
  assert.equal(calls[0].env.QA_GH_TOKEN, 'tok');
});

test('sin cuenta conectada, git se invoca igual que siempre', async () => {
  const projectsDir = temp();
  const calls = [];
  const run = async (_command, args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return { stdout: 'ref: refs/heads/main\tHEAD\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  await createProjectManager({ projectsDir, run })
    .initialize({ id: 'x', name: 'X', repoUrl: 'https://example.test/qa.git' })
    .catch(() => {});
  assert.deepEqual(calls[0], ['ls-remote', '--symref', 'https://example.test/qa.git', 'HEAD']);
});