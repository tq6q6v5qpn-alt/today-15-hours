(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Today15Tracking = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STAGES = ['prep', 'depart', 'arrive', 'start', 'end', 'returnDepart', 'return'];
  const LABELS = {
    prep: ['준비 시작', '준비 중'],
    depart: ['출발하기', '이동 중'],
    arrive: ['도착했어요', '도착 · 활동 전'],
    start: ['활동 시작', '활동 중'],
    end: ['활동 마치기', '마무리 중'],
    returnDepart: ['마무리 끝', '귀가 중'],
    return: ['귀가 · 다음 장소 도착', '전체 기록 완료']
  };
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
  const stamp = value => typeof value === 'string' && value.trim() ? new Date(value).getTime() : NaN;
  const nowTime = value => value instanceof Date ? value.getTime() : new Date(value).getTime();
  const logsOf = task => task.logs && typeof task.logs === 'object' && !Array.isArray(task.logs) ? task.logs : {};
  const knownLogs = task => STAGES.filter(key => own(logsOf(task), key));
  const skipsOf = task => Array.isArray(task.skippedStages) ? task.skippedStages : [];
  const newRoute = task => task.trackingVersion === 1 || knownLogs(task).length === 0;

  function route(task) {
    const steps = [];
    if (positive(task.prepMin)) steps.push('prep');
    if (positive(task.travelMin)) steps.push('depart', 'arrive');
    steps.push('start', 'end');
    if (newRoute(task)) {
      steps.push('returnDepart');
      if (positive(task.travelMin)) steps.push('return');
    } else if (positive(task.travelMin) && (own(logsOf(task), 'depart') || own(logsOf(task), 'arrive'))) {
      steps.push('return');
    }
    return steps;
  }

  // Existing simple start/end records stay simple. Opening them never creates stages.
  function nextStep(task = {}) {
    if (task.routeComplete === true) return null;
    const logs = logsOf(task), fresh = newRoute(task), steps = route(task), skipped = skipsOf(task);
    let key;
    if (!fresh) {
      if (own(logs, 'return') || own(logs, 'end') && !steps.includes('return')) return null;
      const latestIndex = Math.max(-1, ...knownLogs(task).map(stage => STAGES.indexOf(stage)));
      key = steps.find(stage => STAGES.indexOf(stage) > latestIndex && !skipped.includes(stage));
    } else {
      const latestIndex = Math.max(-1, ...[...knownLogs(task), ...skipped.filter(stage => STAGES.includes(stage))].map(stage => STAGES.indexOf(stage)));
      key = steps.find(stage => STAGES.indexOf(stage) > latestIndex && !own(logs, stage) && !skipped.includes(stage));
    }
    if (!key) return null;
    const previous = [...steps].reverse().find(stage => STAGES.indexOf(stage) < STAGES.indexOf(key) && own(logs, stage));
    const label = key === 'returnDepart' && positive(task.travelMin) ? '마무리 끝 · 귀가 출발' : LABELS[key][0];
    const currentLabel = previous ? (previous === 'end' && !fresh ? '활동 종료 · 이동 기록 전' : LABELS[previous][1]) : '시작 전';
    return { key, label, currentLabel };
  }

  function validTimeline(task, now) {
    const limit = nowTime(now);
    if (!Number.isFinite(limit)) return false;
    let previous = -Infinity;
    for (const stage of STAGES) {
      if (!own(logsOf(task), stage)) continue;
      const value = stamp(logsOf(task)[stage]);
      if (!Number.isFinite(value) || value > limit || value < previous) return false;
      previous = value;
    }
    return true;
  }

  function isOngoing(task = {}, now = new Date()) {
    if (task.routeComplete === true || !validTimeline(task, now)) return false;
    const logs = logsOf(task);
    if (!newRoute(task)) return knownLogs(task).length > 0 && nextStep(task) !== null;
    return knownLogs(task).length > 0 && nextStep(task) !== null;
  }

  function before(task) {
    return {
      routeCompleteHad: own(task, 'routeComplete'), routeComplete: task.routeComplete,
      trackingVersionHad: own(task, 'trackingVersion'), trackingVersion: task.trackingVersion
    };
  }

  function validOrigins(task, stage) {
    if (!own(task, 'logOrigins')) return true;
    const origins = task.logOrigins;
    if (!origins || typeof origins !== 'object' || Array.isArray(origins)) return false;
    if (!own(origins, stage)) return true;
    const origin = origins[stage];
    return !!origin && typeof origin === 'object' && !Array.isArray(origin);
  }

  function originBefore(task, stage) {
    return { logOriginsHad: own(task, 'logOrigins'), logOriginHad: own(task.logOrigins, stage), logOrigin: task.logOrigins && task.logOrigins[stage] };
  }

  function markOrigin(task, stage, type, time) {
    if (!own(task, 'logOrigins')) task.logOrigins = {};
    task.logOrigins[stage] = { ...(task.logOrigins[stage] || {}), type, changedAt: new Date(time).toISOString() };
  }

  function restoreOrigin(task, action) {
    if (!own(action, 'logOriginsHad')) return;
    if (action.logOriginHad) {
      if (!task.logOrigins || typeof task.logOrigins !== 'object' || Array.isArray(task.logOrigins)) return;
      task.logOrigins[action.stage] = action.logOrigin;
    } else if (task.logOrigins && typeof task.logOrigins === 'object' && !Array.isArray(task.logOrigins)) {
      delete task.logOrigins[action.stage];
    }
    if (!action.logOriginsHad && task.logOrigins && Object.keys(task.logOrigins).length === 0) delete task.logOrigins;
  }

  function remember(task, action) {
    // Unknown legacy fields are preserved rather than replaced with a new shape.
    if (!own(task, 'routeActions')) task.routeActions = [];
    if (Array.isArray(task.routeActions)) task.routeActions.push(action);
  }

  function guard(task, expectedStage, now) {
    if (own(task, 'logs') && (!task.logs || typeof task.logs !== 'object' || Array.isArray(task.logs))) return { ok: false, reason: 'invalid-logs' };
    if (own(task, 'routeActions') && !Array.isArray(task.routeActions)) return { ok: false, reason: 'invalid-history' };
    const next = nextStep(task);
    if (!next || next.key !== expectedStage) return { ok: false, reason: 'stale-stage' };
    if (!validTimeline(task, now)) return { ok: false, reason: 'invalid-timeline' };
    if (own(logsOf(task), expectedStage)) return { ok: false, reason: 'already-recorded' };
    return null;
  }

  function advance(task, expectedStage, now = new Date()) {
    const error = guard(task, expectedStage, now);
    if (error) return error;
    if (!validOrigins(task, expectedStage)) return { ok: false, reason: 'invalid-origins' };
    const time = nowTime(now);
    const candidate = { ...task, logs: { ...logsOf(task), [expectedStage]: new Date(time).toISOString() } };
    if (!validTimeline(candidate, now)) return { ok: false, reason: 'invalid-timeline' };
    const action = { type: 'record', stage: expectedStage, logsHad: own(task, 'logs'), ...before(task), ...originBefore(task, expectedStage) };
    if (newRoute(task)) task.trackingVersion = 1;
    if (!own(task, 'logs')) task.logs = {};
    else if (!task.logs || typeof task.logs !== 'object' || Array.isArray(task.logs)) return { ok: false, reason: 'invalid-logs' };
    task.logs[expectedStage] = new Date(time).toISOString();
    markOrigin(task, expectedStage, 'tap', time);
    const finished = nextStep(task) === null;
    if (finished) task.routeComplete = true;
    remember(task, action);
    return { ok: true, stage: expectedStage, finished };
  }

  function skip(task, expectedStage, now = new Date()) {
    const error = guard(task, expectedStage, now);
    if (error) return error;
    if (own(task, 'skippedStages') && !Array.isArray(task.skippedStages)) return { ok: false, reason: 'invalid-skips' };
    const action = { type: 'skip', stage: expectedStage, ...before(task), skippedStagesHad: own(task, 'skippedStages') };
    if (newRoute(task)) task.trackingVersion = 1;
    if (!own(task, 'skippedStages')) task.skippedStages = [];
    task.skippedStages.push(expectedStage);
    const finished = nextStep(task) === null;
    if (finished) task.routeComplete = true;
    remember(task, action);
    return { ok: true, stage: expectedStage, finished };
  }

  function edit(task, stage, value, options = {}) {
    const logs = logsOf(task), now = options.now === undefined ? new Date() : options.now;
    if (own(task, 'routeActions') && !Array.isArray(task.routeActions)) return { ok: false, reason: 'invalid-history' };
    if (!STAGES.includes(stage) || !own(logs, stage)) return { ok: false, reason: 'missing-record' };
    if (own(options, 'expectedValue') && logs[stage] !== options.expectedValue) return { ok: false, reason: 'stale-record' };
    if (!validOrigins(task, stage)) return { ok: false, reason: 'invalid-origins' };
    if (value === logs[stage]) return { ok: false, reason: 'unchanged' };
    const candidate = { ...task, logs: { ...logs, [stage]: value } };
    if (!validTimeline(candidate, now)) return { ok: false, reason: 'invalid-timeline' };
    const action = { type: 'edit', stage, previous: logs[stage], ...before(task), ...originBefore(task, stage) };
    task.logs[stage] = value;
    markOrigin(task, stage, 'user-edited', nowTime(now));
    remember(task, action);
    return { ok: true, stage, finished: nextStep(task) === null };
  }

  function restoreFlags(task, action) {
    for (const field of ['routeComplete', 'trackingVersion']) {
      if (action[field + 'Had']) task[field] = action[field];
      else delete task[field];
    }
  }

  function undo(task) {
    const actions = Array.isArray(task.routeActions) ? task.routeActions : [];
    const action = actions[actions.length - 1];
    if (action && STAGES.includes(action.stage) && ['record', 'skip', 'edit'].includes(action.type)) {
      if (action.type === 'record') {
        if (!own(logsOf(task), action.stage)) return { ok: false, reason: 'missing-record' };
        delete task.logs[action.stage];
        if (action.logsHad === false && Object.keys(task.logs).length === 0) delete task.logs;
      } else if (action.type === 'skip') {
        const index = skipsOf(task).lastIndexOf(action.stage);
        if (index < 0) return { ok: false, reason: 'missing-skip' };
        task.skippedStages.splice(index, 1);
        if (!action.skippedStagesHad && task.skippedStages.length === 0) delete task.skippedStages;
      } else {
        if (!own(logsOf(task), action.stage)) return { ok: false, reason: 'missing-record' };
        task.logs[action.stage] = action.previous;
      }
      actions.pop(); restoreFlags(task, action); restoreOrigin(task, action);
      return { ok: true, stage: action.stage, type: action.type };
    }
    const latest = knownLogs(task).filter(stage => Number.isFinite(stamp(logsOf(task)[stage])))
      .sort((a, b) => stamp(logsOf(task)[b]) - stamp(logsOf(task)[a]) || STAGES.indexOf(b) - STAGES.indexOf(a))[0];
    if (!latest) return { ok: false, reason: 'empty' };
    delete task.logs[latest];
    if (task.routeComplete === true) delete task.routeComplete;
    return { ok: true, stage: latest, type: 'record' };
  }

  function createUI({ element, Core, onChange }) {
    let task = null, returnFocus = null, editing = null, message = '';
    const lastUIStepAt = new WeakMap();
    const uiNow = () => typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const canRecordStep = value => !lastUIStepAt.has(value) || uiNow() - lastUIStepAt.get(value) >= 450;
    const recordUIStep = (value, result) => { if (result.ok) lastUIStepAt.set(value, uiNow()); };
    const query = selector => element.querySelector(selector);
    const esc = value => String(value === undefined ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const localValue = value => {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '';
      const pad = number => String(number).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const originText = (value, stage) => value.logOrigins && value.logOrigins[stage] && value.logOrigins[stage].type === 'user-edited' ? '직접 수정한 시각' : value.logOrigins && value.logOrigins[stage] && value.logOrigins[stage].type === 'tap' ? '누른 시각' : '기존 기록';
    const displayStamp = value => Number.isFinite(stamp(value)) ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '기록된 시각 확인';
    const measuredText = value => value === null || value === undefined ? '미확인' : `${value}분`;
    const plannedText = value => value === undefined || value === null || value === '' ? '미설정' : `${Math.max(0, Number(value) || 0)}분`;
    const announce = result => {
      message = result.ok ? '' : result.reason === 'stale-stage' || result.reason === 'stale-record' ? '이미 바뀐 단계입니다. 현재 기록을 확인해 주세요.' : '시각 순서와 현재 시각을 확인해 주세요. 기록은 바꾸지 않았습니다.';
    };
    const changed = (result, type) => {
      announce(result);
      if (result.ok && typeof onChange === 'function') onChange(task, { ...result, type });
      render();
      (query('#trackNext') || query('#undoTrack') || query('#closeTrack')).focus();
    };
    function close() {
      element.classList.remove('on'); editing = null; task = null;
      if (returnFocus && returnFocus.isConnected) returnFocus.focus();
      returnFocus = null;
    }
    function open(value) {
      if (!value || typeof value !== 'object') return;
      returnFocus = document.activeElement; task = value; editing = null; message = '';
      element.classList.add('on');
      const sheet = query('.sheet');
      sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'trackTitle');
      render(); (query('#trackNext') || query('#closeTrack')).focus();
    }
    function render() {
      if (!task) return;
      const shownTask = task;
      const active = event => task === shownTask && element.classList.contains('on') && (!event || event.currentTarget.isConnected);
      const oldDetails = query('.track-detail'), detailsOpen = oldDetails && oldDetails.open;
      query('#trackTitle').textContent = task.name || '활동 기록';
      const lead = query('.sheetlead');
      if (lead) lead.textContent = '현재 단계의 다음 행동만 누르세요. 필요 없는 단계는 건너뛰며, 측정하지 않은 시간은 미확인으로 남습니다.';
      const next = nextStep(task), logs = logsOf(task), parts = Core.measuredParts ? Core.measuredParts(task) : {};
      const partRows = [
        ['준비', parts.prep, task.prepMin],
        ['이동 전체', `가는 길 ${measuredText(parts.outbound)} · 귀가 ${measuredText(parts.returnTravel)}${parts.legacyReturn !== null && parts.legacyReturn !== undefined ? ` · 기존 귀가(마무리 포함) ${measuredText(parts.legacyReturn)}` : ''}`, task.travelMin],
        ['활동', parts.activity, task.min], ['마무리', parts.wrapUp, task.wrapUpMin]
      ];
      const timelineValid = validTimeline(task, new Date());
      const legacy = !newRoute(task);
      const current = task.routeComplete === true ? '전체 기록 완료' : next ? next.currentLabel : '활동 기록 완료';
      query('#trackStages').innerHTML = `<div class="track-summary"><span>현재 단계</span><strong>${esc(current)}</strong></div>${next ? `<button type="button" class="btn primary track-next" id="trackNext" ${timelineValid ? '' : 'disabled'}>${esc(next.label)}</button><button type="button" class="btn outline" id="trackSkip" ${timelineValid ? '' : 'disabled'}>이 단계 건너뛰기</button>` : '<p class="track-progress">새 기록을 만들지 않고 저장된 시각을 보여줍니다.</p>'}<p class="track-message" role="status">${esc(message || (!timelineValid ? '기록된 시각을 확인해 주세요. 미래 시각이나 순서가 바뀐 기록이 있습니다.' : ''))}</p><details class="track-detail" ${detailsOpen || editing ? 'open' : ''}><summary>기록 확인·수정</summary><div class="track-parts">${partRows.map(([label, actual, planned]) => `<div class="track-part"><strong>${esc(label)}</strong><span class="actual">실제 ${esc(typeof actual === 'string' ? actual : measuredText(actual))}</span><small class="planned">예상 ${esc(plannedText(planned))}</small></div>`).join('')}</div><p class="track-progress">기록한 구간 합계 ${esc(measuredText(parts.total))}${legacy && parts.legacyReturn !== null && parts.legacyReturn !== undefined ? ' · 기존 귀가 기록은 마무리와 귀가 이동을 합친 시간입니다.' : ''}</p><div class="track-records">${STAGES.map(stage => {
        if (own(logs, stage)) return `<button type="button" class="track-record" data-track-edit="${stage}"><b>${esc(LABELS[stage][0])}</b><time>${esc(displayStamp(logs[stage]))}</time><small>${esc(originText(task, stage))} · 터치해서 수정</small></button>${editing && editing.stage === stage ? `<div class="track-edit"><label for="trackEditTime">${esc(LABELS[stage][0])} 실제 시각</label><input type="datetime-local" id="trackEditTime" step="60" value="${esc(editing.value)}" max="${localValue(new Date().toISOString())}"><p class="track-message" id="trackEditPreview" role="status">적용 전에는 기록이 바뀌지 않습니다.</p><div class="actions"><button type="button" class="btn primary" id="trackApplyEdit">적용</button><button type="button" class="btn outline" id="trackCancelEdit">취소</button></div></div>` : ''}`;
        return `<div class="track-record"><b>${esc(LABELS[stage][0])}</b><span>${skipsOf(task).includes(stage) ? '건너뜀 · 미확인' : '미확인'}</span></div>`;
      }).join('')}</div></details>`;
      if (next) {
        query('#trackNext').onclick = event => {
          if (!active(event) || !canRecordStep(task)) return;
          editing = null;
          const result = advance(task, next.key); recordUIStep(task, result); changed(result, 'track-stage');
        };
        query('#trackSkip').onclick = event => {
          if (!active(event) || !canRecordStep(task)) return;
          editing = null;
          const result = skip(task, next.key); recordUIStep(task, result); changed(result, 'track-skip');
        };
      }
      element.querySelectorAll('[data-track-edit]').forEach(button => button.onclick = event => {
        if (!active(event)) return;
        const stage = button.dataset.trackEdit;
        editing = { stage, expectedValue: logs[stage], value: localValue(logs[stage]) }; render(); query('#trackEditTime').focus();
      });
      if (editing) {
        query('#trackEditTime').oninput = event => {
          if (!active(event) || !editing) return;
          editing.value = event.target.value;
          query('#trackEditPreview').textContent = Number.isFinite(new Date(editing.value).getTime()) ? `변경 미리보기 ${displayStamp(new Date(editing.value).toISOString())} · 적용 전입니다` : '시각을 입력해 주세요.';
        };
        query('#trackApplyEdit').onclick = event => {
          if (!active(event) || !editing) return;
          const date = new Date(editing.value), draft = editing;
          if (!Number.isFinite(date.getTime())) { message = '유효한 시각을 입력해 주세요.'; render(); return; }
          const result = edit(task, draft.stage, date.toISOString(), { expectedValue: draft.expectedValue });
          if (result.ok) editing = null;
          changed(result, 'track-edit');
        };
        query('#trackCancelEdit').onclick = event => { if (!active(event) || !editing) return; const stage = editing.stage; editing = null; message = ''; render(); query(`[data-track-edit="${stage}"]`).focus(); };
      }
      query('#undoTrack').disabled = !knownLogs(task).length && !(Array.isArray(task.routeActions) && task.routeActions.length);
      query('#undoTrack').onclick = event => { if (!active(event)) return; editing = null; changed(undo(task), 'track-undo'); };
      query('#closeTrack').onclick = close;
    }
    element.addEventListener('click', event => { if (event.target === element) close(); });
    element.addEventListener('keydown', event => {
      if (!task || !element.classList.contains('on')) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const buttons = [...element.querySelectorAll('button:not([disabled]),input:not([disabled]),summary,[tabindex="0"]')].filter(item => item.getClientRects().length);
      if (!buttons.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return { open, close, render };
  }

  return { nextStep, isOngoing, advance, skip, undo, edit, createUI };
});
