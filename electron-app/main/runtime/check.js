const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MIN_NODE_MAJOR = 18;

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { raw: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]) };
}

async function commandVersion(command, run = execFileAsync, { shell = false } = {}) {
  try {
    const { stdout } = await run(command, ['--version'], {
      windowsHide: true,
      timeout: 10_000,
      shell,
    });
    const version = parseVersion(stdout);
    return version
      ? { available: true, version: version.raw, major: version.major }
      : { available: false, error: `La respuesta de ${command} no contiene una versión válida.` };
  } catch (err) {
    return { available: false, error: err.code === 'ENOENT' ? 'No se encontró en el equipo.' : (err.message || String(err)) };
  }
}

async function checkRuntime({ run = execFileAsync, platform = process.platform } = {}) {
  const onWindows = platform === 'win32';
  const node = await commandVersion('node', run, { shell: onWindows });
  const npm = node.available ? await commandVersion(onWindows ? 'npm.cmd' : 'npm', run, { shell: onWindows }) : { available: false, error: 'Requiere Node.js.' };
  const compatible = node.available && node.major >= MIN_NODE_MAJOR && npm.available;

  return {
    ok: compatible,
    minimumNodeMajor: MIN_NODE_MAJOR,
    node,
    npm,
    message: !node.available
      ? 'Node.js no está instalado o RunQA no puede encontrarlo.'
      : node.major < MIN_NODE_MAJOR
        ? `Node.js ${node.version} no es compatible. Se requiere la versión ${MIN_NODE_MAJOR} o superior.`
        : !npm.available
          ? 'Node.js está instalado, pero npm no está disponible.'
          : 'Node.js y npm están listos.',
  };
}

module.exports = { MIN_NODE_MAJOR, parseVersion, commandVersion, checkRuntime };
