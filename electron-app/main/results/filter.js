/** ¿La corrida (`isoString`) cae en la fecha local `dateStr` (YYYY-MM-DD)? Vacío = sí. */
function matchesLocalDate(isoString, dateStr) {
  if (!dateStr) return true;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return false;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === dateStr;
}

module.exports = { matchesLocalDate };
