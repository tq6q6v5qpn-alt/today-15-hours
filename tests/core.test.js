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

