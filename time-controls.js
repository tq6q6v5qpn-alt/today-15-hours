(function (root) {
  'use strict';

  function create(options) {
    const Core = options.Core;
    const currentDate = options.currentDate;
    const calendar = typeof options.calendar === 'function' ? options.calendar : () => ({});
    const sheet = document.getElementById('timeAdjustSheet');
    const title = document.getElementById('timeAdjustTitle');
    const help = document.getElementById('timeAdjustHelp');
    const fields = document.getElementById('timeAdjustFields');
    const preview = document.getElementById('timeAdjustPreview');
    const error = document.getElementById('timeAdjustError');
    const apply = document.getElementById('applyTimeAdjust');
    const cancel = document.getElementById('cancelTimeAdjust');
    let draft = null;
    let source = null;
    let background = [];

    function make(tag, properties = {}, text) {
      const node = document.createElement(tag);
      Object.assign(node, properties);
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function minuteText(minutes) {
      if (minutes === null || !Number.isFinite(minutes)) return '미설정';
      const sign = minutes < 0 ? '−' : '';
      const value = Math.abs(Math.round(minutes));
      const hours = Math.floor(value / 60), mins = value % 60;
      return sign + (hours ? `${hours}시간${mins ? ` ${mins}분` : ''}` : `${mins}분`);
    }

    function shiftedDate(date, offset) {
      const value = new Date(`${date}T12:00:00`);
      if (!Number.isFinite(value.getTime())) return date;
      value.setDate(value.getDate() + offset);
      return Core.keyDate(value);
    }

    function stepper(field, label) {
      const row = make('div', { className: 'time-adjust-stepper' });
      for (const [delta, text] of [[-60, '−1시간'], [-10, '−10분'], [10, '＋10분'], [60, '＋1시간']]) {
        const button = make('button', { type: 'button' }, text);
        button.dataset.timeField = field;
        button.dataset.timeDelta = String(delta);
        button.setAttribute('aria-label', `${label} ${delta < 0 ? '줄이기' : '늘리기'} ${Math.abs(delta) === 60 ? '1시간' : '10분'}`);
        row.append(button);
      }
      return row;
    }

    function inputField(id, field, labelText, type, value, bounds = {}) {
      const section = make('div', { className: 'time-adjust-field' });
      const label = make('label', { htmlFor: id }, labelText);
      const input = make('input', { id, type, value: value ?? '', ...bounds });
      input.required = true;
      if (type === 'number') input.inputMode = 'numeric';
      section.append(label, input, stepper(field, labelText));
      fields.append(section);
      return input;
    }

    function checkbox(id, labelText, checked = false) {
      const section = make('div', { className: 'field' });
      const label = make('label', { htmlFor: id });
      label.style.cssText = 'display:flex;align-items:center;gap:10px;min-height:44px;margin:0;font-size:14px;line-height:1.5';
      const input = make('input', { id, type: 'checkbox', checked });
      input.style.cssText = 'width:24px;min-width:24px;height:24px;min-height:24px;margin:0;padding:0;flex:none';
      label.append(input, make('span', {}, labelText));
      section.append(label);
      fields.append(section);
      return input;
    }

    function lockBackground() {
      background = Array.from(document.querySelectorAll('.app, .sheetbg')).filter(node => node !== sheet).map(node => ({
        node, inert: node.inert, ariaHidden: node.getAttribute('aria-hidden')
      }));
      for (const { node } of background) {
        node.inert = true;
        node.setAttribute('aria-hidden', 'true');
      }
    }

    function close() {
      // Clear the draft before any callback or focus event can apply it twice.
      draft = null;
      sheet.classList.remove('on');
      sheet.setAttribute('aria-hidden', 'true');
      for (const { node, inert, ariaHidden } of background) {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      }
      background = [];
      const previous = source;
      source = null;
      if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
    }

    function begin(kind, titleText, helpText, onApply) {
      const previous = draft ? source : document.activeElement;
      if (draft) close();
      source = previous;
      draft = { kind, date: currentDate(), onApply };
      title.textContent = titleText;
      help.textContent = helpText;
      fields.replaceChildren();
      preview.textContent = '';
      error.textContent = '';
      apply.disabled = false;
      sheet.setAttribute('aria-hidden', 'false');
      sheet.classList.add('on');
      sheet.querySelector('.sheet').scrollTop = 0;
      lockBackground();
      return draft;
    }

    function focusFirst() {
      const field = fields.querySelector('input:not(:disabled)');
      (field || cancel).focus({ preventScroll: true });
    }

    function readDuration() {
      const input = fields.querySelector('#adjustDuration');
      if (!input || input.value.trim() === '') return null;
      const value = Number(input.value);
      return Number.isFinite(value) && Number.isInteger(value) && value >= draft.min && value <= draft.max ? value : null;
    }

    function readSleep() {
      const bedtime = fields.querySelector('#adjustBedtime').value;
      const wakeAt = fields.querySelector('#adjustWakeAt').value;
      const fullDay = fields.querySelector('#adjustFullDay').checked;
      const sleep = Core.sleepFromClocks(bedtime, wakeAt, fullDay);
      return sleep === null ? null : {
        sleep, sleepAt: bedtime,
        sleepAtDayOffset: fields.querySelector('#adjustBedNextDay').checked ? 1 : 0,
        sleepConfirmed: true
      };
    }

    function valueToApply() {
      if (draft.kind === 'sleep') return readSleep();
      if (draft.kind === 'duration') return readDuration();
      if (fields.querySelector('#adjustAutoClock')?.checked) return null;
      const value = fields.querySelector('#adjustClock').value;
      return Core.timeMinute(value) === null ? undefined : value;
    }

    function update() {
      if (!draft) return;
      error.textContent = '';
      let valid = true;
      if (currentDate() !== draft.date) {
        error.textContent = '날짜가 바뀌었어요. 취소하고 선택한 날짜의 시간을 다시 열어주세요.';
        valid = false;
      }
      if (draft.kind === 'sleep') {
        const bed = fields.querySelector('#adjustBedtime');
        const wake = fields.querySelector('#adjustWakeAt');
        const equal = Core.timeMinute(bed.value) !== null && bed.value === wake.value;
        const fullDay = fields.querySelector('#adjustFullDay');
        fullDay.parentElement.parentElement.hidden = !equal;
        if (!equal) fullDay.checked = false;
        const choice = readSleep();
        const bedOffset = fields.querySelector('#adjustBedNextDay').checked ? 1 : 0;
        fields.querySelector('#adjustBedDate').textContent = `${shiftedDate(draft.date, bedOffset)} 취침`;
        if (choice) {
          const candidate = { ...draft.day, ...choice, date: draft.date };
          const settings = Core.sleepSettings(candidate);
          const budget = Core.remaining(candidate);
          const now = new Date();
          const window = Core.dayWindow(candidate, now, calendar());
          const bedtime = Core.bedtimeWindow(candidate, now);
          fields.querySelector('#adjustWakeDate').textContent = `${shiftedDate(draft.date, settings.wakeDayOffset)} 기상`;
          const future = bedtime.relation === 'future';
          const lines = [
            `${minuteText(Math.round(choice.sleep * 60))} 수면 · ${shiftedDate(draft.date, settings.bedtimeDayOffset)} ${settings.bedtime} → ${shiftedDate(draft.date, settings.wakeDayOffset)} ${settings.wakeAt}`,
            `하루 미배정 예산 ${minuteText(budget)}`,
            `${future ? '해당 날짜 전체에서 열린 시간' : window.relation === 'past' ? '해당 날짜의 남은 열린 시간' : '지금부터 열린 시간'} ${minuteText(window.openMinutes)}`,
            future ? `예정 취침 ${shiftedDate(draft.date, settings.bedtimeDayOffset)} ${settings.bedtime}` : `취침까지 ${minuteText(bedtime.remainingMinutes)}`
          ];
          preview.textContent = lines.join(' · ');
        } else {
          valid = false;
          fields.querySelector('#adjustWakeDate').textContent = '기상 날짜는 두 시각을 입력하면 표시됩니다.';
          preview.textContent = '잠드는 시각과 일어나는 시각을 모두 선택해주세요. 적용 전에는 저장된 시간이 바뀌지 않습니다.';
        }
      } else if (draft.kind === 'duration') {
        const value = readDuration();
        valid = valid && value !== null;
        preview.textContent = value === null ? `0 이상의 정수 분을 입력해주세요. 조절 범위 ${draft.min}~${draft.max}분.` : draft.preview ? draft.preview(value) : `예상 소요시간 ${minuteText(value)} · 적용할 때만 바뀝니다.`;
      } else {
        const automatic = fields.querySelector('#adjustAutoClock')?.checked === true;
        const input = fields.querySelector('#adjustClock');
        input.disabled = automatic;
        input.required = !automatic;
        const value = automatic ? null : Core.timeMinute(input.value) === null ? undefined : input.value;
        valid = valid && value !== undefined;
        preview.textContent = value === undefined ? '시각을 선택해주세요. 적용 전에는 저장된 시간이 바뀌지 않습니다.' : draft.preview ? draft.preview(value) : automatic ? '앞선 활동의 끝에 이어서 시작합니다.' : `${draft.date} ${value} 시작 · 적용할 때만 바뀝니다.`;
      }
      for (const button of fields.querySelectorAll('[data-time-field]')) {
        const field = button.dataset.timeField;
        const input = fields.querySelector(field === 'bedtime' ? '#adjustBedtime' : field === 'wakeAt' ? '#adjustWakeAt' : field === 'clock' ? '#adjustClock' : '#adjustDuration');
        button.disabled = !input || input.disabled || (field === 'duration' ? readDuration() === null : Core.timeMinute(input.value) === null);
      }
      apply.disabled = !valid;
    }

    function openSleep(day, onApply) {
      const settings = Core.sleepSettings(day);
      const saved = settings.status === 'saved';
      const legacyPartial = settings.status === 'unset' && (settings.hours !== null || settings.bedtime !== null);
      const legacy = saved || legacyPartial;
      const note = legacy ? '기존 저장값을 그대로 보여드려요. 직접 정한 값인지 자동 기본값인지 구분할 기록이 없어 확인이 필요합니다.' : settings.status === 'unset' ? '정해진 기본값은 없어요. 원하는 취침·기상 시각을 선택해주세요.' : '두 시각을 조절하면 수면 길이와 남은 시간이 함께 바뀝니다.';
      const edit = begin('sleep', '잠드는 시각과 일어나는 시각', `${note} 선택한 날짜: ${currentDate()}.`, onApply);
      edit.day = { ...day };
      inputField('adjustBedtime', 'bedtime', '잠드는 시각', 'time', settings.bedtime, { step: '60' });
      const bedDate = make('p', { id: 'adjustBedDate', className: 'muted' });
      fields.querySelector('#adjustBedtime').parentElement.append(bedDate);
      checkbox('adjustBedNextDay', '선택한 날짜의 다음날에 잠들기', settings.bedtimeDayOffset === 1);
      inputField('adjustWakeAt', 'wakeAt', '일어나는 시각', 'time', settings.wakeAt, { step: '60' });
      const wakeDate = make('p', { id: 'adjustWakeDate', className: 'muted' });
      fields.querySelector('#adjustWakeAt').parentElement.append(wakeDate);
      checkbox('adjustFullDay', '같은 시각을 24시간 수면으로 설정 (해제하면 0시간)', settings.hours === 24);
      update();
      focusFirst();
    }

    function openDuration(config) {
      const edit = begin('duration', config.title || '예상 소요시간 조절', config.contextNote || '시각이 아닌 소요시간입니다. 분을 직접 입력하거나 버튼으로 조절하세요.', config.onApply);
      edit.min = Number.isInteger(config.min) && config.min >= 0 ? config.min : 0;
      edit.max = Number.isInteger(config.max) && config.max >= edit.min ? config.max : 1440;
      edit.preview = config.preview;
      inputField('adjustDuration', 'duration', '소요시간 (분)', 'number', config.value, { min: String(edit.min), max: String(edit.max), step: '1' });
      update();
      focusFirst();
    }

    function openClock(config) {
      const edit = begin('clock', config.title || '시작 시각 조절', `선택한 날짜 ${currentDate()}의 시각입니다. ${config.contextNote || '시간을 직접 입력하거나 버튼으로 조절하세요.'}`, config.onApply);
      edit.preview = config.preview;
      inputField('adjustClock', 'clock', '시작 시각', 'time', Core.timeMinute(config.value) === null ? '' : config.value, { step: '60' });
      if (config.allowAuto) checkbox('adjustAutoClock', '앞선 활동 뒤에 이어서 시작 (자동 시각)', config.auto === true);
      update();
      focusFirst();
    }

    fields.addEventListener('input', update);
    fields.addEventListener('change', update);
    fields.addEventListener('click', event => {
      const button = event.target.closest('[data-time-field]');
      if (!button || !draft || button.disabled) return;
      const field = button.dataset.timeField;
      const delta = Number(button.dataset.timeDelta);
      const input = fields.querySelector(field === 'bedtime' ? '#adjustBedtime' : field === 'wakeAt' ? '#adjustWakeAt' : field === 'clock' ? '#adjustClock' : '#adjustDuration');
      if (field === 'duration') {
        const value = readDuration();
        if (value === null) return;
        input.value = String(Math.min(draft.max, Math.max(draft.min, value + delta)));
      } else {
        if (Core.timeMinute(input.value) === null) return;
        input.value = Core.plus(input.value, delta);
      }
      update();
    });

    apply.addEventListener('click', () => {
      if (!draft) return;
      update();
      if (currentDate() !== draft.date || apply.disabled) {
        if (!error.textContent) error.textContent = draft.kind === 'duration' ? '조절 범위 안의 정수 분을 입력해주세요.' : '시각을 모두 선택해주세요.';
        const invalid = fields.querySelector('input:invalid');
        invalid?.focus({ preventScroll: true });
        invalid?.reportValidity();
        return;
      }
      const result = valueToApply();
      const callback = draft.onApply;
      close();
      if (typeof callback === 'function') callback(result);
    });
    cancel.addEventListener('click', close);
    sheet.addEventListener('click', event => { if (event.target === sheet) close(); });
    document.addEventListener('keydown', event => {
      if (!draft || !sheet.classList.contains('on')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === 'Tab') {
        const targets = Array.from(sheet.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter(node => node.getClientRects().length);
        if (!targets.length) return;
        const first = targets[0], last = targets[targets.length - 1];
        if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) {
          event.preventDefault(); first === last ? first.focus() : last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }, true);
    sheet.setAttribute('aria-hidden', 'true');
    return { openSleep, openDuration, openClock, close };
  }

  root.Today15TimeControls = { create };
})(typeof globalThis !== 'undefined' ? globalThis : window);
