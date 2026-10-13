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

test('수면은 0~24시간을 허용하며 실제 하루 계산에 잘못된 값을 추정하지 않는다', () => {
  for (const value of [0, 7.5, 9, 24]) {
    assert.equal(Core.sleepHours(value), value);
    assert.equal(Core.available(value), 1440 - value * 60);
  }
  assert.equal(Core.sleepHours('7.5'), 7.5);
  for (const value of [undefined, null, '', -1, 24.1, NaN, Infinity, '잘못된 값']) {
    assert.equal(Core.sleepHours(value), 9);
    assert.equal(Core.available(value), null);
    assert.equal(Core.remaining({ sleep: value, tasks: [{ min: 30 }] }), null);
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
  assert.equal(Core.wakeTime(), null);
  assert.equal(Core.wakeTime({ sleep: 7.5 }), null);
  assert.equal(Core.wakeTime({ sleep: 7.5, sleepAt: '23:30' }), '07:00');
  assert.equal(Core.wakeTime({ sleep: 0, sleepAt: '23:30' }), '23:30');
  assert.equal(Core.wakeTime({ sleep: 24, sleepAt: '23:30' }), '23:30');
  assert.equal(Core.wakeTime({ sleep: 7.5, sleepAt: '01:00' }), '08:30');
  assert.equal(Core.wakeTime({ sleep: 9, sleepAt: '잘못된 값' }), null);
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
  assert.equal(Core.schedule({ tasks: [{ min: 30 }] })[0].startMinute, null);
  assert.equal(Core.schedule({ sleep: 9, sleepAt: '23:30', tasks: [{ min: 30 }] })[0].startMinute, 510);
});

test('하루 점유는 자정을 감싼 수면과 0·24·7.5시간 수면을 반영한다', () => {
  const defaultMinutes = Core.dayOccupancy({ sleep: 9, sleepAt: '23:30', tasks: [] });
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
  const shortSleep = Core.dayOccupancy({ sleep: 7.5, sleepAt: '23:30' });
  assert.equal(shortSleep.filter(value => value === 'sleep').length, 450);
  assert.equal(shortSleep[419], 'sleep');
  assert.equal(shortSleep[420], null);
});

test('겹친 준비·이동·활동·수면은 실제 남은 시간에서 한 번만 차감한다', () => {
  const day = {
    date: '2026-10-11', sleep: 9, sleepAt: '23:30',
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
  assert.deepEqual(Core.dayWindow({ date: '2026-10-12', sleep: 7.5, sleepAt: '23:30' }, now), {
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
  assert.equal(Core.remaining(merged.calendar['2026-10-10']), null);
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

test('미설정 취침은 추정하지 않고 수면 시간 변경은 설정된 취침까지의 시간을 바꾸지 않는다', () => {
  const now = new Date(2026, 9, 11, 12, 0, 30);
  const defaultWindow = Core.bedtimeWindow({ date: '2026-10-11' }, now);
  assert.equal(defaultWindow.bedtime, null);
  assert.equal(defaultWindow.remainingMinutes, null);
  assert.equal(defaultWindow.reached, false);
  for (const sleepAt of ['', '잘못된 값', '24:00', '12:60', null]) {
    const result = Core.bedtimeWindow({ date: '2026-10-11', sleepAt }, now);
    assert.equal(result.bedtime, null);
    assert.equal(result.remainingMinutes, null);
  }
  for (const sleep of [0, 7.5, 9, 24]) {
    assert.deepEqual(Core.bedtimeWindow({ date: '2026-10-11', sleep, sleepAt: '23:30' }, now), {
      relation: 'today', bedtime: '23:30', remainingMinutes: 689, reached: false
    });
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

test('수면 입력은 누락·빈칸·잘못된 타입을 0시간으로 확정하지 않는다', () => {
  for (const value of [undefined, null, '', '  ', false, true, [], {}, -1, 24.01, NaN, Infinity, '미정']) {
    assert.equal(Core.validSleepHours(value), null);
  }
  for (const [value, expected] of [[0, 0], ['0', 0], [24, 24], ['7.5', 7.5], [' 8 ', 8]]) {
    assert.equal(Core.validSleepHours(value), expected);
  }
  assert.equal(Core.sleepHours(), 9, '독립된 이전 API만 기본값을 유지한다');
  assert.equal(Core.available(), null);
  assert.equal(Core.remaining(), null);
});

test('유효한 예전 수면값은 확인 여부를 추정하지 않고 saved로 보존한다', () => {
  const day = { sleep: 9, sleepAt: '23:30', custom: '보존' };
  const before = JSON.stringify(day);
  assert.deepEqual(Core.sleepSettings(day), {
    status: 'saved', hours: 9, bedtime: '23:30', wakeAt: '08:30', bedtimeDayOffset: 0, wakeDayOffset: 1
  });
  assert.equal(Core.sleepSettings({ ...day, sleepConfirmed: true }).status, 'confirmed');
  for (const sleepConfirmed of [false, 'true', 1, null, undefined]) {
    assert.equal(Core.sleepSettings({ ...day, sleepConfirmed }).status, 'saved');
  }
  assert.equal(JSON.stringify(day), before);
});

test('수면 부분값과 잘못된 기존값은 삭제하지 않고 미설정 상태로 해석한다', () => {
  assert.deepEqual(Core.sleepSettings({ sleep: 7.5, sleepConfirmed: true }), {
    status: 'unset', hours: 7.5, bedtime: null, wakeAt: null, bedtimeDayOffset: 0, wakeDayOffset: null
  });
  assert.deepEqual(Core.sleepSettings({ sleepAt: '01:00', sleepAtDayOffset: 1 }), {
    status: 'unset', hours: null, bedtime: '01:00', wakeAt: null, bedtimeDayOffset: 1, wakeDayOffset: null
  });
  const invalid = { sleep: '미정', sleepAt: '25:00', sleepConfirmed: true, note: '삭제하지 않음' };
  const before = JSON.stringify(invalid);
  assert.equal(Core.sleepSettings(invalid).status, 'unset');
  assert.equal(Core.remaining(invalid), null);
  assert.equal(JSON.stringify(invalid), before);
});

test('취침·기상 시각은 자정 넘김과 분 단위 수면 시간을 계산한다', () => {
  assert.equal(Core.sleepFromClocks('23:30', '08:30'), 9);
  assert.equal(Core.sleepFromClocks('01:00', '08:30'), 7.5);
  assert.equal(Core.sleepFromClocks('23:59', '00:01'), 2 / 60);
  assert.equal(Core.sleepFromClocks('00:00', '23:59'), 1439 / 60);
  assert.equal(Core.sleepFromClocks('08:00', '08:00'), 0);
  assert.equal(Core.sleepFromClocks('08:00', '08:00', true), 24);
  assert.equal(Core.sleepFromClocks('08:00', '09:00', true), 1);
  for (const [start, end] of [['', '08:00'], ['08:00', null], ['24:00', '08:00'], ['08:00', '12:60']]) {
    assert.equal(Core.sleepFromClocks(start, end), null);
  }
});

test('수면 0·24시간과 다음날 취침은 기상 날짜를 명확히 구분한다', () => {
  assert.deepEqual(Core.sleepSettings({ sleep: 0, sleepAt: '00:00', sleepConfirmed: true }), {
    status: 'confirmed', hours: 0, bedtime: '00:00', wakeAt: '00:00', bedtimeDayOffset: 0, wakeDayOffset: 0
  });
  assert.equal(Core.sleepSettings({ sleep: 24, sleepAt: '23:30' }).wakeDayOffset, 1);
  assert.deepEqual(Core.sleepSettings({ sleep: 9, sleepAt: '01:00', sleepAtDayOffset: 1 }), {
    status: 'saved', hours: 9, bedtime: '01:00', wakeAt: '10:00', bedtimeDayOffset: 1, wakeDayOffset: 1
  });
  assert.equal(Core.sleepSettings({ sleep: 24, sleepAt: '23:30', sleepAtDayOffset: 1 }).wakeDayOffset, 2);
  assert.equal(Core.sleepSettings({ sleep: 9, sleepAt: '01:00', sleepAtDayOffset: '1' }).bedtimeDayOffset, 0);
});

test('기상 미정 자동 일정은 미정으로 남고 직접 시작 시각 이후 순서는 이어진다', () => {
  const day = { tasks: [
    { id: 'unknown', min: 20, custom: '기록' },
    { id: 'also-unknown', min: 30 },
    { id: 'explicit', start: '23:50', min: 20, prepMin: 5, travelMin: 10 },
    { id: 'following', min: 30 }
  ] };
  const before = JSON.stringify(day);
  const rows = Core.schedule(day);
  assert.deepEqual(rows.slice(0, 2).map(row => [row.startMinute, row.endMinute, row.start, row.activityStart, row.end]), [
    [null, null, null, null, null], [null, null, null, null, null]
  ]);
  assert.deepEqual(rows.slice(2).map(row => [row.startMinute, row.endMinute, row.start, row.activityStart, row.end]), [
    [1430, 1465, '23:50', '00:00', '00:25'], [1465, 1495, '00:25', '00:25', '00:55']
  ]);
  assert.equal(rows[0].custom, '기록');
  assert.equal(JSON.stringify(day), before);
});

test('수면 미설정 점유는 확인 가능한 계획만 표시하고 수면 구간을 만들어내지 않는다', () => {
  for (const day of [{}, { sleep: 9 }, { sleepAt: '23:30' }, { sleep: -1, sleepAt: '23:30' }]) {
    const minutes = Core.dayOccupancy({ ...day, tasks: [{ min: 30 }, { start: '12:00', min: 10 }] });
    assert.equal(minutes.filter(value => value === 'sleep').length, 0);
    assert.equal(minutes.filter(value => value !== null).length, 10);
    assert.equal(minutes[719], null);
    assert.equal(minutes[720], 1);
    assert.equal(minutes[730], null);
  }
  assert.equal(Core.dayOccupancy({ sleep: 0 }).filter(value => value === null).length, 1440);
  assert.equal(Core.dayOccupancy({ sleep: 24 }).filter(value => value === 'sleep').length, 1440);
});

test('수면 또는 자동 일정이 미정이면 열린 시간을 숫자로 확정하지 않는다', () => {
  const now = new Date(2026, 9, 13, 12);
  for (const day of [{}, { sleep: 9 }, { sleepAt: '23:30' }, { sleep: 0, tasks: [{ min: 30 }] }]) {
    const result = Core.dayWindow({ date: '2026-10-13', ...day }, now);
    assert.equal(result.untilMidnight, 720);
    assert.equal(result.openMinutes, null);
  }
  assert.equal(Core.dayWindow({ date: '2026-10-12' }, now).openMinutes, 0);
  assert.equal(Core.dayWindow({ date: '2026-10-14' }, now).openMinutes, null);
  assert.equal(Core.dayWindow({ date: '2026-10-13', sleep: 0, tasks: [{ start: '13:00', min: 30 }] }, now).openMinutes, 690);
  assert.equal(Core.dayWindow({ date: '2026-10-13', sleep: 24 }, now).openMinutes, 0);
  assert.equal(Core.dayWindow({ date: '2026-10-13', sleep: 0 }, now, { '2026-10-12': { tasks: [{ min: 30 }] } }).openMinutes, null);
});

test('오래된 미정 일정은 오늘까지 이어질 수 없으면 열린 시간을 막지 않는다', () => {
  const day = { date: '2026-10-13', sleep: 0, tasks: [] };
  const now = new Date(2026, 9, 13, 12);
  const old = { '2026-09-01': { tasks: [{ min: 60 }] } };
  assert.equal(Core.dayWindow(day, now, old).openMinutes, 720);
  assert.equal(Core.dayWindow(day, now, { ...old, '2026-10-12': { tasks: [{ min: 60 }] } }).openMinutes, null);
  assert.equal(Core.dayWindow(day, now, { ...old, '2026-10-11': { tasks: [{ min: 1440 }] } }).openMinutes, 720);
  assert.equal(Core.dayWindow(day, now, { ...old, '2026-10-11': { tasks: [{ min: 1500 }] } }).openMinutes, null);
});

test('이전 미정 일정 범위 제한은 명시적 장기 일정의 연말 점유를 지우지 않는다', () => {
  const day = { date: '2027-01-01', sleep: 0, tasks: [] };
  const calendar = {
    '2026-11-01': { tasks: [{ min: 60 }] },
    '2026-12-30': { tasks: [{ start: '23:00', min: 1560 }] }
  };
  assert.equal(Core.dayWindow(day, new Date(2027, 0, 1), calendar).openMinutes, 1380);
  assert.equal(Core.dayOccupancy(day, calendar).filter(value => value === 'previous').length, 60);
  assert.equal(Core.dayWindow(day, new Date(2027, 0, 1), {
    ...calendar, '2026-12-29': { tasks: [{ min: 4500 }] }
  }).openMinutes, null);
});

test('미설정 취침은 과거에도 미정이며 저장된 시각만 계산한다', () => {
  const now = new Date(2026, 9, 13, 12);
  for (const date of ['2026-10-12', '2026-10-13', '2026-10-14']) {
    const result = Core.bedtimeWindow({ date }, now);
    assert.equal(result.bedtime, null);
    assert.equal(result.remainingMinutes, null);
    assert.equal(result.reached, false);
  }
  assert.equal(Core.bedtimeWindow({ date: '2026-10-13', sleepAt: '13:00' }, now).remainingMinutes, 60);
});

test('다음날 취침은 명시적 날짜 오프셋으로만 오늘 이후 시간을 계산한다', () => {
  const now = new Date(2026, 9, 13, 12);
  const original = { date: '2026-10-13', sleepAt: '01:00', sleep: 9 };
  assert.equal(Core.bedtimeWindow(original, now).remainingMinutes, 0);
  assert.equal(Core.bedtimeWindow(original, now).reached, true);
  assert.deepEqual(Core.bedtimeWindow({ ...original, sleepAtDayOffset: 1 }, now), {
    relation: 'today', bedtime: '01:00', remainingMinutes: 780, reached: false
  });
  assert.equal(Core.bedtimeWindow({ ...original, sleepAt: '00:00', sleepAtDayOffset: 1 }, now).remainingMinutes, 720);
});

test('명시적 다음날 수면과 자동 일정은 원래 날짜에 잘못 배치하지 않는다', () => {
  const night = { date: '2026-10-13', sleep: 8, sleepAt: '01:00', sleepAtDayOffset: 1, tasks: [{ min: 60 }] };
  const before = JSON.stringify(night);
  const rows = Core.schedule(night);
  assert.deepEqual(rows.map(task => [task.startMinute, task.endMinute, task.start, task.end]), [[1980, 2040, '09:00', '10:00']]);
  assert.equal(Core.dayOccupancy(night).filter(value => value !== null).length, 0);
  assert.equal(Core.dayWindow(night, new Date(2026, 9, 13, 12)).openMinutes, 720);
  assert.equal(Core.remaining(night), 900, '하루 예산은 전체 길이, 열린 구간은 실제 날짜를 쓴다');
  const next = { date: '2026-10-14', sleep: 0, tasks: [] };
  const calendar = { '2026-10-13': night };
  const occupancy = Core.dayOccupancy(next, calendar);
  assert.equal(occupancy[59], null);
  assert.equal(occupancy[60], 'sleep');
  assert.equal(occupancy[539], 'sleep');
  assert.equal(occupancy[540], 'previous');
  assert.equal(occupancy[599], 'previous');
  assert.equal(occupancy[600], null);
  assert.equal(Core.dayWindow(next, new Date(2026, 9, 14), calendar).openMinutes, 900);
  assert.equal(Core.dayWindow({ ...next, tasks: [{ start: '01:30', min: 60 }] }, new Date(2026, 9, 14), calendar).openMinutes, 900, '계획과 수면 겹침은 한 번 차감한다');
  assert.equal(JSON.stringify(night), before);
});

test('명시적 다음날 0·24시간 수면은 둘째 다음날 기상과 점유까지 이어진다', () => {
  const night = { date: '2026-12-31', sleep: 24, sleepAt: '23:30', sleepAtDayOffset: 1, tasks: [{ min: 30 }] };
  const calendar = { '2026-12-31': night };
  assert.equal(Core.schedule(night)[0].startMinute, 4290);
  assert.equal(Core.dayOccupancy(night).filter(value => value !== null).length, 0);
  const next = { date: '2027-01-01', sleep: 0, tasks: [] };
  const second = { date: '2027-01-02', sleep: 0, tasks: [] };
  assert.equal(Core.dayOccupancy(next, calendar).filter(value => value === 'sleep').length, 30);
  assert.equal(Core.dayWindow(next, new Date(2027, 0, 1), calendar).openMinutes, 1410);
  assert.equal(Core.dayOccupancy(second, calendar).filter(value => value === 'sleep').length, 1410);
  assert.equal(Core.dayOccupancy(second, calendar)[1410], 'previous');
  assert.equal(Core.dayWindow(second, new Date(2027, 0, 2), calendar).openMinutes, 0);
  const zero = { ...night, sleep: 0, sleepAt: '01:00', tasks: [{ min: 15 }] };
  assert.equal(Core.schedule(zero)[0].startMinute, 1500);
  assert.equal(Core.dayOccupancy(zero).filter(value => value !== null).length, 0);
  assert.equal(Core.dayWindow(next, new Date(2027, 0, 1), { '2026-12-31': zero }).openMinutes, 1425);
});

test('날짜 오프셋 없는 기존 수면은 일일 원형 배치와 기상 순서를 유지한다', () => {
  const legacy = { sleep: 9, sleepAt: '23:30', tasks: [{ min: 60 }] };
  assert.equal(Core.schedule(legacy)[0].startMinute, 510);
  const occupancy = Core.dayOccupancy(legacy);
  assert.equal(occupancy.filter(value => value === 'sleep').length, 540);
  assert.equal(occupancy[0], 'sleep');
  assert.equal(occupancy[509], 'sleep');
  assert.equal(occupancy[510], 0);
  assert.equal(occupancy[1410], 'sleep');
  assert.deepEqual(Core.dayOccupancy({ ...legacy, sleepAtDayOffset: 0 }), occupancy);
  assert.deepEqual(Core.schedule({ ...legacy, sleepAtDayOffset: 0 }), Core.schedule(legacy));
});

test('이전 미설정 다음날 수면은 가능한 겹침만 불확실하게 두고 오래된 날짜는 막지 않는다', () => {
  const unknown = { sleep: 8, sleepAtDayOffset: 1, tasks: [{ min: 60 }] };
  const calendar = { '2026-10-13': unknown };
  for (const date of ['2026-10-14', '2026-10-15']) {
    const day = { date, sleep: 0, tasks: [] };
    assert.equal(Core.dayWindow(day, new Date(`${date}T00:00:00`), calendar).openMinutes, null);
  }
  const later = { date: '2026-10-16', sleep: 0, tasks: [] };
  assert.equal(Core.dayWindow(later, new Date(2026, 9, 16), calendar).openMinutes, 1440);
  assert.equal(Core.dayOccupancy({ date: '2026-10-14', sleep: 0 }, calendar).filter(value => value === 'sleep').length, 0, '미정 수면 구간은 임의로 칠하지 않는다');
});

test('전날의 다음날 취침은 자정 이후에도 실제 목표까지 이어지고 완료 후 0분이다', () => {
  const day = { date: '2026-10-12', sleepAt: '01:00', sleepAtDayOffset: 1 };
  assert.deepEqual(Core.bedtimeWindow(day, new Date(2026, 9, 13, 0, 30)), {
    relation: 'past', bedtime: '01:00', remainingMinutes: 30, reached: false, activeNight: true
  });
  assert.equal(Core.bedtimeWindow(day, new Date(2026, 9, 13, 0, 59, 59, 999)).remainingMinutes, 0);
  assert.equal(Core.bedtimeWindow(day, new Date(2026, 9, 13, 0, 59, 59, 999)).reached, false);
  assert.equal(Core.bedtimeWindow(day, new Date(2026, 9, 13, 1)).reached, true);
  assert.equal(Core.bedtimeWindow(day, new Date(2026, 9, 13, 2)).remainingMinutes, 0);
  assert.deepEqual(Core.bedtimeWindow(day, new Date(2026, 9, 14)), {
    relation: 'past', bedtime: '01:00', remainingMinutes: 0, reached: false
  });
});

test('다음날 취침의 진행 판정은 월말·연말·윤년 경계를 유지한다', () => {
  for (const [date, year, monthIndex, dayOfMonth] of [
    ['2026-10-31', 2026, 10, 1], ['2026-12-31', 2027, 0, 1],
    ['2028-02-28', 2028, 1, 29], ['2028-02-29', 2028, 2, 1]
  ]) {
    const day = { date, sleepAt: '01:00', sleepAtDayOffset: 1 };
    const result = Core.bedtimeWindow(day, new Date(year, monthIndex, dayOfMonth, 0, 30));
    assert.equal(result.remainingMinutes, 30, date);
    assert.equal(result.activeNight, true, date);
    assert.equal(result.relation, 'past', date);
  }
});

test('수면 설정 표시용 새 필드도 스키마 1 백업 왕복과 병합에서 그대로 남는다', () => {
  const day = { date: '2026-10-13', sleep: 7.5, sleepAt: '01:00', sleepAtDayOffset: 1, sleepConfirmed: true,
    custom: { retained: true }, tasks: [{ id: 'a', min: 0, prepMin: 0, travelMin: 0, note: '0값 보존' }] };
  const incoming = JSON.parse(JSON.stringify({ format: 'today-15-hours', schemaVersion: 1, calendar: { '2026-10-13': day }, meta: { extra: '남김' } }));
  const merged = Core.mergeBackups({ calendar: {}, meta: {} }, incoming);
  assert.deepEqual(merged.calendar['2026-10-13'], day);
  assert.equal(merged.meta.extra, '남김');
  assert.equal(Core.sleepSettings(merged.calendar['2026-10-13']).status, 'confirmed');
  assert.equal(Core.remaining(merged.calendar['2026-10-13']), 990);
});

test('실제 준비·왕로·활동·마무리·귀가는 각각 확인된 기록으로 측정한다', () => {
  const task = { logs: {
    prep: '2026-10-13T10:00:00+09:00', depart: '2026-10-13T10:10:00+09:00',
    arrive: '2026-10-13T10:30:00+09:00', start: '2026-10-13T10:35:00+09:00',
    end: '2026-10-13T11:35:00+09:00', returnDepart: '2026-10-13T11:45:00+09:00',
    return: '2026-10-13T12:00:00+09:00'
  } };
  assert.deepEqual(Core.measuredParts(task, new Date('2026-10-13T13:00:00+09:00')), {
    prep: 10, outbound: 20, activity: 60, wrapUp: 10, returnTravel: 15, legacyReturn: null, total: 115
  });
  assert.deepEqual(Core.actualParts(task), { prep: 10, travel: 35, activity: 60, wrapUp: 10, total: 115 });
});

test('이전 끝→귀가 기록은 마무리와 이동으로 추정 분할하지 않는다', () => {
  const task = { logs: { start: '2026-10-13T10:00:00+09:00', end: '2026-10-13T11:00:00+09:00', return: '2026-10-13T11:30:00+09:00' } };
  assert.deepEqual(Core.measuredParts(task, new Date('2026-10-13T12:00:00+09:00')), {
    prep: null, outbound: null, activity: 60, wrapUp: null, returnTravel: null, legacyReturn: 30, total: 90
  });
  assert.deepEqual(Core.actualParts(task), { prep: 0, travel: 30, activity: 60, total: 90 });
});

test('실측의 누락·잘못된·역순·미래 구간은 0분과 구분한다', () => {
  const now = new Date('2026-10-13T12:00:00+09:00');
  for (const logs of [{}, { start: '잘못됨', end: now.toISOString() },
    { start: '2026-10-13T11:30:00+09:00', end: '2026-10-13T11:00:00+09:00' },
    { start: '2026-10-13T11:00:00+09:00', end: '2026-10-13T12:01:00+09:00' }]) {
    assert.equal(Core.measuredParts({ logs }, now).activity, null);
    assert.equal(Core.measuredParts({ logs }, now).total, null);
  }
  const zero = Core.measuredParts({ logs: { start: now.toISOString(), end: now.toISOString() } }, now);
  assert.equal(zero.activity, 0);
  assert.equal(zero.total, 0);
  assert.equal(Core.measuredParts({ logs: { start: now.toISOString(), end: now.toISOString() } }, new Date('invalid')).total, null);
});

test('실측 부분기록은 알려진 구간만 합하고 미확인 나머지는 null로 보존한다', () => {
  const task = { logs: {
    prep: '2026-10-13T10:00:00+09:00', start: '2026-10-13T10:10:00+09:00',
    end: '2026-10-13T11:00:00+09:00', returnDepart: '잘못된 값',
    return: '2026-10-13T11:30:00+09:00', customLog: '보존'
  }, custom: '그대로' };
  const before = JSON.stringify(task);
  assert.deepEqual(Core.measuredParts(task, new Date('2026-10-13T12:00:00+09:00')), {
    prep: 10, outbound: null, activity: 50, wrapUp: null, returnTravel: null, legacyReturn: null, total: 60
  });
  assert.equal(JSON.stringify(task), before);
});

test('새 단계에서 출발을 생략하면 이동을 포함한 준비 시간을 추정하지 않는다', () => {
  const now = new Date('2026-10-13T12:00:00+09:00');
  const logs = { prep: '2026-10-13T10:00:00+09:00', start: '2026-10-13T10:30:00+09:00', end: '2026-10-13T11:00:00+09:00' };
  for (const task of [
    { trackingVersion: 1, travelMin: 30, logs },
    { trackingVersion: 1, travelMin: 0, skippedStages: ['depart'], logs }
  ]) {
    assert.equal(Core.measuredParts(task, now).prep, null);
    assert.equal(Core.measuredParts(task, now).total, 30);
    assert.equal(Core.actualParts(task).prep, 0);
    assert.equal(Core.actualParts(task).total, 30);
  }
  const local = { trackingVersion: 1, travelMin: 0, logs };
  assert.equal(Core.measuredParts(local, now).prep, 30);
  assert.equal(Core.actualParts(local).prep, 30);
  assert.equal(Core.measuredParts({ travelMin: 30, logs }, now).prep, 30, '이전 형식은 기존 계산을 유지한다');
  assert.equal(Core.measuredParts({ trackingVersion: 1, travelMin: 30, logs: { ...logs, depart: '2026-10-13T10:10:00+09:00' } }, now).prep, 10);
});

test('새 단계의 귀가 출발 생략은 이전 합산 귀가 기록으로 바꾸지 않는다', () => {
  const now = new Date('2026-10-13T12:00:00+09:00');
  const logs = { start: '2026-10-13T10:00:00+09:00', end: '2026-10-13T11:00:00+09:00', return: '2026-10-13T11:30:00+09:00' };
  const task = { trackingVersion: 1, skippedStages: ['returnDepart'], logs };
  const before = JSON.stringify(task);
  assert.deepEqual(Core.measuredParts(task, now), {
    prep: null, outbound: null, activity: 60, wrapUp: null, returnTravel: null, legacyReturn: null, total: 60
  });
  assert.deepEqual(Core.actualParts(task), { prep: 0, travel: 0, activity: 60, total: 60 });
  assert.equal(Core.measuredParts({ logs }, now).legacyReturn, 30);
  assert.equal(Core.actualParts({ logs }).travel, 30);
  assert.equal(JSON.stringify(task), before);
});

test('자정과 여러 날짜를 넘긴 실측은 날짜를 잃거나 임의로 0분 처리하지 않는다', () => {
  const task = { logs: { start: '2026-12-31T23:30:00+09:00', end: '2027-01-02T00:30:00+09:00' } };
  assert.equal(Core.measuredParts(task, new Date('2027-01-02T01:00:00+09:00')).activity, 1500);
  assert.equal(Core.measuredParts(task, new Date('2027-01-02T01:00:00+09:00')).total, 1500);
  assert.equal(Core.measuredParts(task, new Date('2027-01-01T23:59:00+09:00')).activity, null);
});
