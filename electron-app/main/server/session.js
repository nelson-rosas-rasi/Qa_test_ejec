const { appError } = require('../errors');

const KEY = 'serverSession';

/** Lee el claim `exp` (segundos epoch) del payload de un JWT, sin verificar la firma. */
function readExp(token) {
  try {
    const payload = String(token).split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Sesión del backend cifrada con safeStorage (igual que la cuenta de GitHub):
 * el token va cifrado, el usuario en claro (no es secreto y permite pintar la UI
 * sin red). El `exp` se deriva del propio JWT.
 */
function createServerSession({ store, safeStorage }) {
  return {
    save(token, user) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw appError('SECURE_STORAGE_UNAVAILABLE', 'Este equipo no puede guardar la sesión de forma segura.');
      }
      store.setSetting(KEY, {
        token: safeStorage.encryptString(token).toString('base64'),
        user: user || null,
        savedAt: new Date().toISOString(),
      });
    },

    load() {
      const saved = store.getSetting(KEY);
      if (!saved?.token || !safeStorage.isEncryptionAvailable()) return null;
      try {
        const token = safeStorage.decryptString(Buffer.from(saved.token, 'base64'));
        const exp = readExp(token);
        return { token, user: saved.user || null, expiresAt: exp ? exp * 1000 : null };
      } catch {
        return null;
      }
    },

    isExpired(token) {
      const exp = readExp(token);
      if (exp === null) return true;
      return Date.now() >= exp * 1000;
    },

    clear() {
      store.setSetting(KEY, null);
    },
  };
}

module.exports = { createServerSession };
