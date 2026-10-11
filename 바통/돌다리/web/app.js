'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안'];
const CYCLES = ['매주', '매월', '분기', '반기', '매년', '해당 월', '1회'];
const STANDING = ['매주', '매월', '분기', '반기', '매년'];
const STATUS = {'진행': '진행 중', '대기': '회신·결정 대기', '완료': '끝남'};
const QS = [['q1', '① 이 업무에서 처음 한 달 안에 꼭 해야 하는 것은?', '예) 매월 5일 전월 실적 집계·과장 보고. 2월 말 만료 계약 갱신 안내'], ['q2', '② 자주 틀리거나 조심할 것은?', '예) 미납 2개월째 업체는 발송 정지 전에 반드시 유선 통보'], ['q3', '③ 이 일로 연락 오는 사람과 이유는?', '예) 한결물류 김대리 — 분할 납부 요청이 잦음']];
const AS = [['acct', '계정·비밀번호 보관처', '예) 우편영업 시스템 계정은 서무 담당이 관리, 비밀번호는 봉인 봉투'], ['goods', '열쇠·물품·비품', '예) 매대 열쇠 2개(서랍), 전시용 태블릿 1대'], ['budget', '예산·미지급·정산', '예) 홍보 예산 잔액, 업체 미지급 1건(12월 정산)'], ['etc', '그 밖의 당부', '예) 국장 보고는 매주 월요일 오전']];
const SECS = [['s1', '1. 업무 현황'], ['s2', '2. 주요 현안·미결 사항'], ['s3', '3. 연간 업무 일정'], ['s4', '4. 업무별 인수인계'], ['s5', '5. 관계자 연락처'], ['s6', '6. 계정·물품·예산'], ['s7', '7. 주요 자료 목록'], ['s8', '8. 확인하지 못한 자료']];
let ST = null, ITEMS = [], DROPPED = [], AREAS = [], OV = {}, ASSETS = {}, KEYFILES = [];
let mode = 'give', sec = 'prep', area = '', pending = {}, timer = null, flushTimer = null, engine = 'rules';

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json(); if (!r.ok) throw new Error(j.error || ('오류 ' + r.status)); return j;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const secText = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초'; };
const mon = w => { const m = /(\d{1,2})월/.exec(w || ''); return m ? +m[1] : 99; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
const areaOf = it => it.area || '기타';
const kept = () => ITEMS.filter(i => i.keep && i.decided !== false);
const undecided = () => ITEMS.filter(i => i.decided === false || (i.decided === undefined && i.src !== '직접 입력' && !i.area_by && false));
// 제안 상태: decided가 없으면(초안 직후) 「제안」으로 본다. 넣기/버리기를 누르면 decided=true.
const isSug = it => it.decided !== true && it.src !== '직접 입력';
const usedAreas = () => AREAS.concat(['기타']).filter(a => ITEMS.some(i => areaOf(i) === a));

// ---------------------------------------------------------------- 상태
async function refresh() {
  ST = await api('/api/state');
  $('#ver').textContent = 'v' + (ST.version || '');
  AREAS = (ST.areas_text || '').split('\n').map(l => l.split(/[:：]/)[0].trim()).filter(Boolean);
  OV = ST.overview || {}; ASSETS = ST.assets || {}; KEYFILES = ST.keyfiles || [];
  if (ST.step >= 4) { const j = await api('/api/items'); ITEMS = j.items; DROPPED = j.dropped; }
  else { ITEMS = []; DROPPED = []; }
  $('#subline').textContent = (ST.folder ? ST.folder + ' · ' : '') + (ST.handover_from || ST.handover_to ? `인계자 ${ST.handover_from || '?'} → 인수자 ${ST.handover_to || '?'} · ` : '') + '이 PC 안에서만 작동';
  renderNav(); renderAside();
  const pr = ST.progress;
  if (ST.running && sec === 'prep' && $('#btnStop') && pr) {   // 중단 단추가 이미 있으면(진행 화면이 그려진 뒤) 글·막대만 갱신
    $('#progText').textContent = pr.phase ? `${pr.phase}… ${pr.index || 0}/${pr.total || 0}` : `파일 ${pr.index}/${pr.total} · 모델 호출 ${pr.calls_done}/${pr.calls_total} · ${secText(pr.sec || 0)} 지남 · 남은 시간 약 ${secText(pr.chars_total && pr.chars_done ? (pr.sec / pr.chars_done) * (pr.chars_total - pr.chars_done) : 0)}`;
    const bar = $('#main .bar i'); if (bar) bar.style.width = (pr.chars_total ? Math.round(100 * pr.chars_done / pr.chars_total) : pr.total ? Math.round(100 * pr.index / pr.total) : 0) + '%';
  } else renderMain();
  if (ST.running || ST.reloading || ST.extracting) { clearTimeout(timer); timer = setTimeout(refresh, ST.running ? 1500 : 2500); }
}
function completeness(a) {
  const rows = ITEMS.filter(i => areaOf(i) === a);
  const ov = OV[a] || {};
  const qs = QS.filter(([k]) => (ov[k] || '').trim()).length;
  const sug = rows.filter(isSug).length;
  const noNext = rows.filter(i => i.keep && !isSug(i) && i.type === '진행 중 현안' && !(i.next || '').trim()).length;
  const done = qs === 3 && sug === 0 && noNext === 0;
  return {qs, sug, noNext, done, seen: rows.filter(i => i.keep && !isSug(i)).length ? Math.round(100 * rows.filter(i => i.keep && !isSug(i) && i.seen).length / rows.filter(i => i.keep && !isSug(i)).length) : 0};
}
function overall() {
  const used = usedAreas(); if (!used.length) return {pct: 0, label: '완성도 —'};
  if (mode === 'take') { const k = kept(); const n = k.filter(i => i.seen).length; return {pct: k.length ? Math.round(100 * n / k.length) : 0, label: `확인 ${n}/${k.length}`}; }
  const n = used.filter(a => completeness(a).done).length;
  return {pct: Math.round(100 * n / used.length), label: `완성도 ${n}/${used.length} 업무`};
}

// ---------------------------------------------------------------- 왼쪽 목차
function renderNav() {
  const nav = $('#nav'); const used = usedAreas();
  const prepSt = ST.running || ST.extracting ? '<span class="st ai">진행 중</span>' : ST.step >= 4 ? '<span class="st ok">완료</span>' : ST.step >= 2 ? '<span class="st todo">초안 전</span>' : '<span class="st todo">폴더 전</span>';
  let h = `<div class="lbl">준 비</div><a data-s="prep" class="${sec === 'prep' ? 'cur' : ''}">폴더 읽기 · 초안 ${prepSt}</a><div class="lbl">인수인계서 목차</div>`;
  const badge = id => {
    if (!ITEMS.length) return '';
    if (id === 's2') { const r = ITEMS.filter(i => i.type === '진행 중 현안'); const s = r.filter(isSug).length; return s ? `<span class="st ai">제안 ${s}</span>` : `<span class="st ok">${r.filter(i => i.keep).length}건</span>`; }
    if (id === 's3') { const s = ITEMS.filter(i => i.type === '월별 할 일' && isSug(i)).length; return s ? `<span class="st ai">제안 ${s}</span>` : '<span class="st ok">확인</span>'; }
    if (id === 's5') { const r = ITEMS.filter(i => i.type === '협의할 사람'); const s = r.filter(isSug).length; return s ? `<span class="st ai">제안 ${s}</span>` : `<span class="st ok">${r.filter(i => i.keep).length}명</span>`; }
    if (id === 's6') { return AS.every(([k]) => (ASSETS[k] || '').trim()) ? '<span class="st ok">작성</span>' : '<span class="st todo">빈 칸</span>'; }
    if (id === 's1') { return ST.handover_from && ST.handover_to ? '<span class="st ok">작성</span>' : '<span class="st todo">인계자</span>'; }
    if (id === 's7') { return KEYFILES.length ? `<span class="st ok">${KEYFILES.length}개</span>` : '<span class="st ai">제안</span>'; }
    if (id === 's8') { return `<span class="st">${ST.n_fail || 0}</span>`; }
    return '';
  };
  for (const [id, name] of SECS) {
    h += `<a data-s="${id}" class="${sec === id && !(id === 's4' && area) ? 'cur' : ''}">${name} ${badge(id)}</a>`;
    if (id === 's4') for (const a of used) { const c = completeness(a); h += `<a data-s="s4" data-a="${esc(a)}" class="lv2 ${sec === 's4' && area === a ? 'cur' : ''}">${esc(a)} ${c.done ? '<span class="st ok">작성</span>' : c.sug ? `<span class="st ai">제안 ${c.sug}</span>` : '<span class="st todo">질문 ' + c.qs + '/3</span>'}</a>`; }
  }
  h += `<div class="lbl">기 타</div><a data-s="log" class="${sec === 'log' ? 'cur' : ''}">작업 기록</a>`;
  nav.innerHTML = h;
  $$('#nav a').forEach(el => el.onclick = () => { sec = el.dataset.s; area = el.dataset.a || (sec === 's4' ? '' : area); ls('sec', sec); ls('area', area); renderNav(); renderMain(); renderAside(); window.scrollTo(0, 0); });
  const o = overall(); $('#progLbl').textContent = o.label; $('#progBar').style.width = o.pct + '%';
}

// ---------------------------------------------------------------- 본문
function renderMain() {
  const m = $('#main');
  if (!ITEMS.length && sec !== 'prep' && sec !== 'log') sec = 'prep';
  if (sec === 'prep') return renderPrep(m);
  if (sec === 'log') { m.innerHTML = `<h2>작업 기록</h2><div id="log">${esc((ST.log || []).join('\n'))}</div>`; return; }
  if (sec === 's1') return renderS1(m);
  if (sec === 's2') return renderS2(m);
  if (sec === 's3') return renderS3(m);
  if (sec === 's4') return area ? renderArea(m) : renderAreaList(m);
  if (sec === 's5') return renderS5(m);
  if (sec === 's6') return renderS6(m);
  if (sec === 's7') return renderS7(m);
  if (sec === 's8') return renderS8(m);
}
function head(title, lead, badges) { return `<div class="crumb">업무 인수인계서</div><h2>${esc(title)} ${badges || ''}</h2><p class="lead">${lead}</p>`; }

// 항목 카드(제안·채택·뺌 공용)
function card(it, o) {
  o = o || {};
  const sug = isSug(it), off = !sug && !it.keep;
  const chips = [];
  if (it.type === '월별 할 일') { if (STANDING.includes(it.cycle)) chips.push(`<span class="chip cy">${esc(it.cycle)}</span>`); }
  if (it.type === '진행 중 현안' && !sug && it.keep) chips.push(`<span class="chip st">${STATUS[it.status || '진행']}</span>`);
  if (it.src !== '규칙' && it.src !== '직접 입력') chips.push('<span class="chip">AI</span>');
  const src = it.file ? `출처: ${esc(it.file)} · 「${esc(String(it.quote || '').replace(/\n/g, ' / ').slice(0, 140))}」${(it.also || []).length ? ' · 같은 내용 ' + it.also.length + '곳' : ''}` : '전임자가 직접 적음';
  let body = `<div class="t">${it.type === '월별 할 일' ? `<input class="when" data-k="when" value="${esc(it.when)}" placeholder="시기" ${mode === 'take' ? 'disabled' : ''}>` : ''}<input class="text" data-k="text" value="${esc(it.text)}" ${mode === 'take' ? 'disabled' : ''}>${chips.join('')}</div>`;
  if (it.type === '진행 중 현안' && !sug && it.keep && mode === 'give') body += `<div class="t"><select class="mini" data-k="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(it.status || '진행') === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input class="text" data-k="next" value="${esc(it.next || '')}" placeholder="다음에 할 일(후임자가 이어서 할 것)"></div>`;
  body += `<div class="s">${src}</div>`;
  if (!sug && it.keep && mode === 'give') body += `<input class="memo" data-k="note" value="${esc(it.note || '')}" placeholder="메모(후임자에게 남길 말)">`;
  if (mode === 'take' && it.note) body += `<div class="s">메모: ${esc(it.note)}</div>`;
  let act = '';
  if (mode === 'take') act = sug ? '<span class="chip">전임자 미확인</span>' : `<label><input type="checkbox" class="seen" ${it.seen ? 'checked' : ''}> 확인</label>`;
  else if (sug) act = `<button class="y" data-act="in">넣기</button><button class="n" data-act="out">버리기</button>`;
  else if (it.keep) act = `<button class="n" data-act="out">빼기</button>` + (o.move ? `<select class="mini" data-k="area" title="업무 바꾸기">${AREAS.concat(['기타']).map(a => `<option ${areaOf(it) === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>` : '');
  else act = `<button class="y" data-act="in">되살리기</button>`;
  return `<div class="sug ${sug ? '' : it.keep ? 'me' : 'off'}" data-id="${it.id}"><div>${body}</div><div class="act">${act}</div></div>`;
}
function bindCards(root) {
  root.querySelectorAll('.sug[data-id]').forEach(el => {
    const id = +el.dataset.id; const it = ITEMS.find(i => i.id === id); if (!it) return;
    el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { mark(id, inp.dataset.k, inp.value); if (inp.dataset.k === 'area') { it.area = inp.value; it.area_by = '사람'; rerender(); } });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { const on = b.dataset.act === 'in'; mark(id, 'keep', on); mark(id, 'decided', true); it.keep = on; it.decided = true; rerender(); });
    const sn = el.querySelector('.seen'); if (sn) sn.onchange = () => { mark(id, 'seen', sn.checked); it.seen = sn.checked; renderNav(); renderAside(); };
  });
}
function mark(id, k, v) { pending[id] = pending[id] || {id}; pending[id][k] = v; const it = ITEMS.find(i => i.id === id); if (it) it[k] = v; clearTimeout(flushTimer); flushTimer = setTimeout(flush, 500); }
async function flush() {
  if (!Object.keys(pending).length) return;
  const body = {changes: Object.values(pending)}; pending = {};
  try { const j = await api('/api/items', body); ITEMS = j.items; DROPPED = j.dropped; renderNav(); renderAside(); } catch (e) { alert('저장 실패: ' + e.message); }
}
function rerender() { renderNav(); renderMain(); renderAside(); }
function bulkBtns(rows, label) {
  const s = rows.filter(isSug); if (!s.length || mode === 'take') return '';
  return `<span class="r"><button class="ghost sm" data-bulk="in">${label || '남은 제안'} ${s.length}개 모두 넣기</button><button class="ghost sm" data-bulk="out">모두 버리기</button></span>`;
}
function bindBulk(root, rowsFn) {
  root.querySelectorAll('[data-bulk]').forEach(b => b.onclick = async () => {
    const rows = rowsFn(b).filter(isSug); const on = b.dataset.bulk === 'in';
    if (!confirm(`제안 ${rows.length}개를 모두 「${on ? '넣기' : '버리기'}」 할까요?`)) return;
    try { const j = await api('/api/items', {changes: Object.values(pending), bulk: [{ids: rows.map(i => i.id), keep: on}]}); pending = {}; ITEMS = j.items; DROPPED = j.dropped; rerender(); } catch (e) { alert(e.message); }
  });
}
function addRow(a, types) {
  if (mode === 'take') return '';
  return `<div class="q"><div class="qt">직접 적기 <span class="chip">문서에 없거나 못 찾은 것</span></div><div class="row"><select id="addType">${types.map(t => `<option>${t}</option>`).join('')}</select><input type="text" id="addWhen" placeholder="시기(예: 2026년 2월·매월)" style="width:170px"><input type="text" id="addText" class="wide" placeholder="내용"><button class="btn sm" id="btnAdd">추가</button></div></div>`;
}
function bindAdd(a) {
  const b = $('#btnAdd'); if (!b) return;
  b.onclick = async () => { const text = $('#addText').value.trim(); if (!text) return $('#addText').focus();
    try { const j = await api('/api/items', {changes: Object.values(pending), add: [{type: $('#addType').value, when: $('#addWhen').value, text, area: a || '기타'}]}); pending = {}; ITEMS = j.items; const n = ITEMS[ITEMS.length - 1]; if (n) { n.decided = true; mark(n.id, 'decided', true); } rerender(); } catch (e) { alert(e.message); } };
}

// --- 준비
function renderPrep(m) {
  const x = ST.extracting; const f = ST.files || [];
  let h = head('폴더 읽기 · 초안 만들기', '처음 한 번만 하는 준비입니다. 끝나면 왼쪽 목차의 인수인계서를 채웁니다.');
  h += `<div class="sec"><h3>① 업무 폴더</h3><div class="row"><input type="text" id="folder" class="wide" value="${esc(ST.folder || '')}" placeholder="예) C:\\업무\\우편영업실  (주소를 붙여 넣거나 「찾기」)"><button class="ghost" id="btnPick">찾기…</button><button class="ghost" id="btnBrowse">창으로 찾기</button><button class="btn" id="btnExtract" ${x ? 'disabled' : ''}>읽기</button></div>
    <div id="picker" class="picker" hidden><div class="row"><b>폴더 고르기</b> <span id="pkPath" class="s"></span><button class="ghost sm" id="pkUp">위로</button><button class="btn sm" id="pkUse">이 폴더로</button><button class="ghost sm" id="pkClose">닫기</button></div><div id="pkList"></div></div><div id="extractMsg">${x ? `<div class="note">읽는 중 ${x.index}/${x.total} · ${secText(x.sec || 0)} · ${esc(x.file || '')}</div><div class="bar"><i style="width:${x.total ? Math.round(100 * x.index / x.total) : 0}%"></i></div>` : ST.extract_error ? `<div class="bad">${esc(ST.extract_error)}</div>` : ''}</div>`;
  if (f.length) {
    h += `<div class="pills"><span class="pill">읽은 문서 <b>${f.length}</b></span><span class="pill">못 읽은 문서 <b>${ST.n_fail || 0}</b></span><span class="pill">읽지 않는 형식 <b>${ST.n_skip || 0}</b></span><span class="pill">원본 변경 <b>${ST.originals_changed || 0}</b></span></div>`;
    if (ST.warn) h += `<div class="note">${esc(ST.warn)}</div>`;
    if (ST.subdirs && ST.subdirs.length) { const ex = new Set(ST.exclude || []); h += `<details><summary>읽을 하위 폴더 고르기(${ST.subdirs.length - ex.size}/${ST.subdirs.length})</summary>` + ST.subdirs.map(d => `<label style="display:inline-flex;gap:4px;margin:2px 10px 2px 0"><input type="checkbox" class="sub" value="${esc(d)}" ${ex.has(d) ? '' : 'checked'}>${esc(d)}</label>`).join('') + `<div class="row"><button class="ghost sm" id="subAll">모두</button><button class="ghost sm" id="subNone">모두 해제</button><button class="ghost sm" id="btnReread">이 폴더들로 다시 읽기</button></div></details>`; }
  }
  h += `</div><div class="sec"><h3>② 초안 만들기</h3>`;
  if (!f.length) h += '<div class="s">먼저 폴더를 읽으세요.</div>';
  else {
    const p = ST.plan || {};
    h += `<div class="row"><div class="seg" id="engineSeg"><button data-e="rules" class="${engine === 'rules' ? 'on' : ''}">규칙만 · 몇 분</button><button data-e="model" class="${engine === 'model' ? 'on' : ''}">AI 모델도 사용 · 오래 걸림</button></div>
      <span id="modelRow" ${engine === 'model' ? '' : 'hidden'}><select id="model"><option value="">모델 고르기</option>${ST.model ? `<option value="${esc(ST.model)}" selected>${esc(ST.model)}</option>` : ''}</select> <input type="text" id="url" value="${esc(ST.url || '')}" style="width:280px"> <button class="ghost sm" id="btnModels">목록 새로고침</button></span><span class="s" id="planHint"></span></div>`;
    h += engine === 'model' && ST.model ? `<div class="note">모델 <b>${esc(ST.model)}</b>에 문장 파일 ${p.files_model || 0}개(호출 ${p.calls || 0}회). 예상 약 ${secText(p.est_sec || 0)}. 짧은 파일부터 보내고, 「여기까지만」으로 끊어도 결과는 남습니다. 모델 응답은 호출마다 저장되어 중간에 꺼져도 이어서 갑니다.${ST.checkpoint && ST.checkpoint.reusable ? ` 이전 응답 ${ST.checkpoint.reusable}회 재사용.` : ''}</div>` : `<div class="s">규칙만: 전화번호·기한·현안 신호어가 있는 줄을 뽑습니다. 수천 파일도 몇 분입니다. 모델은 나중에 하위 폴더 하나로 좁혀 보태는 것을 권합니다.</div>`;
    const pr = ST.progress;
    h += `<div class="row"><button class="btn" id="btnDraft" ${ST.running ? 'disabled' : ''}>초안 만들기</button>${ST.running ? '<button class="ghost sm" id="btnStop" style="color:var(--fail);border-color:var(--fail)">여기까지만(중단)</button>' : ''}<span class="s" id="progText">${ST.running && pr ? (pr.phase ? `${pr.phase}… ${pr.index || 0}/${pr.total || 0}` : `파일 ${pr.index}/${pr.total} · 모델 호출 ${pr.calls_done}/${pr.calls_total} · ${secText(pr.sec || 0)} 지남 · 남은 시간 약 ${secText(pr.chars_total && pr.chars_done ? (pr.sec / pr.chars_done) * (pr.chars_total - pr.chars_done) : 0)}`) : ST.step >= 4 && pr ? `끝났습니다. 파일 ${pr.total}개 · 모델 호출 ${pr.calls_done}회 · ${secText(pr.sec || 0)}. 항목 ${ITEMS.length}개가 목차의 각 절에 제안으로 들어가 있습니다.` : ''}</span></div>`;
    if (ST.running && pr) h += `<div class="bar"><i style="width:${pr.chars_total ? Math.round(100 * pr.chars_done / pr.chars_total) : pr.total ? Math.round(100 * pr.index / pr.total) : 0}%"></i></div>`;
    h += `<details><summary>설정 더 보기(표 파일·지침 제외·최근 연도·긴 파일·업무 키워드)</summary><div class="row"><label><input type="checkbox" id="tables" ${ST.include_tables ? 'checked' : ''}> 표 파일도 모델에</label><label><input type="checkbox" id="skipRef" ${ST.skip_reference !== false ? 'checked' : ''}> 지침·매뉴얼류는 모델에 보내지 않기</label><label>최근 <select id="recent">${[0, 1, 2, 3].map(n => `<option value="${n}" ${(ST.recent_years || 0) === n ? 'selected' : ''}>${n ? n + '년' : '전체 연도'}</option>`).join('')}</select> 파일만 모델에</label><label>긴 파일은 앞 <select id="maxCalls">${[[1, '6천 자'], [2, '1만2천 자'], [3, '1만8천 자'], [6, '3만6천 자'], [99, '전부']].map(([v, t]) => `<option value="${v}" ${(ST.max_calls || 3) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>까지</label></div>
      <div class="s" style="margin-top:8px">업무 키워드 — 한 줄에 「업무 이름: 키워드, 키워드」. 항목이 어느 업무에 들어갈지 정합니다.</div><textarea id="areas" style="width:100%;min-height:120px;border:1px solid var(--line);border-radius:8px;padding:8px">${esc(ST.areas_text || '')}</textarea><div class="row"><button class="ghost sm" id="btnAreas">키워드 적용(다시 분류)</button><button class="ghost sm" id="btnAreasDefault">기본값으로</button></div></details>`;
  }
  h += '</div>';
  if (ITEMS.length) h += `<div class="good">초안이 있습니다. 왼쪽 목차 「1. 업무 현황」부터 채워 가세요. <button class="btn sm" id="goS1">인수인계서로</button></div>`;
  m.innerHTML = h; bindPrep();
}
function bindPrep() {
  const g = $('#goS1'); if (g) g.onclick = () => { sec = 's1'; rerender(); };
  $('#btnExtract').onclick = () => doExtract($('#folder').value, []);
  $('#btnPick').onclick = () => pkLoad($('#folder').value.trim() || '').catch(e => alert(e.message));
  $('#pkClose').onclick = () => { $('#picker').hidden = true; };
  $('#pkUse').onclick = () => { $('#folder').value = pkCur; $('#picker').hidden = true; doExtract(pkCur, []); };
  $('#btnBrowse').onclick = async () => { const j = await api('/api/browse', {}); if (j.folder) $('#folder').value = j.folder; else $('#extractMsg').innerHTML = '<div class="note">윈도 폴더 창을 열지 못했습니다. 「찾기…」로 고르거나 주소를 붙여 넣으세요.</div>'; };
  const sa = $('#subAll'); if (sa) { sa.onclick = () => $$('.sub').forEach(c => c.checked = true); $('#subNone').onclick = () => $$('.sub').forEach(c => c.checked = false); $('#btnReread').onclick = () => doExtract($('#folder').value, $$('.sub').filter(c => !c.checked).map(c => c.value)); }
  const seg = $('#engineSeg'); if (seg) {
    seg.querySelectorAll('button').forEach(b => b.onclick = async () => { engine = b.dataset.e; ls('engine', engine); if (engine === 'rules') { await settings({model: ''}); } renderMain(); if (engine === 'model') loadModels(); });
    ['#model', '#url', '#tables', '#recent', '#maxCalls', '#skipRef'].forEach(s => { const el = $(s); if (el) el.onchange = () => settings().then(() => renderMain()).catch(e => alert(e.message)); });
    $('#btnModels').onclick = loadModels; if (engine === 'model') loadModels();
    $('#btnDraft').onclick = async () => { try { await settings(); await api('/api/draft', {}); ITEMS = []; await refresh(); } catch (e) { alert(e.message); } };
    const st = $('#btnStop'); if (st) st.onclick = () => { api('/api/stop', {}); $('#progText').textContent = '중단 요청… 진행 중이던 호출 하나가 끝나면 멈춥니다.'; };
    $('#btnAreas').onclick = async () => { try { await settings({areas_text: $('#areas').value}); await refresh(); alert('업무를 다시 나눴습니다.'); } catch (e) { alert(e.message); } };
    $('#btnAreasDefault').onclick = async () => { if (!confirm('업무 키워드를 기본값으로 되돌릴까요?')) return; try { await settings({areas_text: ''}); await refresh(); } catch (e) { alert(e.message); } };
  }
}
async function settings(extra) {
  const body = Object.assign({}, extra || {});
  const take = (sel, k, f) => { const el = $(sel); if (el) body[k] = f ? f(el) : el.value; };
  if (!('model' in body)) take('#model', 'model'); take('#url', 'url', el => el.value.trim()); take('#tables', 'include_tables', el => el.checked); take('#skipRef', 'skip_reference', el => el.checked); take('#recent', 'recent_years', el => +el.value); take('#maxCalls', 'max_calls', el => +el.value);
  if (engine === 'rules') body.model = '';
  else if (body.model === '') delete body.model;   // 목록을 아직 못 받았을 때 모델 선택을 지우지 않는다
  const j = await api('/api/settings', body);
  ST = Object.assign(ST, await api('/api/state'));   // 화면을 다시 그릴 때 옛 값(예: 모델 주소)이 되살아나지 않게 서버 값으로 맞춘다
  OV = ST.overview || {}; ASSETS = ST.assets || {}; KEYFILES = ST.keyfiles || [];
  return j;
}
async function loadModels() {
  try { const j = await api('/api/models'); const sel = $('#model'); if (!sel) return; const cur = ST.model || '';
    const have = [...sel.options].map(o => o.value).filter(Boolean); if (j.models.length && j.models.every(m => have.includes(m)) && have.every(m => j.models.includes(m) || m === cur)) return;
    sel.innerHTML = '<option value="">모델 고르기</option>' + j.models.map(m => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
    if (cur && !j.models.includes(cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
    $('#planHint').textContent = j.models.length ? '' : 'Ollama가 켜져 있지 않거나 모델이 없습니다. 규칙만으로 진행할 수 있습니다.'; } catch (e) { const ph = $('#planHint'); if (ph) ph.textContent = e.message; }
}
async function doExtract(folder, exclude) {
  if (ITEMS.length && !confirm(`지금 초안 ${ITEMS.length}개가 있습니다. 폴더를 다시 읽으면 초안이 비워집니다(이전 초안은 작업 폴더에 백업). 계속할까요?`)) return;
  try { await api('/api/extract', {folder, exclude: exclude || []}); ITEMS = []; await refresh(); } catch (e) { $('#extractMsg').innerHTML = '<div class="bad">' + esc(e.message) + '</div>'; }
}
let pkCur = '';
async function pkLoad(path) {
  const j = await api('/api/ls?path=' + encodeURIComponent(path || '')); if (j.error) return alert(j.error);
  pkCur = j.path; $('#picker').hidden = false; $('#pkPath').textContent = j.path ? `${j.path} (파일 ${j.files}개)` : '드라이브·자주 쓰는 폴더';
  $('#pkUp').disabled = !j.parent && !j.path; $('#pkUse').disabled = !j.path;
  $('#pkList').innerHTML = j.dirs.length ? j.dirs.map(d => `<span class="d" data-p="${esc(d.path)}">📁 ${esc(d.name)}</span>`).join('') : '<span class="s">하위 폴더가 없습니다. 「이 폴더로」를 누르세요.</span>';
  $$('#pkList .d').forEach(el => el.onclick = () => pkLoad(el.dataset.p)); $('#pkUp').onclick = () => pkLoad(j.parent || '');
}

// --- 1. 업무 현황
function renderS1(m) {
  const used = usedAreas();
  let h = head('1. 업무 현황', '인계자·인수자를 적고, 업무마다 열어서 채웁니다. 완성도는 질문 3개·남은 제안·다음 할 일로 계산합니다.');
  h += `<div class="q"><div class="row"><label>인계자 <input type="text" id="hFrom" value="${esc(ST.handover_from || '')}" placeholder="이름(직급)"></label><label>인수자 <input type="text" id="hTo" value="${esc(ST.handover_to || '')}" placeholder="이름(직급)"></label><label>제목 꼬리 <input type="text" id="hTitle" value="${esc(ST.title || '')}" placeholder="예) 영업과 우편영업실 · 2026.2." style="width:260px"></label></div></div>`;
  h += '<div class="sec"><h3>업무 목록 <span class="chip">키워드로 나눈 것 · 준비 화면에서 고칠 수 있음</span></h3><div class="grid">' + used.map(a => { const r = ITEMS.filter(i => areaOf(i) === a); const c = completeness(a); const n = t => r.filter(i => i.type === t && i.keep && !isSug(i)).length; const pct = mode === 'take' ? c.seen : Math.round(100 * ((c.qs / 3) * 0.5 + (c.sug ? 0 : 0.3) + (c.noNext ? 0 : 0.2))); return `<div class="acard" data-a="${esc(a)}"><h4>${esc(a)} ${c.done ? '<span class="st ok">작성</span>' : c.sug ? `<span class="st ai">제안 ${c.sug}</span>` : '<span class="st todo">작성 중</span>'}</h4><div class="cnt">할 일 ${n('월별 할 일')} · 현안 ${n('진행 중 현안')} · 연락처 ${n('협의할 사람')}</div><div class="bar"><i style="width:${pct}%"></i></div></div>`; }).join('') + '</div></div>';
  m.innerHTML = h;
  $$('.acard').forEach(el => el.onclick = () => { sec = 's4'; area = el.dataset.a; ls('sec', sec); ls('area', area); rerender(); });
  const sv = () => settings({handover_from: $('#hFrom').value, handover_to: $('#hTo').value, title: $('#hTitle').value}).then(() => renderNav()).catch(e => alert(e.message));
  ['#hFrom', '#hTo', '#hTitle'].forEach(s => $(s).onchange = sv);
}

// --- 2. 현안
function renderS2(m) {
  const rows = ITEMS.filter(i => i.type === '진행 중 현안');
  let h = head('2. 주요 현안·미결 사항', '후임자에게 가장 중요한 절입니다. 걸려 있는 일마다 상태와 「다음에 할 일」 한 줄을 적습니다. 제안은 「넣기」「버리기」로 정리합니다.', bulkBtns(rows));
  for (const a of usedAreas()) { const r = rows.filter(i => areaOf(i) === a); if (!r.length) continue; h += `<div class="sec"><h3>${esc(a)} <span class="chip">${r.filter(i => i.keep && !isSug(i)).length}건${r.filter(isSug).length ? ' · 제안 ' + r.filter(isSug).length : ''}</span></h3>` + r.sort((x, y) => (isSug(y) - isSug(x))).map(i => card(i, {move: true})).join('') + '</div>'; }
  if (!rows.length) h += '<div class="s">현안 항목이 없습니다. 「4. 업무별」에서 직접 적을 수 있습니다.</div>';
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows);
}
// --- 3. 연간 일정
function calHtml(rows) {
  const k = rows.filter(i => i.keep && !isSug(i) && i.type === '월별 할 일');
  const standing = k.filter(i => STANDING.includes(i.cycle)).sort((a, b) => STANDING.indexOf(a.cycle) - STANDING.indexOf(b.cycle));
  const months = {}; for (let i = 1; i <= 12; i++) months[i] = [];
  const none = []; k.filter(i => !STANDING.includes(i.cycle)).forEach(i => { const mm = mon(i.when); (mm >= 1 && mm <= 12 ? months[mm] : none).push(i); });
  let h = '<div class="cal">';
  h += `<div class="m ${standing.length ? '' : 'empty'}"><b>늘 하는 일</b>${standing.map(i => `<div>${esc(i.cycle)} · ${esc(i.text)}</div>`).join('') || '없음'}</div>`;
  for (let i = 1; i <= 12; i++) h += `<div class="m ${months[i].length ? '' : 'empty'}"><b>${i}월</b>${months[i].map(x => `<div>${esc(x.text)}</div>`).join('') || '없음'}</div>`;
  h += '</div>';
  if (none.length) h += `<div class="s" style="margin-top:6px">시기가 적히지 않은 일 ${none.length}개는 아래 목록에서 시기를 적으면 달에 들어갑니다.</div>`;
  return h;
}
function renderS3(m) {
  const rows = ITEMS.filter(i => i.type === '월별 할 일');
  let h = head('3. 연간 업무 일정', '늘 하는 일과 1~12월. 빈 달은 정말 할 일이 없는지 한 번 보고, 없으면 그대로 둡니다.', bulkBtns(rows));
  h += calHtml(ITEMS);
  const sug = rows.filter(isSug);
  if (sug.length) h += `<div class="sec"><h3>제안 ${sug.length}개 <span class="chip">넣으면 달력에 들어감</span></h3>` + sug.slice(0, 200).map(i => card(i, {move: true})).join('') + (sug.length > 200 ? `<div class="s">…외 ${sug.length - 200}개는 「4. 업무별」에서</div>` : '') + '</div>';
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows);
}
// --- 4. 업무별
function renderAreaList(m) {
  const used = usedAreas();
  m.innerHTML = head('4. 업무별 인수인계', '업무를 하나 골라 한 장씩 채웁니다.') + '<div class="grid">' + used.map(a => { const c = completeness(a); return `<div class="acard" data-a="${esc(a)}"><h4>${esc(a)} ${c.done ? '<span class="st ok">작성</span>' : c.sug ? `<span class="st ai">제안 ${c.sug}</span>` : '<span class="st todo">질문 ' + c.qs + '/3</span>'}</h4></div>`; }).join('') + '</div>';
  $$('.acard').forEach(el => el.onclick = () => { area = el.dataset.a; ls('area', area); rerender(); });
}
function topFiles(rows, n) {
  const f = {}; rows.filter(i => i.keep && !isSug(i)).forEach(i => { if (i.file) f[i.file] = (f[i.file] || 0) + 1; (i.also || []).forEach(a => { f[a.file] = (f[a.file] || 0) + 1; }); });
  return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, n || 8);
}
function renderArea(m) {
  const a = area; const rows = ITEMS.filter(i => areaOf(i) === a); const c = completeness(a); const ov = OV[a] || {};
  let h = `<div class="crumb">4. 업무별 인수인계 › ${esc(a)}</div><h2>${esc(a)} ${c.done ? '<span class="badge me">작성 완료</span>' : ''}${c.sug ? `<span class="badge ai">제안 ${c.sug}건 남음</span>` : ''}</h2><p class="lead">이 업무에서 후임자가 알아야 할 것을 한 장으로. 제안은 문서에서 찾은 것이니 「넣기」 또는 「버리기」만 누르면 됩니다.</p>`;
  h += `<div class="sec"><h3>업무 개요 <span class="chip">${c.qs}/3 답함</span></h3>` + QS.map(([k, q, ex]) => `<div class="q"><div class="qt">${q}</div><textarea data-ov="${k}" ${mode === 'take' ? 'disabled' : ''}>${esc(ov[k] || '')}</textarea>${ov[k] ? '' : `<div class="ex">${esc(ex)}</div>`}</div>`).join('') + '</div>';
  const todo = rows.filter(i => i.type === '월별 할 일');
  h += `<div class="sec"><h3>이 업무의 달력 ${bulkBtns(todo)}</h3>${calHtml(rows)}` + todo.filter(isSug).map(i => card(i, {move: true})).join('') + `<details><summary>달력에 든 할 일 ${todo.filter(i => i.keep && !isSug(i)).length}개 펼쳐 고치기</summary>${todo.filter(i => !isSug(i)).map(i => card(i, {move: true})).join('')}</details></div>`;
  const iss = rows.filter(i => i.type === '진행 중 현안');
  h += `<div class="sec"><h3>지금 걸려 있는 일 ${c.noNext ? `<span class="badge todo">다음 할 일 ${c.noNext}건 비었음</span>` : ''} ${bulkBtns(iss)}</h3>` + (iss.length ? iss.sort((x, y) => (isSug(y) - isSug(x))).map(i => card(i, {move: true})).join('') : '<div class="s">없음</div>') + '</div>';
  const ppl = rows.filter(i => i.type === '협의할 사람');
  h += `<div class="sec"><h3>연락할 사람 ${bulkBtns(ppl)}</h3>` + personCards(ppl) + '</div>';
  const tf = topFiles(rows, 8);
  h += `<div class="sec"><h3>꼭 봐야 할 파일 <span class="chip">출처로 많이 나온 순</span></h3>${tf.length ? '<ul class="files">' + tf.map(([f, n]) => `<li><label><input type="checkbox" class="kf" value="${esc(f)}" ${KEYFILES.includes(f) ? 'checked' : ''} ${mode === 'take' ? 'disabled' : ''}> ${esc(f)}</label> <span class="s">항목 ${n}개의 출처${KEYFILES.includes(f) ? ' · 주요 자료' : ''}</span></li>`).join('') + '</ul>' : '<div class="s">없음</div>'}</div>`;
  h += addRow(a, TYPES);
  m.innerHTML = h; bindCards(m); bindBulk(m, b => { const sec3 = b.closest('.sec'); const t = sec3 && sec3.querySelector('h3').textContent; return t && t.startsWith('이 업무의 달력') ? todo : t && t.startsWith('지금 걸려') ? iss : ppl; }); bindAdd(a); bindPeople(m);
  m.querySelectorAll('textarea[data-ov]').forEach(t => t.onchange = async () => { OV[a] = Object.assign({}, OV[a] || {}, {[t.dataset.ov]: t.value}); await settings({overview: OV}); ST.overview = OV; renderNav(); renderAside(); });
  m.querySelectorAll('.kf').forEach(k => k.onchange = async () => { KEYFILES = k.checked ? KEYFILES.concat([k.value]) : KEYFILES.filter(f => f !== k.value); await settings({keyfiles: KEYFILES}); renderNav(); });
}
function personCards(ppl) {
  const acc = ppl.filter(i => !isSug(i) && i.keep), sug = ppl.filter(isSug);
  const one = it => { const parts = String(it.text).split(' · '); const name = parts[0] || '', ph = parts[1] || '', ctx = parts.slice(2).join(' · ');
    return `<div class="person" data-id="${it.id}"><b>${esc(name)}</b><span>${mode === 'take' ? `<label><input type="checkbox" class="seen" ${it.seen ? 'checked' : ''}> 확인</label>` : `<button class="x" data-act="out" title="빼기">✕</button>`}</span><span class="ph">${esc(ph)}</span><span></span><span class="why">${esc(ctx)}${it.file ? ' · ' + esc(it.file) : ''}</span><span></span>${mode === 'take' ? (it.note ? `<span class="why" style="grid-column:1/3">무슨 일로: ${esc(it.note)}</span>` : '') : `<input data-k="note" value="${esc(it.note || '')}" placeholder="무슨 일로 연락하는지">`}</div>`; };
  let h = acc.length ? '<div class="people">' + acc.map(one).join('') + '</div>' : '<div class="s">고른 사람이 없습니다.</div>';
  if (sug.length && mode === 'give') h += `<details ${sug.length <= 10 ? 'open' : ''}><summary>제안 ${sug.length}명 보기</summary>${sug.slice(0, 100).map(i => card(i, {move: true})).join('')}${sug.length > 100 ? `<div class="s">…외 ${sug.length - 100}명</div>` : ''}</details>`;
  return h;
}
function bindPeople(root) {
  root.querySelectorAll('.person[data-id]').forEach(el => { const id = +el.dataset.id; const it = ITEMS.find(i => i.id === id); if (!it) return;
    const n = el.querySelector('[data-k]'); if (n) n.onchange = () => mark(id, 'note', n.value);
    const x = el.querySelector('[data-act]'); if (x) x.onclick = () => { mark(id, 'keep', false); mark(id, 'decided', true); it.keep = false; it.decided = true; rerender(); };
    const sn = el.querySelector('.seen'); if (sn) sn.onchange = () => { mark(id, 'seen', sn.checked); it.seen = sn.checked; renderNav(); renderAside(); }; });
}
// --- 5. 연락처
function renderS5(m) {
  const rows = ITEMS.filter(i => i.type === '협의할 사람');
  let h = head('5. 관계자 연락처', '업무별로 고른 사람들입니다. 「무슨 일로」를 적어야 후임자가 씁니다. 제안은 각 업무 장에서 넣고 버립니다.', bulkBtns(rows, '모든 업무의 남은 제안'));
  for (const a of usedAreas()) { const r = rows.filter(i => areaOf(i) === a); if (!r.length) continue; h += `<div class="sec"><h3>${esc(a)} <span class="chip">${r.filter(i => i.keep && !isSug(i)).length}명${r.filter(isSug).length ? ' · 제안 ' + r.filter(isSug).length : ''}</span></h3>${personCards(r)}</div>`; }
  m.innerHTML = h; bindCards(m); bindPeople(m); bindBulk(m, () => rows);
}
// --- 6. 계정·물품·예산
function renderS6(m) {
  m.innerHTML = head('6. 계정·물품·예산 등 인계 물품', '문서에서 찾을 수 없어 전임자가 직접 적는 절입니다. 표준 인수인계서에 꼭 들어가는 항목입니다.') + AS.map(([k, q, ex]) => `<div class="q"><div class="qt">${q}</div><textarea data-as="${k}" ${mode === 'take' ? 'disabled' : ''}>${esc(ASSETS[k] || '')}</textarea>${ASSETS[k] ? '' : `<div class="ex">${esc(ex)}</div>`}</div>`).join('');
  m.querySelectorAll('textarea[data-as]').forEach(t => t.onchange = async () => { ASSETS[t.dataset.as] = t.value; await settings({assets: ASSETS}); ST.assets = ASSETS; renderNav(); });
}
// --- 7. 주요 자료
function renderS7(m) {
  const tf = topFiles(ITEMS, 40);
  let h = head('7. 주요 자료 목록', '항목의 출처로 많이 나온 파일입니다. 후임자가 꼭 봐야 할 것에 체크하면 인수인계서에 그것만 실립니다. 체크가 없으면 상위 15개가 실립니다.');
  h += '<ul class="files">' + tf.map(([f, n]) => `<li><label><input type="checkbox" class="kf" value="${esc(f)}" ${KEYFILES.includes(f) ? 'checked' : ''} ${mode === 'take' ? 'disabled' : ''}> ${esc(f)}</label> <span class="s">항목 ${n}개의 출처</span></li>`).join('') + '</ul>';
  m.innerHTML = h; m.querySelectorAll('.kf').forEach(k => k.onchange = async () => { KEYFILES = k.checked ? KEYFILES.concat([k.value]) : KEYFILES.filter(f => f !== k.value); await settings({keyfiles: KEYFILES}); renderNav(); });
}
// --- 8. 못 읽은 자료
function renderS8(m) {
  const fails = (ST.failures || []).filter(x => !x.skip), skips = (ST.failures || []).filter(x => x.skip);
  const by = {}; fails.forEach(x => { const k = String(x.reason).replace(/\(.*$/, '').trim(); by[k] = (by[k] || 0) + 1; });
  let h = head('8. 확인하지 못한 자료', '읽지 못한 문서는 후임자가 직접 열어 봐야 하므로 인수인계서에 목록으로 실립니다. 그림·프로그램·임시 파일은 수만 적힙니다.');
  h += `<div class="pills"><span class="pill">못 읽은 문서 <b>${fails.length}</b></span><span class="pill">읽지 않는 형식 <b>${skips.length}</b></span></div><table><tr><th>이유</th><th class="num">파일</th></tr>${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}</table>`;
  h += `<details><summary>파일별 보기(${fails.length})</summary><table>${fails.map(x => `<tr><td>${esc(x.file)}</td><td class="s">${esc(x.reason)}</td></tr>`).join('')}</table></details>`;
  m.innerHTML = h;
}

// ---------------------------------------------------------------- 오른쪽: 물어보기·완성도
function renderAside() {
  const box = $('#checklist'); if (!ITEMS.length) { box.innerHTML = '<div>초안을 만들면 여기에 완성도가 보입니다.</div>'; return; }
  if (sec === 's4' && area) { const c = completeness(area); box.innerHTML = `<div><b>${esc(area)}</b></div><div>개요 3문항<span class="${c.qs === 3 ? 'ok' : 'no'}">${c.qs}/3</span></div><div>남은 제안<span class="${c.sug ? 'no' : 'ok'}">${c.sug ? c.sug + '건' : '없음'}</span></div><div>다음 할 일 빈 현안<span class="${c.noNext ? 'no' : 'ok'}">${c.noNext ? c.noNext + '건' : '없음'}</span></div>${mode === 'take' ? `<div>확인률<span>${c.seen}%</span></div>` : ''}`; return; }
  const used = usedAreas(); box.innerHTML = used.map(a => { const c = completeness(a); return `<div><span>${esc(a)}</span><span class="${c.done ? 'ok' : 'no'}">${c.done ? '완료' : c.sug ? '제안 ' + c.sug : '질문 ' + c.qs + '/3'}</span></div>`; }).join('') + `<div><span>계정·물품·예산</span><span class="${AS.every(([k]) => (ASSETS[k] || '').trim()) ? 'ok' : 'no'}">${AS.filter(([k]) => (ASSETS[k] || '').trim()).length}/4</span></div>`;
}
let qTimer = null;
$('#q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(async () => { const q = $('#q').value.trim(); if (q.length < 2) { $('#answers').innerHTML = ''; return; }
  try { const j = await api('/api/search?q=' + encodeURIComponent(q)); $('#answers').innerHTML = j.hits.length ? `<div class="s" style="font-size:.82rem;color:var(--ink3)">「${esc(q)}」가 든 파일 ${j.total}개 중 ${j.hits.length}개</div>` + j.hits.map(h => `<div class="ans"><div class="f">${esc(h.file)}</div>${h.lines.map(l => `<div class="l">${esc(l)}</div>`).join('')}<div class="src">이름 ${h.name_hits}곳 · 본문 ${h.body_hits}곳</div></div>`).join('') : '<div class="ans">찾지 못했습니다. 다른 말로 찾아보세요.</div>'; } catch (e) { $('#answers').innerHTML = '<div class="ans">' + esc(e.message) + '</div>'; } }, 350); };

// ---------------------------------------------------------------- 머리글: 모드·글자·인쇄·내보내기
$('#modeSeg').querySelectorAll('button').forEach(b => b.onclick = () => { mode = b.dataset.m; ls('mode', mode); $$('#modeSeg button').forEach(x => x.classList.toggle('on', x === b)); rerender(); });
function applyPrefs() { document.documentElement.style.setProperty('--s', String(+(ls('fs') || 1))); const t = ls('theme'); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
$('#fsup').onclick = () => { ls('fs', Math.min(1.4, +(ls('fs') || 1) + 0.1).toFixed(2)); applyPrefs(); };
$('#fsdn').onclick = () => { ls('fs', Math.max(0.8, +(ls('fs') || 1) - 0.1).toFixed(2)); applyPrefs(); };
$('#thm').onclick = () => { ls('theme', ls('theme') === 'dark' ? '' : 'dark'); applyPrefs(); };
applyPrefs();
$('#btnExport').onclick = async () => {
  if (!ITEMS.length) return alert('초안이 없습니다. 준비 화면에서 폴더를 읽고 초안을 만드세요.');
  await flush();
  try { await api('/api/export', {}); ST = await api('/api/state'); const files = ST.exports || []; const m = $('#main');
    m.insertAdjacentHTML('afterbegin', `<div class="good">인수인계서를 만들었습니다(작업 폴더 ${esc(ST.work)}). ${files.map(n => `<a href="/api/download?name=${encodeURIComponent(n)}">${esc(n)}</a>`).join(' · ')} — .docx는 워드·한글에서 열어 꾸미고, 원본지문.csv는 원본이 바뀌지 않았다는 증빙입니다.</div>`); window.scrollTo(0, 0); } catch (e) { alert(e.message); }
};
$('#btnPrint').onclick = () => { if (!ITEMS.length) return alert('인쇄할 초안이 없습니다.'); renderPrintView(); window.print(); };
function renderPrintView() {
  const k = kept(); const used = usedAreas(); const pi = it => `<div class="pi">${it.when ? '[' + esc(it.when) + '] ' : ''}${esc(it.text)}${it.type === '진행 중 현안' ? ' [' + STATUS[it.status || '진행'] + ']' : ''}${it.next ? ' → 다음: ' + esc(it.next) : ''}${it.note ? ' — ' + esc(it.note) : ''}<span class="s">${it.file ? esc(it.file) : '전임자가 직접 적음'}</span></div>`;
  let h = `<h2>업무 인수인계서 · ${esc(ST.title || '')}</h2><p>인계자 ${esc(ST.handover_from || '')} → 인수자 ${esc(ST.handover_to || '')} · ${new Date().toLocaleDateString('ko-KR')} · 돌다리 v${esc(ST.version || '')}</p>`;
  h += '<h3>1. 업무 현황</h3>' + used.map(a => { const r = k.filter(i => areaOf(i) === a); return `<p>${esc(a)} — 할 일 ${r.filter(i => i.type === '월별 할 일').length} · 현안 ${r.filter(i => i.type === '진행 중 현안').length} · 연락처 ${r.filter(i => i.type === '협의할 사람').length}</p>`; }).join('');
  h += '<h3>2. 주요 현안·미결 사항</h3>' + (k.filter(i => i.type === '진행 중 현안').map(pi).join('') || '<p>(없음)</p>');
  h += '<h3>3. 연간 업무 일정</h3>' + calHtml(ITEMS).replace(/class="cal"/, 'class="cal" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px"');
  h += '<h3>4. 업무별 인수인계</h3>' + used.map(a => { const r = k.filter(i => areaOf(i) === a); const ov = OV[a] || {}; return `<h4>${esc(a)}</h4>` + QS.map(([kk, q]) => `<p><b>${q.slice(2)}</b> ${esc(ov[kk] || '(적지 않음)')}</p>`).join('') + r.filter(i => i.type !== '협의할 사람').map(pi).join(''); }).join('');
  h += '<h3>5. 관계자 연락처</h3>' + (k.filter(i => i.type === '협의할 사람').map(i => `<div class="pi">${esc(i.text)}${i.note ? ' — ' + esc(i.note) : ''}</div>`).join('') || '<p>(없음)</p>');
  h += '<h3>6. 계정·물품·예산</h3>' + AS.map(([kk, q]) => `<p><b>${q}</b> ${esc(ASSETS[kk] || '(적지 않음)')}</p>`).join('');
  h += '<h3>7. 주요 자료 목록</h3>' + ((KEYFILES.length ? KEYFILES : topFiles(ITEMS, 15).map(x => x[0])).map(f => `<div class="pi">${esc(f)}</div>`).join('') || '<p>(없음)</p>');
  const fails = (ST.failures || []).filter(x => !x.skip); h += `<h3>8. 확인하지 못한 자료</h3>` + (fails.slice(0, 300).map(x => `<div class="pi">${esc(x.file)} — ${esc(x.reason)}</div>`).join('') || '<p>(없음)</p>') + (fails.length > 300 ? `<p>…외 ${fails.length - 300}개</p>` : '');
  $('#printView').innerHTML = h;
}

// ---------------------------------------------------------------- 시작
mode = ls('mode') || 'give'; $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.m === mode));
engine = ls('engine') || 'rules';
refresh().then(() => { const s = ls('sec'); if (ITEMS.length && s && s !== 'prep') { sec = s; area = ls('area') || ''; } else sec = 'prep'; if (ST.model && engine === 'rules') engine = 'model'; rerender(); }).catch(e => { $('#main').innerHTML = '<div class="bad">서버와 연결하지 못했습니다: ' + esc(e.message) + '</div>'; });
