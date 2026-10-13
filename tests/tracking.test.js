const test = require('node:test');
const assert = require('node:assert/strict');
const Tracking = require('../tracking.js');
const Core = require('../core.js');
const at = (minutes = 0) => new Date(Date.UTC(2026, 9, 13, 14, 50 + minutes));
const step = (task, stage, minutes) => Tracking.advance(task, stage, at(minutes));

function swimming() { return { id: 'test-swim', name: '수영', min: 60, prepMin: 20, travelMin: 60, custom: { keep: true } }; }

test('새 준비·왕복 이동 활동은 다음 행동 하나씩 기록한다', () => {
  const task = swimming();
  const stages = ['prep', 'depart', 'arrive', 'start', 'end', 'returnDepart', 'return'];
  for (const [index, stage] of stages.entries()) {
    assert.equal(Tracking.nextStep(task).key, stage);
    const result = step(task, stage, index * 10);
    assert.equal(result.ok, true);
    assert.equal(result.finished, index === stages.length - 1);
    assert.equal(Tracking.isOngoing(task, at(100)), index !== stages.length - 1);
  }
  assert.equal(task.trackingVersion, 1);
  assert.equal(task.routeComplete, true);
  assert.equal(Tracking.nextStep(task), null);
  assert.equal(Core.measuredParts(task, at(100)).total, 50);
  assert.deepEqual(task.custom, { keep: true });
});

test('준비·이동 계획 0은 단계와 가짜 기록을 만들지 않는다', () => {
  const task = { min: 0, prepMin: 0, travelMin: 0 };
  assert.equal(Tracking.nextStep(task).key, 'start');
  step(task, 'start', 0); step(task, 'end', 0); step(task, 'returnDepart', 0);
  assert.deepEqual(Object.keys(task.logs), ['start', 'end', 'returnDepart']);
  assert.deepEqual(Core.measuredParts(task, at(10)), {
    prep: null, outbound: null, activity: 0, wrapUp: 0, returnTravel: null, legacyReturn: null, total: 0
  });
});

test('기대 단계가 다른 반복 터치와 이전 버튼은 시각을 덮어쓰지 않는다', () => {
  const task = swimming();
  assert.equal(step(task, 'start', 0).ok, false);
  assert.equal(step(task, 'prep', 0).ok, true);
  const snapshot = JSON.stringify(task);
  assert.equal(step(task, 'prep', 1).ok, false);
  assert.equal(Tracking.skip(task, 'prep', at(1)).ok, false);
  assert.equal(JSON.stringify(task), snapshot);
});

test('건너뛴 단계는 미확인이고 마지막 생략을 되돌릴 수 있다', () => {
  const task = swimming();
  assert.equal(Tracking.skip(task, 'prep', at()).ok, true);
  assert.equal(Tracking.skip(task, 'depart', at()).ok, true);
  assert.equal(Tracking.skip(task, 'arrive', at()).ok, true);
  step(task, 'start', 10); step(task, 'end', 70);
  assert.equal(Core.measuredParts(task, at(100)).prep, null);
  assert.equal(Core.measuredParts(task, at(100)).outbound, null);
  assert.equal(Tracking.skip(task, 'returnDepart', at(80)).ok, true);
  assert.equal(Tracking.skip(task, 'return', at(90)).finished, true);
  assert.equal(task.routeComplete, true);
  assert.equal(Tracking.undo(task).ok, true);
  assert.equal(Tracking.nextStep(task).key, 'return');
  assert.equal(task.routeComplete, undefined);
  assert.equal(task.logs.return, undefined);
  assert.deepEqual(task.skippedStages, ['prep', 'depart', 'arrive', 'returnDepart']);
});

test('첫 생략 취소는 원래 필드를 되돌리고 기록을 만들지 않는다', () => {
  const task = { name: '독서', min: 20, unrelated: '보존' };
  Tracking.skip(task, 'start', at());
  Tracking.undo(task);
  assert.equal(task.trackingVersion, undefined);
  assert.equal(task.skippedStages, undefined);
  assert.equal(task.logs, undefined);
  assert.equal(task.unrelated, '보존');
  assert.equal(Tracking.nextStep(task).key, 'start');
});

test('실제 시각이 자정을 넘어도 원래 활동에 ISO를 보존한다', () => {
  const task = { min: 30 };
  Tracking.advance(task, 'start', new Date('2026-10-13T23:50:00+09:00'));
  Tracking.advance(task, 'end', new Date('2026-10-14T00:20:00+09:00'));
  Tracking.advance(task, 'returnDepart', new Date('2026-10-14T00:30:00+09:00'));
  assert.equal(task.logs.start, '2026-10-13T14:50:00.000Z');
  assert.equal(task.logs.end, '2026-10-13T15:20:00.000Z');
  assert.equal(Core.measuredParts(task, at(60)).activity, 30);
  assert.equal(Core.measuredParts(task, at(60)).wrapUp, 10);
});

test('기존 시작·종료 기록은 준비·마무리 단계로 확장하지 않는다', () => {
  const task = { prepMin: 20, travelMin: 60, logs: { start: at().toISOString(), end: at(60).toISOString() } };
  const original = JSON.stringify(task);
  assert.equal(Tracking.nextStep(task), null);
  assert.equal(Tracking.isOngoing(task, at(100)), false);
  assert.equal(step(task, 'returnDepart', 70).ok, false);
  assert.equal(JSON.stringify(task), original);
});

test('기존 시작만 있는 활동은 종료만 기록하며 새 마무리 요구가 없다', () => {
  const task = { prepMin: 20, travelMin: 60, logs: { start: at().toISOString() } };
  assert.equal(Tracking.nextStep(task).key, 'end');
  assert.equal(Tracking.isOngoing(task, at(1)), true);
  assert.equal(step(task, 'end', 60).finished, true);
  assert.equal(task.trackingVersion, undefined);
  assert.equal(task.logs.returnDepart, undefined);
  assert.equal(Tracking.nextStep(task), null);
});

test('기존 경로 기록은 원래 귀가 구간의 합산 의미를 보존한다', () => {
  const task = { travelMin: 60, logs: { depart: at().toISOString(), arrive: at(20).toISOString(), start: at(25).toISOString(), end: at(85).toISOString() } };
  assert.equal(Tracking.nextStep(task).key, 'return');
  assert.equal(step(task, 'return', 100).finished, true);
  const actual = Core.measuredParts(task, at(110));
  assert.equal(actual.legacyReturn, 15);
  assert.equal(actual.wrapUp, null);
  assert.equal(actual.returnTravel, null);
  assert.equal(task.logs.returnDepart, undefined);
});

test('새로고침·백업 직렬화 후 현재 단계와 취소 이력이 유지된다', () => {
  const original = swimming();
  step(original, 'prep', 0); step(original, 'depart', 10);
  const task = JSON.parse(JSON.stringify(original));
  assert.equal(Tracking.nextStep(task).key, 'arrive');
  assert.equal(Tracking.isOngoing(task, at(20)), true);
  assert.equal(Tracking.undo(task).stage, 'depart');
  assert.equal(Tracking.nextStep(task).key, 'depart');
  assert.equal(task.logs.prep, original.logs.prep);
});

test('완료 기록을 되돌리면 마지막 실제 단계만 제거한다', () => {
  const task = { min: 10, logs: { customEvent: '별도 기록' } };
  step(task, 'start', 0); step(task, 'end', 10); step(task, 'returnDepart', 15);
  assert.equal(Tracking.undo(task).stage, 'returnDepart');
  assert.equal(Tracking.isOngoing(task, at(20)), true);
  assert.equal(Tracking.nextStep(task).key, 'returnDepart');
  assert.equal(task.logs.customEvent, '별도 기록');
  assert.equal(task.logs.end, at(10).toISOString());
});

test('잘못된·미래·역순 시각은 새 기록을 막고 내용을 유지한다', () => {
  for (const logs of [ { start: 'bad' }, { start: at(100).toISOString() }, { prep: at(20).toISOString(), start: at(10).toISOString() } ]) {
    const task = { trackingVersion: 1, min: 10, logs };
    const original = JSON.stringify(task);
    assert.equal(Tracking.isOngoing(task, at(50)), false);
    assert.equal(Tracking.advance(task, 'end', at(50)).ok, false);
    assert.equal(JSON.stringify(task), original);
  }
});

test('실측 뒤 계획을 바꾸어도 앞 준비 단계를 소급해서 만들지 않는다', () => {
  const task = { min: 10, prepMin: 0, travelMin: 0 };
  step(task, 'start', 0); task.prepMin = 30; task.travelMin = 20;
  assert.equal(Tracking.nextStep(task).key, 'end');
  assert.equal(step(task, 'prep', 10).ok, false);
  assert.equal(task.logs.prep, undefined);
});

test('시각 수정은 명시적 적용으로만 바꾸고 취소할 수 있다', () => {
  const task = { min: 10 };
  step(task, 'start', 0); step(task, 'end', 10);
  const old = task.logs.end, newer = at(12).toISOString();
  assert.equal(Tracking.edit(task, 'end', newer, { expectedValue: old, now: at(20) }).ok, true);
  assert.equal(task.logs.end, newer);
  assert.equal(Tracking.undo(task).type, 'edit');
  assert.equal(task.logs.end, old);
  assert.equal(Tracking.nextStep(task).key, 'returnDepart');
});

test('순서를 뒤집거나 미래로 수정한 초안은 저장하지 않는다', () => {
  const task = { min: 10 };
  step(task, 'start', 0); step(task, 'end', 10); step(task, 'returnDepart', 15);
  for (const [stage, minutes] of [['start', 11], ['end', 16], ['returnDepart', 30]]) {
    const original = JSON.stringify(task);
    assert.equal(Tracking.edit(task, stage, at(minutes).toISOString(), { now: at(20) }).ok, false);
    assert.equal(JSON.stringify(task), original);
  }
});

test('시각 수정의 반복 적용과 오래된 편집창은 기록을 덮어쓰지 않는다', () => {
  const task = { logs: { start: at().toISOString(), end: at(10).toISOString() } };
  const originalEnd = task.logs.end;
  assert.equal(Tracking.edit(task, 'end', at(11).toISOString(), { expectedValue: originalEnd, now: at(20) }).ok, true);
  assert.equal(Tracking.edit(task, 'end', at(12).toISOString(), { expectedValue: originalEnd, now: at(20) }).ok, false);
  assert.equal(task.logs.end, at(11).toISOString());
});

test('알 수 없는 기존 필드와 잘못된 새 필드 형태는 삭제하지 않는다', () => {
  for (const task of [{ logs: null, future: { keep: true } }, { logs: {}, routeActions: '다른 의미' }, { logs: {}, skippedStages: '다른 의미' }]) {
    const original = JSON.stringify(task);
    const expected = Tracking.nextStep(task).key;
    const result = own(task, 'skippedStages') ? Tracking.skip(task, expected, at()) : Tracking.advance(task, expected, at());
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(task), original);
  }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
});

test('예전 기록 취소는 같은 시각일 때 마지막 순서부터 제거한다', () => {
  const task = { logs: { start: at().toISOString(), end: at().toISOString(), custom: '보존' } };
  assert.equal(Tracking.undo(task).stage, 'end');
  assert.equal(task.logs.start, at().toISOString());
  assert.equal(task.logs.custom, '보존');
});


test('실제 탭과 직접 수정한 시각을 구분하고 취소하면 원래 출처를 복구한다', () => {
  const task = { min: 10, logOrigins: { future: { keep: true } } };
  step(task, 'start', 0); step(task, 'end', 10);
  assert.deepEqual(task.logOrigins.end, { type: 'tap', changedAt: at(10).toISOString() });
  const originalOrigin = { ...task.logOrigins.end };
  assert.equal(Tracking.edit(task, 'end', at(12).toISOString(), { now: at(20) }).ok, true);
  assert.deepEqual(task.logOrigins.end, { type: 'user-edited', changedAt: at(20).toISOString() });
  assert.equal(Tracking.undo(task).type, 'edit');
  assert.deepEqual(task.logOrigins.end, originalOrigin);
  Tracking.undo(task);
  assert.equal(task.logs.end, undefined);
  assert.equal(task.logOrigins.end, undefined);
  assert.deepEqual(task.logOrigins.future, { keep: true });
});

test('기존 출처 필드와 알 수 없는 출처 형태를 보존한다', () => {
  const legacy = { logs: { start: at().toISOString(), end: at(10).toISOString() } };
  Tracking.edit(legacy, 'end', at(12).toISOString(), { now: at(20) });
  assert.equal(legacy.logOrigins.end.type, 'user-edited');
  Tracking.undo(legacy);
  assert.equal(legacy.logOrigins, undefined);
  const first = { min: 10 };
  step(first, 'start', 0); Tracking.undo(first);
  assert.equal(first.logs, undefined);
  assert.equal(first.logOrigins, undefined);
  for (const logOrigins of ['알 수 없는 형식', null, [], { end: '미래 형식' }]) {
    const task = { logs: { start: at().toISOString(), end: at(10).toISOString() }, logOrigins };
    const before = JSON.stringify(task);
    assert.equal(Tracking.edit(task, 'end', at(11).toISOString(), { now: at(20) }).ok, false);
    assert.equal(JSON.stringify(task), before);
  }
});


test('기존 준비만 기록된 활동도 준비 시각을 유지하며 이어서 기록한다', () => {
  const task = { prepMin: 20, travelMin: 60, logs: { prep: at().toISOString() }, oldField: '보존' };
  assert.equal(Tracking.isOngoing(task, at(1)), true);
  assert.equal(Tracking.nextStep(task).key, 'depart');
  assert.equal(step(task, 'depart', 10).ok, true);
  assert.equal(task.logs.prep, at().toISOString());
  assert.equal(task.trackingVersion, undefined);
  assert.equal(task.oldField, '보존');
  assert.equal(Tracking.nextStep(task).key, 'arrive');
});

test('기존 이동 기록은 새 마무리로 바꾸지 않고 원래 귀가까지 이어간다', () => {
  const task = { travelMin: 60, logs: { depart: at().toISOString() } };
  assert.equal(Tracking.isOngoing(task, at(1)), true);
  assert.equal(Tracking.nextStep(task).key, 'arrive');
  step(task, 'arrive', 20);
  assert.equal(Tracking.isOngoing(task, at(21)), true);
  step(task, 'start', 25); step(task, 'end', 85);
  assert.equal(Tracking.nextStep(task).key, 'return');
  assert.equal(Tracking.isOngoing(task, at(86)), true);
  assert.equal(step(task, 'return', 100).finished, true);
  assert.equal(Tracking.isOngoing(task, at(101)), false);
  assert.equal(task.trackingVersion, undefined);
  assert.equal(task.logs.returnDepart, undefined);
});
