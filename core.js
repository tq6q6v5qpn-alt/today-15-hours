(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Today15Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MINUTES = 24 * 60;

  function validSleepHours(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const hours = Number(value);
    return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? hours : null;
  }

  // Keep the standalone legacy helper, but never infer sleep for a saved day.
  function sleepHours(value = 9) {
    return validSleepHours(value) ?? 9;
  }

  function timeMinute(time) {
    if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
    const [hours, minutes] = time.split(':').map(Number);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  }

  function sleepSettings(day = {}) {
    const hours = validSleepHours(day.sleep);
    const bedtimeMinute = timeMinute(day.sleepAt);
    const bedtime = bedtimeMinute === null ? null : day.sleepAt;
    const bedtimeDayOffset = day.sleepAtDayOffset === 1 ? 1 : 0;
    const complete = hours !== null && bedtime !== null;
    const wakeMinute = complete ? bedtimeMinute + Math.round(hours * 60) : null;
    return {
      status: complete ? day.sleepConfirmed === true ? 'confirmed' : 'saved' : 'unset',
      hours, bedtime,
      wakeAt: complete ? plus('00:00', wakeMinute) : null,
      bedtimeDayOffset,
      wakeDayOffset: complete ? bedtimeDayOffset + Math.floor(wakeMinute / DAY_MINUTES) : null
    };
  }

  function sleepFromClocks(bedtime, wakeAt, fullDay = false) {
    const start = timeMinute(bedtime), end = timeMinute(wakeAt);
    if (start === null || end === null) return null;
    const minutes = (end - start + DAY_MINUTES) % DAY_MINUTES;
    return minutes === 0 && fullDay ? 24 : minutes / 60;
  }

  function wakeTime(day = {}) {
    return sleepSettings(day).wakeAt;
  }

  // Absolute offsets keep a sequence crossing midnight on the following day.
  // An explicitly entered clock time still belongs to the selected date.
  function schedule(day = {}) {
    const settings = sleepSettings(day);
    let cursor = timeMinute(settings.wakeAt);
    if (cursor !== null && settings.bedtimeDayOffset === 1) cursor += settings.wakeDayOffset * DAY_MINUTES;
    return (day.tasks || []).map(task => {
      const startMinute = timeMinute(task.start) ?? cursor;
      const endMinute = startMinute === null ? null : startMinute + taskTotal(task);
      cursor = endMinute;
      return {
        ...task, startMinute, endMinute,
        start: startMinute === null ? null : plus('00:00', startMinute),
        activityStart: startMinute === null ? null : plus('00:00', startMinute + nonNegative(task.prepMin) + Math.floor(nonNegative(task.travelMin) / 2)),
        end: endMinute === null ? null : plus('00:00', endMinute)
      };
    });
  }

  function dayOccupancy(day = {}, calendar = {}) {
    const minutes = Array(DAY_MINUTES).fill(null);
    const hours = validSleepHours(day.sleep), bedtimeMinute = timeMinute(day.sleepAt);
    const sleepMin = hours === null ? 0 : Math.round(hours * 60);
    // Legacy bedtime remains a daily cycle. Explicit next-day bedtime belongs
    // to the following date and is applied when that date reads the calendar.
    // A full daily cycle is known without a clock; partial sleep needs one.
    if (day.sleepAtDayOffset !== 1 && (bedtimeMinute !== null || sleepMin === DAY_MINUTES)) {
      for (let offset = 0; offset < sleepMin; offset++) minutes[((bedtimeMinute ?? 0) + offset) % DAY_MINUTES] = 'sleep';
    }
    const civilDay = date => {
      const [year, month, value] = date.split('-').map(Number);
      return Date.UTC(year, month - 1, value) / 86400000;
    };
    for (const [date, previous] of Object.entries(calendar)) {
      if (!day.date || date >= day.date) continue;
      const offset = (civilDay(day.date) - civilDay(date)) * DAY_MINUTES;
      if (previous.sleepAtDayOffset === 1) {
        const previousBedtime = timeMinute(previous.sleepAt), previousHours = validSleepHours(previous.sleep);
        if (previousBedtime !== null && previousHours !== null) {
          const start = previousBedtime + DAY_MINUTES - offset;
          const end = start + Math.round(previousHours * 60);
          for (let minute = Math.max(0, start); minute < Math.min(DAY_MINUTES, end); minute++) minutes[minute] = 'sleep';
        }
      }
      schedule(previous).forEach(task => {
        if (task.startMinute === null) return;
        for (let minute = Math.max(0, Math.floor(task.startMinute - offset)); minute < Math.min(DAY_MINUTES, task.endMinute - offset); minute++) minutes[minute] = 'previous';
      });
    }
    schedule(day).forEach((task, index) => {
      if (task.startMinute === null) return;
      for (let minute = Math.max(0, Math.floor(task.startMinute)); minute < Math.min(DAY_MINUTES, task.endMinute); minute++) minutes[minute] = index;
    });
    return minutes;
  }

  function dayWindow(day = {}, now = new Date(), calendar = {}) {
    const today = keyDate(now), date = day.date || today;
    const relation = date < today ? 'past' : date > today ? 'future' : 'today';
    const fromMinute = relation === 'past' ? DAY_MINUTES : relation === 'future' ? 0 : now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
    const hours = validSleepHours(day.sleep);
    const sleepKnown = hours !== null && (hours === 0 || hours === 24 || timeMinute(day.sleepAt) !== null);
    const civilDay = value => {
      const [year, month, date] = value.split('-').map(Number);
      return Date.UTC(year, month - 1, date) / 86400000;
    };
    const previousSleepKnown = Object.entries(calendar).every(([previousDate, previous]) => {
      if (previousDate >= date || previous.sleepAtDayOffset !== 1) return true;
      const previousHours = validSleepHours(previous.sleep);
      if (previousHours === 0 || previousHours !== null && timeMinute(previous.sleepAt) !== null) return true;
      // Unknown next-day sleep can extend at most through the second day after
      // its source date; never manufacture that missing interval as free time.
      const endBound = DAY_MINUTES + (timeMinute(previous.sleepAt) ?? DAY_MINUTES) + Math.round((previousHours ?? 24) * 60);
      return (civilDay(date) - civilDay(previousDate)) * DAY_MINUTES >= endBound;
    });
    const plansKnown = schedule(day).every(task => task.startMinute !== null) && Object.entries(calendar).every(([previousDate, previous]) => {
      if (previousDate >= date) return true;
      const rows = schedule(previous);
      if (rows.every(task => task.startMinute !== null)) return true;
      // Legacy unknown clocks start inside their own day; explicit next-night
      // sleep may wake two dates later. Include every duration in a safe bound.
      const latestWake = previous.sleepAtDayOffset === 1 ? 2 * DAY_MINUTES + Math.round((validSleepHours(previous.sleep) ?? 24) * 60) : DAY_MINUTES;
      const endBound = Math.max(latestWake + planned(previous.tasks || []), ...rows.map(task => task.endMinute ?? 0));
      return endBound <= (civilDay(date) - civilDay(previousDate)) * DAY_MINUTES;
    });
    if (relation !== 'past' && (!sleepKnown || !previousSleepKnown || !plansKnown)) {
      return { relation, fromMinute, untilMidnight: Math.floor(DAY_MINUTES - fromMinute), openMinutes: null };
    }
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
    const settings = sleepSettings(day), bedtime = settings.bedtime;
    const bedtimeMinute = bedtime === null ? null : timeMinute(bedtime) + settings.bedtimeDayOffset * DAY_MINUTES;
    const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
    const civilDay = value => {
      const [year, month, date] = value.split('-').map(Number);
      return Date.UTC(year, month - 1, date) / 86400000;
    };
    const activeNight = relation === 'past' && settings.bedtimeDayOffset === 1 && civilDay(today) - civilDay(date) === 1;
    const targetMinute = activeNight && bedtimeMinute !== null ? bedtimeMinute - DAY_MINUTES : bedtimeMinute;
    return {
      relation, bedtime,
      remainingMinutes: targetMinute === null || relation === 'future' ? null : relation === 'past' && !activeNight ? 0 : Math.max(0, Math.floor(targetMinute - minute)),
      reached: targetMinute !== null && (relation === 'today' || activeNight) && minute >= targetMinute,
      ...(activeNight ? { activeNight: true } : {})
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

  function available(hours) {
    const valid = validSleepHours(hours);
    return valid === null ? null : DAY_MINUTES - Math.round(valid * 60);
  }

  function remaining(day = {}) {
    const minutes = available(day.sleep);
    return minutes === null ? null : minutes - planned(day.tasks || []);
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

  function actualPrepEnd(task, logs) {
    if (logs.depart) return logs.depart;
    if (task.trackingVersion !== 1) return logs.start;
    const skipped = Array.isArray(task.skippedStages) ? task.skippedStages : [];
    if (skipped.includes('depart') || skipped.includes('arrive') || logs.arrive) return null;
    // Recorded prep -> start actions establish a route without outbound travel.
    // Later edits to the expected travel budget must not reclassify that interval.
    const actions = Array.isArray(task.routeActions) ? task.routeActions : [];
    const prepIndex = actions.findIndex(action => action?.type === 'record' && action.stage === 'prep');
    const startIndex = actions.findIndex(action => action?.type === 'record' && action.stage === 'start');
    const directStart = prepIndex >= 0 && startIndex > prepIndex &&
      !actions.slice(prepIndex + 1, startIndex).some(action => ['depart', 'arrive'].includes(action?.stage));
    // Imported records without action evidence retain their existing ambiguity.
    return directStart || nonNegative(task.travelMin) === 0 ? logs.start : null;
  }

  function actualParts(task = {}) {
    const logs = task.logs || {};
    const tracked = task.trackingVersion === 1;
    const prepEnd = actualPrepEnd(task, logs);
    const prep = diffMinutes(logs.prep, prepEnd);
    const travel = diffMinutes(logs.depart, logs.arrive) + (tracked ? 0 : diffMinutes(logs.end, logs.return));
    const activity = diffMinutes(logs.start, logs.end);
    if (typeof logs.returnDepart === 'string' && Number.isFinite(new Date(logs.returnDepart).getTime())) {
      const wrapUp = diffMinutes(logs.end, logs.returnDepart);
      const splitTravel = diffMinutes(logs.depart, logs.arrive) + diffMinutes(logs.returnDepart, logs.return);
      return { prep, travel: splitTravel, activity, wrapUp, total: prep + splitTravel + activity + wrapUp };
    }
    return { prep, travel, activity, total: prep + travel + activity };
  }

  // Null means no valid measurement, while 0 is an explicitly timed zero interval.
  // A total is the sum of measured parts; missing parts remain visible as null.
  function measuredParts(task = {}, now = new Date()) {
    const logs = task.logs || {};
    const limit = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const interval = (start, end) => {
      if (typeof start !== 'string' || !start || typeof end !== 'string' || !end) return null;
      const from = new Date(start).getTime(), until = new Date(end).getTime();
      if (!Number.isFinite(limit) || !Number.isFinite(from) || !Number.isFinite(until) || until < from || until > limit) return null;
      return Math.round((until - from) / 60000);
    };
    const hasReturnDepart = typeof logs.returnDepart === 'string' && !!logs.returnDepart;
    const tracked = task.trackingVersion === 1;
    const prepEnd = actualPrepEnd(task, logs);
    const parts = {
      prep: interval(logs.prep, prepEnd),
      outbound: interval(logs.depart, logs.arrive),
      activity: interval(logs.start, logs.end),
      wrapUp: hasReturnDepart ? interval(logs.end, logs.returnDepart) : null,
      returnTravel: hasReturnDepart ? interval(logs.returnDepart, logs.return) : null,
      legacyReturn: tracked || hasReturnDepart ? null : interval(logs.end, logs.return)
    };
    const measured = Object.values(parts).filter(value => value !== null);
    return { ...parts, total: measured.length ? measured.reduce((sum, value) => sum + value, 0) : null };
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
    validSleepHours,
    sleepHours,
    sleepSettings,
    sleepFromClocks,
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
    measuredParts,
    validateBackup,
    mergeBackups
  };
});
