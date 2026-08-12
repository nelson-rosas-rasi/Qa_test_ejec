const INSTALLER = /^RunQA-Installer-(\d+\.\d+\.\d+)\.exe$/;

function fallo(message) {
  const err = new Error(message);
  err.code = 'RELEASE_NOT_FOUND';
  return err;
}

/**
 * El setup no se rearma con cada versión de RunQA: pregunta por el release más
 * reciente en el momento de instalar.
 *
 * Se pide la LISTA de releases y no `/releases/latest`. En este repo conviven
 * los releases de RunQA (`v*`) con los del propio Setup (`setup-v*`), y
 * `/releases/latest` devuelve el más nuevo sea cual sea: al publicar el Setup,
 * el paso que instala RunQA pasó a fallar en todos los equipos porque el
 * release más nuevo no traía instalador. Buscar el más reciente que sí lo traiga
 * vuelve a esto inmune a lo que se publique al lado.
 *
 * GitHub devuelve la lista de más nueva a más vieja: el primero que coincida es
 * el que corresponde.
 */
async function latestInstaller({ owner, repo, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
  let respuesta;
  try {
    respuesta = await fetchImpl(url, { headers: { accept: 'application/vnd.github+json' } });
  } catch {
    throw fallo('No hubo respuesta de github.com. Revisá la conexión a internet.');
  }
  if (!respuesta.ok) throw fallo('github.com no devolvió ninguna versión publicada de RunQA.');

  let releases;
  try {
    releases = await respuesta.json();
  } catch {
    throw fallo('github.com devolvió una respuesta que no se pudo leer.');
  }
  if (!Array.isArray(releases)) throw fallo('github.com devolvió una respuesta que no se pudo leer.');

  for (const release of releases) {
    // Borradores y preliminares no se le sirven a un QA: se saltean igual que
    // hacía `/releases/latest`, para no cambiar qué versión termina instalando.
    if (release.draft || release.prerelease) continue;
    const asset = (release.assets || []).find((a) => INSTALLER.test(a.name));
    if (asset) return { name: asset.name, url: asset.browser_download_url, version: asset.name.match(INSTALLER)[1] };
  }

  throw fallo('Ninguna versión publicada de RunQA incluye su instalador.');
}

module.exports = { latestInstaller };
