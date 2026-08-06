const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeNotificationService } = require('../main/server/native-notifications');

function fakeStore() {
  const data = {};
  return {
    getSetting: key => data[key],
    setSetting: (key, value) => { data[key] = value; },
  };
}

test('muestra únicamente asignación y vencimiento del día una sola vez', () => {
  const shown = [];
  const service = createNativeNotificationService({ store: fakeStore(), show: n => shown.push(n) });
  service.process([
    { id: 1, type: 'EXECUTION_ASSIGNED', title: 'Asignada', message: 'M', targetDate: '2026-08-10', read: false },
    { id: 2, type: 'EXECUTION_UPDATED', title: 'Cambio', message: 'M', targetDate: '2026-08-11', read: false },
    { id: 3, type: 'EXECUTION_DUE_TODAY', title: 'Hoy', message: 'M', targetDate: '2026-08-12', read: false },
  ]);
  service.process([{ id: 1, type: 'EXECUTION_ASSIGNED', read: false }]);
  assert.deepEqual(shown.map(n => n.id), [1, 3]);
  assert.deepEqual(shown[0], {
    id: 1,
    title: 'Asignada',
    body: 'M',
    targetDate: '2026-08-10',
  });
});

test('la deduplicación sobrevive al reinicio del servicio', () => {
  const store = fakeStore();
  const firstShown = [];
  createNativeNotificationService({ store, show: n => firstShown.push(n) }).process([
    { id: 'n-1', type: 'EXECUTION_ASSIGNED', title: 'Asignada', message: 'M', read: false },
  ]);

  const afterRestart = [];
  createNativeNotificationService({ store, show: n => afterRestart.push(n) }).process([
    { id: 'n-1', type: 'EXECUTION_ASSIGNED', title: 'Asignada', message: 'M', read: false },
    { id: 'n-2', type: 'EXECUTION_DUE_TODAY', title: 'Hoy', message: 'M', read: false },
  ]);

  assert.equal(firstShown.length, 1);
  assert.deepEqual(afterRestart.map(n => n.id), ['n-2']);
});

test('las notificaciones leídas no generan avisos nativos', () => {
  const shown = [];
  createNativeNotificationService({ store: fakeStore(), show: n => shown.push(n) }).process([
    { id: 1, type: 'EXECUTION_ASSIGNED', read: true },
    { id: 2, type: 'EXECUTION_DUE_TODAY', read: true },
  ]);
  assert.deepEqual(shown, []);
});

test('un fallo al mostrar no bloquea avisos posteriores ni marca el fallido', () => {
  const store = fakeStore();
  const shown = [];
  const service = createNativeNotificationService({
    store,
    show: notification => {
      if (notification.id === 1) throw new Error('falló el sistema operativo');
      shown.push(notification.id);
    },
  });
  const notifications = [
    { id: 1, type: 'EXECUTION_ASSIGNED', read: false },
    { id: 2, type: 'EXECUTION_DUE_TODAY', read: false },
  ];
  service.process(notifications);
  service.process(notifications);
  assert.deepEqual(shown, [2]);
});

test('conserva únicamente los 500 identificadores más recientes', () => {
  const store = fakeStore();
  const notifications = Array.from({ length: 501 }, (_, index) => ({
    id: index + 1,
    type: 'EXECUTION_ASSIGNED',
    read: false,
  }));
  createNativeNotificationService({ store, show: () => {} }).process(notifications);

  const shownAfterRestart = [];
  createNativeNotificationService({ store, show: n => shownAfterRestart.push(n.id) }).process([
    notifications[0],
    notifications.at(-1),
  ]);
  assert.deepEqual(shownAfterRestart, [1]);
});
