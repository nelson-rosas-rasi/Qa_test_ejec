const { spawn } = require('node:child_process');
const { createStreamParser, translate } = require('./events');

function buildArgs({ cliPath, testIds, runAll, reporters, visualMode = false, stopOnFail = false }) {
  const args = [cliPath, 'test'];
  if (!runAll) args.push(...testIds);
  args.push(`--reporter=${reporters.join(',')}`);
  if (visualMode) args.push('--headed');
  if (stopOnFail) args.push('--max-failures=1');
  return args;
}

/**
 * Playwright lanza navegadores como *nietos*: matar solo al hijo los deja huérfanos.
 */
function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Mata el proceso y todo su árbol (Playwright lanza los navegadores como nietos).
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  // POSIX: el hijo es líder de su grupo (spawn detached), así que se señala al grupo
  // entero. Intento ordenado (SIGTERM, deja que Playwright cierre los navegadores) y,
  // de respaldo, forzado (SIGKILL) por si algo quedó vivo.
  const signal = (sig) => {
    try { process.kill(-child.pid, sig); } catch { /* el grupo ya murió */ }
    try { child.kill(sig); } catch { /* el hijo ya murió */ }
  };
  signal('SIGTERM');
  const timer = setTimeout(() => { if (child.exitCode === null) signal('SIGKILL'); }, 2000);
  if (timer.unref) timer.unref();
}

/**
 * Devuelve `{ promise, stop }`. `onEvent` recibe `{ channel, payload }` listos para IPC.
 * No importa `electron`: quien llame decide qué hacer con los eventos.
 */
function runTests(options, onEvent) {
  const {
    repoPath, cliPath, reporters, nodePath = process.execPath, profile,
    testIds = [], runAll = false, visualMode = false, stopOnFail = false,
  } = options;

  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_HTML_OPEN: 'never' };
  if (profile) env.QA_PROFILE = profile;

  const child = spawn(nodePath, buildArgs({ cliPath, testIds, runAll, reporters, visualMode, stopOnFail }), {
    cwd: repoPath,
    env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const statuses = new Map();
  const details = new Map();
  let durationMs = 0;
  let stopped = false;

  const feed = createStreamParser((record) => {
    if (record.type === 'testEnd' && !record.willRetry) {
      statuses.set(record.id, record.status);
      details.set(record.id, {
        id: record.id, name: record.name, status: record.status,
        durationMs: record.durationMs, error: record.error, retry: record.retry,
      });
    }
    if (record.type === 'end') durationMs = record.durationMs;
    for (const event of translate(record)) onEvent(event);
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', feed);

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    const trimmed = text.trimEnd();
    if (trimmed) onEvent({ channel: 'run:log', payload: { level: 'muted', text: trimmed } });
  });

  const promise = new Promise((resolve) => {
    child.on('close', () => {
      const values = [...statuses.values()];
      resolve({
        ok: !stopped,
        stopped,
        summary: {
          passed: values.filter((s) => s === 'passed').length,
          failed: values.filter((s) => s !== 'passed' && s !== 'skipped').length,
          skipped: values.filter((s) => s === 'skipped').length,
          durationMs,
        },
        tests: [...details.values()],
      });
    });
    child.on('error', () => resolve({ ok: false, stopped, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 }, tests: [] }));
  });

  return {
    promise,
    stop() {
      stopped = true;
      killTree(child);
    },
  };
}

module.exports = { runTests, buildArgs };
