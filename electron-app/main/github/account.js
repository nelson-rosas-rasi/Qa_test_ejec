const { appError } = require('../errors');

const KEY = 'github';

/**
 * Guarda el token cifrado con safeStorage (DPAPI en Windows, atado a la cuenta
 * de Windows del QA). La identidad se guarda en claro: no es secreta y permite
 * pintar el perfil sin red.
 */
function createAccountStore({ store, safeStorage }) {
  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw appError('SECURE_STORAGE_UNAVAILABLE', 'Este equipo no puede guardar la cuenta de forma segura.');
    }
  }

  return {
    save(token, identity) {
      // Si no hay cifrado, no se guarda en claro como alternativa: se falla.
      requireEncryption();
      store.setSetting(KEY, {
        token: safeStorage.encryptString(token).toString('base64'),
        identity,
        verifiedAt: new Date().toISOString(),
      });
    },

    load() {
      const saved = store.getSetting(KEY);
      if (!saved?.token) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;
      try {
        return {
          token: safeStorage.decryptString(Buffer.from(saved.token, 'base64')),
          identity: saved.identity || null,
          verifiedAt: saved.verifiedAt || null,
        };
      } catch {
        // Cifrado con otra cuenta de Windows, o config manipulado.
        return null;
      }
    },

    saveIdentity(identity) {
      const saved = store.getSetting(KEY);
      if (!saved?.token) return;
      store.setSetting(KEY, { ...saved, identity, verifiedAt: new Date().toISOString() });
    },

    clear() {
      store.setSetting(KEY, null);
    },
  };
}

module.exports = { createAccountStore };
