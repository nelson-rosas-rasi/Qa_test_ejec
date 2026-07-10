const path = require('node:path');

const SENTINEL = '@@QATR@@';

/** Quita los códigos de color ANSI que Playwright mete en los mensajes de error. */
function plain(text) {
  // La secuencia ANSI completa incluye el byte ESC (\x1b); sin él quedarían
  // caracteres de control invisibles en la consola.
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

class NdjsonReporter {
  constructor() {
    this._rootDir = process.cwd();
  }

  printsToStdio() {
    return true;
  }

  onBegin(config, suite) {
    this._rootDir = config.rootDir;
    this._emit({ type: 'begin', total: suite.allTests().length });
  }

  onTestBegin(test, result) {
    this._emit({ type: 'testBegin', id: this._id(test), name: test.title, retry: result.retry });
  }

  onTestEnd(test, result) {
    const failed = result.status !== 'passed' && result.status !== 'skipped';
    this._emit({
      type: 'testEnd',
      id: this._id(test),
      name: test.title,
      status: result.status,
      retry: result.retry,
      willRetry: failed && result.retry < test.retries,
      durationMs: result.duration,
      error: result.error?.message ? plain(result.error.message).split('\n')[0].slice(0, 300) : null,
    });
  }

  onStdOut(chunk) {
    this._emit({ type: 'stdout', text: plain(chunk).trimEnd() });
  }

  onEnd(result) {
    this._emit({ type: 'end', status: result.status, durationMs: result.duration });
  }

  /** `cartera/nota-credito-clientes.spec.ts:22` — el mismo id que produce build-tree.js. */
  _id(test) {
    const rel = path.relative(this._rootDir, test.location.file).split(path.sep).join('/');
    return `${rel}:${test.location.line}`;
  }

  _emit(record) {
    process.stdout.write(SENTINEL + JSON.stringify(record) + '\n');
  }
}

module.exports = NdjsonReporter;
module.exports.plain = plain;
