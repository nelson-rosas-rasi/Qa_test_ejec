const INSTALLER = /^RunQA-Installer-(\d+\.\d+\.\d+)\.exe$/;

function fallo(message) {
  const err = new Error(message);
  err.code = 'RELEASE_NOT_FOUND';
  return err;
}

/**
 * El setup no se rearma con cada versión de RunQA: pregunta por el release más
 * reciente en el momento de instalar.
 */
async function latestInstaller({ owner, repo, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  let respuesta;
  try {
    respuesta = await fetchImpl(url, { headers: { accept: 'application/vnd.github+json' } });
  } catch {
    throw fallo('No hubo respuesta de github.com. Revisá la conexión a internet.');
  }
  if (!respuesta.ok) throw fallo('github.com no devolvió ninguna versión publicada de RunQA.');

  let release;
  try {
    release = await respuesta.json();
  } catch {
    throw fallo('github.com devolvió una respuesta que no se pudo leer.');
  }

  const asset = (release.assets || []).find((a) => INSTALLER.test(a.name));
  if (!asset) throw fallo('La última versión publicada de RunQA no incluye su instalador.');

  return { name: asset.name, url: asset.browser_download_url, version: asset.name.match(INSTALLER)[1] };
}

module.exports = { latestInstaller };
