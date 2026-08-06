const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../renderer/notifications');

test('clickPlan abre targetDate y sólo solicita PATCH si está no leída', () => {
  assert.deepEqual(model.clickPlan({ read: false, targetDate: '2026-08-05' }), {
    targetDate: '2026-08-05',
    shouldMarkRead: true,
  });
  assert.deepEqual(model.clickPlan({ read: true, targetDate: '2026-08-05' }), {
    targetDate: '2026-08-05',
    shouldMarkRead: false,
  });
});

test('clickPlan descarta fechas nulas o inválidas', () => {
  assert.equal(model.clickPlan({ read: false, targetDate: null }).targetDate, null);
  assert.equal(model.clickPlan({ read: false, targetDate: '2026-02-30' }).targetDate, null);
  assert.equal(model.clickPlan({ read: false, targetDate: '05/08/2026' }).targetDate, null);
});

test('cuenta no leídas y limita el texto de la insignia', () => {
  assert.equal(model.unreadCount([{ read: false }, { read: true }]), 1);
  assert.equal(model.unreadCount([]), 0);
  assert.equal(model.badgeText(0), '');
  assert.equal(model.badgeText(9), '9');
  assert.equal(model.badgeText(10), '9+');
  assert.equal(model.badgeText(99), '9+');
});
