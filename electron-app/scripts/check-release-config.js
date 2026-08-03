const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDERS = {
  owner: 'CAMBIAME-usuario-u-org',
  repo: 'runqa-releases',
};

function validateReleaseConfig(pkg) {
  const publish = pkg?.build?.publish || {};
  const missing = Object.entries(PLACEHOLDERS)
    .filter(([key, placeholder]) => !publish[key] || publish[key] === placeholder)
    .map(([key]) => key);
  return { ok: missing.length === 0, missing };
}

function main() {
  const packagePath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const result = validateReleaseConfig(pkg);
  if (result.ok) return;
  console.error(`No se puede publicar RunQA: falta configurar build.publish.${result.missing.join(' y build.publish.')} en package.json.`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { PLACEHOLDERS, validateReleaseConfig };
