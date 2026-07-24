const isFail = (status) => status !== 'passed' && status !== 'skipped';

/**
 * Historial agregado de un test a lo largo de las corridas guardadas.
 * `records` es la lista tal cual la devuelve results/store.list().
 */
function testHistory(records, testId) {
  const appearances = [];
  for (const record of records) {
    const t = (record.tests || []).find((x) => x.id === testId);
    if (!t) continue;
    appearances.push({ finishedAt: record.finishedAt, status: t.status, error: t.error });
  }
  appearances.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));

  const runs = appearances.length;
  const failures = appearances.filter((a) => isFail(a.status)).length;
  const failRate = runs ? failures / runs : 0;

  const lastFailure = [...appearances].reverse().find((a) => isFail(a.status));
  const lastFailureAt = lastFailure ? lastFailure.finishedAt : null;

  const timeline = appearances.slice(-10).map((a) => (isFail(a.status) ? 'fail' : 'pass'));

  const counts = new Map();
  for (const a of appearances) {
    if (!isFail(a.status) || !a.error) continue;
    counts.set(a.error, (counts.get(a.error) || 0) + 1);
  }
  let topError = null;
  for (const [message, count] of counts) {
    if (!topError || count > topError.count) topError = { message, count };
  }

  return { runs, failures, failRate, lastFailureAt, timeline, topError };
}

module.exports = { testHistory };
