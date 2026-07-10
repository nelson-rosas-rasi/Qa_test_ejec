const SENTINEL = '@@QATR@@';

const FAILURE_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

const log = (level, text) => ({ channel: 'run:log', payload: { level, text } });
const result = (id, status) => ({ channel: 'run:testResult', payload: { id, status } });

/**
 * Acumula hasta ver un `\n`: el stream corta las líneas donde le da la gana.
 * Devuelve una función `feed(chunk)`.
 */
function createStreamParser(onRecord) {
  let buffer = '';
  return function feed(chunk) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const at = line.indexOf(SENTINEL);
      if (at === -1) continue;
      try {
        onRecord(JSON.parse(line.slice(at + SENTINEL.length)));
      } catch {
        // Línea corrupta: la app no se cae por una línea ilegible.
      }
    }
  };
}

/** Un registro del reporter → los eventos IPC que el renderer ya sabe consumir. */
function translate(record) {
  switch (record.type) {
    case 'testBegin':
      return [result(record.id, 'running')];

    case 'stdout':
      return record.text ? [log('muted', record.text)] : [];

    case 'testEnd': {
      if (record.willRetry) return [log('muted', `${record.name} — falló, reintentando…`)];
      if (record.status === 'skipped') return [log('muted', `${record.name} — omitida`)];

      if (record.status === 'passed') {
        const events = [];
        if (record.retry > 0) events.push(log('muted', `${record.name} — inestable: pasó en el reintento`));
        events.push(log('pass', record.name));
        events.push(result(record.id, 'passed'));
        return events;
      }

      if (FAILURE_STATUSES.has(record.status)) {
        const text = record.error ? `${record.name} — ${record.error}` : record.name;
        return [log('fail', text), result(record.id, 'failed')];
      }
      return [];
    }

    default:
      return [];
  }
}

module.exports = { createStreamParser, translate, SENTINEL };
