(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Today15Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MINUTES = 24 * 60;

  function sleepHours(value = 9) {
    if (value === null || value === '') return 9;
    const hours = Number(value);
    return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? hours : 9;
  }

  function timeMinute(time) {
    if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [hours, minutes] = time.split(':').map(Number);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  }

  function sleepStart(day = {}) {
    return timeMinute(day.sleepAt) ?? 23 * 60 + 30;
  }

  function wakeTime(day = {}) {
    return plus('00:00', (sleepStart(day) + Math.round(sleepHours(day.sleep) * 60)) % DAY_MINUTES);
  }

  // Absolute offsets keep a sequence crossing midnight on the following day.
  // An explicitly entered clock time still belongs to the selected date.
  function schedule(day = {}) {
    let cursor = timeMinute(wakeTime(day));
    return (day.tasks || []).map(task => {
      const startMinute = timeMinute(task.start) ?? cursor;
      const endMinute = startMinute + taskTotal(task);
      cursor = endMinute;
      return {
        ...task, startMinute, endMinute,
        start: plus('00:00', startMinute),
        activityStart: plus('00:00', startMinute + nonNegative(task.prepMin) + Math.floor(nonNegative(task.travelMin) / 2)),
        end: plus('00:00', endMinute)
      };
    });
  }

  function dayOccupancy(day = {}, calendar = {}) {
    const minutes = Array(DAY_MINUTES).fill(null);
    const sleepMin = Math.round(sleepHours(day.sleep) * 60);
    // sleepAt is the daily bedtime: the overnight part occupies the morning.
    for (let offset = 0; offset < sleepMin; offset++) minutes[(sleepStart(day) + offset) % DAY_MINUTES] = 'sleep';
    const civilDay = date => {
      const [year, month, value] = date.split('-').map(Number);
      return Date.UTC(year, month - 1, value) / 86400000;
    };
    for (const [date, previous] of Object.entries(calendar)) {
      if (!day.date || date >= day.date) continue;
      const offset = (civilDay(day.date) - civilDay(date)) * DAY_MINUTES;
      schedule(previous).forEach(task => {
        for (let minute = Math.max(0, Math.floor(task.startMinute - offset)); minute < Math.min(DAY_MINUTES, task.endMinute - offset); minute++) minutes[minute] = 'previous';
      });
    }
    schedule(day).forEach((task, index) => {
      for (let minute = Math.max(0, Math.floor(task.startMinute)); minute < Math.min(DAY_MINUTES, task.endMinute); minute++) minutes[minute] = index;
    });
    return minutes;
  }

  function dayWindow(day = {}, now = new Date(), calendar = {}) {
    const today = keyDate(now), date = day.date || today;
    const relation = date < today ? 'past' : date > today ? 'future' : 'today';
    const fromMinute = relation === 'past' ? DAY_MINUTES : relation === 'future' ? 0 : now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
    const occupancy = dayOccupancy(day, calendar);
    let open = 0;
    for (let minute = Math.floor(fromMinute); minute < DAY_MINUTES; minute++) {
      if (occupancy[minute] === null) open += Math.min(1, minute + 1 - fromMinute);
    }
    return { relation, fromMinute, untilMidnight: Math.floor(DAY_MINUTES - fromMinute), openMinutes: Math.floor(open + 1e-9) };
  }

  function bedtimeWindow(day = {}, now = new Date()) {
    const today = keyDate(now), date = day.date || today;
    const relation = date < today ? 'past' : date > today ? 'future' : 'today';
    const bedtime = plus('00:00', sleepStart(day));
    const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
    return {
      relation, bedtime,
      remainingMinutes: relation === 'future' ? null : relation === 'past' ? 0 : Math.max(0, Math.floor(sleepStart(day) - minute)),
      reached: relation === 'today' && minute >= sleepStart(day)
    };
  }

  function completedTasks(calendar = {}, date = keyDate(), now = new Date()) {
    const completed = [], seen = new Set();
    for (const [sourceDate, day] of Object.entries(calendar)) {
      for (const task of day.tasks || []) {
        const end = task.logs?.end;
        if (typeof end !== 'string' || !end) continue;
        const when = new Date(end), start = new Date(task.logs?.start);
        if (!Number.isFinite(when.getTime()) || when > now || keyDate(when) !== date) continue;
        if (Number.isFinite(start.getTime()) && when < start) continue;
        const identity = task.id == null ? null : `${task.id}:${when.getTime()}`;
        if (identity && seen.has(identity)) continue;
        if (identity) seen.add(identity);
        completed.push({ ...task, sourceDate, completedAt: end });
      }
    }
    return completed.sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt));
  }

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

  function available(hours = 9) {
    return DAY_MINUTES - Math.round(sleepHours(hours) * 60);
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
      meta: { ...(current.meta || {}), ...(incoming.meta || {}), fixed: [...fixedById.values()] },
      feedback: [...new Set([current.feedback, incoming.feedback].filter(Boolean))].join('\n\n')
    };
  }

  return {
    DAY_MINUTES,
    sleepHours,
    timeMinute,
    wakeTime,
    schedule,
    dayOccupancy,
    dayWindow,
    bedtimeWindow,
    completedTasks,
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
