const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

test('24시간에서 수면과 준비·이동·활동을 모두 차감한다', () => {
  const day = {
    sleep: 9,
    tasks: [{ min: 60, prepMin: 20, travelMin: 60 }]
  };
  assert.equal(Core.available(day.sleep), 900);
  assert.equal(Core.taskTotal(day.tasks[0]), 140);
  assert.equal(Core.remaining(day), 760);
});

test('가용시간을 넘긴 계획은 음수로 남긴다', () => {
  const day = { sleep: 9, tasks: [{ min: 600 }, { min: 360 }] };
  assert.equal(Core.remaining(day), -60);
});

test('자정을 넘기는 시각 계산을 보존한다', () => {
  assert.equal(Core.plus('23:40', 30), '00:10');
  assert.equal(Core.plus('00:10', -30), '23:40');
});

test('실제 준비·이동·활동 구간을 따로 계산한다', () => {
  const task = { logs: {
    prep: '2026-07-23T10:00:00+09:00',
    depart: '2026-07-23T10:10:00+09:00',
    arrive: '2026-07-23T10:30:00+09:00',
    start: '2026-07-23T10:35:00+09:00',
    end: '2026-07-23T11:35:00+09:00',
    return: '2026-07-23T11:50:00+09:00'
  }};
  assert.deepEqual(Core.actualParts(task), {
    prep: 10,
    travel: 35,
    activity: 60,
    total: 105
  });
});

test('백업 형식과 날짜별 작업 배열을 검증한다', () => {
  const valid = {
    format: 'today-15-hours',
    schemaVersion: 1,
    calendar: { '2026-07-23': { tasks: [] } }
  };
  assert.equal(Core.validateBackup(valid).ok, true);
  assert.equal(Core.validateBackup({ ...valid, schemaVersion: 0 }).ok, false);
  assert.equal(Core.validateBackup({ ...valid, calendar: [] }).ok, false);
});

test('백업 병합은 같은 날짜를 가져온 기록으로 바꾸고 고정사항을 중복 제거한다', () => {
  const current = {
    calendar: { '2026-07-23': { tasks: [{ name: '기존' }] } },
    meta: { fixed: [{ id: 'a', name: '기존 기념일' }] },
    feedback: '현재 메모'
  };
  const incoming = {
    format: 'today-15-hours',
    schemaVersion: 1,
    calendar: { '2026-07-23': { tasks: [{ name: '백업' }] } },
    meta: { fixed: [{ id: 'a', name: '수정된 기념일' }, { id: 'b', name: '새 기념일' }] },
    feedback: '백업 메모'
  };
  const merged = Core.mergeBackups(current, incoming);
  assert.equal(merged.calendar['2026-07-23'].tasks[0].name, '백업');
  assert.deepEqual(merged.meta.fixed.map(item => item.name), ['수정된 기념일', '새 기념일']);
  assert.equal(merged.feedback, '현재 메모\n\n백업 메모');
});

test('수면은 0~24시간을 허용하고 잘못된 입력은 기존 9시간으로 계산한다', () => {
  for (const value of [0, 7.5, 9, 24]) {
    assert.equal(Core.sleepHours(value), value);
    assert.equal(Core.available(value), 1440 - value * 60);
  }
  assert.equal(Core.sleepHours('7.5'), 7.5);
  for (const value of [undefined, null, '', -1, 24.1, NaN, Infinity, '잘못된 값']) {
    assert.equal(Core.sleepHours(value), 9);
    assert.equal(Core.available(value), 900);
  }
});

test('시각은 유효한 HH:MM만 날짜 안의 분으로 변환한다', () => {
  assert.equal(Core.timeMinute('00:00'), 0);
  assert.equal(Core.timeMinute('08:30'), 510);
  assert.equal(Core.timeMinute('23:59'), 1439);
  for (const time of ['24:00', '12:60', '9:00', '09:0', '-1:00', 'abc', '', null]) {
    assert.equal(Core.timeMinute(time), null);
  }
});

test('기상 시각은 취침 시각과 날짜별 수면 설정으로 계산한다', () => {
  assert.equal(Core.wakeTime(), '08:30');
  assert.equal(Core.wakeTime({ sleep: 7.5 }), '07:00');
  assert.equal(Core.wakeTime({ sleep: 0 }), '23:30');
  assert.equal(Core.wakeTime({ sleep: 24 }), '23:30');
  assert.equal(Core.wakeTime({ sleep: 7.5, sleepAt: '01:00' }), '08:30');
  assert.equal(Core.wakeTime({ sleep: 9, sleepAt: '잘못된 값' }), '08:30');
});

test('순서 배치는 준비와 이동을 포함하며 자정 이후의 절대 분을 유지한다', () => {
  const day = {
    tasks: [
      { name: '밤 일정', start: '23:40', min: 30, prepMin: 20, travelMin: 30 },
      { name: '뒤따르는 일정', min: 20 },
      { name: '직접 지정한 새벽 일정', start: '00:30', min: 10 }
    ]
  };
  const rows = Core.schedule(day);
  assert.deepEqual(rows.map(row => [row.startMinute, row.endMinute]), [
    [1420, 1500], [1500, 1520], [30, 40]
  ]);
  assert.deepEqual(rows.map(row => [row.start, row.activityStart, row.end]), [
    ['23:40', '00:15', '01:00'], ['01:00', '01:00', '01:20'], ['00:30', '00:30', '00:40']
  ]);
  assert.equal(Core.schedule({ tasks: [{ min: 30 }] })[0].startMinute, 510);
});

test('하루 점유는 자정을 감싼 수면과 0·24·7.5시간 수면을 반영한다', () => {
  const defaultMinutes = Core.dayOccupancy({ tasks: [] });
  assert.equal(defaultMinutes.length, 1440);
  assert.equal(defaultMinutes.filter(value => value === 'sleep').length, 540);
  assert.equal(defaultMinutes[0], 'sleep');
  assert.equal(defaultMinutes[509], 'sleep');
  assert.equal(defaultMinutes[510], null);
  assert.equal(defaultMinutes[1409], null);
  assert.equal(defaultMinutes[1410], 'sleep');
  assert.equal(defaultMinutes[1439], 'sleep');
  assert.equal(Core.dayOccupancy({ sleep: 0 }).filter(value => value === null).length, 1440);
  assert.equal(Core.dayOccupancy({ sleep: 24 }).filter(value => value === 'sleep').length, 1440);
  const shortSleep = Core.dayOccupancy({ sleep: 7.5 });
  assert.equal(shortSleep.filter(value => value === 'sleep').length, 450);
  assert.equal(shortSleep[419], 'sleep');
  assert.equal(shortSleep[420], null);
});

test('겹친 준비·이동·활동·수면은 실제 남은 시간에서 한 번만 차감한다', () => {
  const day = {
    date: '2026-10-11', sleep: 9,
    tasks: [
      { start: '08:00', min: 60, prepMin: 20, travelMin: 40 },
      { start: '09:00', min: 120 }
    ]
  };
  const occupancy = Core.dayOccupancy(day);
  assert.equal(Core.planned(day.tasks), 240);
  assert.equal(Core.remaining(day), 660);
  assert.equal(occupancy.filter(value => value === null).length, 750);
  assert.equal(occupancy[479], 'sleep');
  assert.equal(occupancy[480], 0);
  assert.equal(occupancy[539], 0);
  assert.equal(occupancy[540], 1);
  assert.equal(occupancy[659], 1);
  assert.equal(occupancy[660], null);
  assert.equal(Core.dayWindow(day, new Date(2026, 9, 11, 9, 30)).openMinutes, 750);
  assert.equal(Core.dayWindow(day, new Date(2026, 9, 11, 12)).openMinutes, 690);
});

test('자정 뒤 자동 순서는 선택한 날짜 앞부분에 다시 나타나지 않는다', () => {
  const day = {
    date: '2026-10-11', sleep: 0,
    tasks: [{ start: '23:40', min: 30 }, { min: 30 }]
  };
  const occupancy = Core.dayOccupancy(day);
  assert.equal(occupancy.filter(value => value !== null).length, 20);
  assert.equal(occupancy[0], null);
  assert.equal(occupancy[30], null);
  assert.equal(occupancy[1419], null);
  assert.equal(occupancy[1420], 0);
  assert.equal(occupancy[1439], 0);
  assert.equal(Core.remaining(day), 1380);
  assert.equal(Core.dayWindow(day, new Date(2026, 9, 11, 23, 40)).openMinutes, 0);
});

test('이전 날짜의 자정 넘긴 일정은 다음 날짜 실제 점유에 이어진다', () => {
  const previous = {
    date: '2026-10-10', sleep: 0,
    tasks: [{ start: '23:40', min: 30, prepMin: 20, travelMin: 30 }, { min: 20 }]
  };
  const day = { date: '2026-10-11', sleep: 0, tasks: [{ start: '01:10', min: 20 }] };
  const calendar = {
    '2026-10-10': previous,
    '2026-10-12': { sleep: 0, tasks: [{ start: '00:00', min: 1440 }] }
  };
  const occupancy = Core.dayOccupancy(day, calendar);
  assert.equal(occupancy[0], 'previous');
  assert.equal(occupancy[69], 'previous');
  assert.equal(occupancy[70], 0);
  assert.equal(occupancy[89], 0);
  assert.equal(occupancy[90], null);
  assert.equal(occupancy.filter(value => value !== null).length, 90);
  assert.equal(Core.dayWindow(day, new Date(2026, 9, 11), calendar).openMinutes, 1350);
});

test('여러 날을 넘긴 이전 일정도 해당 날짜 구간만 점유한다', () => {
  const day = { date: '2027-01-01', sleep: 0, tasks: [] };
  const calendar = {
    '2026-12-30': { sleep: 0, tasks: [{ start: '23:00', min: 1560 }] },
    '2026-12-29': { sleep: 0, tasks: [{ start: '23:00', min: 60 }] }
  };
  const occupancy = Core.dayOccupancy(day, calendar);
  assert.equal(occupancy[0], 'previous');
  assert.equal(occupancy[59], 'previous');
  assert.equal(occupancy[60], null);
  assert.equal(occupancy.filter(value => value === 'previous').length, 60);
});

test('월말·연말·윤년 날짜 경계를 넘어 이전 일정의 분을 보존한다', () => {
  for (const [previousDate, date] of [
    ['2026-10-31', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
    ['2027-02-28', '2027-03-01'],
    ['2028-02-28', '2028-02-29'],
    ['2028-02-29', '2028-03-01']
  ]) {
    const day = { date, sleep: 0, tasks: [] };
    const calendar = { [previousDate]: { sleep: 0, tasks: [{ start: '23:30', min: 120 }] } };
    const occupancy = Core.dayOccupancy(day, calendar);
    assert.equal(occupancy.filter(value => value === 'previous').length, 90, date);
    assert.equal(occupancy[89], 'previous', date);
    assert.equal(occupancy[90], null, date);
  }
});

test('오늘은 현재 시각 이후만, 과거는 0분, 미래는 온전한 날짜로 계산한다', () => {
  const now = new Date(2026, 9, 11, 12, 0, 0);
  assert.deepEqual(Core.dayWindow({ date: '2026-10-10', sleep: 0 }, now), {
    relation: 'past', fromMinute: 1440, untilMidnight: 0, openMinutes: 0
  });
  assert.deepEqual(Core.dayWindow({ date: '2026-10-11', sleep: 0 }, now), {
    relation: 'today', fromMinute: 720, untilMidnight: 720, openMinutes: 720
  });
  assert.deepEqual(Core.dayWindow({ date: '2026-10-12', sleep: 7.5 }, now), {
    relation: 'future', fromMinute: 0, untilMidnight: 1440, openMinutes: 990
  });
});

test('자정과 마지막 1초는 지나간 시간 또는 다음 날짜를 중복 계산하지 않는다', () => {
  const day = { date: '2026-10-11', sleep: 0, tasks: [] };
  assert.deepEqual(Core.dayWindow(day, new Date(2026, 9, 11)), {
    relation: 'today', fromMinute: 0, untilMidnight: 1440, openMinutes: 1440
  });
  const thirtySeconds = Core.dayWindow(day, new Date(2026, 9, 11, 0, 0, 30));
  assert.equal(thirtySeconds.fromMinute, 0.5);
  assert.equal(thirtySeconds.untilMidnight, 1439);
  assert.equal(thirtySeconds.openMinutes, 1439);
  const lastSecond = Core.dayWindow(day, new Date(2026, 9, 11, 23, 59, 59, 999));
  assert.equal(lastSecond.relation, 'today');
  assert.equal(lastSecond.untilMidnight, 0);
  assert.equal(lastSecond.openMinutes, 0);
  assert.deepEqual(Core.dayWindow(day, new Date(2026, 9, 12)), {
    relation: 'past', fromMinute: 1440, untilMidnight: 0, openMinutes: 0
  });
});

test('현재 분의 일부와 이후 겹친 계획을 합친 뒤 온전한 분만 표시한다', () => {
  const day = { date: '2026-10-11', sleep: 0, tasks: [{ start: '12:01', min: 1 }] };
  const result = Core.dayWindow(day, new Date(2026, 9, 11, 12, 0, 30));
  assert.equal(result.untilMidnight, 719);
  assert.equal(result.openMinutes, 718);
});

test('오늘·과거·미래 판정은 월·연·윤년 자정에서 바뀐다', () => {
  for (const [oldDate, year, monthIndex, dayOfMonth] of [
    ['2026-10-31', 2026, 10, 1],
    ['2026-12-31', 2027, 0, 1],
    ['2028-02-28', 2028, 1, 29],
    ['2028-02-29', 2028, 2, 1]
  ]) {
    const now = new Date(year, monthIndex, dayOfMonth);
    assert.equal(Core.dayWindow({ date: oldDate, sleep: 0 }, now).relation, 'past');
    assert.equal(Core.dayWindow({ date: Core.keyDate(now), sleep: 0 }, now).relation, 'today');
    const next = new Date(year, monthIndex, dayOfMonth + 1);
    assert.equal(Core.dayWindow({ date: Core.keyDate(next), sleep: 0 }, now).relation, 'future');
  }
});

test('계산과 수면 변경은 다른 날짜 기록이나 입력 객체를 수정하지 않는다', () => {
  const calendar = {
    '2026-10-10': { date: '2026-10-10', sleep: 9, tasks: [{ id: 'old', min: 30, done: true }] },
    '2026-10-11': { date: '2026-10-11', sleep: 7.5, tasks: [{ id: 'new', min: 45, note: '기록 유지' }] }
  };
  const before = JSON.stringify(calendar);
  Core.schedule(calendar['2026-10-11']);
  Core.dayOccupancy(calendar['2026-10-11'], calendar);
  Core.dayWindow(calendar['2026-10-11'], new Date(2026, 9, 11, 12), calendar);
  assert.equal(JSON.stringify(calendar), before);
  assert.equal(Core.remaining(calendar['2026-10-11']), 945);
  assert.equal(Core.remaining({ ...calendar['2026-10-11'], sleep: 9 }), 855);
  assert.equal(calendar['2026-10-10'].sleep, 9);
});

test('스키마 1 JSON 왕복과 복원은 날짜별 수면·로그·임의 기록 필드를 보존한다', () => {
  const legacyDay = {
    date: '2026-10-10',
    tasks: [{ id: 'legacy', name: '예전 기록', min: 30, prepMin: 10, travelMin: 20,
      done: true, custom: { retained: true }, logs: { start: '2026-10-10T10:00:00+09:00' } }],
    memo: '이전 날짜 메모'
  };
  const editedDay = { date: '2026-10-11', sleep: 7.5, sleepAt: '23:00', tasks: [], memo: '오늘 메모' };
  const incoming = {
    format: 'today-15-hours', schemaVersion: 1,
    calendar: { '2026-10-10': legacyDay, '2026-10-11': editedDay },
    meta: { fixed: [], customMeta: '보존' }, feedback: '기존 피드백'
  };
  const restored = JSON.parse(JSON.stringify(incoming));
  assert.deepEqual(Core.validateBackup(restored), { ok: true });
  const untouched = { date: '2026-10-09', sleep: 9, tasks: [{ id: 'untouched', min: 15 }] };
  const merged = Core.mergeBackups({ calendar: { '2026-10-09': untouched }, meta: {} }, restored);
  assert.deepEqual(merged.calendar['2026-10-09'], untouched);
  assert.deepEqual(merged.calendar['2026-10-10'], legacyDay);
  assert.deepEqual(merged.calendar['2026-10-11'], editedDay);
  assert.equal(merged.meta.customMeta, '보존');
  assert.equal(merged.feedback, '기존 피드백');
  assert.equal(Core.remaining(merged.calendar['2026-10-10']), 840);
  assert.equal(Core.remaining(merged.calendar['2026-10-11']), 990);
});

test('오늘 취침까지 남은 시간은 준비·이동·계획 차감 없이 시계로 계산한다', () => {
  const day = {
    date: '2026-10-11', sleepAt: '23:30', sleep: 9,
    tasks: [{ start: '10:00', min: 900, prepMin: 100, travelMin: 100 }]
  };
  assert.deepEqual(Core.bedtimeWindow(day, new Date(2026, 9, 11, 12)), {
    relation: 'today', bedtime: '23:30', remainingMinutes: 690, reached: false
  });
  assert.equal(Core.bedtimeWindow({ ...day, tasks: [] }, new Date(2026, 9, 11, 12)).remainingMinutes, 690);
  assert.equal(Core.bedtimeWindow({ ...day, sleepAt: '12:00' }, new Date(2026, 9, 11, 10)).remainingMinutes, 120);
});

test('취침 직전은 온전한 분만 표시하고 취침 시각 이후는 0분으로 유지한다', () => {
  const day = { date: '2026-10-11', sleepAt: '23:30' };
  assert.equal(Core.bedtimeWindow(day, new Date(2026, 9, 11, 23, 29)).remainingMinutes, 1);
  const lastSecond = Core.bedtimeWindow(day, new Date(2026, 9, 11, 23, 29, 59, 999));
  assert.equal(lastSecond.remainingMinutes, 0);
  assert.equal(lastSecond.reached, false);
  const atBedtime = Core.bedtimeWindow(day, new Date(2026, 9, 11, 23, 30));
  assert.equal(atBedtime.remainingMinutes, 0);
  assert.equal(atBedtime.reached, true);
  const afterBedtime = Core.bedtimeWindow(day, new Date(2026, 9, 11, 23, 59, 59));
  assert.equal(afterBedtime.remainingMinutes, 0);
  assert.equal(afterBedtime.reached, true);
});

test('취침 계산은 과거 0분·미래 미정과 자정 날짜 전환을 구분한다', () => {
  const now = new Date(2027, 0, 1);
  const past = Core.bedtimeWindow({ date: '2026-12-31', sleepAt: '23:30' }, now);
  assert.equal(past.relation, 'past');
  assert.equal(past.remainingMinutes, 0);
  const today = Core.bedtimeWindow({ date: '2027-01-01', sleepAt: '23:30' }, now);
  assert.equal(today.relation, 'today');
  assert.equal(today.remainingMinutes, 1410);
  assert.equal(today.reached, false);
  const future = Core.bedtimeWindow({ date: '2027-01-02', sleepAt: '23:30' }, now);
  assert.equal(future.relation, 'future');
  assert.equal(future.remainingMinutes, null);
  assert.equal(Core.bedtimeWindow({ date: '2027-01-01', sleepAt: '00:00' }, now).reached, true);
  assert.equal(Core.bedtimeWindow({ date: '2027-01-01', sleepAt: '00:00' }, now).remainingMinutes, 0);
});

test('취침 기본값은 23:30이고 수면 시간 변경은 취침까지의 시간을 바꾸지 않는다', () => {
  const now = new Date(2026, 9, 11, 12, 0, 30);
  const defaultWindow = Core.bedtimeWindow({ date: '2026-10-11' }, now);
  assert.equal(defaultWindow.bedtime, '23:30');
  assert.equal(defaultWindow.remainingMinutes, 689);
  for (const sleepAt of ['', '잘못된 값', '24:00', '12:60', null]) {
    const result = Core.bedtimeWindow({ date: '2026-10-11', sleepAt }, now);
    assert.equal(result.bedtime, '23:30');
    assert.equal(result.remainingMinutes, 689);
  }
  for (const sleep of [0, 7.5, 9, 24]) {
    assert.deepEqual(Core.bedtimeWindow({ date: '2026-10-11', sleep, sleepAt: '23:30' }, now), defaultWindow);
  }
});

test('완료 기억은 실제 종료 기록만 사용하며 종료 단독 기록과 휴식도 포함한다', () => {
  const earlyEnd = new Date(2026, 9, 11, 10).toISOString();
  const restEnd = new Date(2026, 9, 11, 12).toISOString();
  const laterEnd = new Date(2026, 9, 11, 15).toISOString();
  const calendar = {
    '2026-10-11': {
      tasks: [
        { id: 'later', name: '마친 활동', logs: { start: new Date(2026, 9, 11, 14).toISOString(), end: laterEnd } },
        { id: 'only-end', name: '끝만 기록한 활동', logs: { end: earlyEnd } },
        { id: 'rest', name: '휴식', kind: 'rest', logs: { end: restEnd } },
        { id: 'plan-only', start: '08:00', min: 30, done: true },
        { id: 'focus-only', min: 60, focusMinutes: 60, done: true, logs: { start: earlyEnd } }
      ]
    }
  };
  const result = Core.completedTasks(calendar, '2026-10-11', new Date(2026, 9, 11, 20));
  assert.deepEqual(result.map(task => task.id), ['only-end', 'rest', 'later']);
  assert.deepEqual(result.map(task => task.completedAt), [earlyEnd, restEnd, laterEnd]);
  assert.deepEqual(result.map(task => task.sourceDate), ['2026-10-11', '2026-10-11', '2026-10-11']);
  assert.equal(result[1].kind, 'rest');
  assert.equal(result[1].name, '휴식');
});

test('완료 기억은 다른 날짜·미래·잘못된 종료 기록을 제외하고 현재 종료는 포함한다', () => {
  const now = new Date(2026, 9, 11, 20);
  const calendar = {
    '2026-10-11': {
      tasks: [
        { id: 'yesterday', logs: { end: new Date(2026, 9, 10, 23, 59).toISOString() } },
        { id: 'tomorrow', logs: { end: new Date(2026, 9, 12).toISOString() } },
        { id: 'future-today', logs: { end: new Date(2026, 9, 11, 20, 0, 1).toISOString() } },
        { id: 'invalid', logs: { end: '잘못된 값' } },
        { id: 'empty', logs: { end: '' } },
        { id: 'missing', logs: {} },
        { id: 'no-logs' },
        { id: 'now', logs: { end: now.toISOString() } }
      ]
    }
  };
  assert.deepEqual(Core.completedTasks(calendar, '2026-10-11', now).map(task => task.id), ['now']);
  assert.deepEqual(Core.completedTasks({}, '2026-10-11', now), []);
});

test('밤샘 활동은 계획 날짜가 아닌 종료 시각의 로컬 날짜에 기억한다', () => {
  const started = new Date(2026, 11, 31, 23, 40).toISOString();
  const completed = new Date(2027, 0, 1, 0, 20).toISOString();
  const midnight = new Date(2027, 0, 1).toISOString();
  const calendar = {
    '2026-12-31': {
      tasks: [
        { id: 'overnight', name: '밤샘 활동', min: 40, start: '23:40', logs: { start: started, end: completed } },
        { id: 'at-midnight', name: '자정에 마친 휴식', kind: 'rest', logs: { end: midnight } }
      ]
    },
    '2027-01-01': { tasks: [] }
  };
  const now = new Date(2027, 0, 1, 1);
  assert.deepEqual(Core.completedTasks(calendar, '2026-12-31', now), []);
  const result = Core.completedTasks(calendar, '2027-01-01', now);
  assert.deepEqual(result.map(task => task.id), ['at-midnight', 'overnight']);
  assert.deepEqual(result.map(task => task.sourceDate), ['2026-12-31', '2026-12-31']);
  assert.equal(result[1].completedAt, completed);
});

test('완료 기억은 커스텀 필드와 로그를 보존하며 원래 캘린더를 수정하지 않는다', () => {
  const end = new Date(2026, 9, 11, 12).toISOString();
  const task = {
    id: 'preserved', name: '보존할 활동', min: 60, prepMin: 10, travelMin: 20,
    custom: { note: '개인 기록', count: 3 }, logs: { end, customLog: '남김' },
    done: false, kind: 'rest'
  };
  const calendar = { '2026-10-10': { tasks: [task], memo: '날짜 메모' } };
  const before = JSON.stringify(calendar);
  const result = Core.completedTasks(calendar, '2026-10-11', new Date(2026, 9, 11, 13));
  assert.deepEqual(result, [{ ...task, sourceDate: '2026-10-10', completedAt: end }]);
  assert.equal(JSON.stringify(calendar), before);
  assert.notEqual(result[0], task);
});

test('실제 시작보다 앞선 종료는 제외하고 종료 단독·동일 시각·잘못된 시작은 허용한다', () => {
  const start = new Date(2026, 9, 11, 12).toISOString();
  const earlier = new Date(2026, 9, 11, 11, 59).toISOString();
  const later = new Date(2026, 9, 11, 12, 1).toISOString();
  const calendar = {
    '2026-10-11': {
      tasks: [
        { id: 'reversed', logs: { start, end: earlier } },
        { id: 'end-only', logs: { end: earlier } },
        { id: 'same-time', logs: { start, end: start } },
        { id: 'valid-order', logs: { start, end: later } },
        { id: 'invalid-start', logs: { start: '잘못된 시작', end: later } }
      ]
    }
  };
  const result = Core.completedTasks(calendar, '2026-10-11', new Date(2026, 9, 11, 13));
  assert.equal(result.some(task => task.id === 'reversed'), false);
  assert.deepEqual(new Set(result.map(task => task.id)), new Set(['end-only', 'same-time', 'valid-order', 'invalid-start']));
});

test('같은 ID와 종료 시각은 날짜 간 중복 제거하고 ID 없는 개별 기록은 보존한다', () => {
  const end = new Date(2026, 9, 11, 12).toISOString();
  const sameInstant = end.replace('Z', '+00:00');
  const laterEnd = new Date(2026, 9, 11, 12, 30).toISOString();
  const calendar = {
    '2026-10-10': {
      tasks: [
        { id: 'duplicate', name: '첫 기록', logs: { end } },
        { name: 'ID 없는 기록', logs: { end } }
      ]
    },
    '2026-10-11': {
      tasks: [
        { id: 'duplicate', name: '겹친 기록', logs: { end: sameInstant } },
        { id: 'duplicate', name: '같은 ID의 다른 완료', logs: { end: laterEnd } },
        { name: 'ID 없는 기록', logs: { end } },
        { id: 'other', name: '다른 ID', logs: { end } }
      ]
    }
  };
  const before = JSON.stringify(calendar);
  const result = Core.completedTasks(calendar, '2026-10-11', new Date(2026, 9, 11, 13));
  assert.equal(result.length, 5);
  const duplicate = result.filter(task => task.id === 'duplicate');
  assert.equal(duplicate.length, 2);
  assert.equal(duplicate.filter(task => new Date(task.completedAt).getTime() === new Date(end).getTime()).length, 1);
  assert.equal(duplicate.filter(task => task.completedAt === laterEnd).length, 1);
  const unidentified = result.filter(task => task.id === undefined);
  assert.equal(unidentified.length, 2);
  assert.notEqual(unidentified[0], unidentified[1]);
  assert.equal(result.filter(task => task.id === 'other').length, 1);
  assert.equal(JSON.stringify(calendar), before);
});
