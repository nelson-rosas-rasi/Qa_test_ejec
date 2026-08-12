/**
 * Comprueba que todo lo que el ejecutable necesita esté realmente presente.
 *
 * Las pruebas no cubren esto: corren sobre los módulos puros y pasan aunque
 * falte el punto de entrada, porque ninguna lo importa. Un archivo que quedó
 * sin commitear pasa el `npm test` del workflow y se descubre recién cuando un
 * QA abre el .exe publicado y no arranca.
 *
 * Comprobar que la carpeta `main/` existe no alcanza: existe con la mitad de
 * los archivos adentro. Por eso se recorre el grafo de `require` desde el punto
 * de entrada, que es la única forma de notar que falta un módulo intermedio.
 *
 * Se corre solo (`npm run check-package`) y en el workflow antes de construir.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const pkg = require(path.join(RAIZ, 'package.json'));

/** Los `require` relativos son los del proyecto; `electron` y los builtin no. */
const RELATIVO = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;

const vistos = new Set();
const faltan = [];

/** Resuelve como Node: tal cual, con .js, o index.js si es carpeta. */
function resolver(destino) {
  if (fs.existsSync(destino) && fs.statSync(destino).isDirectory()) return path.join(destino, 'index.js');
  if (fs.existsSync(destino)) return destino;
  for (const ext of ['.js', '.json']) if (fs.existsSync(destino + ext)) return destino + ext;
  return destino;
}

function revisar(archivo) {
  const real = resolver(archivo);
  if (vistos.has(real)) return;
  vistos.add(real);
  if (!fs.existsSync(real)) {
    // Si no existe, `resolver` devolvió la ruta tal cual y puede venir sin
    // extensión: nombrarla con .js la hace copiable a un `git add`.
    const nombre = path.relative(RAIZ, real);
    faltan.push(path.extname(nombre) ? nombre : `${nombre}.js`);
    return;
  }
  if (!real.endsWith('.js')) return;
  const fuente = fs.readFileSync(real, 'utf8');
  for (const [, destino] of fuente.matchAll(RELATIVO)) {
    revisar(path.join(path.dirname(real), destino));
  }
}

revisar(path.join(RAIZ, pkg.main));
revisar(path.join(RAIZ, 'preload.js'));

// El renderer no se importa con require: main.js lo carga por ruta, así que el
// grafo no lo alcanza y hay que nombrarlo aparte.
for (const suelto of ['prerequisites.json', path.join('renderer', 'index.html')]) {
  if (!fs.existsSync(path.join(RAIZ, suelto))) faltan.push(suelto);
}

if (faltan.length) {
  console.error(`Faltan archivos que el paquete necesita (¿quedaron sin commitear?): ${faltan.join(', ')}`);
  process.exit(1);
}
console.log(`Paquete completo: ${vistos.size} módulos alcanzables desde ${pkg.main}.`);
