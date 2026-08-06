(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RunQaAssignments = api;
})(typeof window !== 'undefined' ? window : globalThis, function createModel() {
  const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  const STATUS = {
    SCHEDULED: { label: 'Programada', className: 'scheduled' },
    ON_TIME: { label: 'Completada a tiempo', className: 'on-time' },
    LATE: { label: 'Completada tarde', className: 'late' },
    OVERDUE: { label: 'Atrasada', className: 'overdue' },
    CANCELLED: { label: 'Cancelada', className: 'cancelled' },
  };

  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const cursor = new Date(first);
    cursor.setDate(cursor.getDate() - cursor.getDay());
    const end = new Date(last);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const weeks = [];

    while (cursor <= end) {
      const week = [];
      for (let index = 0; index < 7; index += 1) {
        const date = new Date(cursor);
        week.push({
          date,
          iso: toIsoDate(date),
          inMonth: date.getFullYear() === year && date.getMonth() === month,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  }

  function addMonths(year, month, delta) {
    const date = new Date(year, month + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() };
  }

  function monthLabel(year, month) {
    return `${MONTHS[month]} ${year}`;
  }

  function groupByDate(occurrences) {
    const grouped = {};
    for (const occurrence of Array.isArray(occurrences) ? occurrences : []) {
      if (typeof occurrence?.dueDate !== 'string') continue;
      (grouped[occurrence.dueDate] ||= []).push(occurrence);
    }
    return grouped;
  }

  function statusMeta(status) {
    return STATUS[status] || STATUS.SCHEDULED;
  }

  function selectionForDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return { cursor: { year, month }, selectedDate: iso };
  }

  return { monthGrid, addMonths, monthLabel, groupByDate, statusMeta, selectionForDate };
});
