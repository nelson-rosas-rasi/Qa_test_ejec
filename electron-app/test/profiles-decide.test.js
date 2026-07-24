const test = require('node:test');
const assert = require('node:assert/strict');
const { canRemoveProfile, nextActiveAfterSave } = require('../main/profiles/decide');

test('canRemoveProfile: el perfil activo no se puede eliminar', () => {
  assert.equal(canRemoveProfile('ana', 'ana'), false);
});

test('canRemoveProfile: un perfil no activo sí se puede eliminar', () => {
  assert.equal(canRemoveProfile('ana', 'luis'), true);
});

test('canRemoveProfile: sin perfil activo, cualquiera se puede eliminar', () => {
  assert.equal(canRemoveProfile(null, 'luis'), true);
});

test('nextActiveAfterSave: crear activa el nuevo perfil', () => {
  assert.equal(nextActiveAfterSave({ isNew: true, currentActive: 'ana', savedId: 'luis' }), 'luis');
});

test('nextActiveAfterSave: crear el primer perfil lo activa', () => {
  assert.equal(nextActiveAfterSave({ isNew: true, currentActive: null, savedId: 'ana' }), 'ana');
});

test('nextActiveAfterSave: editar el activo conserva el activo', () => {
  assert.equal(nextActiveAfterSave({ isNew: false, currentActive: 'ana', savedId: 'ana' }), 'ana');
});

test('nextActiveAfterSave: editar un perfil no activo no cambia el activo', () => {
  assert.equal(nextActiveAfterSave({ isNew: false, currentActive: 'ana', savedId: 'luis' }), 'ana');
});
