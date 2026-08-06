const STORE_KEY = 'nativeNotificationIds';
const MAX_IDS = 500;
const NATIVE_TYPES = new Set(['EXECUTION_ASSIGNED', 'EXECUTION_DUE_TODAY']);

function validId(id) {
  return Number.isInteger(id) || (typeof id === 'string' && id.length > 0);
}

function createNativeNotificationService({ store, show, namespace = () => 'default' }) {
  function loadIds() {
    const saved = store.getSetting(STORE_KEY);
    if (!Array.isArray(saved)) return [];
    return saved.filter(validId).map(String).slice(-MAX_IDS);
  }

  return {
    process(notifications) {
      const ids = loadIds();
      const seen = new Set(ids);
      const scope = String(namespace() ?? 'default');

      for (const notification of Array.isArray(notifications) ? notifications : []) {
        if (notification?.read || !NATIVE_TYPES.has(notification?.type) || !validId(notification?.id)) continue;
        const key = JSON.stringify([scope, String(notification.id)]);
        if (seen.has(key)) continue;

        try {
          show({
            id: notification.id,
            title: notification.title,
            body: notification.message,
            targetDate: notification.targetDate ?? null,
          });
          seen.add(key);
          ids.push(key);
          if (ids.length > MAX_IDS) ids.splice(0, ids.length - MAX_IDS);
          store.setSetting(STORE_KEY, ids);
        } catch {
          // El sistema operativo puede rechazar un aviso; los demás deben continuar.
        }
      }
    },
  };
}

module.exports = { createNativeNotificationService };
