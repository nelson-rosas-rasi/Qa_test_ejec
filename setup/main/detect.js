const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { binaryPaths, markerPath } = require('./paths');

function runFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout });
    });
  });
}

const defaultMarker = (env) => {
  try { return JSON.parse(fs.readFileSync(markerPath(env), 'utf8')); }
  catch { return null; }
};

/** "git version 2.51.0.windows.1" y "v22.21.0" -> "2.51.0" */
function parseVersion(output) {
  const match = String(output).match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

async function probe({ exists, run, ruta, args }) {
  if (!exists(ruta)) return { ok: false, version: null };
  try {
    const { stdout } = await run(ruta, args);
    const version = parseVersion(stdout);
    return version ? { ok: true, version } : { ok: false, version: null };
  } catch {
    return { ok: false, version: null };
  }
}

async function detectPrerequisites({
  exists = fs.existsSync,
  run = runFile,
  env = process.env,
  playwrightVersion,
  readMarker = () => defaultMarker(env),
} = {}) {
  const paths = binaryPaths(env);
  const [git, node, npm] = await Promise.all([
    probe({ exists, run, ruta: paths.git, args: ['--version'] }),
    probe({ exists, run, ruta: paths.node, args: ['--version'] }),
    probe({ exists, run, ruta: paths.npm, args: ['--version'] }),
  ]);
  const marker = readMarker();
  const instalada = marker?.playwrightVersion || null;
  const browsers = { ok: instalada === playwrightVersion, version: instalada };
  return { git, node, npm, browsers };
}

module.exports = { detectPrerequisites, parseVersion };
