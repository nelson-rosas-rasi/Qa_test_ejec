const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../renderer/assignments');

test('agosto de 2026 cubre semanas completas sin alterar fechas ISO', () => {
  const weeks = model.monthGrid(2026, 7);
  assert.equal(weeks[0][0].iso, '2026-07-26');
  assert.equal(weeks.at(-1).at(-1).iso, '2026-09-05');
  assert.equal(weeks.flat().filter(day => day.inMonth).length, 31);
});

test('agrupa ocurrencias y traduce estados', () => {
  const grouped = model.groupByDate([{ id: 1, dueDate: '2026-08-05', status: 'OVERDUE' }]);
  assert.equal(grouped['2026-08-05'][0].id, 1);
  assert.equal(model.statusMeta('OVERDUE').label, 'Atrasada');
});

test('mantiene las etiquetas aprobadas para todos los estados', () => {
  assert.equal(model.statusMeta('SCHEDULED').label, 'Programada');
  assert.equal(model.statusMeta('ON_TIME').label, 'Completada a tiempo');
  assert.equal(model.statusMeta('LATE').label, 'Completada tarde');
  assert.equal(model.statusMeta('OVERDUE').label, 'Atrasada');
  assert.equal(model.statusMeta('CANCELLED').label, 'Cancelada');
});

test('selectionForDate valida el calendario sin conversiones de zona horaria', () => {
  assert.deepEqual(model.selectionForDate('2026-08-05'), {
    cursor: { year: 2026, month: 7 },
    selectedDate: '2026-08-05',
  });
  assert.equal(model.selectionForDate(null), null);
  assert.equal(model.selectionForDate('2026-02-30'), null);
  assert.equal(model.selectionForDate('05/08/2026'), null);
});

test('navega meses y genera la etiqueta en español', () => {
  assert.deepEqual(model.addMonths(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(model.addMonths(2026, 0, -1), { year: 2025, month: 11 });
  assert.equal(model.monthLabel(2026, 7), 'Agosto 2026');
});
