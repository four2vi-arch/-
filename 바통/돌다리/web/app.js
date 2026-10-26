'use strict';
// 돌다리 v3 화면: 문서 한 건 = 카드 한 장. 별지 제12호서식(업무인계·인수서) 차례대로 채운다.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const KINDS = ['현안', '반복', '문서', '연혁', '현황'];
const STATUS = {'진행': '진행 중', '미결': '미결(회신·결정 대기)', '완료': '끝남'};
const AS = [['acct', '계정·비밀번호 보관처 (비밀번호 자체는 적지 마세요 · 어디에 보관돼 있는지만)', '예) 우편영업 시스템 계정은 서무 담당이 관리, 비밀번호는 봉인 봉투'], ['goods', '열쇠·물품·비품', '예) 매대 열쇠 2개(서랍), 전시용 태블릿 1대'], ['budget', '예산·미지급·정산', '예) 홍보 예산 잔액, 업체 미지급 1건(12월 정산)'], ['etc', '그 밖의 당부', '예) 국장 보고는 매주 월요일 오전']];
const SECS = [['s1a', '1-가. 담당 업무'], ['s1b', '1-나. 업무계획·반복 업무'], ['s1c', '1-다. 현안사항'], ['s1d', '1-라. 미결사항'], ['s2', '2. 관련 문서 현황'], ['s3', '3. 물품·예산'], ['s4', '4. 참고(연락처·매뉴얼)']];
const ONNARA = {s1a: '가. 담당 업무', s1b: '나. 주요 업무계획 및 진행사항', s1c: '다. 현안사항 및 문제점', s1d: '라. 주요 미결사항', s2: '2. 관련 문서 현황', s3: '3. 주요 물품 및 예산 등', s4: '4. 그 밖의 참고사항'};
let ST = null, ITEMS = [], AREAS = [], OV = {}, ASSETS = {};
let mode = 'give', sec = 'prep', area = '', pending = {}, timer = null, flushTimer = null, engine = 'rules', wasRunning = false;

async function api(path, body) {
  let r;
  try { r = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}); }
  catch (e) { downBand(true); throw new Error('돌다리 검은 창(서버)이 닫혀 저장하지 못했습니다. 돌다리_실행.bat을 다시 누른 뒤 이 화면을 새로 고치세요.'); }
  downBand(false);
  const j = await r.json(); if (!r.ok) throw new Error(j.error || ('오류 ' + r.status));
  if (body !== undefined && /\/api\/(items|settings)$/.test(path)) { const t = new Date(); $('#saved').textContent = `저장됨 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; }
  return j;
}
function downBand(on) { const b = $('#downBand'); if (b) b.hidden = !on; }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const secText = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초'; };
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
const areaOf = it => it.area || '기타';
const isSug = it => it.decided !== true && it.src !== '직접 입력';   // 아직 넣기·버리기를 누르지 않은 제안
const kept = () => ITEMS.filter(i => i.keep && !isSug(i));
const usedAreas = () => { const conf = AREAS.concat(['기타']); const extra = [...new Set(ITEMS.map(areaOf))].filter(a => !conf.includes(a)).sort(); return conf.slice(0, -1).concat(extra, ['기타']).filter(a => (OV[a] || {}).gone || ITEMS.some(i => areaOf(i) === a && (i.keep || isSug(i)))); };   // 「이미 넘긴 업무」는 항목을 다 빼도 남긴다   // 버린 것만 남은 업무는 뺀다, 설정 밖 업무 이름도 보인다
const issues = () => ITEMS.filter(i => i.kind3 === '현안');
const recurs = () => ITEMS.filter(i => i.kind3 === '반복' || (i.kind3 === '현안' && i.recur));
const fileName = f => String(f || '').split('/').pop();

// ---------------------------------------------------------------- 상태
async function refresh() {
  ST = await api('/api/state');
  $('#ver').textContent = 'v' + (ST.version || '');
  AREAS = (ST.areas_text || '').split('\n').map(l => l.split(/[:：]/)[0].trim()).filter(Boolean);
  OV = ST.overview || {}; ASSETS = ST.assets || {};
  if (ST.step >= 4 || ST.n_items) { const j = await api('/api/items'); ITEMS = j.items; } else ITEMS = [];   // 다시 만드는 동안에도 이전 초안을 볼 수 있게
  setTimeout(fitTop, 0);
  $('#subline').textContent = (ST.folder ? ST.folder + ' · ' : '') + (ST.handover_from || ST.handover_to ? `인계자 ${ST.handover_from || '?'} → 인수자 ${ST.handover_to || '?'} · ` : '') + '이 PC 안에서만 작동';
  renderNav(); renderAside();
  const mb = $('#missBand'); if (mb) { mb.hidden = !(ST.missing && ST.missing.length); mb.textContent = (ST.missing || []).length ? `읽는 데 필요한 부품이 없습니다: ${(ST.missing || []).map(x => x.what + '(' + x.module + ')').join(', ')}. 이 형식은 「못 읽은 문서」로 남습니다. 휴대용 묶음(돌다리_실행.bat)을 쓰거나 「python -m pip install -r 부품목록.txt」를 실행하세요.` : ''; }
  const pr = ST.progress;
  const el = document.activeElement;
  const busy = el && $('#main') && $('#main').contains(el) && ['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName);   // 사용자가 고르는 중이면 화면을 다시 그리지 않는다(모델 목록이 닫히던 것)
  if (ST.running && sec === 'prep' && $('#btnStop') && pr) {
    $('#progText').textContent = progText(pr);
    const bar = $('#main .bar i'); if (bar) bar.style.width = (pr.calls_total ? Math.round(100 * pr.calls_done / pr.calls_total) : 0) + '%';
  } else if ((ST.reloading || ST.extracting) && sec === 'prep' && $('#extractMsg')) {
    $('#extractMsg').innerHTML = extractMsgHtml();   // 되읽기·읽기 중에는 진행 글만 바꾼다
  } else if (!busy) renderMain();
  if (wasRunning && !ST.running && ST.step >= 4 && sec === 'prep' && ITEMS.length) { sec = (ST.handover_from && ST.handover_to && ST.handover_date) ? 's1c' : 's1a'; doneSec = sec; ls('sec', sec); rerender(); }   // 초안이 끝나면 서식 차례대로: 1-가(인계자·인수자·일자)가 비어 있으면 1-가부터, 채워져 있으면 결정할 줄이 많은 1-다 현안으로
  wasRunning = !!ST.running;
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
  const used = usedAreas(); if (!used.length) return {pct: 0, label: '완성도 ·'};
  if (mode === 'take') { const k = kept(); const n = k.filter(i => i.seen).length; return {pct: k.length ? Math.round(100 * n / k.length) : 0, label: `확인 ${n}/${k.length}`}; }
  const n = used.filter(a => completeness(a).done).length;
  return {pct: Math.round(100 * n / used.length), label: `완성도 ${n}/${used.length} 업무`};
}

// ---------------------------------------------------------------- 왼쪽 목차
function renderNav() {
  const nav = $('#nav');
  const prepSt = ST.running || ST.extracting ? '<span class="st ai">진행 중</span>' : ST.step >= 4 ? '<span class="st ok">완료</span>' : ST.step >= 2 ? '<span class="st todo">초안 전</span>' : '<span class="st todo">폴더 전</span>';
  let h = `<div class="lbl">준 비</div><a data-s="prep" href="#prep" class="${sec === 'prep' ? 'cur' : ''}">폴더 읽기 · 초안 ${prepSt}</a><div class="lbl">업무인계·인수서(별지 제12호)</div>`;
  const badge = id => {
    if (!ITEMS.length) return '';
    const sugN = r => r.filter(isSug).length;
    if (id === 's1a') { const n = usedAreas().filter(a => (OV[a] || {}).desc).length; return n === usedAreas().length ? '<span class="st ok">작성</span>' : `<span class="st todo">${n}/${usedAreas().length}</span>`; }
    if (id === 's1b') { const r = recurs(); const s = sugN(r); return s ? `<span class="st ai">확인 전 ${s}</span>` : `<span class="st ok">${r.filter(i => i.keep).length}건</span>`; }
    if (id === 's1c') { const r = issues(); const s = sugN(r); return s ? `<span class="st ai">확인 전 ${s}</span>` : `<span class="st ok">${r.filter(i => i.keep && i.status !== '미결').length}건</span>`; }
    if (id === 's1d') { return `<span class="st">${issues().filter(i => i.keep && !isSug(i) && i.status === '미결').length}건</span>`; }
    if (id === 's2') { const s = ITEMS.filter(i => i.kind3 === '문서' && isSug(i)).length; return s ? `<span class="st ai">확인 전 ${s}</span>` : `<span class="st ok">${kept().length}건</span>`; }
    if (id === 's3') { return AS.every(([k]) => (ASSETS[k] || '').trim()) ? '<span class="st ok">작성</span>' : '<span class="st todo">빈 칸</span>'; }
    if (id === 's4') { return `<span class="st">${contactsAll().length}명</span>`; }
    return '';
  };
  for (const [id, name] of SECS) h += `<a data-s="${id}" href="#${id}" class="${sec === id ? 'cur' : ''}">${name} ${badge(id)}</a>`;
  h += `<div class="lbl">기 타</div><a data-s="log" href="#log" class="${sec === 'log' ? 'cur' : ''}">작업 기록</a>`;
  nav.innerHTML = h;
  $$('#nav a').forEach(el => el.onclick = (e) => { e.preventDefault(); sec = el.dataset.s; ls('sec', sec); ORD = null; renderNav(); renderMain(); renderAside(); window.scrollTo(0, 0); });   // href로 Tab 이동·Enter 가능(키보드만으로 목차를 못 가던 것)
  fitTop();   // 상단 띠 높이가 바뀌어도(인계자↔인수자) 목차·오른쪽 패널 위치를 다시 잰다
  const o = overall(); $('#progLbl').textContent = o.label; $('#progBar').style.width = o.pct + '%';
  ['#btnExport', '#btnPrint', '#btnPreview'].forEach(s => { const b = $(s); if (b) { b.disabled = !ITEMS.length; b.title = ITEMS.length ? '' : '초안을 만든 뒤 쓸 수 있습니다'; } });
}

// ---------------------------------------------------------------- 본문
function renderMain() {
  const m = $('#main');
  if (!ITEMS.length && sec !== 'prep' && sec !== 'log') sec = 'prep';
  if (sec === 'prep') return renderPrep(m);
  if (sec === 'log') { m.innerHTML = `<h2>작업 기록</h2><div id="log">${esc((ST.log || []).join('\n'))}</div>`; return; }
  if (sec === 'preview') { renderPreview(); return; }
  const fn = {s1a: renderS1a, s1b: renderS1b, s1c: renderS1c, s1d: renderS1d, s2: renderS2, s3: renderS3, s4: renderS4}[sec];
  if (fn) { fn(m); m.insertAdjacentHTML('beforeend', stepBar()); bindStepBar(m); m.insertAdjacentHTML('afterbegin', topBands()); bindTopBands(m); }
  if (ST.exports && ST.exports.length && ST.step >= 5) showExports();   // 내보낸 뒤에는 어느 절에서나 받을 수 있게
}
// 절 아래 「이전 절 · 다음 절」: 서식 차례대로 한 절씩 채운다(왼쪽 목차를 찾지 않아도 됨). 마지막 절에서는 내려받기
function stepBar() {
  const i = SECS.findIndex(s => s[0] === sec); if (i < 0) return '';
  const prev = SECS[i - 1], next = SECS[i + 1];
  return `<div class="row stepbar" style="justify-content:space-between;margin-top:28px;border-top:1px solid var(--line2);padding-top:12px">${prev ? `<button class="ghost" data-step="${prev[0]}">← ${esc(prev[1])}</button>` : '<span></span>'}${next ? `<button class="btn" data-step="${next[0]}">다음: ${esc(next[1])} →</button>` : '<button class="btn" id="stepExport">인계·인수서 내려받기</button>'}</div>`;
}
function bindStepBar(root) {
  root.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { sec = b.dataset.step; ls('sec', sec); ORD = null; rerender(); window.scrollTo(0, 0); });
  const e = root.querySelector('#stepExport'); if (e) e.onclick = () => $('#btnExport').click();
}
// 절 맨 위 띠: ① 초안이 끝난 뒤 처음 보는 절에 결과(건수·모델 호출·오류)를 한 번 ② 초안 뒤 기준일(인계 일자)이 바뀌어 초안이 낡았을 때
let doneSec = '';
function topBands() {
  let h = '';
  const info = ST.info || {}, plan = ST.plan || {};
  if (ITEMS.length && info.base_date && plan.base_date && info.base_date !== plan.base_date && !ST.running) h += `<div class="note" id="staleBand"><b>기준일이 바뀌었습니다</b>(초안 ${esc(info.base_date)} → 지금 ${esc(plan.base_date)}). 기간 안 문서·현안 후보·「(지남)」 표시가 달라지므로 <button class="btn sm" id="btnRedraft">초안 다시 만들기</button>를 누르세요. 넣기·버리기·메모·직접 적은 항목은 그대로 남습니다.</div>`;
  if (doneSec === sec && ITEMS.length) {
    const pr = ST.progress || {}, errs = ST.errors || [], nE = errs.filter(e => e.file).length, sysE = errs.filter(e => !e.file);
    h += `<div class="good" id="doneBand"><b>초안 완료</b> · 문서 ${ITEMS.length}건 · 현안 후보 ${issues().length} · 반복 업무 ${recurs().length}${pr.calls_total ? ` · 모델 호출 ${pr.calls_done || 0}/${pr.calls_total}회` : ' · 규칙만'}${nE ? ` · <b style="color:var(--fail)">모델 오류 ${nE}건(그 문서는 규칙 결과로 남음)</b>` : ''}${sysE.length ? ` · <b style="color:var(--fail)">${esc(sysE[0].reason)}</b>` : ''}${pr.stopped ? ' · 중단함' : ''}. ${sec === 's1a' ? '인계자·인수자·입회자와 업무별 한 줄을 적고 아래 「다음」으로 가세요.' : '줄마다 「원문 ▸」로 근거를 보고 넣기·버리기를 하세요.'} <button class="ghost sm" id="doneClose">닫기</button></div>`;
  }
  return h;
}
function bindTopBands(root) {
  const r = root.querySelector('#btnRedraft'); if (r) r.onclick = async () => { try { await api('/api/draft', {}); wasRunning = true; sec = 'prep'; ls('sec', sec); await refresh(); } catch (e) { alert(e.message); } };
  const c = root.querySelector('#doneClose'); if (c) c.onclick = () => { doneSec = ''; renderMain(); };
}
// 넣기·버리기 두 단추는 결정한 뒤에도 그대로 두고 고른 쪽만 채운다(누르면 「빼기」 같은 다른 단추로 바뀌어 「고르는 칸이 사라진」 듯 보이던 것). 다른 쪽을 누르면 바꾼다
function tog(it) {
  const k = !isSug(it) && !!it.keep, o = !isSug(it) && !it.keep;
  return `<button class="y${k ? ' on' : ''}" data-act="in" aria-pressed="${k}" title="${k ? '넣은 줄입니다(결과물에 실림)' : '결과물에 넣기'}">${k ? '✓ 넣음' : '넣기'}</button><button class="n${o ? ' on' : ''}" data-act="out" aria-pressed="${o}" title="${o ? '버린 줄입니다(결과물에 실리지 않음)' : '결과물에서 버리기'}">${o ? '✓ 버림' : '버리기'}</button>`;
}
// 절·업무 머리의 건수: 넣음 · 확인 전 · 버림(넣기를 누르면 줄이 사라지는 게 아니라 「✓ 넣음」으로 바뀐다는 것이 보이게)
const cnt = r => ({in: r.filter(i => i.keep && !isSug(i)).length, sug: r.filter(isSug).length, out: r.filter(i => !i.keep && !isSug(i)).length});
function cntChip(r) { const c = cnt(r); return `<span class="chip">넣음 ${c.in}</span>${c.sug ? ` <span class="chip" style="background:var(--info-bg);color:var(--info)">확인 전 ${c.sug}</span>` : (r.length ? ' <span class="chip cy">모두 확인함</span>' : '')}${c.out ? ` <span class="chip">버림 ${c.out}</span>` : ''}`; }
function head(title, lead, badges) { return `<div class="crumb">업무인계·인수서</div><h2>${esc(title)} ${badges || ''}</h2><p class="lead">${lead}</p>` + copyBar(); }
function copyBar() {
  if (!ONNARA[sec] || !ITEMS.length) return '';
  return `<div class="copybar"><button class="ghost sm" id="btnCopy">온나라에 붙여넣을 글 복사</button><span>서식의 「${esc(ONNARA[sec])}」 칸에 그대로 붙여 넣습니다. 버리기 한 것은 빠지고, 아직 넣기·버리기를 안 누른 제안은 「[확인 전]」 표시로 들어갑니다.</span></div>`;
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
  if (it.recur && it.recur.years) chips.push(`<span class="chip cy">${it.recur.cycle === '매월' ? '매월 · ' + (it.recur.months || []).length + '개월' : '매년 ' + it.recur.month + '월 · ' + it.recur.years.join('·')}</span>`);
  if (it.hist && it.kind3 !== '연혁') chips.push('<span class="chip">연혁</span>');
  if (it.kind3 === '현황') chips.push('<span class="chip">현황 자료</span>');
  if (it.kind3 === '현안' && !sug && it.keep) chips.push(`<span class="chip st">${STATUS[it.status || '진행']}</span>`);
  if (ST.info && ST.info.manual && it.cls === '공문' && !it.reflected) chips.push('<span class="chip st" title="누적 매뉴얼에 이 문서번호·제목이 없음">★ 매뉴얼 미반영</span>');
  if (it.src === '모델') chips.push('<span class="chip">AI 요지</span>');
  if (it.private) chips.push('<span class="chip st" title="멘토 면담·교육과제 같은 개인 문서로 보입니다. 넣지 않으면 결과물에 제목도 싣지 않습니다">개인 문서?</span>');
  if (it.secret) chips.push('<span class="chip st" title="비밀번호·계정 줄이 있습니다. 원문 발췌에서는 가렸습니다">계정 정보 있음</span>');
  if (it.bulk && !isSug(it)) chips.push('<span class="chip">일괄 넣음</span>');
  if (it.status_by === '규칙' && it.status === '미결') chips.push('<span class="chip st" title="원문에 「회신 대기·결론 못 냄」 같은 말이 있어 미결로 제안">미결 제안</span>');
  let body = `<div class="t"><span class="d" ${it.date_src === '수정일' ? 'title="문서에 날짜가 없어 파일 수정일로 대신함"' : ''}>${esc(dateText(it))}</span><input class="text" data-k="title" value="${esc(it.title)}" ${ro ? 'disabled' : ''}>${it.docno ? `<span class="d">${esc(it.docno)}</span>` : ''}${chips.join('')}</div>`;
  if (it.summary) body += `<div class="s">요지: ${esc(it.summary)}</div>`;
  else if (it.quote) body += `<div class="s">원문: ${esc(it.quote)}</div>`;
  if (!ro) body += `<div class="t"><input class="text" data-k="todo" value="${esc(it.todo || '')}" placeholder="후임자가 할 일 (한 줄)"><input class="when" data-k="due_next" value="${esc(it.due_next || '')}" placeholder="기한 YYYY-MM-DD"></div>`;
  else if (it.todo || it.due_next) body += `<div class="s">할 일: ${esc(it.todo || '')}${it.due_next ? ' · 기한 ' + esc(it.due_next) : ''}</div>`;
  if (it.kind3 === '현안' && !sug && it.keep && !ro) body += `<div class="t"><select class="mini" data-k="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(it.status || '진행') === k ? 'selected' : ''}>${v}</option>`).join('')}</select><input class="text" data-k="next" value="${esc(it.next || '')}" placeholder="다음에 할 일(후임자가 이어서 할 것)"></div>`;
  const who = (it.contacts || []).map(c => `${esc(c.name)} ${esc(c.phone)}`).join(', ') || (it.owner ? esc(it.owner) : '');
  body += `<div class="s">${it.file ? `<button class="ghost sm doc-open" data-f="${esc(it.file)}">원문 ▸</button> 파일: ` + esc(it.file) : '전임자가 직접 적음'}${it.attachments && it.attachments.length ? ' · 붙임 ' + it.attachments.length + '개' : ''}${who ? ' · 담당: ' + who : ''}${it.due && it.due.length > 1 ? ' · 기한 후보 ' + it.due.map(d => d.date).join(', ') : ''}</div>`;
  if (!sug && it.keep && !ro) body += `<input class="memo" data-k="note" value="${esc(it.note || '')}" placeholder="메모(후임자에게 남길 말)">`;
  if (ro && it.note) body += `<div class="s">메모: ${esc(it.note)}</div>`;
  if (ro && it.keep) body += `<input class="memo" data-k="question" value="${esc(it.question || '')}" placeholder="전임자에게 물을 것(결과물 4절 「인수자 질문」에 실림)">`;
  if (!ro && it.question) body += `<div class="s">인수자 질문: ${esc(it.question)}</div><input class="memo" data-k="answer" value="${esc(it.answer || '')}" placeholder="답(결과물 4절 「전임자 답」에 실림)">`;
  let act = '';
  if (ro) act = !it.keep && !sug ? '<span class="chip">전임자가 뺌</span>' : `${sug ? '<span class="chip">확인 전</span> ' : ''}<label><input type="checkbox" class="seen" ${it.seen ? 'checked' : ''}> 인수 확인</label>`;
  else if (sug) act = `<button class="y" data-act="in">넣기</button><button class="n" data-act="out">버리기</button><select class="mini" data-k="area" data-autoin="1" title="업무를 바꾸면 넣기로 처리">${AREAS.concat(['기타']).map(a => `<option ${areaOf(it) === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>`;
  else act = tog(it);
  if (!ro && !sug && it.keep) act += `<span class="mv"><select class="mini" data-k="area" title="업무 바꾸기">${AREAS.concat(['기타']).map(a => `<option ${areaOf(it) === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select><select class="mini" data-k="kind3" title="절 바꾸기">${KINDS.map(k => `<option ${it.kind3 === k ? 'selected' : ''}>${k}</option>`).join('')}</select></span>`;
  return `<div class="sug doc ${sug ? '' : it.keep ? 'me' : 'off'}" data-id="${it.id}"><div>${body}</div><div class="act">${act}</div></div>`;
}
function bindCards(root) {
  root.querySelectorAll('.sug[data-id], .trow[data-id]').forEach(el => {
    const id = +el.dataset.id; const it = ITEMS.find(i => i.id === id); if (!it) return;
    el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { mark(id, inp.dataset.k, inp.value); if (inp.dataset.autoin && isSug(it)) { mark(id, 'keep', true); mark(id, 'decided', true); } if (inp.dataset.k === 'area' || inp.dataset.k === 'kind3') { renderNav(); renderAside(); } });   // 업무·절을 바꿔도 카드는 다음 화면 이동 때까지 제자리(바뀌어 사라진 줄 알던 것)
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { const on = b.dataset.act === 'in';
      if (!on && it.kind3 === '현안' && it.recur && it.recur.years && confirm(`「${it.title}」은(는) 해마다 오는 업무입니다(${it.recur.years.join('·')}). 현안에서는 빼고 1-나 반복 업무로 남길까요?\n[확인] 반복 업무로 남김  [취소] 완전히 버림`)) { mark(id, 'kind3', '반복'); mark(id, 'keep', true); mark(id, 'decided', true); rerender(); return; }
      mark(id, 'keep', on); mark(id, 'decided', true); rerender(); });
    const sn = el.querySelector('.seen'); if (sn) sn.onchange = () => { mark(id, 'seen', sn.checked); renderNav(); renderAside(); };
    const dv = el.querySelector('.doc-open'); if (dv) dv.onclick = () => toggleDoc(el, dv);
  });
}
// 원문 보기: 앞 30줄과 기한·미결·후임 같은 말이 든 줄(파일을 따로 열지 않고 넣기·버리기를 판단)
async function toggleDoc(el, btn) {
  const old = el.querySelector('.docview'); if (old) { old.remove(); btn.textContent = '원문 ▸'; return; }
  try { const j = await api('/api/doc?file=' + encodeURIComponent(btn.dataset.f));
    const box = document.createElement(el.tagName === 'TR' ? 'tr' : 'div'); box.className = 'docview';
    const inner = `${j.hot.length ? `<div class="hot"><b>눈여겨볼 줄</b>${j.hot.map(l => `<div>${esc(l)}</div>`).join('')}</div>` : ''}<div class="head"><b>앞부분</b>${j.head.map(l => `<div>${esc(l)}</div>`).join('')}${j.n_lines > 30 ? `<div class="s">… 전체 ${j.n_lines}줄</div>` : ''}</div>`;
    box.innerHTML = el.tagName === 'TR' ? `<td colspan="9">${inner}</td>` : inner;
    if (el.tagName === 'TR') el.after(box); else el.querySelector('div').appendChild(box);
    btn.textContent = '원문 ▾'; } catch (e) { alert(e.message); }
}
function dateText(it) { const d = String(it.date || ''); if (!d) return '날짜 없음'; if (it.date_src === '연도만') return d.slice(0, 4) + '년'; return d + (it.date_src === '수정일' ? '(수정일)' : ''); }
let dirtyAfterExport = false;
function mark(id, k, v) { dirtyAfterExport = true; pending[id] = pending[id] || {id}; pending[id][k] = v; const it = ITEMS.find(i => i.id === id); if (it) { it[k] = v; if (k === 'area') it.area_by = '사람'; } clearTimeout(flushTimer); flushTimer = setTimeout(flush, 500); }
async function flush() {
  if (!Object.keys(pending).length) return;
  const body = {changes: Object.values(pending)}; pending = {};
  try { const j = await api('/api/items', body); ITEMS = j.items; renderNav(); renderAside(); } catch (e) { body.changes.forEach(c => { pending[c.id] = Object.assign({}, c, pending[c.id] || {}); }); alert('저장 실패: ' + e.message); }   // 실패한 변경은 다시 보낼 수 있게 남긴다
}
window.addEventListener('beforeunload', () => { if (Object.keys(pending).length && navigator.sendBeacon) navigator.sendBeacon('/api/items', JSON.stringify({changes: Object.values(pending)})); });
function rerender() { renderNav(); renderMain(); renderAside(); }
function bulkBtns(rows, label) {
  const s = rows.filter(isSug); if (!s.length || mode === 'take') return '';
  return `<span class="r"><button class="ghost sm" data-bulk="in" title="한꺼번에 넣은 것은 결과물에 [일괄 넣음]으로 표시됩니다">${label || '확인 전'} ${s.length}개 모두 넣기</button><button class="ghost sm" data-bulk="out">모두 버리기</button></span>`;
}
function areaOut(a, rows) { const n = rows.filter(isSug).length; return n && mode !== 'take' ? `<span class="r"><button class="ghost sm" data-areaout="${esc(a)}">이 업무 확인 전 ${n}개 버리기</button></span>` : ''; }
function bindAreaOut(root, rowsFn) {
  root.querySelectorAll('[data-areaout]').forEach(b => b.onclick = async () => { const a = b.dataset.areaout; const ids = rowsFn().filter(i => areaOf(i) === a && isSug(i)).map(i => i.id);
    if (!confirm(`「${a}」의 확인 전 ${ids.length}개를 모두 버릴까요? (이미 넘긴 업무 등)`)) return;
    try { const j = await api('/api/items', {changes: Object.values(pending), bulk: [{ids, keep: false}]}); pending = {}; ITEMS = j.items; rerender(); } catch (e) { alert(e.message); } });
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
let view = ls('view') || 'table';   // 'table' = 한 줄씩 표로 빠르게 정리, 'card' = 카드
function viewSeg() { return mode === 'take' ? '' : `<span class="r"><span class="seg" id="viewSeg"><button data-v="table" class="${view === 'table' ? 'on' : ''}">표로 보기</button><button data-v="card" class="${view === 'card' ? 'on' : ''}">카드로 보기</button></span></span>`; }
function bindView(root) { const s = root.querySelector('#viewSeg'); if (s) s.querySelectorAll('button').forEach(b => b.onclick = () => { view = b.dataset.v; ls('view', view); ORD = null; renderMain(); }); }
// 한 줄 = 문서 한 건. 넣기/버리기/상태/할 일을 표 안에서 바로 고친다
function triTable(rows, o) {
  o = o || {}; const ro = mode === 'take';
  const tr = it => { const sug = isSug(it); const chips = [];
    if (it.recur && it.recur.years) chips.push(`<span class="chip cy">${it.recur.cycle === '매월' ? '매월' : '매년 ' + it.recur.month + '월'}</span>`);
    if (ST.info && ST.info.manual && it.cls === '공문' && !it.reflected) chips.push('<span class="chip st">★</span>');
    if (it.src === '모델') chips.push('<span class="chip">AI</span>');
    const act = ro ? (!it.keep && !sug ? '<span class="chip">뺌</span>' : `<label><input type="checkbox" class="seen" ${it.seen ? 'checked' : ''}> 인수 확인</label><input class="text" data-k="question" value="${esc(it.question || '')}" placeholder="물을 것" style="margin-top:3px">`)
      : sug ? `<button class="y" data-act="in">넣기</button> <button class="n" data-act="out">버리기</button>${it.private ? ' <span class="chip st">개인?</span>' : ''}${it.secret ? ' <span class="chip st">계정</span>' : ''}` : tog(it);
    return `<tr class="trow ${sug ? 'sugrow' : !it.keep ? 'offrow' : ''}" data-id="${it.id}"><td class="d">${esc(dateText(it))}</td><td><input class="text" data-k="title" value="${esc(it.title)}" ${ro ? 'disabled' : ''}><div class="s" title="${esc(it.file || '')}">${it.file ? `<button class="ghost sm doc-open" data-f="${esc(it.file)}">원문 ▸</button> ` : ''}${esc(it.cls || '')}${it.docno ? ' · ' + esc(it.docno) : ''} · ${esc(fileName(it.file))}${it.summary ? '<br>요지: ' + esc(it.summary) : it.quote ? '<br>원문: ' + esc(it.quote) : ''}</div></td>
      <td>${chips.join(' ')}</td>${o.issue ? `<td>${!sug && it.keep && !ro ? `<select class="mini" data-k="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(it.status || '진행') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : esc(STATUS[it.status || '진행'])}<input class="when" data-k="due_next" value="${esc(it.due_next || '')}" placeholder="기한" style="width:100%;margin-top:3px" ${ro ? 'disabled' : ''}></td>` : ''}
      <td>${ro ? esc(it.todo || '') + (it.next ? '<br>다음: ' + esc(it.next) : '') : `<input class="text" data-k="todo" value="${esc(it.todo || '')}" placeholder="할 일">${o.issue ? `<input class="text" data-k="next" value="${esc(it.next || '')}" placeholder="다음에 할 일" style="margin-top:3px">` : ''}`}</td>
      <td class="act">${act}${!ro && !sug && it.keep ? `<div class="mv"><select class="mini" data-k="area" title="업무">${AREAS.concat(['기타']).map(a => `<option ${areaOf(it) === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select><select class="mini" data-k="kind3" title="절">${KINDS.map(k => `<option ${it.kind3 === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>` : ''}</td></tr>`; };
  return `<table class="tri"><tr><th style="width:84px">날짜</th><th style="min-width:38%">문서</th><th style="width:52px"></th>${o.issue ? '<th style="width:124px">상태·기한</th>' : ''}<th style="width:23%">할 일${o.issue ? ' · 다음' : ''}</th><th style="width:118px"></th></tr>${rows.map(tr).join('')}</table>`;
}
// 순서: 제안 먼저, 최근 것 먼저. 한 절 안에서는 넣기·버리기를 눌러도 줄이 제자리에 있게(다른 절로 갈 때 다시 정렬)
let ORD = null;
function sortRows(r) {
  const s = r.slice().sort((x, y) => (isSug(y) - isSug(x)) || String(y.date || '').localeCompare(String(x.date || '')));
  if (!ORD) ORD = {}; let n = Object.keys(ORD).length; s.forEach(it => { if (!(it.id in ORD)) ORD[it.id] = n++; });
  return r.slice().sort((x, y) => ORD[x.id] - ORD[y.id]);
}

function extractMsgHtml() {
  const x = ST.extracting;
  if (x) return `<div class="note">읽는 중 ${x.index}/${x.total} · ${secText(x.sec || 0)} · ${esc(x.file || '')}</div><div class="bar"><i style="width:${x.total ? Math.round(100 * x.index / x.total) : 0}%"></i></div>`;
  if (ST.reloading) return '<div class="note">이전 폴더의 글자를 뒤에서 되읽는 중입니다(큰 폴더는 몇 분). 그동안 모델·기간 설정은 할 수 있고, 「초안 만들기」는 끝난 뒤 누르세요.</div>';
  if (ST.extract_error) return `<div class="bad">${esc(ST.extract_error)}</div>`;
  return '';
}
// --- 준비
function renderPrep(m) {
  const x = ST.extracting; const f = ST.files || [];
  let h = head('폴더 읽기 · 초안 만들기', '처음 한 번만 하는 준비입니다. 문서 한 건이 카드 한 장이 되고, 왼쪽 서식 차례대로 넣기·버리기만 하면 됩니다.');
  h += `<div class="sec"><h3>① 업무 폴더</h3><div class="row"><button class="btn" id="btnBrowse" title="윈도 폴더 선택 창에서 고르면 바로 읽습니다">폴더 찾아보기…</button><input type="text" id="folder" class="wide" value="${esc(ST.folder || '')}" placeholder="또는 폴더 주소를 붙여 넣고 「읽기」  예) C:\\업무\\우편영업실"><button class="ghost" id="btnPick" title="이 화면 안에서 폴더 목록을 눌러 고릅니다">화면에서 고르기</button>${(ST.recent || []).length ? `<select id="recent" title="최근에 읽은 폴더를 다시 읽습니다"><option value="">최근 폴더</option>${(ST.recent || []).map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>` : ''}<button class="btn" id="btnExtract" ${x ? 'disabled' : ''}>읽기</button></div>
    <div id="picker" class="picker" hidden><div class="row"><b>폴더 고르기</b> <span id="pkPath" class="s"></span><button class="ghost sm" id="pkUp">위로</button><button class="btn sm" id="pkUse">이 폴더로</button><button class="ghost sm" id="pkClose">닫기</button></div><div id="pkList"></div></div><div id="extractMsg">${extractMsgHtml()}</div>`;
  const os_ = ST.ocr_status || {}; const engs = ['windows', 'tesseract', 'rapidocr'].filter(k => os_[k] && os_[k].ok);
  const ocrHint = engs.length ? `쓸 수 있는 엔진: ${engs.map(k => k + (os_[k].why ? '(' + os_[k].why + ')' : '')).join(' · ')}` : ['windows', 'rapidocr', 'tesseract'].map(k => os_[k] ? k + ': ' + os_[k].why : '').filter(Boolean).join(' / ');
  h += `<details><summary>고급 설정: 스캔 문서 글자 읽기(OCR)</summary><div class="row"><label>스캔 문서 OCR <select id="ocr">${[['off', '끄기'], ['auto', '자동(있는 엔진)'], ['windows', '윈도 내장 OCR'], ['tesseract', 'Tesseract'], ['rapidocr', 'RapidOCR']].map(([v, t]) => `<option value="${v}" ${(ST.ocr || 'auto') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>앞 <select id="ocrPages">${[1, 3, 5, 10, 30].map(n => `<option value="${n}" ${(+ST.ocr_pages || 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select>쪽까지</label><label><input type="checkbox" id="ocrImages" ${ST.ocr_images ? 'checked' : ''}> 그림 파일(jpg·png)도 OCR</label><span class="s">${os_.pdf && !os_.pdf.ok ? os_.pdf.why : ocrHint}${ST.ocr_engine ? ` · 지금: ${esc(ST.ocr_engine)}` : (ST.ocr || 'auto') !== 'off' ? ' · 지금: 엔진 없음(스캔 PDF는 못 읽음으로 남음)' : ''}</span></div></details>`;
  if (f.length) {
    h += `<div class="pills"><span class="pill">읽은 문서 <b>${f.length}</b></span>${ST.n_ocr ? `<span class="pill">OCR로 읽음 <b>${ST.n_ocr}</b></span>` : ''}<span class="pill">못 읽은 문서 <b>${ST.n_fail || 0}</b></span><span class="pill">읽지 않는 형식 <b>${ST.n_skip || 0}</b></span><span class="pill">원본 변경 <b>${ST.originals_changed || 0}</b></span></div>`;
    if (ST.warn) h += `<div class="note">${esc(ST.warn)}</div>`;
    if (ST.areas_src === '폴더') h += `<div class="note">업무를 맨 위 폴더 이름(${esc(AREAS.slice(0, 6).join(', '))}${AREAS.length > 6 ? ' …' : ''})으로 나눴습니다. 폴더가 업무별이 아니면(월별·종류별 등) <button class="ghost sm" id="btnKeyword">키워드로 나누기</button></div>`;
    if (ST.subdirs && ST.subdirs.length) { const ex = new Set(ST.exclude || []); h += `<details><summary>읽을 하위 폴더 고르기(${ST.subdirs.length - ex.size}/${ST.subdirs.length})</summary>` + ST.subdirs.map(d => `<label style="display:inline-flex;gap:4px;margin:2px 10px 2px 0"><input type="checkbox" class="sub" value="${esc(d)}" ${ex.has(d) ? '' : 'checked'}>${esc(d)}</label>`).join('') + `<div class="row"><button class="ghost sm" id="subAll">모두</button><button class="ghost sm" id="subNone">모두 해제</button><button class="ghost sm" id="btnReread">이 폴더들로 다시 읽기</button></div></details>`; }
  }
  h += `</div><div class="sec"><h3>② 초안 만들기</h3>`;
  if (!f.length) h += '<div class="s">먼저 폴더를 읽으세요.</div>';
  else {
    const p = ST.plan || {};
    h += `<div class="row"><label>기간 <select id="months">${[6, 12, 18, 24, 36].map(n => `<option value="${n}" ${(+ST.months || 12) === n ? 'selected' : ''}>최근 ${n}개월</option>`).join('')}</select></label><label>인계 일자 <input type="text" id="hDate2" value="${esc(ST.handover_date || '')}" placeholder="YYYY-MM-DD" style="width:130px" title="기간과 「(지남)」 표시의 기준일. 1-가의 「일자」와 같은 칸입니다. 비우면 오늘(폴더의 최근 문서가 90일보다 오래됐으면 그 다음 날)"></label><span class="s">업무마다 다르게 두려면 아래 「업무 키워드」 줄 끝에 「| 24개월」처럼 적습니다. 해마다 오는 업무는 기간과 상관없이 지난 3년 파일 날짜로 찾습니다.</span></div>`;
    h += `<div class="s">기간 기준일 <b>${esc(p.base_date || '')}</b>(${esc(p.base_why || '')}). 인계 일자를 1-가에 적으면 그날 기준으로 다시 셉니다.${p.base_warn ? ` <b style="color:var(--fail)">${esc(p.base_warn)}</b>` : ''}${p.n_dupver ? ` 같은 파일 사본·이전 판 ${p.n_dupver}건은 최신 하나만 올립니다.` : ''}${p.n_private ? ` 개인 문서로 보이는 ${p.n_private}건은 현안으로 올리지 않습니다.` : ''}${p.n_secret ? ` <b style="color:var(--fail)">비밀번호·계정 줄이 든 문서 ${p.n_secret}건</b>(발췌에서 가림).` : ''}</div>`;
    h += `<div class="pills"><span class="pill">기간 안 문서 <b>${p.n_items || 0}</b></span><span class="pill">현안 후보 <b>${p.n_issue || 0}</b></span><span class="pill">반복 업무 <b>${p.n_recur || 0}</b></span><span class="pill">연혁 <b>${p.n_hist || 0}</b></span><span class="pill">현황 자료 <b>${p.n_status || 0}</b></span><span class="pill">그 밖의 문서 <b>${p.n_doc || 0}</b></span><span class="pill">기간 밖 <b>${p.n_old || 0}</b></span><span class="pill">붙임 <b>${p.n_attach || 0}</b></span></div>`;
    h += `<div class="row"><div class="seg" id="engineSeg"><button data-e="rules" class="${engine === 'rules' ? 'on' : ''}">규칙만 · 몇 초</button><button data-e="model" class="${engine === 'model' ? 'on' : ''}">AI 모델도 사용 · 요지·할 일 받기</button></div>
      <span id="modelRow" ${engine === 'model' ? '' : 'hidden'}><select id="model"><option value="">모델 고르기</option>${ST.model ? `<option value="${esc(ST.model)}" selected>${esc(ST.model)}</option>` : ''}</select> <input type="text" id="url" value="${esc(ST.url || '')}" style="width:280px">${ST.remote_ok ? ` <input type="password" id="key" value="${esc(ST.key || '')}" placeholder="키(기관 서버가 요구할 때만)" style="width:200px" title="실행 옵션 --allow-model-host 로 기관 서버를 허용했을 때만 보입니다. 이 PC 작업 폴더의 세션 파일에 저장됩니다">` : ''} <button class="ghost sm" id="btnModels">목록 새로고침</button>
      <div class="seg" id="scopeSeg" style="display:inline-flex;margin-left:8px"><button data-sc="issues" class="${(ST.model_scope || 'issues') === 'issues' ? 'on' : ''}">현안 후보만</button><button data-sc="all" class="${ST.model_scope === 'all' ? 'on' : ''}">기간 안 전부</button></div></span><span class="s" id="planHint"></span></div>`;
    h += engine === 'model' && ST.model ? `<div class="note">모델 <b>${esc(ST.model)}</b>에 문서 ${p.calls || 0}건(한 건에 한 번). 예상 약 ${secText(p.est_sec || 0)}. 「여기까지만」으로 끊어도 결과는 남고, 모델 응답은 호출마다 저장되어 중간에 꺼져도 이어서 갑니다.${ST.checkpoint && ST.checkpoint.reusable ? ` 저장된 이전 응답 ${ST.checkpoint.reusable}회는 다시 부르지 않습니다.` : ''}</div>` : `<div class="s">규칙만: 문서마다 날짜·문서번호·제목·기한·담당·소관 업무를 읽습니다. 수천 파일도 몇 초입니다. 모델은 현안 후보의 「요지·할 일」 한 줄을 보탭니다(없어도 됩니다).</div>`;
    const pr = ST.progress;
    h += `<div class="row"><button class="btn" id="btnDraft" ${ST.running ? 'disabled' : ''}>초안 만들기</button>${ST.running ? '<button class="ghost sm" id="btnStop" style="color:var(--fail);border-color:var(--fail)">여기까지만(중단)</button>' : ''}<span class="s" id="progText">${ST.running && pr ? progText(pr) : ST.step >= 4 && pr ? `끝났습니다. 문서 ${ITEMS.length}건 · 모델 호출 ${pr.calls_done || 0}회 · ${secText(pr.sec || 0)}. 왼쪽 서식 차례대로 넣기·버리기만 하면 됩니다. 넣기 전 제안도 인쇄·내보내기에 「확인 전」으로 실립니다.` : ''}</span></div>`;
    if (ST.running && pr) h += `<div class="bar"><i style="width:${pr.calls_total ? Math.round(100 * pr.calls_done / pr.calls_total) : 0}%"></i></div>`;
    if (ITEMS.length) h += `<div class="s">다시 만들거나 폴더를 다시 읽어도 넣기·버리기·상태·메모·고친 글·직접 적은 항목은 파일 기준으로 그대로 남습니다.</div>`;
    h += `<div class="row"><label>누적 매뉴얼 파일 <input type="text" id="manualPath" value="${esc(ST.manual_path || '')}" placeholder="비우면 폴더 안에서 자동으로 찾음. 폴더 밖이면 파일 주소(docx·hwpx·md)" style="width:520px"></label>${ST.info && ST.info.manual ? `<span class="s">지금 잡힌 매뉴얼: ${esc(ST.info.manual)}</span>` : ''}</div>`;
    h += `<details><summary>업무 키워드·기간 설정${ST.areas_src === '폴더' ? ' <span class="chip">폴더 이름으로 나눔</span>' : ''}</summary><div class="s" style="margin-top:8px">한 줄에 「업무 이름: 키워드, 키워드 | 기간」. 맨 위 폴더 이름이 업무 이름과 같으면 그 업무로, 아니면(미분류·서식 폴더 등) 제목·앞부분에 키워드가 많이 든 업무로 분류합니다. 기간을 안 적으면 위 기본 기간.</div><textarea id="areas" style="width:100%;min-height:140px;border:1px solid var(--line);border-radius:8px;padding:8px">${esc(ST.areas_text || '')}</textarea><div class="row"><button class="ghost sm" id="btnAreas">적용(다시 분류)</button><button class="ghost sm" id="btnAreasDefault">기본값으로</button><span class="s" style="margin-left:8px">다른 기관 보기:</span>${(ST.presets || []).map(([n]) => `<button class="ghost sm" data-preset="${esc(n)}" title="이 보기의 업무·키워드로 채우고 바로 다시 나눕니다">${esc(n)}</button>`).join('')}</div></details>`;
  }
  h += '</div>';
  if (ITEMS.length) { const nS = ITEMS.filter(isSug).length; h += `<div class="good">초안이 있습니다. 왼쪽 「1-가. 담당 업무」부터 차례로 채우세요. <button class="btn sm" id="goS1">서식으로</button>${nS && mode === 'give' ? ` <button class="ghost sm" id="btnAllIn" style="font-size:.78rem">확인 전 ${nS}건 한꺼번에 넣기</button><span class="s"> (한꺼번에 넣은 것은 결과물에 [일괄 넣음]으로 표시)</span>` : ''}</div>`; }
  h += `<details><summary>처음 쓰는 분 · 다섯 단계</summary><div class="s" style="margin-top:6px">① 폴더를 읽고, 인계 일자를 적은 뒤 「초안 만들기」(규칙만이면 몇 초). ② 1-가에서 인계자·인수자·입회자와 업무별 한 줄 설명. ③ 1-다 현안에서 넣기·버리기, 미결은 상태를 「미결」로. ④ 3절 물품·예산을 직접 적기. ⑤ 「인계·인수서 내려받기」 → docx는 서식에 맞추고 _온나라.txt는 칸마다 붙여 넣기. 넣기 전 제안도 「확인 전」으로 함께 실립니다.</div></details>`;
  m.innerHTML = h; bindPrep();
}
function bindPrep() {
  const g = $('#goS1'); if (g) g.onclick = () => { sec = 's1a'; rerender(); };
  const kw = $('#btnKeyword'); if (kw) kw.onclick = async () => { try { await settings({areas_mode: 'keyword', areas_text: ''}); await refresh(); alert('업무를 키워드로 다시 나눴습니다. 필요하면 아래 「업무 키워드·기간 설정」에서 업무 이름과 키워드를 고치세요. 초안을 다시 만들면 반영됩니다.'); } catch (e) { alert(e.message); } };
  const ai = $('#btnAllIn'); if (ai) ai.onclick = async () => { const ids = ITEMS.filter(isSug).map(i => i.id); if (!confirm(`제안 ${ids.length}건을 모두 넣을까요? 필요 없는 것은 각 절에서 「버리기」로 바꾸면 됩니다.`)) return;
    try { const j = await api('/api/items', {changes: Object.values(pending), bulk: [{ids, keep: true}]}); pending = {}; ITEMS = j.items; sec = 's1c'; rerender(); } catch (e) { alert(e.message); } };
  $('#btnExtract').onclick = () => doExtract($('#folder').value, []);
  $('#folder').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doExtract($('#folder').value, []); } };   // 주소를 붙여 넣고 Enter
  ['#ocr', '#ocrPages', '#ocrImages'].forEach(s => { const el = $(s); if (el) el.onchange = () => api('/api/settings', {ocr: $('#ocr').value, ocr_pages: +$('#ocrPages').value, ocr_images: $('#ocrImages').checked}).then(refresh).catch(e => alert(e.message)); });
  $('#btnPick').onclick = () => pkLoad($('#folder').value.trim() || '').catch(e => alert(e.message));
  $('#pkClose').onclick = () => { $('#picker').hidden = true; };
  $('#pkUse').onclick = () => { $('#folder').value = pkCur; $('#picker').hidden = true; doExtract(pkCur, []); };
  $('#btnBrowse').onclick = async () => {   // 윈도 폴더 창에서 고르면 바로 읽는다. 창을 못 띄우는 PC(권한·원격 접속 등)는 화면 안 폴더 목록으로
    const bb = $('#btnBrowse'); bb.disabled = true; $('#extractMsg').innerHTML = '<div class="note">윈도 폴더 창을 띄웠습니다. 안 보이면 작업 표시줄에서 그 창을 누르세요.</div>';
    let j = {}; try { j = await api('/api/browse', {}); } catch (e) { j = {}; }
    bb.disabled = false;
    if (j.folder) { $('#folder').value = j.folder; doExtract(j.folder, []); }
    else if (j.cancelled) { $('#extractMsg').innerHTML = extractMsgHtml(); }
    else { $('#extractMsg').innerHTML = '<div class="note">이 PC에서는 윈도 폴더 창을 열지 못해 화면 안 목록으로 고릅니다.</div>'; pkLoad($('#folder').value.trim() || '').catch(e => alert(e.message)); } };
  const rc = $('#recent'); if (rc) rc.onchange = () => { if (rc.value) { $('#folder').value = rc.value; doExtract(rc.value, []); } };
  $$('[data-preset]').forEach(b => b.onclick = () => { const p = (ST.presets || []).find(x => x[0] === b.dataset.preset); if (!p) return; $('#areas').value = p[1]; $('#btnAreas').click(); });
  const sa = $('#subAll'); if (sa) { sa.onclick = () => $$('.sub').forEach(c => c.checked = true); $('#subNone').onclick = () => $$('.sub').forEach(c => c.checked = false); $('#btnReread').onclick = () => doExtract($('#folder').value, $$('.sub').filter(c => !c.checked).map(c => c.value)); }
  const seg = $('#engineSeg'); if (seg) {
    seg.querySelectorAll('button').forEach(b => b.onclick = async () => { engine = b.dataset.e; ls('engine', engine); if (engine === 'rules') { await settings({model: ''}); } renderMain(); if (engine === 'model') loadModels(); });
    $('#scopeSeg').querySelectorAll('button').forEach(b => b.onclick = () => settings({model_scope: b.dataset.sc}).then(() => renderMain()).catch(e => alert(e.message)));
    ['#model', '#url', '#key', '#months', '#hDate2', '#manualPath'].forEach(s => { const el = $(s); if (el) el.onchange = () => settings().then(() => renderMain()).catch(e => alert(e.message)); });
    $('#btnModels').onclick = loadModels; if (engine === 'model') loadModels();
    $('#btnDraft').onclick = async () => { try {
      if (engine === 'model') { const j = await api('/api/models'); if (!j.models.length && !confirm('AI 모델(Ollama)에 연결하지 못했습니다. 규칙만으로 초안을 만들까요?')) return; if (!ST.model && !confirm('모델을 고르지 않았습니다. 규칙만으로 초안을 만들까요?')) return; }
      await settings(); await api('/api/draft', {}); wasRunning = true; await refresh(); } catch (e) { alert(e.message); } };
    const st = $('#btnStop'); if (st) st.onclick = () => { api('/api/stop', {}); $('#progText').textContent = '중단 요청… 진행 중이던 호출 하나가 끝나면 멈춥니다. 모델이 처리하지 못한 문서는 규칙 결과로 남습니다.'; };
    $('#btnAreas').onclick = async () => { try { await settings({areas_text: $('#areas').value}); await refresh(); alert('업무를 다시 나눴습니다. 초안을 다시 만들면 기간도 새로 적용됩니다.'); } catch (e) { alert(e.message); } };
    $('#btnAreasDefault').onclick = async () => { if (!confirm('업무 키워드를 기본값으로 되돌릴까요?')) return; try { await settings({areas_text: ''}); await refresh(); } catch (e) { alert(e.message); } };
  }
}
async function settings(extra) {
  const body = Object.assign({}, extra || {});
  if (Object.keys(body).some(k => ['overview', 'assets', 'handover_from', 'handover_to', 'witness', 'handover_date', 'org', 'areas_text'].includes(k))) dirtyAfterExport = true;
  const take = (sel, k, f) => { const el = $(sel); if (el) body[k] = f ? f(el) : el.value; };
  if (!('model' in body)) take('#model', 'model'); take('#url', 'url', el => el.value.trim()); take('#key', 'key', el => el.value.trim()); take('#hDate2', 'handover_date', el => el.value.trim()); take('#months', 'months', el => +el.value); take('#manualPath', 'manual_path', el => el.value.trim());
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
  if (ITEMS.length && !confirm(`지금 초안 ${ITEMS.length}건이 있습니다. 폴더를 다시 읽으면 「초안 만들기」를 한 번 더 눌러야 합니다(넣기·버리기·메모·직접 적은 항목은 파일 기준으로 이어집니다). 계속할까요?`)) return;
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
  h += `<div class="q"><div class="row"><label>인계자 <input type="text" id="hFrom" value="${esc(ST.handover_from || '')}" placeholder="이름(직급)" ${ro ? 'disabled' : ''}></label><label>인수자 <input type="text" id="hTo" value="${esc(ST.handover_to || '')}" placeholder="이름(직급)" ${ro ? 'disabled' : ''}></label><label>입회자 <input type="text" id="hWit" value="${esc(ST.witness || '')}" placeholder="바로 위 상급자" ${ro ? 'disabled' : ''}></label><label>일자 <input type="text" id="hDate" value="${esc(ST.handover_date || '')}" placeholder="YYYY-MM-DD" style="width:130px" ${ro ? 'disabled' : ''}></label><label>소속 <input type="text" id="hOrg" value="${esc(ST.org || '')}" placeholder="예) ○○우체국 ○○과" style="width:260px" ${ro ? 'disabled' : ''}></label></div></div>`;
  h += `<div class="sec"><h3>업무별 설명 <span class="chip">${ST.areas_src === '폴더' ? '맨 위 폴더 이름으로 나눈 것' : '키워드로 나눈 것'} · 준비 화면에서 고칠 수 있음</span></h3>` + used.map(a => { const r = ITEMS.filter(i => areaOf(i) === a); const c = completeness(a); const ov = OV[a] || {}; const n = k => r.filter(i => i.kind3 === k && i.keep && !isSug(i)).length; const sN = r.filter(isSug).length;
    const hist = r.filter(i => i.kind3 === '연혁' || i.hist).sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
    const stat = r.filter(i => i.kind3 === '현황');
    return `<div class="q"><div class="qt">${esc(a)} <span class="chip">넣음: 현안 ${n('현안')} · 반복 ${n('반복')} · 문서 ${r.filter(i => i.keep && !isSug(i)).length}${sN ? ' · 확인 전 ' + sN : ''}</span> ${c.done ? '<span class="st ok">작성</span>' : c.sug ? `<span class="st ai">확인 전 ${c.sug}</span>` : ''}${!ro ? ` <button class="ghost sm" data-gone="${esc(a)}" title="앞서 다른 사람에게 넘긴 업무: 남은 확인 전 제안을 모두 버리고 1-가에 「인계 완료」 한 줄만 남깁니다">이미 넘긴 업무</button>` : ''}</div>${ov.gone ? `<div class="s">[인계 완료] ${esc(ov.gone)}</div>` : ''}<input data-ov="desc" data-a="${esc(a)}" value="${esc(ov.desc || '')}" placeholder="이 업무가 무엇인지 한 줄 (예: 요금후납 계약 체결·갱신·미납 관리)" ${ro ? 'disabled' : ''}><input data-ov="tip" data-a="${esc(a)}" value="${esc(ov.tip || '')}" placeholder="자주 틀리거나 조심할 것 (예: 미납 2개월째 업체는 발송 정지 전에 유선 통보)" style="margin-top:6px" ${ro ? 'disabled' : ''}>${hist.length || stat.length ? `<details ${hist.filter(isSug).length || stat.filter(isSug).length ? 'open' : ''}><summary>연혁 ${hist.length}건 · 현황 자료 ${stat.length}건 ${bulkBtns(hist.concat(stat), '연혁·현황 제안')}</summary>${hist.map(i => card(i)).join('')}${stat.map(i => card(i)).join('')}</details>` : ''}</div>`; }).join('') + '</div>';
  h += '<div class="s">연혁은 제목에 협약·계약·개정·변경·도입·종료·이관·지정·시범 같은 전환점 말이 있거나 옛 인수인계서·누적 매뉴얼에 든 문서입니다. 기간 밖이어도 업무마다 최근 12건까지 올립니다. 현황 자료는 대장·현황·명단·실적 파일의 최신판입니다. 그 밖의 기간 밖 문서는 내보내기의 붙임 1에 업무·연도별 제목으로 실립니다.</div>';
  m.innerHTML = h; bindCopy(); bindCards(m); bindBulk(m, b => { const q = b.closest('.q'); const a = q.querySelector('input[data-ov="desc"]').dataset.a; return ITEMS.filter(i => areaOf(i) === a && (i.kind3 === '연혁' || i.hist || i.kind3 === '현황')); });
  m.querySelectorAll('[data-gone]').forEach(b => b.onclick = async () => { const a = b.dataset.gone;
    const who = prompt(`「${a}」을(를) 이미 누구에게 넘겼나요? 예) 2026. 5. 1. 박○○ 주무관에게 인계\n(이 업무의 확인 전 제안 ${ITEMS.filter(i => areaOf(i) === a && isSug(i)).length}건은 모두 버립니다)`, (OV[a] || {}).gone || ''); if (who === null) return;
    OV[a] = Object.assign({}, OV[a] || {}, {gone: who.trim()});
    try { await settings({overview: OV}); const ids = ITEMS.filter(i => areaOf(i) === a && isSug(i)).map(i => i.id); const j = await api('/api/items', {changes: Object.values(pending), bulk: ids.length ? [{ids, keep: false, area_done: true}] : []}); pending = {}; ITEMS = j.items; rerender(); } catch (e) { alert(e.message); } });
  const sv = () => settings({handover_from: $('#hFrom').value, handover_to: $('#hTo').value, witness: $('#hWit').value, handover_date: $('#hDate').value, org: $('#hOrg').value}).then(() => renderNav()).catch(e => alert(e.message));
  ['#hFrom', '#hTo', '#hWit', '#hDate', '#hOrg'].forEach(s => $(s).onchange = sv);
  m.querySelectorAll('input[data-ov]').forEach(t => t.onchange = async () => { const a = t.dataset.a; OV[a] = Object.assign({}, OV[a] || {}, {[t.dataset.ov]: t.value}); try { await settings({overview: OV}); ST.overview = OV; renderNav(); renderAside(); } catch (e) { alert('저장 실패: ' + e.message); } });
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
  h += '<div class="sec">' + sortRows(rows).map(i => card(i)).join('') + (rows.length ? '' : '<div class="s">해마다 되풀이되는 문서를 찾지 못했습니다. 아래에서 직접 적을 수 있습니다.</div>') + '</div>';
  if (rows.some(i => i.keep && !isSug(i))) h += '<h3 style="margin:16px 0 8px">넣은 업무의 연간 달력</h3>' + calHtml(rows);
  h += addRow('반복');
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows); bindAdd('반복'); bindCopy();
}
// --- 1-다. 현안
function renderS1c(m) {
  const rows = issues().filter(i => isSug(i) || i.status !== '미결' || i.status_by === '규칙');   // 규칙이 미결로 제안한 것은 넣은 뒤에도 여기 남긴다(누르자 사라져 놀라던 것). 사람이 미결로 고르면 1-라로
  let h = head('1-다. 현안사항 및 문제점', '기한이 남았거나 최근에 온 문서, 미결·보류 같은 말이 든 문서입니다. 「원문 ▸」로 근거를 보고 넣기 → 상태·다음에 할 일 한 줄. 넣기·버리기를 누르면 줄은 제자리에 남고 고른 단추가 「✓ 넣음」「✓ 버림」으로 채워집니다(다른 쪽을 누르면 바꿈). 상태를 「미결」로 두면 1-라로 옮겨 갑니다.', bulkBtns(rows) + viewSeg());
  for (const a of usedAreas()) { const r = rows.filter(i => areaOf(i) === a); if (!r.length) continue; h += `<div class="sec"><h3>${esc(a)} ${cntChip(r)}${areaOut(a, r)}</h3>` + (view === 'table' ? triTable(sortRows(r), {issue: true}) : sortRows(r).map(i => card(i)).join('')) + '</div>'; }
  if (!rows.length) h += '<div class="s">현안 후보가 없습니다. 아래에서 직접 적을 수 있습니다.</div>';
  h += addRow('현안');
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows); bindAreaOut(m, () => rows); bindAdd('현안'); bindCopy(); bindView(m);
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
  const rows = ITEMS;
  let h = head('2. 관련 문서 현황', `최근 ${ST.months || 12}개월 문서를 업무별로. 결과물 2절에는 「문서」 항목만 실리고, 현안·반복은 1-나·1-다에 실립니다(여기서 버리면 거기서도 빠집니다). ${info.manual ? `누적 매뉴얼 「${esc(fileName(info.manual))}」(문서번호 ${info.manual_refs}개)에 없는 공문은 ★ 표시.` : '폴더에 누적 매뉴얼(이름에 「매뉴얼」)이 있으면 반영 여부를 대조합니다.'} 기간 밖 문서 ${info.n_old || 0}건은 폴더에 그대로 둡니다.`, bulkBtns(rows, '이 절의 제안'));
  h = h.replace('</p>', '</p>' + (mode === 'take' ? '' : `<div class="row">${viewSeg().replace('class="r"', '')}</div>`));
  for (const a of usedAreas()) { const r = ITEMS.filter(i => areaOf(i) === a); if (!r.length) continue; h += `<div class="sec"><h3>${esc(a)} ${cntChip(r)}${areaOut(a, r)}</h3>` + (view === 'table' ? triTable(sortRows(r)) : sortRows(r).map(i => card(i)).join('')) + '</div>'; }
  h += addRow('문서');
  m.innerHTML = h; bindCards(m); bindBulk(m, () => rows); bindAreaOut(m, () => ITEMS); bindAdd('문서'); bindCopy(); bindView(m);
}
// --- 3. 물품·예산
function renderS3(m) {
  const hints = (ST.info && ST.info.asset_hints) || {};
  m.innerHTML = head('3. 주요 물품 및 예산 등', '전임자가 직접 적는 칸입니다(서식의 필수 항목). 문서에서 관련 있어 보이는 줄을 아래에 참고로 보여 드립니다. 「넣기」를 누르면 칸에 덧붙습니다.') + AS.map(([k, q, ex]) => `<div class="q"><div class="qt">${q}</div><textarea data-as="${k}" ${mode === 'take' ? 'disabled' : ''}>${esc(ASSETS[k] || '')}</textarea>${ASSETS[k] ? '' : `<div class="ex">${esc(ex)}</div>`}${(hints[k] || []).length && mode !== 'take' ? `<details><summary>문서에서 찾은 관련 줄 ${hints[k].length}개(참고)</summary>${hints[k].map((x, i) => `<div class="s" style="margin:3px 0"><button class="ghost sm" data-hint="${k}" data-i="${i}">넣기</button> ${esc(x.line)} <span style="color:var(--ink3)">· ${esc(fileName(x.file))}</span></div>`).join('')}</details>` : ''}</div>`).join('');
  m.querySelectorAll('[data-hint]').forEach(b => b.onclick = () => { const k = b.dataset.hint, x = hints[k][+b.dataset.i]; const t = m.querySelector(`textarea[data-as="${k}"]`); t.value = (t.value ? t.value + '\n' : '') + x.line; t.onchange(); b.disabled = true; });
  bindCopy();
  m.querySelectorAll('textarea[data-as]').forEach(t => t.onchange = async () => { ASSETS[t.dataset.as] = t.value; try { await settings({assets: ASSETS}); ST.assets = ASSETS; renderNav(); } catch (e) { alert('저장 실패: ' + e.message); } });
}
// --- 4. 참고: 연락처·매뉴얼·못 읽은 자료
function contactsAll() {
  const seen = new Set(), out = [];
  ITEMS.filter(i => i.keep).forEach(it => (it.contacts || []).forEach(c => { if (seen.has(c.phone)) return; seen.add(c.phone); out.push({a: areaOf(it), c, it}); }));   // 내보내기와 같게: 버리기 한 것만 빼고, 확인 전 제안도 함께
  return out;
}
function renderS4(m) {
  const info = ST.info || {}; const people = contactsAll();
  let h = head('4. 그 밖의 참고사항', '문서에 적힌 문의처·담당자입니다(같은 번호는 하나로, 버리기 한 문서는 뺌, 아직 확인 전인 문서는 [확인 전]). 누적 매뉴얼과 못 읽은 자료도 여기 실립니다.');
  h += '<div class="sec"><h3>관계자 연락처</h3>';
  for (const a of usedAreas()) { const r = people.filter(p => p.a === a); if (!r.length) continue; h += `<h4 style="margin:10px 0 4px">${esc(a)}</h4><div class="people">` + r.map(p => `<div class="person"><b>${esc(p.c.name)}</b><span></span><span class="ph">${esc(p.c.phone)}</span><span></span><span class="why">${esc(p.c.line)} · ${esc(p.it.title)}${isSug(p.it) ? ' [확인 전]' : ''}</span></div>`).join('') + '</div>'; }
  if (!people.length) h += '<div class="s">문서에서 찾은 연락처가 없습니다.</div>';
  h += '</div>';
  h += `<div class="sec"><h3>누적 업무 매뉴얼</h3>${info.manual ? `<div class="good">${esc(info.manual)} · 문서번호 ${info.manual_refs}개 반영. 매뉴얼에 아직 없는 공문 ${info.n_unreflected || 0}건은 「2. 관련 문서 현황」에 ★로 표시했습니다. 후임자가 해당 절에 반영하면 됩니다.</div>` : '<div class="s">폴더에서 누적 매뉴얼을 찾지 못했습니다(이름에 「매뉴얼」이 든 docx·hwpx 파일).</div>'}</div>`;
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
function fitTop() { const t = document.querySelector('.top'); if (!t) return; const hgt = t.offsetHeight; document.documentElement.style.setProperty('--toph', hgt + 'px'); }
window.addEventListener('resize', fitTop);
function applyPrefs() { document.documentElement.style.setProperty('--s', String(+(ls('fs') || 1))); const t = ls('theme'); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
$('#fsup').onclick = () => { ls('fs', Math.min(1.4, +(ls('fs') || 1) + 0.1).toFixed(2)); applyPrefs(); };
$('#fsdn').onclick = () => { ls('fs', Math.max(0.8, +(ls('fs') || 1) - 0.1).toFixed(2)); applyPrefs(); };
$('#thm').onclick = () => { ls('theme', ls('theme') === 'dark' ? '' : 'dark'); applyPrefs(); };
applyPrefs();
$('#btnExport').onclick = async () => {
  if (!ITEMS.length) return alert('초안이 없습니다. 준비 화면에서 폴더를 읽고 초안을 만드세요.');
  await flush();
  const warn = [];   // 내보내기 전 점검: 서식에 빈칸으로 나갈 것
  const who = [['인계자', ST.handover_from], ['인수자', ST.handover_to], ['입회자', ST.witness]].filter(x => !x[1]).map(x => x[0]);
  if (who.length) warn.push(`· ${who.join('·')} 이름이 비어 있습니다(1-가 맨 위)`);
  const ib = (ST.info || {}).base_date, pb = (ST.plan || {}).base_date; if (ib && pb && ib !== pb) warn.push(`· 기준일이 바뀌었는데(초안 ${ib} → 지금 ${pb}) 초안을 다시 만들지 않았습니다. 기간·현안·「(지남)」이 옛 기준일로 나갑니다`);
  const nS = ITEMS.filter(i => i.keep && isSug(i)).length; if (nS) warn.push(`· 아직 넣기·버리기를 안 누른 제안 ${nS}건이 「[확인 전]」 표시로 함께 실립니다`);
  const nA = AS.filter(([k]) => !(ASSETS[k] || '').trim()).length; if (nA) warn.push(`· 3절 물품·예산 ${nA}칸이 「(적지 않음)」으로 나갑니다`);
  const nD = usedAreas().filter(a => !((OV[a] || {}).desc || (OV[a] || {}).gone || '').trim()).length; if (nD) warn.push(`· 1-가 업무 설명이 빈 업무 ${nD}개(「(적지 않음)」으로 나감)`);
  const nT = ITEMS.filter(i => i.kind3 === '현안' && i.keep && !(i.todo || '').trim() && !(i.next || '').trim()).length; if (nT) warn.push(`· 1-다 할 일·다음이 빈 현안 ${nT}건(인수자가 무엇을 할지 모름)`);
  const nB = ITEMS.filter(i => i.keep && i.bulk).length; if (nB) warn.push(`· 한꺼번에 넣은 ${nB}건은 [일괄 넣음]으로 표시됩니다`);
  const nP = ITEMS.filter(i => i.keep && !isSug(i) && i.private).length; if (nP) warn.push(`· 개인 문서로 보이는 ${nP}건을 넣었습니다: ${ITEMS.filter(i => i.keep && !isSug(i) && i.private).slice(0, 4).map(i => i.title).join(', ')}`);
  const nS2 = ITEMS.filter(i => i.keep && i.secret).length; if (nS2) warn.push(`· 비밀번호·계정 줄이 든 문서 ${nS2}건(발췌에서는 가렸지만 원문을 확인하세요)`);
  if (warn.length && !confirm('내보내기 전에 확인하세요.\n\n' + warn.join('\n') + '\n\n이대로 만들까요? (나중에 고쳐서 다시 내보낼 수 있습니다)')) return;
  try { await api('/api/export', {}); ST = await api('/api/state'); dirtyAfterExport = false; showExports(); window.scrollTo(0, 0); } catch (e) { alert(e.message); }
};
function exportsHtml() {
  const files = ST.exports || []; if (!files.length) return '';
  const link = n => `<a href="/api/download?name=${encodeURIComponent(n)}">${esc(n)}</a>`;
  const docx = files.find(n => n.endsWith('.docx')), rest = files.filter(n => n !== docx);
  if (dirtyAfterExport) return `<div class="note" id="exportBox"><b>내려받은 뒤 고친 내용이 있습니다.</b> 예전 파일(${esc(files[0] || '')})에는 반영되지 않았으니 오른쪽 위 「인계·인수서 내려받기」를 다시 누르세요. <button class="ghost sm" id="btnOpenWork">작업 폴더 열기</button></div>`;
  return `<div class="good" id="exportBox"><b>업무인계·인수서를 만들었습니다.</b> ${docx ? `<a class="btn sm" style="text-decoration:none" href="/api/download?name=${encodeURIComponent(docx)}">워드 파일(.docx) 받기</a>` : ''} <button class="ghost sm" id="btnOpenWork">작업 폴더 열기</button>
    <div class="s" style="margin-top:6px">.docx는 한글·워드에서 열어 서식에 붙입니다. 그 밖의 파일: ${rest.map(link).join(' · ')} (_온나라.txt는 온나라 칸마다 붙여 넣는 글, _원본지문.csv는 원본이 바뀌지 않았다는 증빙). 위치: ${esc(ST.work || '')}</div></div>`;
}
function showExports() {
  const old = $('#exportBox'); if (old) old.remove();
  $('#main').insertAdjacentHTML('afterbegin', exportsHtml());
  const b = $('#btnOpenWork'); if (b) b.onclick = async () => { const j = await api('/api/openwork', {}); if (!j.ok) alert(j.error); };
}
$('#btnPrint').onclick = async () => { if (!ITEMS.length) return alert('인쇄할 초안이 없습니다.'); await renderPrintView(); window.print(); };
$('#btnPreview').onclick = async () => { if (!ITEMS.length) return alert('초안이 없습니다.'); sec = 'preview'; ls('sec', sec); renderNav(); await renderPreview(); };
async function renderPrintView() {
  await flush();
  const j = await api('/api/report'); document.getElementById('printView').innerHTML = j.html;   // 본문 밖(맨 끝)의 인쇄 전용 칸
}
async function renderPreview() {
  const m = $('#main'); m.innerHTML = head('인쇄 미리보기', '내려받는 docx·인쇄물과 같은 서식 표입니다. 고치려면 왼쪽 절로 가서 카드를 바꾸면 바로 반영됩니다.') + '<div class="previewWrap"><div class="pvDoc"></div></div>';
  const j = await api('/api/report'); m.querySelector('.pvDoc').innerHTML = j.html;
}
// ---------------------------------------------------------------- 시작
mode = ls('mode') || 'give'; $$('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.m === mode));
engine = ls('engine') || 'rules';
refresh().then(() => { const s = ls('sec'); if (ITEMS.length && s && s !== 'prep') sec = s; else sec = 'prep'; if (ST.model && engine === 'rules') engine = 'model'; rerender(); }).catch(e => { $('#main').innerHTML = '<div class="bad">서버와 연결하지 못했습니다: ' + esc(e.message) + '</div>'; });
