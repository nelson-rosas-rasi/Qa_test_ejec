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
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // El grupo ya murió.
    }
  }
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

  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (profile) env.QA_PROFILE = profile;

  const child = spawn(nodePath, buildArgs({ cliPath, testIds, runAll, reporters, visualMode, stopOnFail }), {
    cwd: repoPath,
    env,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const statuses = new Map();
  let durationMs = 0;
  let stopped = false;

  const feed = createStreamParser((record) => {
    if (record.type === 'testEnd' && !record.willRetry) statuses.set(record.id, record.status);
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
      });
    });
    child.on('error', () => resolve({ ok: false, stopped, summary: { passed: 0, failed: 0, skipped: 0, durationMs: 0 } }));
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
