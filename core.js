(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Today15Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MINUTES = 24 * 60;

  function keyDate(date = new Date()) {
    const value = date instanceof Date ? date : new Date(`${date}T12:00:00`);
    if (Number.isNaN(value.getTime())) throw new TypeError('Invalid date');
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0')
    ].join('-');
  }

  function nonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function taskTotal(task = {}) {
    return nonNegative(task.min) + nonNegative(task.prepMin) + nonNegative(task.travelMin);
  }

  function planned(tasks = []) {
    return tasks.reduce((total, task) => total + taskTotal(task), 0);
  }

  function available(sleepHours = 9) {
    return DAY_MINUTES - Math.round(nonNegative(sleepHours) * 60);
  }

  function remaining(day = {}) {
    return available(day.sleep ?? 9) - planned(day.tasks || []);
  }

  function plus(time, minutes) {
    if (!/^\d{2}:\d{2}$/.test(time)) throw new TypeError('Invalid time');
    const [hours, mins] = time.split(':').map(Number);
    const value = ((hours * 60 + mins + Number(minutes)) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  }

  function diffMinutes(start, end) {
    if (!start || !end) return 0;
    const value = Math.round((new Date(end) - new Date(start)) / 60000);
    return value > 0 && value < DAY_MINUTES ? value : 0;
  }

  function actualParts(task = {}) {
    const logs = task.logs || {};
    const prep = diffMinutes(logs.prep, logs.depart || logs.start);
    const travel = diffMinutes(logs.depart, logs.arrive) + diffMinutes(logs.end, logs.return);
    const activity = diffMinutes(logs.start, logs.end);
    return { prep, travel, activity, total: prep + travel + activity };
  }

  function validateBackup(data) {
    if (!data || data.format !== 'today-15-hours') return { ok: false, reason: 'format' };
    if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) return { ok: false, reason: 'version' };
    if (!data.calendar || typeof data.calendar !== 'object' || Array.isArray(data.calendar)) return { ok: false, reason: 'calendar' };
    for (const [date, day] of Object.entries(data.calendar)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || !Array.isArray(day.tasks)) return { ok: false, reason: 'day' };
    }
    return { ok: true };
  }

  function mergeBackups(current, incoming) {
    const validation = validateBackup(incoming);
    if (!validation.ok) throw new TypeError(`Invalid backup: ${validation.reason}`);
    const currentFixed = current.meta?.fixed || [];
    const incomingFixed = incoming.meta?.fixed || [];
    const fixedById = new Map([...currentFixed, ...incomingFixed].map(item => [item.id, item]));
    return {
      calendar: { ...(current.calendar || {}), ...incoming.calendar },
      meta: { fixed: [...fixedById.values()] },
      feedback: [...new Set([current.feedback, incoming.feedback].filter(Boolean))].join('\n\n')
    };
  }

  return {
    DAY_MINUTES,
    keyDate,
    taskTotal,
    planned,
    available,
    remaining,
    plus,
    diffMinutes,
    actualParts,
    validateBackup,
    mergeBackups
  };
});
