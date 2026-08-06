(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RunQaNotifications = api;
})(typeof window !== 'undefined' ? window : globalThis, function createModel() {
  function validIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
  }

  function unreadCount(items) {
    return (Array.isArray(items) ? items : []).filter(item => !item?.read).length;
  }

  function badgeText(count) {
    if (!Number.isFinite(count) || count <= 0) return '';
    return count > 9 ? '9+' : String(count);
  }

  function clickPlan(notification) {
    const targetDate = validIsoDate(notification?.targetDate) ? notification.targetDate : null;
    return { targetDate, shouldMarkRead: !notification?.read };
  }

  return { unreadCount, badgeText, clickPlan };
});
