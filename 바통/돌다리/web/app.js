'use strict';
// 돌다리 v3 화면: 문서 한 건 = 카드 한 장. 별지 제12호서식(업무인계·인수서) 차례대로 채운다.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const KINDS = ['현안', '반복', '문서'];
const STATUS = {'진행': '진행 중', '미결': '미결(회신·결정 대기)', '완료': '끝남'};
const AS = [['acct', '계정·비밀번호 보관처', '예) 우편영업 시스템 계정은 서무 담당이 관리, 비밀번호는 봉인 봉투'], ['goods', '열쇠·물품·비품', '예) 매대 열쇠 2개(서랍), 전시용 태블릿 1대'], ['budget', '예산·미지급·정산', '예) 홍보 예산 잔액, 업체 미지급 1건(12월 정산)'], ['etc', '그 밖의 당부', '예) 국장 보고는 매주 월요일 오전']];
const SECS = [['s1a', '1-가. 담당 업무'], ['s1b', '1-나. 업무계획·반복 업무'], ['s1c', '1-다. 현안사항'], ['s1d', '1-라. 미결사항'], ['s2', '2. 관련 문서 현황'], ['s3', '3. 물품·예산'], ['s4', '4. 참고(연락처·매뉴얼)']];
const ONNARA = {s1a: '가. 담당 업무', s1b: '나. 주요 업무계획 및 진행사항', s1c: '다. 현안사항 및 문제점', s1d: '라. 주요 미결사항', s2: '2. 관련 문서 현황', s3: '3. 주요 물품 및 예산 등', s4: '4. 그 밖의 참고사항'};
let ST = null, ITEMS = [], AREAS = [], OV = {}, ASSETS = {};
let mode = 'give', sec = 'prep', area = '', pending = {}, timer = null, flushTimer = null, engine = 'rules';

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json(); if (!r.ok) throw new Error(j.error || ('오류 ' + r.status)); return j;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const secText = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초'; };
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
const areaOf = it => it.area || '기타';
const isSug = it => it.decided !== true && it.src !== '직접 입력';   // 아직 넣기·버리기를 누르지 않은 제안
const kept = () => ITEMS.filter(i => i.keep && !isSug(i));
const usedAreas = () => AREAS.concat(['기타']).filter(a => ITEMS.some(i => areaOf(i) === a));
const issues = () => ITEMS.filter(i => i.kind3 === '현안');
const recurs = () => ITEMS.filter(i => i.kind3 === '반복' || (i.kind3 === '현안' && i.recur));
const fileName = f => String(f || '').split('/').pop();

// ---------------------------------------------------------------- 상태
async function refresh() {
  ST = await api('/api/state');
  $('#ver').textContent = 'v' + (ST.version || '');
  AREAS = (ST.areas_text || '').split('\n').map(l => l.split(/[:：]/)[0].trim()).filter(Boolean);
  OV = ST.overview || {}; ASSETS = ST.assets || {};
  if (ST.step >= 4) { const j = await api('/api/items'); ITEMS = j.items; } else ITEMS = [];
  $('#subline').textContent = (ST.folder ? ST.folder + ' · ' : '') + (ST.handover_from || ST.handover_to ? `인계자 ${ST.handover_from || '?'} → 인수자 ${ST.handover_to || '?'} · ` : '') + '이 PC 안에서만 작동';
  renderNav(); renderAside();
  const pr = ST.progress;
  if (ST.running && sec === 'prep' && $('#btnStop') && pr) {
    $('#progText').textContent = progText(pr);
    const bar = $('#main .bar i'); if (bar) bar.style.width = (pr.calls_total ? Math.round(100 * pr.calls_done / pr.calls_total) : 0) + '%';
  } else renderMain();
  if (ST.running || ST.reloading || ST.extracting) { clearTimeout(timer); timer = setTimeout(refresh, ST.running ? 1500 : 2500); }
}
function progText(pr) {
  if (pr.phase) return `${pr.phase}… ${pr.index || 0}/${pr.total || 0}`;
  const rem = pr.calls_total && pr.calls_done ? (pr.sec / pr.calls_done) * (pr.calls_total - pr.calls_done) : 0;
  return `문서 ${pr.index}/${pr.total} · 모델 호출 ${pr.calls_done}/${pr.calls_total} · ${secText(pr.sec || 0)} 지남${pr.calls_total ? ' · 남은 시간 약 ' + secText(rem) : ''}`;
}
function completeness(a) {
  const rows = ITEMS.filter(i => areaOf(i) === a);
  const ov = OV[a] || {};
  const desc = !!(ov.desc || '').trim();
  const sug = rows.filter(i => isSug(i) && i.kind3 !== '문서').length;
  const noNext = rows.filter(i => i.keep && !isSug(i) && i.kind3 === '현안' && !(i.next || '').trim() && !(i.todo || '').trim()).length;
  const k = rows.filter(i => i.keep && !isSug(i));
  return {desc, sug, noNext, done: desc && sug === 0 && noNext === 0, seen: k.length ? Math.round(100 * k.filter(i => i.seen).length / k.length) : 0};
}
function overall() {
  const used = usedAreas(); if (!used.length) return {pct: 0, label: '완성도 —'};
  if (mode === 'take') { const k = kept(); const n = k.filter(i => i.seen).length; return {pct: k.length ? Math.round(100 * n / k.length) : 0, label: `확인 ${n}/${k.length}`}; }
  const n = used.filter(a => completeness(a).done).length;
  return {pct: Math.round(100 * n / used.length), label: `완성도 ${n}/${used.length} 업무`};
}

// ---------------------------------------------------------------- 왼쪽 목차
function renderNav() {
  const nav = $('#nav');
  const prepSt = ST.running || ST.extracting ? '<span class="st ai">진행 중</span>' : ST.step >= 4 ? '<span class="st ok">완료</span>' : ST.step >= 2 ? '<span class="st todo">초안 전</span>' : '<span class="st todo">폴더 전</span>';
  let h = `<div class="lbl">준 비</div><a data-s="prep" class="${sec === 'prep' ? 'cur' : ''}">폴더 읽기 · 초안 ${prepSt}</a><div class="lbl">업무인계·인수서(별지 제12호)</div>`;
  const badge = id => {
    if (!ITEMS.length) return '';
    const sugN = r => r.filter(isSug).length;
    if (id === 's1a') { const n = usedAreas().filter(a => (OV[a] || {}).desc).length; return n === usedAreas().length ? '<span class="st ok">작성</span>' : `<span class="st todo">${n}/${usedAreas().length}</span>`; }
    if (id === 's1b') { const r = recurs(); const s = sugN(r); return s ? `<span class="st ai">제안 ${s}</span>` : `<span class="st ok">${r.filter(i => i.keep).length}건</span>`; }
    if (id === 's1c') { const r = issues(); const s = sugN(r); return s ? `<span class="st ai">제안 ${s}</span>` : `<span class="st ok">${r.filter(i => i.keep && i.status !== '미결').length}건</span>`; }
    if (id === 's1d') { return `<span class="st">${issues().filter(i => i.keep && !isSug(i) && i.status === '미결').length}건</span>`; }
    if (id === 's2') { const s = ITEMS.filter(i => i.kind3 === '문서' && isSug(i)).length; return s ? `<span class="st ai">제안 ${s}</span>` : `<span class="st ok">${kept().length}건</span>`; }
    if (id === 's3') { return AS.every(([k]) => (ASSETS[k] || '').trim()) ? '<span class="st ok">작성</span>' : '<span class="st todo">빈 칸</span>'; }
    if (id === 's4') { return `<span class="st">${contactsAll().length}명</span>`; }
    return '';
  };
  for (const [id, name] of SECS) h += `<a data-s="${id}" class="${sec === id ? 'cur' : ''}">${name} ${badge(id)}</a>`;
  h += `<div class="lbl">기 타</div><a data-s="log" class="${sec === 'log' ? 'cur' : ''}">작업 기록</a>`;
  nav.innerHTML = h;
  $$('#nav a').forEach(el => el.onclick = () => { sec = el.dataset.s; ls('sec', sec); renderNav(); renderMain(); renderAside(); window.scrollTo(0, 0); });
  const o = overall(); $('#progLbl').textContent = o.label; $('#progBar').style.width = o.pct + '%';
}

// ---------------------------------------------------------------- 본문
function renderMain() {
  const m = $('#main');
  if (!ITEMS.length && sec !== 'prep' && sec !== 'log') sec = 'prep';
  if (sec === 'prep') return renderPrep(m);
  if (sec === 'log') { m.innerHTML = `<h2>작업 기록</h2><div id="log">${esc((ST.log || []).join('\n'))}</div>`; return; }
  const fn = {s1a: renderS1a, s1b: renderS1b, s1c: renderS1c, s1d: renderS1d, s2: renderS2, s3: renderS3, s4: renderS4}[sec];
  if (fn) fn(m);
}
function head(title, lead, badges) { return `<div class="crumb">업무인계·인수서</div><h2>${esc(title)} ${badges || ''}</h2><p class="lead">${lead}</p>` + copyBar(); }
function copyBar() {
  if (!ONNARA[sec] || !ITEMS.length) return '';
  return `<div class="copybar"><button class="ghost sm" id="btnCopy">온나라에 붙여넣을 글 복사</button><span>서식의 「${esc(ONNARA[sec])}」 칸에 그대로 붙여 넣습니다. 넣기로 고른 것만 들어갑니다.</span></div>`;
}
function bindCopy() {
  const b = $('#btnCopy'); if (!b) return;
  b.onclick = async () => { try { const j = await api('/api/onnara'); const s = j.sections.find(x => x.name === ONNARA[sec]); const text = s ? s.text : '(없음)';
    try { await navigator.clipboard.writeText(text); b.textContent = '복사했습니다'; } catch (e) { window.prompt('복사가 막혀 있습니다. 아래 글을 직접 복사하세요.', text); }
    setTimeout(() => { b.textContent = '온나라에 붙여넣을 글 복사'; }, 1500); } catch (e) { alert(e.message); } };
}

// 문서 카드(제안·채택·뺌 공용)
function card(it, o) {
  o = o || {};
  const sug = isSug(it), off = !sug && !it.keep, ro = mode === 'take';
  const chips = [`<span class="chip">${esc(it.cls || '')}</span>`];
  if (it.recur && it.recur.years) chips.push(`<span class="chip cy">매년 ${it.recur.month}월 · ${it.recur.years.join('·')}</span>`);
  if (it.kind3 === '현안' && !sug && it.keep) chips.push(`<span class="chip st">${STATUS[it.status || '진행']}</span>`);
  if (ST.info && ST.info.manual && it.cls === '공문' && !it.reflected) chips.push('<span class="chip st" title="누적 매뉴얼에 이 문서번호·제목이 없음">★ 매뉴얼 미반영</span>');
  if (it.src === '모델') chips.push('<span class="chip">AI 요지</span>');
  let body = `<div class="t"><span class="d">${esc(it.date || '날짜 없음')}</span><input class="text" data-k="title" value="${esc(it.title)}" ${ro ? 'disabled' : ''}>${it.docno ? `<span class="d">${esc(it.docno)}</span>` : ''}${chips.join('')}</div>`;
  if (it.summary) body += `<div class="s">요지: ${esc(it.summary)}</div>`;
  if (!ro) body += `<div class="t"><input class="text" data-k="todo" value="${esc(it.todo || '')}" placeholder="후임자가 할 일 (한 줄)"><input class="when" data-k="due_next" value="${esc(it.due_next || '')}" placeholder="기한 YYYY-MM-DD"></div>`;
  else if (it.todo || it.due_next) body += `<div class="s">할 일: ${esc(it.todo || '')}${it.due_next ? ' · 기한 ' + esc(it.due_next) : ''}</div>`;
  if (it.kind3 === '현안' && !sug && it.keep && !ro) body += `<div class="t"><select class="mini" data-k="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(it.status || '진행') === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input class="text" data-k="next" value="${esc(it.next || '')}" placeholder="다음에 할 일(후임자가 이어서 할 것)"></div>`;
  const who = (it.contacts || []).map(c => `${esc(c.name)} ${esc(c.phone)}`).join(', ') || (it.owner ? esc(it.owner) : '');
  body += `<div class="s">${it.file ? '파일: ' + esc(it.file) : '전임자가 직접 적음'}${it.attachments && it.attachments.length ? ' · 붙임 ' + it.attachments.length + '개' : ''}${who ? ' · 담당: ' + who : ''}${it.due && it.due.length > 1 ? ' · 기한 후보 ' + it.due.map(d => d.date).join(', ') : ''}</div>`;
  if (!sug && it.keep && !ro) body += `<input class="memo" data-k="note" value="${esc(it.note || '')}" placeholder="메모(후임자에게 남길 말)">`;
  if (ro && it.note) body += `<div class="s">메모: ${esc(it.note)}</div>`;
  let act = '';
  if (ro) act = sug ? '<span class="chip">전임자 미확인</span>' : `<label><input type="checkbox" class="seen" ${it.seen ? 'checked' : ''}> 확인</label>`;
  else if (sug) act = `<button class="y" data-act="in">넣기</button><button class="n" data-act="out">버리기</button>`;
  else if (it.keep) act = `<button class="n" data-act="out">빼기</button>`;
  else act = `<button class="y" data-act="in">되살리기</button>`;
  if (!ro && !sug && it.keep) act += `<select class="mini" data-k="area" title="업무 바꾸기">${AREAS.concat(['기타']).map(a => `<option ${areaOf(it) === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select><select class="mini" data-k="kind3" title="절 바꾸기">${KINDS.map(k => `<option ${it.kind3 === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`;
  return `<div class="sug doc ${sug ? '' : it.keep ? 'me' : 'off'}" data-id="${it.id}"><div>${body}</div><div class="act">${act}</div></div>`;
}
function bindCards(root) {
  root.querySelectorAll('.sug[data-id]').forEach(el => {
    const id = +el.dataset.id; const it = ITEMS.find(i => i.id === id); if (!it) return;
    el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { mark(id, inp.dataset.k, inp.value); if (inp.dataset.k === 'area' || inp.dataset.k === 'kind3') rerender(); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { const on = b.dataset.act === 'in'; mark(id, 'keep', on); mark(id, 'decided', true); rerender(); });
    const sn = el.querySelector('.seen'); if (sn) sn.onchange = () => { mark(id, 'seen', sn.checked); renderNav(); renderAside(); };
  });
}
function mark(id, k, v) { pending[id] = pending[id] || {id}; pending[id][k] = v; const it = ITEMS.find(i => i.id === id); if (it) { it[k] = v; if (k === 'area') it.area_by = '사람'; } clearTimeout(flushTimer); flushTimer = setTimeout(flush, 500); }
async function flush() {
  if (!Object.keys(pending).length) return;
  const body = {changes: Object.values(pending)}; pending = {};
  try { const j = await api('/api/items', body); ITEMS = j.items; renderNav(); renderAside(); } catch (e) { alert('저장 실패: ' + e.message); }
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
    try { const j = await api('/api/items', {changes: Object.values(pending), bulk: [{ids: rows.map(i => i.id), keep: on}]}); pending = {}; ITEMS = j.items; rerender(); } catch (e) { alert(e.message); }
  });
}
function addRow(kind3) {
  if (mode === 'take') return '';
  return `<div class="q"><div class="qt">직접 적기 <span class="chip">문서에 없거나 못 찾은 것</span></div><div class="row"><select id="addArea">${AREAS.concat(['기타']).map(a => `<option>${esc(a)}</option>`).join('')}</select><input type="text" id="addDate" placeholder="날짜·시기" style="width:130px"><input type="text" id="addTitle" class="wide" placeholder="제목(무슨 일)"><input type="text" id="addTodo" class="wide" placeholder="후임자가 할 일"><button class="btn sm" id="btnAdd">추가</button></div></div>`;
}
function bindAdd(kind3) {
  const b = $('#btnAdd'); if (!b) return;
  b.onclick = async () => { const title = $('#addTitle').value.trim(); if (!title) return $('#addTitle').focus();
    try { const j = await api('/api/items', {changes: Object.values(pending), add: [{kind3, title, date: $('#addDate').value, todo: $('#addTodo').value, area: $('#addArea').value}]}); pending = {}; ITEMS = j.items; rerender(); } catch (e) { alert(e.message); } };
}
function sortRows(r) { return r.slice().sort((x, y) => (isSug(y) - isSug(x)) || String(y.date || '').localeCompare(String(x.date || ''))); }

// --- 준비
function renderPrep(m) {
  const x = ST.extracting; const f = ST.files || [];
  let h = head('폴더 읽기 · 초안 만들기', '처음 한 번만 하는 준비입니다. 문서 한 건이 카드 한 장이 되고, 왼쪽 서식 차례대로 넣기·버리기만 하면 됩니다.');
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
    h += `<div class="row"><label>기간 <select id="months">${[6, 12, 18, 24, 36].map(n => `<option value="${n}" ${(+ST.months || 12) === n ? 'selected' : ''}>최근 ${n}개월</option>`).join('')}</select></label><span class="s">업무마다 다르게 두려면 아래 「업무 키워드」 줄 끝에 「| 24개월」처럼 적습니다. 해마다 오는 업무는 기간과 상관없이 지난 3년 파일 날짜로 찾습니다.</span></div>`;
    h += `<div class="pills"><span class="pill">기간 안 문서 <b>${p.n_items || 0}</b></span><span class="pill">현안 후보 <b>${p.n_issue || 0}</b></span><span class="pill">반복 업무 <b>${p.n_recur || 0}</b></span><span class="pill">그 밖의 문서 <b>${p.n_doc || 0}</b></span><span class="pill">기간 밖 <b>${p.n_old || 0}</b></span><span class="pill">붙임 <b>${p.n_attach || 0}</b></span></div>`;
    h += `<div class="row"><div class="seg" id="engineSeg"><button data-e="rules" class="${engine === 'rules' ? 'on' : ''}">규칙만 · 몇 초</button><button data-e="model" class="${engine === 'model' ? 'on' : ''}">AI 모델도 사용 · 요지·할 일 받기</button></div>
      <span id="modelRow" ${engine === 'model' ? '' : 'hidden'}><select id="model"><option value="">모델 고르기</option>${ST.model ? `<option value="${esc(ST.model)}" selected>${esc(ST.model)}</option>` : ''}</select> <input type="text" id="url" value="${esc(ST.url || '')}" style="width:280px"> <button class="ghost sm" id="btnModels">목록 새로고침</button>
      <div class="seg" id="scopeSeg" style="display:inline-flex;margin-left:8px"><button data-sc="issues" class="${(ST.model_scope || 'issues') === 'issues' ? 'on' : ''}">현안 후보만</button><button data-sc="all" class="${ST.model_scope === 'all' ? 'on' : ''}">기간 안 전부</button></div></span><span class="s" id="planHint"></span></div>`;
    h += engine === 'model' && ST.model ? `<div class="note">모델 <b>${esc(ST.model)}</b>에 문서 ${p.calls || 0}건(한 건에 한 번). 예상 약 ${secText(p.est_sec || 0)}. 「여기까지만」으로 끊어도 결과는 남고, 모델 응답은 호출마다 저장되어 중간에 꺼져도 이어서 갑니다.${ST.checkpoint && ST.checkpoint.reusable ? ` 저장된 이전 응답 ${ST.checkpoint.reusable}회는 다시 부르지 않습니다.` : ''}</div>` : `<div class="s">규칙만: 문서마다 날짜·문서번호·제목·기한·담당·소관 업무를 읽습니다. 수천 파일도 몇 초입니다. 모델은 현안 후보의 「요지·할 일」 한 줄을 보탭니다(없어도 됩니다).</div>`;
    const pr = ST.progress;
    h += `<div class="row"><button class="btn" id="btnDraft" ${ST.running ? 'disabled' : ''}>초안 만들기</button>${ST.running ? '<button class="ghost sm" id="btnStop" style="color:var(--fail);border-color:var(--fail)">여기까지만(중단)</button>' : ''}<span class="s" id="progText">${ST.running && pr ? progText(pr) : ST.step >= 4 && pr ? `끝났습니다. 문서 ${ITEMS.length}건 · 모델 호출 ${pr.calls_done || 0}회 · ${secText(pr.sec || 0)}. 왼쪽 서식 차례대로 넣기·버리기만 하면 됩니다.` : ''}</span></div>`;
    if (ST.running && pr) h += `<div class="bar"><i style="width:${pr.calls_total ? Math.round(100 * pr.calls_done / pr.calls_total) : 0}%"></i></div>`;
    if (ITEMS.length) h += `<div class="s">다시 만들어도 넣기·버리기·상태·메모는 파일 기준으로 그대로 남습니다.</div>`;
    h += `<details><summary>업무 키워드·기간 설정</summary><div class="s" style="margin-top:8px">한 줄에 「업무 이름: 키워드, 키워드 | 기간」. 문서 제목·앞부분에 키워드가 많이 든 업무로 분류합니다. 기간을 안 적으면 위 기본 기간.</div><textarea id="areas" style="width:100%;min-height:140px;border:1px solid var(--line);border-radius:8px;padding:8px">${esc(ST.areas_text || '')}</textarea><div class="row"><button class="ghost sm" id="btnAreas">적용(다시 분류)</button><button class="ghost sm" id="btnAreasDefault">기본값으로</button></div></details>`;
  }
  h += '</div>';
  if (ITEMS.length) h += `<div class="good">초안이 있습니다. 왼쪽 「1-가. 담당 업무」부터 차례로 채우세요. <button class="btn sm" id="goS1">서식으로</button></div>`;
  m.innerHTML = h; bindPrep();
}
function bindPrep() {
  const g = $('#goS1'); if (g) g.onclick = () => { sec = 's1a'; rerender(); };
  $('#btnExtract').onclick = () => doExtract($('#folder').value, []);
  $('#btnPick').onclick = () => pkLoad($('#folder').value.trim() || '').catch(e => alert(e.message));
  $('#pkClose').onclick = () => { $('#picker').hidden = true; };
  $('#pkUse').onclick = () => { $('#folder').value = pkCur; $('#picker').hidden = true; doExtract(pkCur, []); };
  $('#btnBrowse').onclick = async () => { const j = await api('/api/browse', {}); if (j.folder) $('#folder').value = j.folder; else $('#extractMsg').innerHTML = '<div class="note">윈도 폴더 창을 열지 못했습니다. 「찾기…」로 고르거나 주소를 붙여 넣으세요.</div>'; };
  const sa = $('#subAll'); if (sa) { sa.onclick = () => $$('.sub').forEach(c => c.checked = true); $('#subNone').onclick = () => $$('.sub').forEach(c => c.checked = false); $('#btnReread').onclick = () => doExtract($('#folder').value, $$('.sub').filter(c => !c.checked).map(c => c.value)); }
  const seg = $('#engineSeg'); if (seg) {
    seg.querySelectorAll('button').forEach(b => b.onclick = async () => { engine = b.dataset.e; ls('engine', engine); if (engine === 'rules') { await settings({model: ''}); } renderMain(); if (engine === 'model') loadModels(); });
    $('#scopeSeg').querySelectorAll('button').forEach(b => b.onclick = () => settings({model_scope: b.dataset.sc}).then(() => renderMain()).catch(e => alert(e.message)));
    ['#model', '#url', '#months'].forEach(s => { const el = $(s); if (el) el.onchange = () => settings().then(() => renderMain()).catch(e => alert(e.message)); });
    $('#btnModels').onclick = loadModels; if (engine === 'model') loadModels();
    $('#btnDraft').onclick = async () => { try { await settings(); await api('/api/draft', {}); await refresh(); } catch (e) { alert(e.message); } };
    const st = $('#btnStop'); if (st) st.onclick = () => { api('/api/stop', {}); $('#progText').textContent = '중단 요청… 진행 중이던 호출 하나가 끝나면 멈춥니다.'; };
    $('#btnAreas').onclick = async () => { try { await settings({areas_text: $('#areas').value}); await refresh(); alert('업무를 다시 나눴습니다. 초안을 다시 만들면 기간도 새로 적용됩니다.'); } catch (e) { alert(e.message); } };
    $('#btnAreasDefault').onclick = async () => { if (!confirm('업무 키워드를 기본값으로 되돌릴까요?')) return; try { await settings({areas_text: ''}); await refresh(); } catch (e) { alert(e.message); } };
  }
}
async function settings(extra) {
  const body = Object.assign({}, extra || {});
  const take = (sel, k, f) => { const el = $(sel); if (el) body[k] = f ? f(el) : el.value; };
  if (!('model' in body)) take('#model', 'model'); take('#url', 'url', el => el.value.trim()); take('#months', 'months', el => +el.value);
  if (engine === 'rules') body.model = '';
  else if (body.model === '') delete body.model;
  const j = await api('/api/settings', body);
  ST = Object.assign(ST, await api('/api/state'));
  OV = ST.overview || {}; ASSETS = ST.assets || {};
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
  if (ITEMS.length && !confirm(`지금 초안 ${ITEMS.length}건이 있습니다. 폴더를 다시 읽으면 초안을 다시 만들어야 합니다(넣기·버리기는 파일 기준으로 남습니다). 계속할까요?`)) return;
  try { await api('/api/extract', {folder, exclude: exclude || []}); await refresh(); } catch (e) { $('#extractMsg').innerHTML = '<div class="bad">' + esc(e.message) + '</div>'; }
}
let pkCur = '';
async function pkLoad(path) {
  const j = await api('/api/ls?path=' + encodeURIComponent(path || '')); if (j.error) return alert(j.error);
  pkCur = j.path; $('#picker').hidden = false; $('#pkPath').textContent = j.path ? `${j.path} (파일 ${j.files}개)` : '드라이브·자주 쓰는 폴더';
  $('#pkUp').disabled = !j.parent && !j.path; $('#pkUse').disabled = !j.path;
  $('#pkList').innerHTML = j.dirs.length ? j.dirs.map(d => `<span class="d" data-p="${esc(d.path)}">📁 ${esc(d.name)}</span>`).join('') : '<span class="s">하위 폴더가 없습니다. 「이 폴더로」를 누르세요.</span>';
  $$('#pkList .d').forEach(el => el.onclick = () => pkLoad(el.dataset.p)); $('#pkUp').onclick = () => pkLoad(j.parent || '');
}

// --- 1-가. 담당 업무
function renderS1a(m) {
  const used = usedAreas(); const ro = mode === 'take';
  let h = head('1-가. 담당 업무', '인계자·인수자·입회자(바로 위 상급자)와 일자를 적고, 업무마다 한 줄 설명과 조심할 것을 적습니다. 숫자는 문서에서 센 것입니다.');
  h += `<div class="q"><div class="row"><label>인계자 <input type="text" id="hFrom" value="${esc(ST.handover_from || '')}" placeholder="이름(직급)" ${ro ? 'disabled' : ''}></label><label>인수자 <input type="text" id="hTo" value="${esc(ST.handover_to || '')}" placeholder="이름(직급)" ${ro ? 'disabled' : ''}></label><label>입회자 <input type="text" id="hWit" value="${esc(ST.witness || '')}" placeholder="바로 위 상급자" ${ro ? 'disabled' : ''}></label><label>일자 <input type="text" id="hDate" value="${esc(ST.handover_date || '')}" placeholder="YYYY-MM-DD" style="width:130px" ${ro ? 'disabled' : ''}></label><label>소속 <input type="text" id="hOrg" value="${esc(ST.org || '')}" placeholder="예) 정읍우체국 영업과 우편영업실" style="width:260px" ${ro ? 'disabled' : ''}></label></div></div>`;
  h += '<div class="sec"><h3>업무별 설명 <span class="chip">키워드로 나눈 것 · 준비 화면에서 고칠 수 있음</span></h3>' + used.map(a => { const r = ITEMS.filter(i => areaOf(i) === a); const c = completeness(a); const ov = OV[a] || {}; const n = k => r.filter(i => i.kind3 === k && i.keep && !isSug(i)).length;
    return `<div class="q"><div class="qt">${esc(a)} <span class="chip">현안 ${n('현안')} · 반복 ${n('반복')} · 문서 ${r.filter(i => i.keep && !isSug(i)).length}</span> ${c.done ? '<span class="st ok">작성</span>' : c.sug ? `<span class="st ai">제안 ${c.sug}</span>` : ''}</div><input data-ov="desc" data-a="${esc(a)}" value="${esc(ov.desc || '')}" placeholder="이 업무가 무엇인지 한 줄 (예: 요금후납 계약 체결·갱신·미납 관리)" ${ro ? 'disabled' : ''}><input data-ov="tip" data-a="${esc(a)}" value="${esc(ov.tip || '')}" placeholder="자주 틀리거나 조심할 것 (예: 미납 2개월째 업체는 발송 정지 전에 유선 통보)" style="margin-top:6px" ${ro ? 'disabled' : ''}></div>`; }).join('') + '</div>';
  m.innerHTML = h; bindCopy();
  const sv = () => settings({handover_from: $('#hFrom').value, handover_to: $('#hTo').value, witness: $('#hWit').value, handover_date: $('#hDate').value, org: $('#hOrg').value}).then(() => renderNav()).catch(e => alert(e.message));
  ['#hFrom', '#hTo', '#hWit', '#hDate', '#hOrg'].forEach(s => $(s).onchange = sv);
  m.querySelectorAll('input[data-ov]').forEach(t => t.onchange = async () => { const a = t.dataset.a; OV[a] = Object.assign({}, OV[a] || {}, {[t.dataset.ov]: t.value}); await settings({overview: OV}); ST.overview = OV; renderNav(); renderAside(); });
}
// --- 1-나. 반복 업무(연간 일정)
function calHtml(rows) {
  const k = rows.filter(i => i.keep && !isSug(i));
  const months = {}; for (let i = 1; i <= 12; i++) months[i] = [];
  k.forEach(i => { const mm = (i.recur && i.recur.month) || (i.date ? +i.date.slice(5, 7) : 0); if (mm >= 1 && mm <= 12) months[mm].push(i); });
  let h = '<div class="cal">';
  for (let i = 1; i <= 12; i++) h += `<div class="m ${months[i].length ? '' : 'empty'}"><b>${i}월</b>${months[i].map(x => `<div>${esc(x.title)}</div>`).join('') || '없음'}</div>`;
  return h + '</div>';
}
function renderS1b(m) {
  const rows = recurs();
  let h = head('1-나. 주요 업무계획 및 진행사항(반복 업무)', '해마다 같은 제목으로 오는 공문을 지난 3년 파일 날짜에서 찾았습니다. 달력에 넣으려면 「넣기」, 아니면 「버리기」. 후임자가 할 일은 한 줄로.', bulkBtns(rows));
  h += calHtml(rows);
  h += '<div class="sec">' + sortRows(rows).map(i => card(i)).join('') + (rows.length ? '' : '<div class="s">해마다 되풀이되는 문서를 찾지 못했습니다. 아래에서 직접 적을 수 있습니다.</div>') + '</div>';
  h += addRow('반복');
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows); bindAdd('반복'); bindCopy();
}
// --- 1-다. 현안
function renderS1c(m) {
  const rows = issues().filter(i => isSug(i) || i.status !== '미결');
  let h = head('1-다. 현안사항 및 문제점', '기한이 남았거나 최근에 온 문서, 미결·보류 같은 말이 든 문서입니다. 넣기 → 상태·다음에 할 일 한 줄. 「미결」로 두면 1-라로 갑니다.', bulkBtns(rows));
  for (const a of usedAreas()) { const r = rows.filter(i => areaOf(i) === a); if (!r.length) continue; h += `<div class="sec"><h3>${esc(a)} <span class="chip">${r.filter(i => i.keep && !isSug(i)).length}건${r.filter(isSug).length ? ' · 제안 ' + r.filter(isSug).length : ''}</span></h3>` + sortRows(r).map(i => card(i)).join('') + '</div>'; }
  if (!rows.length) h += '<div class="s">현안 후보가 없습니다. 아래에서 직접 적을 수 있습니다.</div>';
  h += addRow('현안');
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows); bindAdd('현안'); bindCopy();
}
// --- 1-라. 미결
function renderS1d(m) {
  const rows = issues().filter(i => !isSug(i) && i.keep && i.status === '미결');
  let h = head('1-라. 주요 미결사항', '1-다에서 상태를 「미결(회신·결정 대기)」로 둔 것입니다. 「다음에 할 일」이 비면 후임자가 무엇을 기다려야 하는지 모릅니다.');
  h += '<div class="sec">' + (rows.map(i => card(i)).join('') || '<div class="s">미결로 표시한 현안이 없습니다.</div>') + '</div>';
  m.innerHTML = h; bindCards(m); bindCopy();
}
// --- 2. 관련 문서
function renderS2(m) {
  const info = ST.info || {};
  const rows = ITEMS.filter(i => i.kind3 === '문서');
  let h = head('2. 관련 문서 현황', `최근 ${ST.months || 12}개월 문서를 업무별로. 현안·반복으로 간 것도 함께 실립니다. ${info.manual ? `누적 매뉴얼 「${esc(fileName(info.manual))}」(문서번호 ${info.manual_refs}개)에 없는 공문은 ★ 표시.` : '폴더에 누적 매뉴얼(이름에 「매뉴얼」)이 있으면 반영 여부를 대조합니다.'} 기간 밖 문서 ${info.n_old || 0}건은 폴더에 그대로 둡니다.`, bulkBtns(rows, '그 밖의 문서 제안'));
  for (const a of usedAreas()) { const r = ITEMS.filter(i => areaOf(i) === a); if (!r.length) continue; h += `<div class="sec"><h3>${esc(a)} <span class="chip">${r.filter(i => i.keep && !isSug(i)).length}건</span></h3>` + sortRows(r).map(i => card(i)).join('') + '</div>'; }
  h += addRow('문서');
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows); bindAdd('문서'); bindCopy();
}
// --- 3. 물품·예산
function renderS3(m) {
  m.innerHTML = head('3. 주요 물품 및 예산 등', '문서에서 찾을 수 없어 전임자가 직접 적는 칸입니다. 서식의 필수 항목입니다.') + AS.map(([k, q, ex]) => `<div class="q"><div class="qt">${q}</div><textarea data-as="${k}" ${mode === 'take' ? 'disabled' : ''}>${esc(ASSETS[k] || '')}</textarea>${ASSETS[k] ? '' : `<div class="ex">${esc(ex)}</div>`}</div>`).join('');
  bindCopy();
  m.querySelectorAll('textarea[data-as]').forEach(t => t.onchange = async () => { ASSETS[t.dataset.as] = t.value; await settings({assets: ASSETS}); ST.assets = ASSETS; renderNav(); });
}
// --- 4. 참고: 연락처·매뉴얼·못 읽은 자료
function contactsAll() {
  const seen = new Set(), out = [];
  kept().forEach(it => (it.contacts || []).forEach(c => { if (seen.has(c.phone)) return; seen.add(c.phone); out.push({a: areaOf(it), c, it}); }));
  return out;
}
function renderS4(m) {
  const info = ST.info || {}; const people = contactsAll();
  let h = head('4. 그 밖의 참고사항', '넣기로 고른 문서에 적힌 문의처·담당자입니다(같은 번호는 하나로). 누적 매뉴얼과 못 읽은 자료도 여기 실립니다.');
  h += '<div class="sec"><h3>관계자 연락처</h3>';
  for (const a of usedAreas()) { const r = people.filter(p => p.a === a); if (!r.length) continue; h += `<h4 style="margin:10px 0 4px">${esc(a)}</h4><div class="people">` + r.map(p => `<div class="person"><b>${esc(p.c.name)}</b><span></span><span class="ph">${esc(p.c.phone)}</span><span></span><span class="why">${esc(p.c.line)} · ${esc(p.it.title)}</span></div>`).join('') + '</div>'; }
  if (!people.length) h += '<div class="s">문서에서 찾은 연락처가 없습니다.</div>';
  h += '</div>';
  h += `<div class="sec"><h3>누적 업무 매뉴얼</h3>${info.manual ? `<div class="good">${esc(info.manual)} — 문서번호 ${info.manual_refs}개 반영. 매뉴얼에 아직 없는 공문 ${info.n_unreflected || 0}건은 「2. 관련 문서 현황」에 ★로 표시했습니다. 후임자가 해당 절에 반영하면 됩니다.</div>` : '<div class="s">폴더에서 누적 매뉴얼을 찾지 못했습니다(이름에 「매뉴얼」이 든 docx·hwpx 파일).</div>'}</div>`;
  const fails = (ST.failures || []).filter(x => !x.skip), skips = (ST.failures || []).filter(x => x.skip);
  const by = {}; fails.forEach(x => { const k = String(x.reason).replace(/\(.*$/, '').trim(); by[k] = (by[k] || 0) + 1; });
  h += `<div class="sec"><h3>확인하지 못한 자료 <span class="chip">붙임으로 실림</span></h3><div class="pills"><span class="pill">못 읽은 문서 <b>${fails.length}</b></span><span class="pill">읽지 않는 형식 <b>${skips.length}</b></span></div><table><tr><th>이유</th><th class="num">파일</th></tr>${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}</table><details><summary>파일별 보기(${fails.length})</summary><table>${fails.map(x => `<tr><td>${esc(x.file)}</td><td class="s">${esc(x.reason)}</td></tr>`).join('')}</table></details></div>`;
  m.innerHTML = h; bindCopy();
}

// ---------------------------------------------------------------- 오른쪽: 물어보기·완성도
function renderAside() {
  const box = $('#checklist'); if (!ITEMS.length) { box.innerHTML = '<div>초안을 만들면 여기에 완성도가 보입니다.</div>'; return; }
  const used = usedAreas(); box.innerHTML = used.map(a => { const c = completeness(a); return `<div><span>${esc(a)}</span><span class="${c.done ? 'ok' : 'no'}">${c.done ? '완료' : c.sug ? '제안 ' + c.sug : !c.desc ? '설명 없음' : '할 일 빈 현안 ' + c.noNext}</span></div>`; }).join('') + `<div><span>물품·예산</span><span class="${AS.every(([k]) => (ASSETS[k] || '').trim()) ? 'ok' : 'no'}">${AS.filter(([k]) => (ASSETS[k] || '').trim()).length}/4</span></div><div><span>인계·인수·입회자</span><span class="${ST.handover_from && ST.handover_to && ST.witness ? 'ok' : 'no'}">${[ST.handover_from, ST.handover_to, ST.witness].filter(Boolean).length}/3</span></div>`;
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
    m.insertAdjacentHTML('afterbegin', `<div class="good">업무인계·인수서를 만들었습니다(작업 폴더 ${esc(ST.work)}). ${files.map(n => `<a href="/api/download?name=${encodeURIComponent(n)}">${esc(n)}</a>`).join(' · ')} — .docx는 워드·한글에서 열어 서식에 맞추고, _온나라.txt는 칸마다 붙여 넣는 글, 원본지문.csv는 원본이 바뀌지 않았다는 증빙입니다.</div>`); window.scrollTo(0, 0); } catch (e) { alert(e.message); }
};
$('#btnPrint').onclick = () => { if (!ITEMS.length) return alert('인쇄할 초안이 없습니다.'); renderPrintView(); window.print(); };
function renderPrintView() {
  const k = kept(); const used = usedAreas();
  const pi = it => `<div class="pi">${it.date ? '[' + esc(it.date) + '] ' : ''}${esc(it.title)}${it.docno ? ' (' + esc(it.docno) + ')' : ''}${it.kind3 === '현안' ? ' [' + STATUS[it.status || '진행'] + ']' : ''}${it.due_next ? ' · 기한 ' + esc(it.due_next) : ''}${it.todo ? ' → 할 일: ' + esc(it.todo) : ''}${it.next ? ' → 다음: ' + esc(it.next) : ''}${it.note ? ' — ' + esc(it.note) : ''}<span class="s">${it.file ? esc(it.file) : '전임자가 직접 적음'}</span></div>`;
  let h = `<h2>업무인계·인수서 · ${esc(ST.title || '')}</h2><p>인계자 ${esc(ST.handover_from || '')} · 인수자 ${esc(ST.handover_to || '')} · 입회자 ${esc(ST.witness || '')} · ${esc(ST.handover_date || new Date().toLocaleDateString('ko-KR'))} · ${esc(ST.org || '')} · 돌다리 v${esc(ST.version || '')}</p>`;
  h += '<h3>1. 업무현황</h3><h4>가. 담당 업무</h4>' + used.map(a => { const ov = OV[a] || {}; return `<p><b>${esc(a)}</b> ${esc(ov.desc || '')}${ov.tip ? ' · 조심할 것: ' + esc(ov.tip) : ''}</p>`; }).join('');
  h += '<h4>나. 주요 업무계획 및 진행사항</h4>' + (recurs().filter(i => i.keep && !isSug(i)).map(pi).join('') || '<p>(없음)</p>');
  h += '<h4>다. 현안사항 및 문제점</h4>' + (issues().filter(i => i.keep && !isSug(i) && i.status !== '미결').map(pi).join('') || '<p>(없음)</p>');
  h += '<h4>라. 주요 미결사항</h4>' + (issues().filter(i => i.keep && !isSug(i) && i.status === '미결').map(pi).join('') || '<p>(없음)</p>');
  h += '<h3>2. 관련 문서 현황</h3>' + used.map(a => `<h4>${esc(a)}</h4>` + k.filter(i => areaOf(i) === a).map(pi).join('')).join('');
  h += '<h3>3. 주요 물품 및 예산 등</h3>' + AS.map(([kk, q]) => `<p><b>${q}</b> ${esc(ASSETS[kk] || '(적지 않음)')}</p>`).join('');
  h += '<h3>4. 그 밖의 참고사항</h3>' + (contactsAll().map(p => `<div class="pi">${esc(p.a)} · ${esc(p.c.name)} · ${esc(p.c.phone)} · ${esc(p.c.line)}</div>`).join('') || '<p>(없음)</p>');
  const fails = (ST.failures || []).filter(x => !x.skip); h += `<h3>붙임. 확인하지 못한 자료</h3>` + (fails.slice(0, 300).map(x => `<div class="pi">${esc(x.file)} — ${esc(x.reason)}</div>`).join('') || '<p>(없음)</p>') + (fails.length > 300 ? `<p>…외 ${fails.length - 300}개</p>` : '');
  $('#printView').innerHTML = h;
}

// ---------------------------------------------------------------- 시작
mode = ls('mode') || 'give'; $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.m === mode));
engine = ls('engine') || 'rules';
refresh().then(() => { const s = ls('sec'); if (ITEMS.length && s && s !== 'prep') sec = s; else sec = 'prep'; if (ST.model && engine === 'rules') engine = 'model'; rerender(); }).catch(e => { $('#main').innerHTML = '<div class="bad">서버와 연결하지 못했습니다: ' + esc(e.message) + '</div>'; });
