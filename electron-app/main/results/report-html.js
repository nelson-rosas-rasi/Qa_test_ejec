const fs = require('node:fs');
const path = require('node:path');

/** Reemplaza cada `{{TOKEN}}` por su valor; un token ausente/nulo queda vacío. */
function fillTemplate(templateHtml, tokens) {
  return String(templateHtml).replace(/\{\{(\w+)\}\}/g, (_, key) =>
    (key in tokens && tokens[key] != null) ? String(tokens[key]) : '');
}

/** Lee `assets/rasi-logo.png` y lo devuelve como <img> con data URI, o '' si falta. */
function logoHtml(assetsDir = path.join(__dirname, 'assets')) {
  try {
    const buf = fs.readFileSync(path.join(assetsDir, 'rasi-logo.png'));
    return `<img src="data:image/png;base64,${buf.toString('base64')}" alt="RASI" style="height:56px">`;
  } catch {
    return '';
  }
}

module.exports = { fillTemplate, logoHtml };
