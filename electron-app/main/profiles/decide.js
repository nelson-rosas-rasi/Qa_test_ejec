/**
 * Reglas de negocio de perfiles, puras y testeables. Los handlers de IPC son
 * delgados y delegan aquí las decisiones (qué perfil queda activo, si se puede
 * eliminar), para poder cubrirlas con node:test sin arrancar Electron.
 */

/** No se puede eliminar el perfil activo: hay que activar otro primero. */
function canRemoveProfile(activeId, id) {
  return id !== activeId;
}

/**
 * Qué perfil queda activo tras guardar. Al crear (isNew) se activa el recién
 * guardado, como hasta ahora. Al editar se conserva el activo actual.
 */
function nextActiveAfterSave({ isNew, currentActive, savedId }) {
  return isNew ? savedId : currentActive;
}

module.exports = { canRemoveProfile, nextActiveAfterSave };
