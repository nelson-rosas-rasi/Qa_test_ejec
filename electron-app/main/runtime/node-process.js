/**
 * El ejecutable empaquetado de Electron necesita esta variable para actuar como
 * Node al lanzar el CLI de Playwright. Node real no la necesita y algunas
 * versiones pueden comportarse de forma distinta si se fuerza.
 */
function nodeProcessEnv(extra = {}, isElectron = Boolean(process.versions.electron)) {
  const env = { ...process.env, ...extra };
  if (isElectron) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

module.exports = { nodeProcessEnv };
