(()=>{'use strict';
const Core=window.Today15Core;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],KEY='today15hours_v2',CALKEY='today15_calendar_v3',METAKEY='today15_meta_v4',FEEDBACKKEY='today15_feedback_v1',SCHEMA=1;
const keyDate=Core.keyDate,taskTotal=Core.taskTotal,plus=Core.plus,diffMinutes=Core.diffMinutes,actualParts=Core.actualParts;
const PRESETS={swim:{name:'수영',activity:60,prep:20,travel:60},read:{name:'독서',activity:60,prep:10,travel:0},media:{name:'게임·만화·영화',activity:120,prep:0,travel:0},cook:{name:'요리',activity:90,prep:20,travel:0},make:{name:'뚝딱뚝딱',activity:60,prep:10,travel:0},bass:{name:'베이스',activity:60,prep:20,travel:60},band:{name:'밴드 활동',activity:180,prep:30,travel:60}};
const TRACK_STAGES=[['prep','준비 시작'],['depart','출발'],['arrive','도착'],['start','활동 시작'],['end','활동 끝'],['return','귀가·다음 장소 도착']];
let calendar=loadCalendar(),state=load(),meta=loadMeta(),feedback=localStorage.getItem(FEEDBACKKEY)||'',editing=null,tracking=null,quickDraft=null,cubeDraft=null,alerts=[],calendarMonth=null,suddenMinutes=30,lastCancelled=null,undoTimer=null,dayGridCount=Number(localStorage.getItem('today15_grid_v1'))||48;
function fresh(date=keyDate()){return{date,sleep:9,sleepAt:'23:30',tasks:[],events:[],start:'08:30',choice:''}}
function loadCalendar(){try{let all=JSON.parse(localStorage.getItem(CALKEY)||'{}'),old=JSON.parse(localStorage.getItem(KEY)||'null');if(old?.date&&!all[old.date])all[old.date]=old;localStorage.setItem(CALKEY,JSON.stringify(all));return all}catch{return{}}}
function prepareDay(day,date){day.date=date;day.sleep??=9;day.sleepAt??='23:30';return day}
function load(){let today=keyDate();return prepareDay(calendar[today]||fresh(today),today)}
function save(){calendar[state.date]=state;localStorage.setItem(CALKEY,JSON.stringify(calendar));localStorage.setItem(KEY,JSON.stringify(state))}
function loadMeta(){try{let x=JSON.parse(localStorage.getItem(METAKEY)||'{}');return{...x,fixed:Array.isArray(x.fixed)?x.fixed:[]}}catch{return{fixed:[]}}}
function saveMeta(){localStorage.setItem(METAKEY,JSON.stringify(meta))}
function stateDate(){return new Date(state.date+'T12:00:00')}
function syncHeader(){let d=stateDate();$('#date').textContent=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(d)}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function minsText(n){let sign=n<0?'−':'';n=Math.abs(n);let h=Math.floor(n/60),m=n%60;return sign+(h?`${h}시간${m?` ${m}분`:''}`:`${m}분`)}
function planned(){return Core.planned(state.tasks)}
function available(){return Core.available(state.sleep)}
function remaining(){return Core.remaining(state)}
function updateBudget(){let r=remaining(),pct=available()>0?Math.max(0,Math.min(100,r/available()*100)):0;$('#remainTop').textContent=minsText(r);$('#remainCard').textContent=minsText(r);$('#budgetFill').style.width=pct+'%';$('#budgetFill').style.background=r<0?'#a8655e':r<120?'#ba8a5e':'linear-gradient(90deg,#477c68,#7eaa94)';$('#overmsg').classList.toggle('on',r<0);
  const windowTime=Core.dayWindow(state,new Date(),calendar);
  $('#futureLabel').textContent=windowTime.relation==='today'?'지금부터 열린 시간':windowTime.relation==='future'?'이 날짜의 열린 시간':'지난 날짜의 열린 시간';
  $('#futureTime').textContent=minsText(windowTime.openMinutes);
  $('#untilMidnight').textContent=windowTime.relation==='today'?`자정까지 ${minsText(windowTime.untilMidnight)}`:windowTime.relation==='past'?'이미 지난 날짜입니다':`${state.date} · 하루 전체 기준`;
  $('#futureNote').textContent=windowTime.relation==='past'?'이 날짜는 끝났습니다. 하루 예산과 기록은 그대로 볼 수 있습니다.':'선택한 날짜의 자정까지 수면과 계획이 없는 구간입니다. 이전 날짜에서 이어진 계획도 반영하고, 겹친 구간은 한 번만 셉니다. 다음 날로 이어지는 계획은 그 날짜에서 반영합니다.';
}
function renderSleep(){
  const hours=Core.sleepHours(state.sleep);
  $('#sleepSummary').textContent=`수면 ${minsText(Math.round(hours*60))} · 하루 24시간`;
  $('#sleepHours').value=hours;$('#sleepAt').value=Core.timeMinute(state.sleepAt)===null?'23:30':state.sleepAt;
  $('#sleepStatus').textContent='';
}
$('#saveSleep').onclick=()=>{
  const input=$('#sleepHours'),time=$('#sleepAt');
  if(!input.value||!input.checkValidity()||!time.value||!time.checkValidity()){input.reportValidity();time.reportValidity();$('#sleepStatus').textContent='수면은 0~24시간, 잠드는 시각도 입력해주세요.';return}
  state.sleep=Number(input.value);state.sleepAt=time.value;save();renderAll();$('#sleepStatus').textContent='이 날짜에 저장했습니다.';
};
let homeDraftPreset=null,homeReturnFocus=null;
function validLog(value){return typeof value==='string'&&value&&Number.isFinite(new Date(value).getTime())}
function homeEntries(){return Object.entries({...calendar,[state.date]:state}).flatMap(([sourceDate,day])=>(day.tasks||[]).map((task,index)=>({sourceDate,task,index})))}
function ongoingEntries(){const now=new Date();return homeEntries().filter(({task})=>validLog(task.logs?.start)&&new Date(task.logs.start)<=now&&!task.logs?.end)}
function taskPicture(task){if(task.kind==='rest'||task.name==='휴식'||task.name==='쉬는 시간')return'🌿';return({수영:'🏊',독서:'📚','게임·만화·영화':'🎮',요리:'🍳',뚝딱뚝딱:'🛠️',베이스:'🎸','밴드 활동':'🎵'})[task.name]||'🎨'}
function renderHomeSleep(){const bedtime=Core.bedtimeWindow(state).bedtime;$('#homeBedtime').value=bedtime;$('#homeSleepHours').value=Core.sleepHours(state.sleep);$('#homeSleepStatus').textContent=''}
function renderHome(){
  const now=new Date(),bed=Core.bedtimeWindow(state,now);
  $('#homeDate').textContent=new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(stateDate());
  $('#homeLabel').textContent=bed.relation==='future'?'이 날짜에 잠들 시각':bed.relation==='past'?'이미 지난 날짜예요':'오늘 잠들기까지 남은 시간';
  $('#homeTime').textContent=bed.relation==='future'?bed.bedtime:minsText(bed.remainingMinutes);
  $('#homeNote').textContent=bed.relation==='past'?'이 날짜는 끝났어요. 기록은 그대로 남아 있어요.':bed.relation==='future'?'미래 날짜의 예정 시각이에요. 실제 남은 시간은 그날 보여드려요.':bed.reached?`${bed.bedtime} 취침 시각이 지났어요. 필요하면 설정을 바꿀 수 있어요.`:`${bed.bedtime}에 잠들기로 했어요. 활동과 휴식이 모두 들어갈 시간이에요.`;
  $('#homeToday').hidden=bed.relation==='today';$('#homeStart').textContent=bed.relation==='today'?'활동 시작':'오늘 활동 시작';
  $('#homeRecords').textContent=bed.relation==='today'?'오늘 기록':'이 날짜 기록';
  const ongoing=ongoingEntries();
  $('#homeActive').innerHTML=(ongoing.length&&bed.relation!=='today'?'<p class="home-empty">지금 이어지는 활동이에요. 마치면 오늘에 기록해요.</p>':'')+ongoing.map(({sourceDate,task,index})=>`<div class="home-active-item"><div><b><span aria-hidden="true">${taskPicture(task)}</span> ${esc(task.name)}</b><p>지금 하고 있어요${sourceDate!==keyDate()?' · 이전 날짜에서 이어짐':''}</p></div><div class="home-active-actions"><button data-home-finish="${index}" data-source-date="${sourceDate}">마치기</button></div></div>`).join('');
  const memories=Core.completedTasks({...calendar,[state.date]:state},state.date,now);
  $('#homeMemories').innerHTML=memories.length?memories.map(task=>`<span class="home-memory ${taskPicture(task)==='🌿'?'rest':''}" role="img" aria-label="${esc(task.name)} · 마친 기록"><span aria-hidden="true">${taskPicture(task)}</span><span>${esc(task.name)}</span></span>`).join(''):'<p class="home-empty">쉬어도, 무언가 해도 좋아요. 마친 활동과 휴식이 여기에 남아요.</p>';
  bindHomeFinish($('#homeActive'));
}
function recordHomeEvent(day,type,task){day.events=Array.isArray(day.events)?day.events:[];day.events.push({id:String(Date.now()+Math.random()),type,taskId:task.id,name:task.name,at:new Date().toISOString()})}
function bindHomeFinish(container){container.querySelectorAll('[data-home-finish]').forEach(button=>button.onclick=()=>finishHomeTask(button.dataset.sourceDate,+button.dataset.homeFinish))}
function finishHomeTask(sourceDate,index){
  const day=sourceDate===state.date?state:calendar[sourceDate],task=day?.tasks?.[index];
  if(!task||!validLog(task.logs?.start)||new Date(task.logs.start)>new Date()||task.logs?.end)return;
  if(state.date!==keyDate())chooseDate(keyDate());
  task.logs.end=new Date().toISOString();recordHomeEvent(day,'completed',task);save();renderAll();closeHomeStart();showView('homeView');
}
function closeHomeStart(){const sheet=$('#homeStartSheet');sheet.classList.remove('on');sheet.setAttribute('aria-hidden','true');homeDraftPreset=null;if(homeReturnFocus?.isConnected)homeReturnFocus.focus()}
function checkHomeStartDate(){if(state.date===keyDate())return true;chooseDate(keyDate());showView('homeView');alert('날짜가 바뀌었어요. 오늘 화면에서 활동 시작을 다시 눌러주세요.');return false}
function startHomeTask(index){
  if(!$('#homeStartSheet').classList.contains('on')||!checkHomeStartDate())return;
  const task=state.tasks[index];if(!task||task.logs?.start||task.logs?.end)return;
  task.logs={...(task.logs||{}),start:new Date().toISOString()};recordHomeEvent(state,'started',task);save();renderAll();closeHomeStart();
}
function renderHomeStartList(){
  const ongoing=ongoingEntries().map(({sourceDate,task,index})=>`<div class="home-active-item"><b>${esc(task.name)} · 진행 중</b><div class="home-active-actions"><button data-home-finish="${index}" data-source-date="${sourceDate}">마치기</button></div></div>`).join('');
  const pending=state.tasks.map((task,index)=>!task.logs?.start&&!task.logs?.end?`<button class="btn outline" data-home-start="${index}">${esc(task.name)} 시작 · 전체 ${minsText(taskTotal(task))}</button>`:'').join('');
  const now=new Date(),review=state.tasks.map((task,index)=>{
    const start=task.logs?.start,end=task.logs?.end;
    const needsReview=(start&&(!validLog(start)||new Date(start)>now))||(end&&(!validLog(end)||new Date(end)>now||(validLog(start)&&new Date(end)<new Date(start))));
    return needsReview?`<button class="btn outline" data-home-review="${index}">${esc(task.name)} · 기록된 시각 확인</button>`:'';
  }).join('');
  $('#homeStartList').innerHTML=ongoing+pending+review+'<p class="sheetlead" id="homeStartPresetHint">새 활동이나 휴식을 골라 시작할 수도 있어요.</p>';
  $('#homeStartList').querySelectorAll('[data-home-start]').forEach(button=>button.onclick=()=>startHomeTask(+button.dataset.homeStart));bindHomeFinish($('#homeStartList'));
  $('#homeStartList').querySelectorAll('[data-home-review]').forEach(button=>button.onclick=()=>{closeHomeStart();showView('todayView');openTrack(+button.dataset.homeReview)});
}
function openHomeStart(){
  if(state.date!==keyDate())chooseDate(keyDate());showView('homeView');homeReturnFocus=document.activeElement;homeDraftPreset=null;
  $('#homeNewName').value='';$('#homeNewMinutes').value=30;$$('[data-home-preset]').forEach(button=>button.classList.remove('on'));
  renderHomeStartList();$('#homeStartSheet').classList.add('on');$('#homeStartSheet').setAttribute('aria-hidden','false');$('#homeStartSheet button').focus();
}
$('#homeStart').onclick=openHomeStart;$('#closeHomeStart').onclick=closeHomeStart;
$('#homeStartSheet').onclick=event=>{if(event.target===$('#homeStartSheet'))closeHomeStart()};
$('#homeStartSheet').onkeydown=event=>{
  if(event.key==='Escape'){event.preventDefault();closeHomeStart();return}
  if(event.key!=='Tab')return;const controls=[...$('#homeStartSheet').querySelectorAll('button,input')].filter(el=>!el.disabled&&el.offsetParent!==null),first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
};
$('#homeStartPresets').onclick=event=>{
  const button=event.target.closest('[data-home-preset]');if(!button)return;
  homeDraftPreset=button.dataset.homePreset==='rest'?{name:'휴식',activity:30,prep:0,travel:0,kind:'rest'}:{...PRESETS[button.dataset.homePreset]};
  if(!homeDraftPreset)return;$('#homeNewName').value=homeDraftPreset.name;$('#homeNewMinutes').value=homeDraftPreset.activity;
  $$('[data-home-preset]').forEach(item=>item.classList.toggle('on',item===button));
  $('#homeStartPresetHint').textContent=`예상 준비 ${minsText(homeDraftPreset.prep)} · 이동 전체 ${minsText(homeDraftPreset.travel)}도 계획에 포함해요. 실제 경로는 따로 기록할 수 있어요.`;
};
$('#homeNewName').oninput=()=>{homeDraftPreset=null;$$('[data-home-preset]').forEach(item=>item.classList.remove('on'));$('#homeStartPresetHint').textContent='직접 적은 활동은 준비·이동 없이 시작해요. 자세한 계획에서 조정할 수 있어요.'};
$('#homeNewStart').onclick=()=>{
  if(!$('#homeStartSheet').classList.contains('on')||!checkHomeStartDate())return;
  const name=$('#homeNewName').value.trim(),input=$('#homeNewMinutes');
  if(!name){$('#homeNewName').focus();return}if(!input.value||!input.checkValidity()){input.reportValidity();return}
  const now=new Date(),task=addTask(name,Number(input.value),homeDraftPreset?.prep||0,homeDraftPreset?.travel||0,'sudden',`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`);
  if(homeDraftPreset?.kind==='rest')task.kind='rest';task.logs.start=now.toISOString();recordHomeEvent(state,'started',task);save();renderAll();closeHomeStart();
};
$('#goHome').onclick=()=>showView('homeView');$('#homeDetails').onclick=()=>showView('planView');$('#homeRecords').onclick=()=>showView('todayView');$('#homeToday').onclick=()=>{chooseDate(keyDate());showView('homeView')};
$('#openHomeSleep').onclick=()=>{const settings=$('#homeSleepSettings');settings.hidden=!settings.hidden;$('#openHomeSleep').setAttribute('aria-expanded',String(!settings.hidden));if(!settings.hidden)$('#homeBedtime').focus()};
$('#saveHomeSleep').onclick=()=>{
  const hours=$('#homeSleepHours'),bedtime=$('#homeBedtime');
  if(!hours.value||!hours.checkValidity()||!bedtime.value||!bedtime.checkValidity()){hours.reportValidity();bedtime.reportValidity();$('#homeSleepStatus').textContent='수면은 0~24시간, 잠드는 시각도 입력해주세요.';return}
  state.sleep=Number(hours.value);state.sleepAt=bedtime.value;save();renderAll();$('#homeSleepStatus').textContent='이 날짜에 저장했어요.';
};
function renderDayMap(){
  const colors=['#2f8065','#cb7a3a','#537ba3','#7b64a8','#bc5965','#6e8741','#9b6b42'];
  const sleepMin=Math.round(Core.sleepHours(state.sleep)*60),named=planned(),left=remaining(),rows=schedule();
  const openColor='#e7e5dd',occupancy=Core.dayOccupancy(state,calendar);
  const minuteColors=occupancy.map(value=>value===null?openColor:value==='sleep'?'#263d55':value==='previous'?'#537ba3':colors[value%colors.length]);
  const now=new Date(),todayKey=keyDate(),today=state.date===todayKey,pastDay=state.date<todayKey,nowMinute=now.getHours()*60+now.getMinutes(),preciseMinute=nowMinute+now.getSeconds()/60;
  const statusColors=minuteColors.map((color,minute)=>{
    if(pastDay||(today&&minute<preciseMinute))return'#a9635d';
    return color===openColor?'#e8c968':'#5d9278';
  });
  const cellMinutes=1440/dayGridCount;
  const cellColor=(start,end)=>{
    const first=Math.floor(start),last=Math.ceil(end),runs=[];
    for(let minute=first;minute<last;minute++){
      const color=statusColors[Math.min(1439,minute)];
      if(runs.at(-1)?.color===color)runs.at(-1).size+=1;
      else runs.push({color,size:1});
    }
    if(runs.length===1)return runs[0].color;
    let used=0,parts=[];
    runs.forEach(run=>{const from=used/(last-first)*100;used+=run.size;const to=used/(last-first)*100;parts.push(`${run.color} ${from}% ${to}%`)});
    return`linear-gradient(90deg,${parts.join(',')})`;
  };
  const cells=Array.from({length:dayGridCount},(_,index)=>{
    const start=index*cellMinutes,end=start+cellMinutes;
    const current=today&&preciseMinute>=start&&preciseMinute<end;
    const elapsed=today&&end<=preciseMinute;
    const progress=current?Math.max(0,Math.min(100,(preciseMinute-start)/(end-start)*100)):0;
    const title=`${plus('00:00',start)}~${plus('00:00',end%1440)}`;
    const label=dayGridCount===24?String(Math.floor(start/60)).padStart(2,'0'):dayGridCount===48&&index%2===0?String(Math.floor(start/60)).padStart(2,'0'):dayGridCount===48?'·':'';
    const hourStart=dayGridCount===1440&&index%60===0;
    return`<button type="button" class="cube ${elapsed?'elapsed ':''}${current?'current ':''}${hourStart?'hour-start':''}" style="background:${cellColor(start,end)};--elapsed:${progress}%" data-cube-start="${start}" data-cube-duration="${cellMinutes}" data-hour="${hourStart?String(Math.floor(start/60)).padStart(2,'0'):''}" aria-label="${title} 계획하기"><span>${label}</span></button>`;
  }).join('');
  const taskRows=state.tasks.map((task,index)=>{
    const total=taskTotal(task),width=Math.max(1,Math.min(100,total/1440*100)),row=rows[index];
    return `<div class="allocation-row"><div class="allocation-name"><span style="background:${colors[index%colors.length]}"></span><b>${esc(task.name)}</b><time>${displayTime(row.start)} · ${minsText(total)}</time></div><div class="allocation-track"><i style="width:${width}%;background:${colors[index%colors.length]}"></i></div></div>`;
  }).join('');
  const unit=dayGridCount===24?'1시간':dayGridCount===48?'30분':'1분';
  const active=rows.find(task=>nowMinute>=task.startMinute&&nowMinute<task.endMinute);
  const nowBlock=today?`<div class="now-coordinate"><div><small>지금 여기</small><strong>${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}</strong></div><div><b>오늘의 ${(nowMinute+1).toLocaleString('ko-KR')}번째 분</b><span>${active?esc(active.name):occupancy[nowMinute]==='sleep'?'수면':occupancy[nowMinute]==='previous'?'이전 날짜에서 이어진 계획':'열린 시간'} · 자정까지 ${minsText(Math.floor(1440-preciseMinute))}</span></div></div>`:`<div class="viewing-date">선택한 날짜의 00:00부터 23:59까지</div>`;
  $('#dayMap').innerHTML=`<div class="grid-switch" aria-label="시간 격자 단위"><button data-grid-count="24" class="${dayGridCount===24?'on':''}">24칸</button><button data-grid-count="48" class="${dayGridCount===48?'on':''}">48칸</button><button data-grid-count="1440" class="${dayGridCount===1440?'on':''}">1분 × 1,440</button></div>${nowBlock}<div class="cube-legend"><span class="past">지남</span><span class="planned">계획</span><span class="open">열림</span></div><div class="time-axis"><span>00시</span><span>06시</span><span>12시</span><span>18시</span><span>24시</span></div><div class="time-cube-board cubes-${dayGridCount} ${left<0?'over':''}" role="group" aria-label="00시부터 23시 59분까지의 24시간 격자. 한 칸 ${unit}. 수면 ${minsText(sleepMin)}, 이름 붙인 시간 ${minsText(named)}, 하루 미배정 예산 ${minsText(left)}">${cells}</div><div class="cube-caption"><b>1칸 = ${unit}</b><span>큐브를 누르면 그 시각에 계획을 놓습니다</span></div><div class="cube-insight"><small>오늘의 바닥 단위</small><strong>평범한 하루 안에 실제로<br><em>1,440개의 작은 선택지</em>가 있었다는 사실.</strong></div><div class="day-numbers cube-numbers"><div><small>수면</small><strong>${minsText(sleepMin)}</strong></div><div><small>이름 붙인 시간</small><strong>${minsText(named)}</strong></div><div class="${left<0?'negative':''}"><small>하루 미배정 예산</small><strong>${minsText(left)}</strong></div></div>${taskRows?`<div class="allocation-list">${taskRows}</div>`:'<div class="day-empty">노란 큐브를 눌러 계획을 놓아보세요.<br>저장하면 그 시간이 초록색으로 바뀝니다.</div>'}<p class="day-principle">빨강은 지나온 좌표, 초록은 정한 시간, 노랑은 아직 선택할 수 있는 자리입니다.</p>`;
  $$('[data-grid-count]').forEach(button=>button.onclick=()=>{dayGridCount=+button.dataset.gridCount;localStorage.setItem('today15_grid_v1',String(dayGridCount));renderDayMap()});
  $('.time-cube-board').onclick=event=>{
    const cube=event.target.closest('[data-cube-start]');if(!cube)return;
    const start=+cube.dataset.cubeStart,duration=+cube.dataset.cubeDuration,end=start+duration;
    const clickNow=new Date(),clickToday=keyDate(clickNow),clickMinute=clickNow.getHours()*60+clickNow.getMinutes()+clickNow.getSeconds()/60;
    if(state.date<clickToday||(state.date===clickToday&&end<=clickMinute)){alert('이미 지나온 큐브입니다. 노란색이나 초록색 큐브를 선택해주세요.');return}
    const chosenStart=state.date===clickToday&&start<clickMinute?Math.ceil(clickMinute):start;
    if(chosenStart>=1440){alert('이 날짜에는 온전한 1분이 남아 있지 않습니다. 다음 날짜를 선택해주세요.');return}
    openCubePlan(chosenStart,Math.max(1,end-chosenStart));
  };
}
function renderTasks(){let box=$('#taskList');box.innerHTML=state.tasks.length?state.tasks.map((t,i)=>`<button class="task ${remaining()<0?'over':''}" data-focus="${i}"><div class="tasktop"><span class="dot"></span><b>${esc(t.name)}</b>${t.origin==='sudden'?'<span class="live-badge">지금 생김</span>':''}</div>${t.focus?.question?`<p>${esc(t.focus.question)}</p>`:'<p>눌러서 시작과 끝을 선명하게 만들기</p>'}<div class="taskbreak"><span>활동 ${minsText(t.min)}</span>${t.prepMin?`<span>준비 ${minsText(t.prepMin)}</span>`:''}${t.travelMin?`<span>이동 ${minsText(t.travelMin)}</span>`:''}<span>전체 ${minsText(taskTotal(t))}</span></div><span class="del" data-del="${i}">×</span></button>`).join(''):'<div class="empty">아직 떼어놓은 시간이 없습니다.<br>위의 빠른 버튼부터 눌러보세요.</div>';$$('[data-del]').forEach(b=>b.onclick=e=>{e.stopPropagation();cancelTask(+b.dataset.del)});$$('[data-focus]').forEach(b=>b.onclick=()=>openFocus(+b.dataset.focus))}
function renderAll(){syncHeader();renderSleep();renderHomeSleep();updateBudget();renderHome();renderDayMap();renderTasks();renderToday();renderFocus();renderCalendar()}
function addTask(name,min,prepMin=0,travelMin=0,origin='planned',start=null){if(!name)return;let task={id:Date.now()+Math.random(),name,min,prepMin,travelMin,origin,focus:null,logs:{}};if(start)task.start=start;state.tasks.push(task);if(origin==='sudden')recordEvent('added',task,{minutes:min});save();renderAll();return task}
function recordEvent(type,task,detail={}){state.events=Array.isArray(state.events)?state.events:[];state.events.push({id:String(Date.now()+Math.random()),type,taskId:task.id,name:task.name,at:new Date().toISOString(),...detail})}
function cancelTask(index){let task=state.tasks[index];if(!task)return;lastCancelled={task,index,date:state.date};state.tasks.splice(index,1);recordEvent('cancelled',task,{minutes:taskTotal(task)});save();renderAll();$('#undoText').textContent=`${task.name} 취소 · ${minsText(taskTotal(task))} 돌아옴`;$('#undoToast').classList.add('on');clearTimeout(undoTimer);undoTimer=setTimeout(()=>{$('#undoToast').classList.remove('on');lastCancelled=null},8000)}
function adjustTask(index,delta){let task=state.tasks[index];if(!task)return;let before=task.min;task.min=Math.max(10,Math.min(720,before+delta));if(task.min===before)return;recordEvent(task.min>before?'extended':'shortened',task,{delta:task.min-before,minutes:task.min});save();renderAll();if(navigator.vibrate)navigator.vibrate(12)}
syncHeader();
function renderQuick(){if(!quickDraft)return;$('#quickTitle').textContent=quickDraft.name;$('#quickActivity').textContent=minsText(quickDraft.activity);$('#quickPrep').textContent=minsText(quickDraft.prep);$('#quickTravel').textContent=minsText(quickDraft.travel)}
$('#quick').onclick=e=>{let b=e.target.closest('[data-preset]');if(!b)return;quickDraft={...PRESETS[b.dataset.preset]};renderQuick();$('#quickSheet').classList.add('on')};
$$('[data-adjust]').forEach(button=>button.onclick=()=>{let[field,delta]=button.dataset.adjust.split(',');quickDraft[field]=Math.max(field==='activity'?10:0,quickDraft[field]+Number(delta));renderQuick()});
$('#addQuick').onclick=()=>{if(!quickDraft||!$('#quickSheet').classList.contains('on'))return;addTask(quickDraft.name,quickDraft.activity,quickDraft.prep,quickDraft.travel);quickDraft=null;$('#quickSheet').classList.remove('on')};$('#closeQuick').onclick=()=>$('#quickSheet').classList.remove('on');$('#quickSheet').onclick=e=>{if(e.target===$('#quickSheet'))$('#quickSheet').classList.remove('on')};
function renderSudden(){suddenMinutes=Math.max(10,Math.min(360,suddenMinutes));$('#suddenRange').value=suddenMinutes;$('#suddenTime').textContent=minsText(suddenMinutes);let after=remaining()-suddenMinutes;$('#suddenRemain').textContent=minsText(after);$('#suddenPreview').classList.toggle('over',after<0)}
$('#openSudden').onclick=()=>{if(state.date!==keyDate())chooseDate(keyDate());suddenMinutes=30;$('#suddenName').value='식사';$$('[data-sudden]').forEach((b,i)=>b.classList.toggle('on',i===0));renderSudden();$('#suddenSheet').classList.add('on')};
$('#closeSudden').onclick=()=>$('#suddenSheet').classList.remove('on');$('#suddenSheet').onclick=e=>{if(e.target===$('#suddenSheet'))$('#suddenSheet').classList.remove('on')};
$('#suddenPresets').onclick=e=>{let b=e.target.closest('[data-sudden]');if(!b)return;$$('[data-sudden]').forEach(x=>x.classList.toggle('on',x===b));$('#suddenName').value=b.dataset.sudden==='기타'?'':b.dataset.sudden;$('#suddenName').focus()};
$('#suddenRange').oninput=e=>{suddenMinutes=+e.target.value;renderSudden()};
$$('[data-sudden-adjust]').forEach(button=>button.onclick=()=>{suddenMinutes+=+button.dataset.suddenAdjust;renderSudden();if(navigator.vibrate)navigator.vibrate(10)});
$('#addSudden').onclick=()=>{if(!$('#suddenSheet').classList.contains('on'))return;if(state.date!==keyDate()){chooseDate(keyDate());alert('날짜가 바뀌었습니다. 오늘 날짜에서 지금 생김을 다시 열어주세요.');return}let name=$('#suddenName').value.trim();if(!name){$('#suddenName').focus();return}let now=new Date(),start=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;addTask(name,suddenMinutes,0,0,'sudden',start);$('#suddenSheet').classList.remove('on');showView('todayView')};
function renderCubePlan(){
  if(!cubeDraft)return;
  const start=plus('00:00',cubeDraft.start),end=plus(start,cubeDraft.duration);
  $('#cubePlanTime').textContent=`${start}~${end}`;
  $('#cubePlanDuration').textContent=minsText(cubeDraft.duration);
}
function openCubePlan(start,duration){
  cubeDraft={start,duration:Math.max(1,Math.round(duration))};
  $('#cubePlanName').value='';
  $$('[data-cube-name]').forEach(button=>button.classList.remove('on'));
  renderCubePlan();
  $('#cubePlanSheet').classList.add('on');
}
$('#cubePlanPresets').onclick=event=>{
  const button=event.target.closest('[data-cube-name]');if(!button)return;
  $('#cubePlanName').value=button.dataset.cubeName;
  $$('[data-cube-name]').forEach(item=>item.classList.toggle('on',item===button));
};
$$('[data-cube-adjust]').forEach(button=>button.onclick=()=>{cubeDraft.duration=Math.max(1,Math.min(720,cubeDraft.duration+Number(button.dataset.cubeAdjust)));renderCubePlan()});
$('#saveCubePlan').onclick=()=>{
  if(!cubeDraft||!$('#cubePlanSheet').classList.contains('on'))return;
  const name=$('#cubePlanName').value.trim();if(!name){$('#cubePlanName').focus();return}
  if(state.date<keyDate()){alert('날짜가 바뀌었습니다. 다음 날짜에서 계획해주세요.');return}
  addTask(name,cubeDraft.duration,0,0,'planned',plus('00:00',cubeDraft.start));cubeDraft=null;
  $('#cubePlanSheet').classList.remove('on');
};
$('#closeCubePlan').onclick=()=>$('#cubePlanSheet').classList.remove('on');
$('#cubePlanSheet').onclick=event=>{if(event.target===$('#cubePlanSheet'))$('#cubePlanSheet').classList.remove('on')};
$('#undoCancel').onclick=()=>{if(!lastCancelled||lastCancelled.date!==state.date)return;state.tasks.splice(Math.min(lastCancelled.index,state.tasks.length),0,lastCancelled.task);recordEvent('restored',lastCancelled.task,{minutes:taskTotal(lastCancelled.task)});lastCancelled=null;clearTimeout(undoTimer);$('#undoToast').classList.remove('on');save();renderAll()};
$('#add').onclick=()=>{let n=$('#taskName').value.trim();if(!n){$('#taskName').focus();return}addTask(n,+$('input[name=dur]:checked').value,Math.max(0,+$('#directPrep').value||0),Math.max(0,+$('#directTravel').value||0));$('#taskName').value='';$('#directPrep').value=0;$('#directTravel').value=0};
function openFocus(i){editing=i;let t=state.tasks[i];$('#sheetTitle').textContent=t.name;$('#focusQuestion').value=t.focus?.question||'';$('#firstMove').value=t.focus?.first||'';$('#finishLine').value=t.focus?.finish||'';$('#focusSheet').classList.add('on')}
$('#closeSheet').onclick=()=>$('#focusSheet').classList.remove('on');$('#focusSheet').onclick=e=>{if(e.target===$('#focusSheet'))$('#focusSheet').classList.remove('on')};$('#saveFocus').onclick=()=>{if(editing===null)return;state.tasks[editing].focus={question:$('#focusQuestion').value.trim(),first:$('#firstMove').value.trim(),finish:$('#finishLine').value.trim()};save();$('#focusSheet').classList.remove('on');renderAll();showView('focusView')};
function wakeTime(){return Core.wakeTime(state)}
function displayTime(t){let[h,m]=t.split(':').map(Number);return`${h<12?'오전':'오후'} ${h%12||12}:${String(m).padStart(2,'0')}`}
function schedule(){return Core.schedule(state)}
function moveTask(from,to){if(from===to||to<0||to>=state.tasks.length)return;let [item]=state.tasks.splice(from,1);state.tasks.splice(to,0,item);save();renderAll()}
function bindTodayEditing(){
  $$('.timeedit').forEach(input=>input.onchange=()=>{let i=+input.dataset.timeIndex;state.tasks[i].start=input.value||null;save();renderAll()});
  $$('[data-move-task]').forEach(button=>button.onclick=()=>moveTask(+button.dataset.moveTask,+button.dataset.to));
  $$('[data-auto-time]').forEach(button=>button.onclick=()=>{delete state.tasks[+button.dataset.autoTime].start;save();renderAll()});
  $$('.draghandle').forEach(handle=>{
    let timer=null,active=false,target=+handle.dataset.dragIndex,startX=0,startY=0;
    const clear=()=>{if(timer)clearTimeout(timer);timer=null};
    handle.oncontextmenu=e=>e.preventDefault();
    handle.onpointerdown=e=>{startX=e.clientX;startY=e.clientY;target=+handle.dataset.dragIndex;handle.setPointerCapture?.(e.pointerId);timer=setTimeout(()=>{active=true;handle.closest('.sortslot').classList.add('dragging');if(navigator.vibrate)navigator.vibrate(25)},450)};
    handle.onpointermove=e=>{if(!active){if(Math.hypot(e.clientX-startX,e.clientY-startY)>9)clear();return}e.preventDefault();let row=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-slot-index]');if(row){target=+row.dataset.slotIndex;$$('.sortslot').forEach(x=>x.classList.toggle('drop-target',+x.dataset.slotIndex===target))}};
    const finish=e=>{clear();if(active){e.preventDefault();let from=+handle.dataset.dragIndex;active=false;moveTask(from,target)}};
    handle.onpointerup=finish;handle.onpointercancel=finish;
  });
}
function openTrack(i){tracking=i;state.tasks[i].logs={...(state.tasks[i].logs||{})};$('#trackTitle').textContent=state.tasks[i].name;renderTrack();$('#trackSheet').classList.add('on')}
function renderTrack(){let task=state.tasks[tracking],logs=task.logs||{};$('#trackStages').innerHTML=TRACK_STAGES.map(([key,label],i)=>`<button class="track-stage ${logs[key]?'done':''}" data-track-stage="${key}"><span class="stage-no">${logs[key]?'✓':i+1}</span><b>${label}</b><time>${logs[key]?new Date(logs[key]).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'탭해서 기록'}</time></button>`).join('');$$('[data-track-stage]').forEach(button=>button.onclick=()=>{task.logs[button.dataset.trackStage]=new Date().toISOString();save();renderTrack();renderToday()})}
$('#undoTrack').onclick=()=>{if(tracking===null)return;let logs=state.tasks[tracking].logs||{},last=Object.entries(logs).sort((a,b)=>new Date(b[1])-new Date(a[1]))[0];if(last){delete logs[last[0]];save();renderTrack();renderToday()}};$('#closeTrack').onclick=()=>$('#trackSheet').classList.remove('on');$('#trackSheet').onclick=e=>{if(e.target===$('#trackSheet'))$('#trackSheet').classList.remove('on')};
function renderToday(){let rows=schedule(),body=$('#todayBody');body.innerHTML=state.tasks.length?`<div class="today-card"><div class="tiny">${esc(state.date)} · 기상 ${displayTime(wakeTime())}</div><h2>오늘 가진 것부터</h2><p class="edit-hint">손잡이를 길게 눌러 옮기고, 갑자기 달라진 시간은 10분씩 바로 조절하세요.</p><div class="timeline">${rows.map((t,i)=>`<div class="slot sortslot ${t.origin==='sudden'?'live-new':''}" data-slot-index="${i}"><button class="draghandle" data-drag-index="${i}" aria-label="${esc(t.name)} 순서 옮기기">⠿</button><div><input class="timeedit clock" data-time-index="${i}" type="time" value="${t.start}" aria-label="${esc(t.name)} 전체 시작 시각">${t.startMinute>=1440?`<div class="manualmark">${Math.floor(t.startMinute/1440)}일 뒤 시작</div>`:''}${state.tasks[i].start?'<div class="manualmark">직접 지정</div>':''}</div><div><b>${esc(t.name)}</b>${t.origin==='sudden'?'<span class="live-badge">지금 생김</span>':''}<small>전체 ${minsText(taskTotal(t))} · 활동 ${minsText(t.min)}${t.prepMin?` · 준비 ${minsText(t.prepMin)}`:''}${t.travelMin?` · 이동 ${minsText(t.travelMin)}`:''}${t.focus?.finish?`<br>${esc(t.focus.finish)}`:''}</small><div class="resizebuttons"><button data-resize="${i}" data-delta="-10" aria-label="${esc(t.name)} 10분 줄이기">−10분</button><button data-resize="${i}" data-delta="10" aria-label="${esc(t.name)} 10분 늘리기">＋10분</button><button class="cancel-live" data-cancel="${i}">취소</button></div><button class="track-btn" data-open-track="${i}">${Object.keys(t.logs||{}).length?`경로 ${Object.keys(t.logs).length}단계 기록 중`:'준비·출발·도착 기록'}</button><div class="movebuttons"><button data-move-task="${i}" data-to="${i-1}" ${i===0?'disabled':''} aria-label="위로 이동">↑</button><button data-move-task="${i}" data-to="${i+1}" ${i===rows.length-1?'disabled':''} aria-label="아래로 이동">↓</button>${state.tasks[i].start?`<button data-auto-time="${i}">자동 시각</button>`:''}</div></div></div>`).join('')}</div><div class="notice">하루 미배정 예산은 <strong>${minsText(remaining())}</strong>입니다. 이미 지난 시간도 포함하며, 지금부터 열린 시간은 시간 탭에서 확인할 수 있습니다.</div></div>`:'<div class="empty">먼저 ‘시간 떼기’에서 오늘의 시간을 놓아주세요.</div>';bindTodayEditing();$$('[data-open-track]').forEach(button=>button.onclick=()=>openTrack(+button.dataset.openTrack));$$('[data-resize]').forEach(button=>button.onclick=()=>adjustTask(+button.dataset.resize,+button.dataset.delta));$$('[data-cancel]').forEach(button=>button.onclick=()=>cancelTask(+button.dataset.cancel))}
function renderFocus(){let items=state.tasks.filter(t=>t.focus&&(t.focus.question||t.focus.first||t.focus.finish));$('#focusBody').innerHTML=items.length?items.map(t=>`<div class="focuscard" style="margin-bottom:12px"><div class="tiny">${esc(t.name)} · ${minsText(t.min)}</div><div class="k">이번에 붙들 것</div><div class="v">${esc(t.focus.question||'정하지 않음')}</div><div class="k">첫 행동</div><div class="v">${esc(t.focus.first||'가장 작은 행동부터')}</div><div class="finish">끝나는 기준 · ${esc(t.focus.finish||'시간이 되면 멈추고 남은 곳 표시')}</div></div>`).join(''):'<div class="empty">계획 화면에서 활동 하나를 누르면<br>질문·첫 행동·끝나는 기준을 붙일 수 있어요.</div>'}
function chooseDate(date){save();clearTransient();state=prepareDay(calendar[date]||fresh(date),date);calendar[state.date]=state;calendarMonth=new Date(date+'T12:00:00');renderAll()}
function clearTransient(){lastCancelled=null;clearTimeout(undoTimer);$('#undoToast').classList.remove('on');$$('.sheetbg').forEach(sheet=>sheet.classList.remove('on'));$('#homeStartSheet').setAttribute('aria-hidden','true');editing=null;tracking=null;quickDraft=null;cubeDraft=null}
function fixedFor(date){let md=date.slice(5);return(meta.fixed||[]).filter(item=>item.date===date||(item.yearly&&item.date.slice(5)===md))}
function renderAnalytics(y,m){let entries=Object.values(calendar).filter(day=>{let d=new Date(day.date+'T12:00:00');return d.getFullYear()===y&&d.getMonth()===m}),plannedTotal=0,actual=0,transition=0,trackedAvailable=0,byName={};entries.forEach(day=>{let hasActual=false;(day.tasks||[]).forEach(t=>{plannedTotal+=taskTotal(t);byName[t.name]=(byName[t.name]||0)+taskTotal(t);let a=actualParts(t);actual+=a.total;transition+=a.prep+a.travel;if(a.total)hasActual=true});if(hasActual)trackedAvailable+=Core.available(day.sleep ?? 9)});let unknown=Math.max(0,trackedAvailable-actual),top=Object.entries(byName).sort((a,b)=>b[1]-a[1]).slice(0,5),max=top[0]?.[1]||1;$('#analytics').innerHTML=`<div class="panel analytics-panel"><div class="paneltitle"><span>${m+1}월 시간 보기</span><small>기록 기반</small></div><div class="stat-grid"><div class="stat"><small>계획한 전체</small><strong>${minsText(plannedTotal)}</strong></div><div class="stat"><small>실제로 기록됨</small><strong>${minsText(actual)}</strong></div><div class="stat"><small>실제 준비·이동</small><strong>${minsText(transition)}</strong></div><div class="stat"><small>아직 이름 없는 시간</small><strong>${minsText(unknown)}</strong></div></div>${top.length?`<div class="bar-list">${top.map(([name,min])=>`<div class="bar-row"><span>${esc(name)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.round(min/max*100)}%"></span></span><span>${minsText(min)}</span></div>`).join('')}</div>`:''}<div class="analytics-note">‘이름 없는 시간’은 낭비 판정이 아닙니다. 경로 기록을 남긴 날의 가용시간 중 아직 준비·이동·활동으로 설명되지 않은 부분입니다.</div></div>`}
function renderCalendar(){
  if(!calendarMonth)calendarMonth=stateDate();
  let y=calendarMonth.getFullYear(),m=calendarMonth.getMonth(),first=new Date(y,m,1),days=new Date(y,m+1,0).getDate(),cells=[];
  $('#monthTitle').textContent=`${y}년 ${m+1}월`;
  for(let i=0;i<first.getDay();i++)cells.push('<span class="daycell blank"></span>');
  for(let day=1;day<=days;day++){
    let date=keyDate(new Date(y,m,day)),item=calendar[date],count=item?.tasks?.length||0,choice=!!item?.choice,fixed=fixedFor(date);
    cells.push(`<button class="daycell ${date===keyDate()?'today':''} ${date===state.date?'selected':''}" data-calendar-date="${date}" aria-label="${m+1}월 ${day}일${count?`, 계획 ${count}개`:''}${choice?', 선택 기록 있음':''}${fixed.length?', 고정사항 있음':''}"><span class="daynum">${day}</span><span class="daymarks">${count?`<span class="planmark">${count}</span>`:''}${choice?'<span class="choicemark">◆</span>':''}${fixed.length?'<span class="fixedmark">●</span>':''}</span></button>`);
  }
  $('#monthGrid').innerHTML=cells.join('');
  $$('[data-calendar-date]').forEach(button=>button.onclick=()=>chooseDate(button.dataset.calendarDate));
  let names=state.tasks.slice(0,5).map(t=>`<span>${esc(t.name)}</span>`).join(''),fixed=fixedFor(state.date);
  $('#calendarDetail').innerHTML=`<div class="calendar-date">${new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(stateDate())}</div><div class="calendar-summary">${state.tasks.length?`계획 ${state.tasks.length}개 · ${minsText(planned())}`:'아직 연결된 계획이 없습니다.'}</div>${names?`<div class="calendar-tasks">${names}</div>`:''}<div class="choice-note"><label for="choiceInput">이 좌표에서 내가 한 선택 (선택 사항)</label><div class="choice-help">매일 쓸 필요가 없습니다. 기억하고 싶은 갈림길이 있었던 날에만 한 줄 남깁니다.</div><textarea id="choiceInput" maxlength="180" placeholder="예: 숙소에 남는 대신 해안길을 걸었다.">${esc(state.choice||'')}</textarea><div class="detail-actions"><button class="btn soft" id="saveChoice">선택 남기기</button><button class="btn outline" id="openDatePlan">이 날짜 계획</button></div></div><div class="fixed-section"><label>생일·기념일·변하지 않는 사항</label><div class="fixed-list">${fixed.length?fixed.map(item=>`<div class="fixed-item"><span>${item.yearly?'매년 · ':''}${esc(item.name)}</span><button data-delete-fixed="${item.id}" aria-label="${esc(item.name)} 지우기">×</button></div>`).join(''):'<div class="choice-help">이 날짜에는 아직 고정사항이 없습니다.</div>'}</div><div class="fixed-form"><input id="fixedName" maxlength="60" placeholder="예: 할머니 생일"><button id="addFixed" aria-label="고정사항 추가">＋</button></div><label class="repeat-check"><input id="fixedYearly" type="checkbox"> 해마다 같은 날짜에 표시</label></div>`;
  $('#saveChoice').onclick=()=>{state.choice=$('#choiceInput').value.trim();save();renderCalendar()};
  $('#openDatePlan').onclick=()=>showView('planView');
  $('#addFixed').onclick=()=>{let name=$('#fixedName').value.trim();if(!name)return;meta.fixed.push({id:String(Date.now()),name,date:state.date,yearly:$('#fixedYearly').checked});saveMeta();renderCalendar()};
  $$('[data-delete-fixed]').forEach(button=>button.onclick=()=>{meta.fixed=meta.fixed.filter(item=>item.id!==button.dataset.deleteFixed);saveMeta();renderCalendar()});
  renderAnalytics(y,m);
}
$('#prevMonth').onclick=()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderCalendar()};
$('#nextMonth').onclick=()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderCalendar()};
function showView(id){$$('.view').forEach(v=>v.classList.toggle('on',v.id===id));$$('.nav button').forEach(b=>b.classList.toggle('on',b.dataset.view===id));document.body.classList.toggle('is-home',id==='homeView');if(id==='calendarView')renderCalendar();if(id==='homeView')renderHome();if(id==='planView'){updateBudget();renderDayMap()}scrollTo(0,0)}$$('.nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));$('#makeToday').onclick=()=>showView('todayView');
$('#reset').onclick=()=>{if(confirm('선택한 날짜에 떼어놓은 시간을 모두 비울까요?')){state.tasks=[];save();renderAll()}};
function icsDate(date,minute){let day=new Date(date+'T12:00:00');day.setDate(day.getDate()+Math.floor(minute/1440));return keyDate(day).replaceAll('-','')+'T'+plus('00:00',minute).replace(':','')+'00'}
function makeICS(){let rows=schedule(),stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');let events=rows.map((t,i)=>`BEGIN:VEVENT\r\nUID:${Date.now()}-${i}@today15\r\nDTSTAMP:${stamp}\r\nDTSTART:${icsDate(state.date,t.startMinute)}\r\nDTEND:${icsDate(state.date,t.endMinute)}\r\nSUMMARY:${t.name.replace(/[\\,;]/g,' ')}\r\nDESCRIPTION:${(t.focus?.finish||'정한 시간만큼 하고 다음 칸으로').replace(/[\\,;]/g,' ')}\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nACTION:DISPLAY\r\nDESCRIPTION:10분 뒤 ${t.name.replace(/[\\,;]/g,' ')}\r\nEND:VALARM\r\nEND:VEVENT`).join('\r\n');return`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Today15//KO\r\nCALSCALE:GREGORIAN\r\n${events}\r\nEND:VCALENDAR`}
$('#calendar').onclick=()=>{if(!state.tasks.length)return;let blob=new Blob([makeICS()],{type:'text/calendar;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`오늘15시간_${state.date}.ics`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
$('#notify').onclick=async()=>{if(state.date!==keyDate()){alert('앱 내부 알림은 오늘 날짜에만 켤 수 있습니다. 다른 날짜는 Apple 캘린더에 넣어주세요.');return}if(!('Notification'in window)){alert('이 브라우저에서는 웹 알림을 지원하지 않습니다. Apple 캘린더 내보내기를 사용해주세요.');return}const selectedDate=state.date;let p=await Notification.requestPermission();if(p!=='granted'){alert('알림 권한이 허용되지 않았습니다. 캘린더 알림을 사용해주세요.');return}if(state.date!==selectedDate||state.date!==keyDate()){alert('날짜가 바뀌었습니다. 오늘 날짜에서 알림을 다시 켜주세요.');return}alerts.forEach(clearTimeout);alerts=[];let now=new Date();schedule().forEach(t=>{let when=new Date(state.date+'T00:00:00');when.setMinutes(t.startMinute);let delay=when-now;if(delay>0&&delay<86400000)alerts.push(setTimeout(()=>new Notification(t.name,{body:t.focus?.first||'이제 첫 행동부터 시작해요.'}),delay))});alert('이 페이지를 열어둔 동안 오늘 알림이 켜졌습니다.')};
function openDataSheet(){feedback=localStorage.getItem(FEEDBACKKEY)||feedback;$('#feedbackNote').value=feedback;$('#dataSheet').classList.add('on')}
$('#openData').onclick=openDataSheet;$('#closeData').onclick=()=>$('#dataSheet').classList.remove('on');$('#dataSheet').onclick=e=>{if(e.target===$('#dataSheet'))$('#dataSheet').classList.remove('on')};
$('#saveFeedback').onclick=()=>{feedback=$('#feedbackNote').value.trim();localStorage.setItem(FEEDBACKKEY,feedback);alert('테스트 메모를 저장했습니다.')};
$('#exportData').onclick=()=>{save();feedback=$('#feedbackNote').value.trim();localStorage.setItem(FEEDBACKKEY,feedback);let payload={format:'today-15-hours',schemaVersion:SCHEMA,exportedAt:new Date().toISOString(),calendar,meta,feedback},blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`오늘15시간_전체백업_${keyDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
$('#importData').onclick=()=>{$('#importFile').value='';$('#importFile').click()};
$('#importFile').onchange=async e=>{let file=e.target.files?.[0];if(!file)return;try{let data=JSON.parse(await file.text()),validation=Core.validateBackup(data);if(!validation.ok)throw new Error(validation.reason);if(!confirm('백업 기록을 현재 기기의 기록과 합칠까요? 같은 날짜는 백업 기록으로 바뀝니다.'))return;let merged=Core.mergeBackups({calendar,meta,feedback},data);calendar=merged.calendar;meta=merged.meta;feedback=merged.feedback;localStorage.setItem(CALKEY,JSON.stringify(calendar));saveMeta();localStorage.setItem(FEEDBACKKEY,feedback);clearTransient();state=prepareDay(calendar[keyDate()]||fresh(),keyDate());calendar[state.date]=state;calendarMonth=stateDate();save();renderAll();$('#feedbackNote').value=feedback;alert('백업 기록을 가져왔습니다.')}catch{alert('오늘 15시간에서 만든 JSON 백업 파일인지 확인해주세요.')}};
$('#shareApp').onclick=async()=>{let share={title:'오늘 15시간',text:'24시간에서 수면·준비·이동·활동을 하나씩 떼어놓는 계획 앱',url:'https://tq6q6v5qpn-alt.github.io/today-15-hours/'};try{if(navigator.share)await navigator.share(share);else{await navigator.clipboard.writeText(share.url);alert('앱 주소를 복사했습니다.')}}catch(error){if(error.name!=='AbortError')alert('공유하지 못했습니다. 앱 주소를 직접 복사해주세요.')}};
if('serviceWorker'in navigator&&location.protocol.startsWith('http')){
  let refreshing=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;location.reload()});
  navigator.serviceWorker.register('./sw.js').then(registration=>registration.update()).catch(()=>{});
}
function refreshClock(){updateBudget();renderHome();if(!document.body.classList.contains('is-home'))renderDayMap()}
renderAll();showView('homeView');setInterval(refreshClock,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshClock()});
window.addEventListener('focus',refreshClock);
})();
