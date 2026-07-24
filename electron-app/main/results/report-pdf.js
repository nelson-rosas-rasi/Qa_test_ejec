const fs = require('node:fs');

/**
 * Genera un PDF a partir de HTML usando una BrowserWindow oculta y printToPDF.
 * Escribe el HTML en `htmlPath` (autocontenido, con el logo embebido) y el PDF en
 * `pdfPath`. `electron` se requiere de forma perezosa: solo se usa en el main.
 */
async function renderPdf({ html, htmlPath, pdfPath }) {
  fs.writeFileSync(htmlPath, html, 'utf8');
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(htmlPath);
    const pdf = await win.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(pdfPath, pdf);
  } finally {
    win.destroy();
  }
}

module.exports = { renderPdf };
