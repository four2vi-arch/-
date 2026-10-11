'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안'];
const CYCLES = ['매주', '매월', '분기', '반기', '매년', '해당 월', '1회'];
let ST = null, ITEMS = [], DROPPED = [], pending = {}, timer = null;
let view = 'folder', tab = '월별 할 일', fArea = '', fCycle = '', q = '';
const PAGE_STEP = 200; const PAGE = {};
let AREAS = [];

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ('오류 ' + r.status));
  return j;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])); }
function secText(s) { s = Math.max(0, Math.round(s)); return s >= 3600 ? Math.floor(s / 3600) + '시간 ' + Math.floor(s % 3600 / 60) + '분' : s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초'; }
function mon(w) { const m = /(\d{1,2})월/.exec(w || ''); return m ? +m[1] : 99; }
function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

// ---------------------------------------------------------------- 화면 전환
function show(v) {
  view = v; ls('view', v);
  $$('.view').forEach(el => el.classList.toggle('on', el.id === 'v-' + v));
  $$('nav#side a').forEach(a => a.classList.toggle('cur', a.dataset.v === v));
  if (v === 'review') renderItems(); if (v === 'cycle') renderCycle(); if (v === 'area') renderArea(); if (v === 'files') renderFilesView();
  window.scrollTo(0, 0);
}
$$('nav#side a').forEach(a => a.onclick = () => show(a.dataset.v));
function navState() {
  const step = ST.step || 1;
  const map = {folder: 1, setup: 2, run: 3, review: 4, export: 5};
  $$('nav#side a').forEach(a => {
    const n = map[a.dataset.v]; if (!n) return;
    a.classList.toggle('done', n < step); a.classList.toggle('off', n > step && !(n === 2 && ST.files && ST.files.length));
  });
  $('#cFolder').textContent = ST.files && ST.files.length ? ST.files.length + '개' : '';
  $('#cRun').textContent = ST.running ? '진행 중' : '';
  $('#cReview').textContent = ITEMS.length ? ITEMS.filter(i => i.keep).length + '/' + ITEMS.length : '';
  $('#cExport').textContent = (ST.exports || []).length ? (ST.exports.length) + '개' : '';
}

// ---------------------------------------------------------------- 상태
async function refresh() {
  ST = await api('/api/state');
  if (ST.version) $('#ver').textContent = 'v' + ST.version;
  if (ST.folder && !$('#folder').value) $('#folder').value = ST.folder;
  if (!$('#url').value) $('#url').value = ST.url;
  $('#tables').checked = !!ST.include_tables; $('#recent').value = String(ST.recent_years || 0); $('#maxCalls').value = String(ST.max_calls || 3); $('#skipRef').checked = ST.skip_reference !== false;
  if (document.activeElement !== $('#title')) $('#title').value = ST.title || '';
  if (document.activeElement !== $('#areas')) $('#areas').value = ST.areas_text || '';
  AREAS = (ST.areas_text || '').split('\n').map(l => l.split(/[:：]/)[0].trim()).filter(Boolean);
  $('#log').textContent = (ST.log || []).join('\n');
  renderFiles(); renderSubdirs(); renderPlan(); renderProgress(); renderExports();
  if (ST.step >= 4 && !ITEMS.length) await loadItems();
  navState();
  if (ST.extracting) { renderExtracting(); $('#btnExtract').disabled = true; } else if ($('#btnExtract').disabled && !ST.running) { $('#btnExtract').disabled = false; }
  if (ST.running || ST.reloading || ST.extracting) { clearTimeout(timer); timer = setTimeout(refresh, ST.reloading ? 3000 : 1500); }
}

// ---------------------------------------------------------------- 1. 폴더
function failGroups() {
  const fails = (ST.failures || []).filter(x => !x.skip), skips = (ST.failures || []).filter(x => x.skip);
  const byReason = {}; fails.forEach(x => { const k = String(x.reason).replace(/\(.*$/, '').trim(); byReason[k] = (byReason[k] || 0) + 1; });
  const byExt = {}; skips.forEach(x => { const m = /\.([^.]+)$/.exec(x.file); const k = m ? '.' + m[1].toLowerCase() : '(없음)'; byExt[k] = (byExt[k] || 0) + 1; });
  return {fails, skips, byReason, byExt};
}
function renderFiles() {
  const box = $('#files');
  if (!ST.files || !ST.files.length) { box.innerHTML = ''; return; }
  const g = failGroups();
  let h = ST.reloading ? '<div class="note">이전 작업의 폴더 글자를 뒤에서 되읽는 중입니다(큰 폴더는 몇 분). 끝나면 초안 만들기를 누를 수 있습니다.</div>' : '';
  h += `<div class="stats"><div class="stat"><b>${ST.files.length}</b><span>읽은 문서</span></div><div class="stat"><b>${g.fails.length}</b><span>못 읽은 문서(직접 열어 볼 것)</span></div><div class="stat"><b>${g.skips.length}</b><span>읽지 않는 형식(그림·프로그램 등)</span></div><div class="stat"><b>${ST.originals_changed}</b><span>원본 변경(지문 대조)</span></div></div>`;
  if (ST.step >= 2 && !ST.running) h += '<div class="good">읽기가 끝났습니다. 왼쪽 「2. 설정·계획」으로 가서 「초안 만들기」를 누르세요. <button class="sm" id="goSetup">설정·계획으로</button></div>';
  box.innerHTML = h;
  const b = $('#goSetup'); if (b) b.onclick = () => show('setup');
}
function renderFilesView() {
  const box = $('#filesView');
  if (!ST.files || !ST.files.length) { box.innerHTML = '<div class="hint">아직 폴더를 읽지 않았습니다.</div>'; return; }
  const kinds = {}; ST.files.forEach(f => { kinds[f.kind] = kinds[f.kind] || {n: 0, c: 0}; kinds[f.kind].n++; kinds[f.kind].c += f.chars; });
  const g = failGroups();
  let h = '<div class="card"><b>읽은 문서</b><table><tr><th>형식</th><th class="num">파일</th><th class="num">글자 수</th></tr>' + Object.keys(kinds).sort().map(k => `<tr><td>.${k}</td><td class="num">${kinds[k].n}</td><td class="num">${kinds[k].c.toLocaleString()}</td></tr>`).join('') + '</table></div>';
  h += `<div class="card"><b>못 읽은 문서 ${g.fails.length}개</b> <span class="hint">인수인계서에 「직접 열어 볼 것」으로 적힙니다</span><table><tr><th>이유</th><th class="num">파일</th></tr>` + Object.entries(g.byReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('') + '</table>'
    + (g.fails.length ? '<details><summary>파일별 보기</summary><table>' + g.fails.map(x => `<tr><td>${esc(x.file)}</td><td>${esc(x.reason)}</td></tr>`).join('') + '</table></details>' : '') + '</div>';
  h += `<div class="card"><b>읽지 않는 형식 ${g.skips.length}개</b> <span class="hint">그림·영상·프로그램·글꼴·임시 파일. 문서가 아니므로 인수인계서에 적지 않습니다</span><div class="chips">` + Object.entries(g.byExt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${esc(k)} ${v}</span>`).join('') + '</div></div>';
  box.innerHTML = h;
}
function renderSubdirs() {
  const box = $('#subdirs');
  const warn = ST.warn ? `<div class="note">${esc(ST.warn)}${ST.suggest ? ` <button class="sm" id="btnSuggest" style="margin-left:8px">이 폴더로 바꿔 읽기</button>` : ''}</div>` : '';
  if (!ST.folder || !ST.subdirs || !ST.subdirs.length) { box.innerHTML = warn; bindSuggest(); return; }
  const ex = new Set(ST.exclude || []);
  box.innerHTML = warn + '<details><summary>읽을 하위 폴더 고르기(' + (ST.subdirs.length - ex.size) + '/' + ST.subdirs.length + ')</summary><div class="hint" style="margin:6px 0">체크를 풀면 뺍니다. 모델을 돌릴 때는 최근 폴더 한두 개만 남기면 빠릅니다.</div>' +
    ST.subdirs.map(d => `<label class="f" style="display:inline-flex;margin:2px 10px 2px 0"><input type="checkbox" class="sub" value="${esc(d)}" ${ex.has(d) ? '' : 'checked'}> ${esc(d)}</label>`).join('') +
    ' <div class="row"><button class="ghost sm" id="subAll">모두</button><button class="ghost sm" id="subNone">모두 해제</button><button class="sm" id="btnReread">이 폴더들로 다시 읽기</button></div></details>';
  $('#subAll').onclick = () => $$('.sub').forEach(c => c.checked = true);
  $('#subNone').onclick = () => $$('.sub').forEach(c => c.checked = false);
  $('#btnReread').onclick = () => doExtract($('#folder').value, $$('.sub').filter(c => !c.checked).map(c => c.value));
  bindSuggest();
}
function bindSuggest() { const b = $('#btnSuggest'); if (b) b.onclick = () => { $('#folder').value = ST.suggest; doExtract(ST.suggest, []); }; }
async function doExtract(folder, exclude) {
  if (ITEMS.length && !confirm(`지금 초안 ${ITEMS.length}개가 있습니다. 폴더를 다시 읽으면 검토 화면이 비워집니다(이전 초안은 작업 폴더에 백업됩니다). 계속할까요?\n아직 내보내지 않았다면 「취소」를 누르고 먼저 내보내세요.`)) return;
  $('#extractMsg').innerHTML = '<div class="hint">읽는 중… 큰 폴더는 몇 분 걸립니다. 이 화면을 닫지 마세요.</div>'; $('#btnExtract').disabled = true;
  try {
    await api('/api/extract', {folder, exclude: exclude || []}); ITEMS = []; DROPPED = []; pending = {};
    // 서버가 뒤에서 읽는다. 끝날 때까지 2초마다 상태를 물어 진행을 보인다(11분 넘는 요청을 브라우저가 끊는 일을 피함)
    for (;;) { await sleep(2000); ST = await api('/api/state'); if (!ST.extracting) break; renderExtracting(); }
    $('#extractMsg').innerHTML = ST.extract_error ? '<div class="bad">' + esc(ST.extract_error) + '</div>' : '';
    await refresh(); await loadModels(); await settings();
  } catch (e) { $('#extractMsg').innerHTML = '<div class="bad">' + esc(e.message) + '</div>'; }
  $('#btnExtract').disabled = false;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function renderExtracting() {
  const x = ST.extracting; if (!x) return;
  const pct = x.total ? Math.round(100 * x.index / x.total) : 0;
  $('#extractMsg').innerHTML = `<div class="hint">읽는 중 ${x.index}/${x.total} (${pct}%) · ${secText(x.sec || 0)} · ${esc(x.file || '')}</div><div class="bar"><i style="width:${pct}%"></i></div>`;
}
let pkCur = '';
async function pkLoad(path) {
  const j = await api('/api/ls?path=' + encodeURIComponent(path || ''));
  if (j.error) { alert(j.error); return; }
  pkCur = j.path; $('#picker').hidden = false;
  $('#pkPath').textContent = j.path ? `${j.path} (파일 ${j.files}개)` : '드라이브·자주 쓰는 폴더';
  $('#pkUp').disabled = !j.parent && !j.path; $('#pkUse').disabled = !j.path;
  $('#pkList').innerHTML = j.dirs.length ? j.dirs.map(d => `<span class="d" data-p="${esc(d.path)}">📁 ${esc(d.name)}</span>`).join('') : '<span class="hint">하위 폴더가 없습니다. 「이 폴더로」를 누르세요.</span>';
  $$('#pkList .d').forEach(el => el.onclick = () => pkLoad(el.dataset.p));
  $('#pkUp').onclick = () => pkLoad(j.parent || '');
}
$('#btnPick').onclick = () => pkLoad($('#folder').value.trim() || '').catch(e => alert(e.message));
$('#pkClose').onclick = () => { $('#picker').hidden = true; };
$('#pkUse').onclick = () => { $('#folder').value = pkCur; $('#picker').hidden = true; doExtract(pkCur, []); };
$('#btnBrowse').onclick = async () => { const j = await api('/api/browse', {}); if (j.folder) { $('#folder').value = j.folder; $('#extractMsg').innerHTML = ''; } else $('#extractMsg').innerHTML = '<div class="note">윈도 폴더 창을 열지 못했거나 취소했습니다. 「찾기…」로 화면 안에서 고르거나, 탐색기 주소창의 경로를 붙여 넣은 뒤 「읽기」를 누르세요.</div>'; };
$('#btnExtract').onclick = () => doExtract($('#folder').value, []);

// ---------------------------------------------------------------- 2. 설정·계획
function renderPlan() {
  const p = ST.plan; const box = $('#plan');
  if (!p) { box.innerHTML = '<div class="hint">먼저 「1. 업무 폴더」에서 폴더를 읽으세요.</div>'; return; }
  const model = ST.model;
  if (!model) box.innerHTML = `<div class="note">모델 없이 규칙만으로 뽑습니다(수천 파일이면 몇 분). 전화번호·기한·현안 신호어가 있는 줄만 나옵니다. 모델을 고르면 문장 파일 ${p.files_model}개를 더 읽어 항목을 보탭니다.</div>`;
  else box.innerHTML = `<div class="note">모델 <b>${esc(model)}</b>에 문장 파일 <b>${p.files_model}</b>개(호출 ${p.calls}회)를 보내고, 나머지 ${p.files_rule_only}개는 규칙만 적용합니다. 예상 <b>약 ${secText(p.est_sec)}</b>(호출당 ${p.avg_sec}초 기준. 긴 공문은 호출당 2분을 넘기도 하니 실제는 더 길 수 있습니다). 짧은 파일부터 보내므로 「여기까지만」으로 끊어도 많은 파일이 모델을 거칩니다.${ST.checkpoint && ST.checkpoint.reusable ? ` <b>이전 회차의 모델 응답 ${ST.checkpoint.reusable}회가 남아 있어 그만큼은 다시 부르지 않습니다.</b>` : ''}</div>`;
}
async function loadModels() {
  try {
    const j = await api('/api/models');
    const sel = $('#model'); const cur = ST.model || '';
    sel.innerHTML = '<option value="">없음(규칙만, 몇 분)</option>' + j.models.map(m => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
    if (cur && !j.models.includes(cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
    $('#planHint').textContent = j.models.length ? '' : 'Ollama가 켜져 있지 않거나 모델이 없습니다. 모델 없이(규칙만) 진행할 수 있습니다.';
  } catch (e) { $('#planHint').textContent = e.message; }
}
async function settings(extra) {
  const body = Object.assign({model: $('#model').value, url: $('#url').value.trim(), include_tables: $('#tables').checked, recent_years: +$('#recent').value, max_calls: +$('#maxCalls').value, skip_reference: $('#skipRef').checked, title: $('#title').value}, extra || {});
  const j = await api('/api/settings', body);
  ST.model = $('#model').value; ST.include_tables = $('#tables').checked; ST.recent_years = +$('#recent').value; ST.plan = j.plan; renderPlan();
}
$('#btnModels').onclick = loadModels;
['#model', '#url', '#tables', '#recent', '#maxCalls', '#skipRef', '#title'].forEach(s => $(s).onchange = () => settings().catch(e => alert(e.message)));
$('#btnAreas').onclick = async () => { try { await settings({areas_text: $('#areas').value}); ITEMS = []; await refresh(); alert('분야를 다시 매겼습니다.'); } catch (e) { alert(e.message); } };
$('#btnAreasDefault').onclick = async () => { if (!confirm('분야 키워드를 기본값으로 되돌릴까요?')) return; try { await settings({areas_text: ''}); ITEMS = []; await refresh(); } catch (e) { alert(e.message); } };
$('#btnDraft').onclick = async () => {
  if (!ST.files || !ST.files.length) { alert('먼저 폴더를 읽어야 합니다.'); show('folder'); return; }
  try { await settings(); await api('/api/draft', {}); ITEMS = []; DROPPED = []; pending = {}; show('run'); await refresh(); } catch (e) { alert(e.message); }
};

// ---------------------------------------------------------------- 3. 진행
function renderProgress() {
  const p = ST.progress; $('#btnStop').disabled = !ST.running;
  if (!p) return;
  const done = p.chars_total ? p.chars_done / p.chars_total : p.calls_total ? p.calls_done / p.calls_total : (p.index / Math.max(1, p.total));
  $('#barFill').style.width = Math.round(Math.min(1, done) * 100) + '%';
  const left = p.chars_total && p.chars_done > 0 ? (p.sec / p.chars_done) * (p.chars_total - p.chars_done)
             : p.calls_total && p.calls_done ? (p.sec / p.calls_done) * (p.calls_total - p.calls_done) : (p.calls_total - p.calls_done) * (ST.avg_sec || 22);
  if (!ST.running) { $('#progText').textContent = ST.step >= 4 ? `끝났습니다. 파일 ${p.total}개 · 모델 호출 ${p.calls_done}회 · ${secText(p.sec || 0)}. 왼쪽 「4. 검토」로 가세요.` : ''; return; }
  $('#progText').textContent = p.phase ? `${p.phase}… ${p.index || 0}/${p.total || 0} 항목 · 지난 시간 ${secText(p.sec || 0)} (모델 호출은 끝났습니다. 잠시 기다리세요)`
    : `파일 ${p.index}/${p.total} · 모델 호출 ${p.calls_done}/${p.calls_total} · 지난 시간 ${secText(p.sec || 0)} · 남은 시간 약 ${secText(left)} · ${esc(p.file || '')}`;
}
$('#btnStop').onclick = () => { api('/api/stop', {}); $('#progText').textContent = '중단 요청… 진행 중이던 호출 하나가 끝나면 멈춥니다(길면 2~3분).'; };

// ---------------------------------------------------------------- 4. 검토
async function loadItems() { const j = await api('/api/items'); ITEMS = j.items; DROPPED = j.dropped; if (view === 'review') renderItems(); navState(); }
function visible() {
  const needle = q.trim().toLowerCase();
  const rows = ITEMS.filter(i => i.type === tab && (!fArea || (i.area || '기타') === fArea) && (!fCycle || (i.cycle || '1회') === fCycle)
    && (!needle || [i.text, i.file, i.quote, i.note, i.when].some(x => String(x || '').toLowerCase().includes(needle))));
  if (tab === '월별 할 일') rows.sort((a, b) => (mon(a.when) - mon(b.when)) || String(a.file).localeCompare(String(b.file)));
  return rows;
}
function itemHtml(it, dropped) {
  const tag = it.src === '규칙' ? '<span class="tag">규칙</span>' : it.src === '직접 입력' ? '<span class="tag man">직접 적음</span>' : String(it.src).indexOf('보정') >= 0 ? '<span class="tag fix">모델 · 발췌 보정</span>' : String(it.src).indexOf('복원') >= 0 ? '<span class="tag man">전임자 복원</span>' : '<span class="tag">모델</span>';
  const cy = it.cycle && it.cycle !== '1회' && it.cycle !== '해당 월' ? `<span class="tag cy">${esc(it.cycle)}</span>` : '';
  const also = (it.also || []).length ? `<div class="also">같은 내용 ${it.also.length}곳: ${it.also.slice(0, 4).map(a => esc(a.file)).join(' · ')}${it.also.length > 4 ? ' …' : ''}</div>` : '';
  const src = (it.file ? `<div class="src"><b>출처</b> ${esc(it.file)} · 「${esc(String(it.quote || it.quote_raw || '').replace(/\n/g, ' / '))}」</div>` : '<div class="src"><b>출처</b> 전임자가 직접 적음</div>') + also;
  const areaSel = `<select class="area" title="분야">${AREAS.concat(['기타']).map(a => `<option ${a === (it.area || '기타') ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>`;
  return `<div class="item ${it.keep ? '' : 'off'}" data-id="${it.id}">
    <div><input type="checkbox" class="keep" ${it.keep ? 'checked' : ''} title="${dropped ? '체크하면 초안에 넣습니다' : '체크를 풀면 인수인계서에서 뺍니다'}"></div>
    <div>${dropped ? '' : '<input type="checkbox" class="sel" title="일괄 처리용 선택">'}</div>
    <div><div class="t"><select class="type">${TYPES.map(t => `<option ${t === it.type ? 'selected' : ''}>${t}</option>`).join('')}</select><input class="when" type="text" value="${esc(it.when)}" placeholder="시기"><input class="text" type="text" value="${esc(it.text)}">${areaSel}${cy}${tag}</div>
    ${src}<input class="note" type="text" value="${esc(it.note || '')}" placeholder="후임자에게 남길 메모(선택)"></div></div>`;
}
function renderChips() {
  const cnt = t => ITEMS.filter(i => i.type === t && i.keep).length;
  $('#tabs').innerHTML = TYPES.map(t => `<span class="chip ${t === tab ? 'on' : ''}" data-t="${t}">${t} (${cnt(t)})</span>`).join('');
  $$('#tabs .chip').forEach(b => b.onclick = () => { tab = b.dataset.t; renderItems(); });
  const inTab = ITEMS.filter(i => i.type === tab);
  const ac = {}; inTab.forEach(i => { const a = i.area || '기타'; ac[a] = (ac[a] || 0) + 1; });
  $('#areaChips').innerHTML = `<span class="chip ins ${fArea ? '' : 'on'}" data-a="">전체</span>` + AREAS.concat(['기타']).filter(a => ac[a]).map(a => `<span class="chip ins ${a === fArea ? 'on' : ''}" data-a="${esc(a)}">${esc(a)} ${ac[a]}</span>`).join('');
  $$('#areaChips .chip').forEach(b => b.onclick = () => { fArea = b.dataset.a; renderItems(); });
  const cc = {}; inTab.forEach(i => { const c = i.cycle || '1회'; cc[c] = (cc[c] || 0) + 1; });
  $('#cycleChips').innerHTML = `<span class="chip ins ${fCycle ? '' : 'on'}" data-c="">전체</span>` + CYCLES.filter(c => cc[c]).map(c => `<span class="chip ins ${c === fCycle ? 'on' : ''}" data-c="${c}">${c} ${cc[c]}</span>`).join('');
  $$('#cycleChips .chip').forEach(b => b.onclick = () => { fCycle = b.dataset.c; renderItems(); });
}
function renderItems() {
  if (!ITEMS.length && !DROPPED.length) { $('#items').innerHTML = '<div class="hint">아직 초안이 없습니다. 「2. 설정·계획」에서 「초안 만들기」를 누르세요.</div>'; $('#tabs').innerHTML = ''; $('#areaChips').innerHTML = ''; $('#cycleChips').innerHTML = ''; $('#counts').textContent = ''; return; }
  renderChips();
  const rows = visible();
  const key = tab + '|' + fArea + '|' + fCycle + '|' + q;
  const lim = PAGE[key] || PAGE_STEP;
  $('#filterInfo').textContent = (fArea || fCycle || q) ? `조건에 맞는 항목 ${rows.length}개` : '';
  $('#items').innerHTML = (rows.slice(0, lim).map(i => itemHtml(i, false)).join('') || '<div class="hint">조건에 맞는 항목이 없습니다.</div>')
    + (rows.length > lim ? `<div class="row"><button class="ghost sm" id="btnMore">더 보기 (${rows.length - lim}개 남음)</button><span class="hint">화면에 ${lim}개만 그렸습니다. 일괄 처리와 내보내기는 전부에 적용됩니다.</span></div>` : '');
  const bm = $('#btnMore'); if (bm) bm.onclick = () => { PAGE[key] = lim + PAGE_STEP; renderItems(); };
  $('#dropped').innerHTML = DROPPED.slice(0, PAGE_STEP).map(i => itemHtml(i, true)).join('') + (DROPPED.length > PAGE_STEP ? `<div class="hint">…외 ${DROPPED.length - PAGE_STEP}개</div>` : '') || '<div class="hint">없음</div>';
  $('#nDropped').textContent = DROPPED.length; $('#nErr').textContent = (ST.errors || []).length;
  $('#errs').innerHTML = (ST.errors || []).map(e => esc((e.file ? e.file + ' · ' : '') + e.reason)).join('<br>') || '없음';
  $('#selAll').checked = false; $('#selInfo').textContent = '';
  $('#addArea').innerHTML = AREAS.concat(['기타']).map(a => `<option>${esc(a)}</option>`).join('');
  renderCounts();
  $$('.item').forEach(el => {
    const id = +el.dataset.id;
    const mark = (k, v) => { pending[id] = pending[id] || {id}; pending[id][k] = v; const it = ITEMS.concat(DROPPED).find(i => i.id === id); if (it) it[k] = v; };
    el.querySelector('.keep').onchange = e => { mark('keep', e.target.checked); el.classList.toggle('off', !e.target.checked); if (DROPPED.some(i => i.id === id)) save(); else renderCounts(); };
    el.querySelector('.type').onchange = e => mark('type', e.target.value);
    el.querySelector('.when').onchange = e => mark('when', e.target.value);
    el.querySelector('.text').onchange = e => mark('text', e.target.value);
    el.querySelector('.note').onchange = e => mark('note', e.target.value);
    el.querySelector('.area').onchange = e => mark('area', e.target.value);
    const sel = el.querySelector('.sel'); if (sel) sel.onchange = () => { $('#selInfo').textContent = $$('.sel:checked').length + '개 선택'; };
  });
}
function renderCounts() {
  const cnt = t => ITEMS.filter(i => i.type === t && i.keep).length;
  $$('#tabs .chip').forEach(b => b.textContent = `${b.dataset.t} (${cnt(b.dataset.t)})`);
  $('#counts').textContent = `남길 항목 ${ITEMS.filter(i => i.keep).length}개 / 전체 ${ITEMS.length}개`;
  navState();
}
async function save(add, bulk) {
  const body = {changes: Object.values(pending), add: add ? [add] : [], bulk: bulk ? [bulk] : []};
  pending = {};
  const j = await api('/api/items', body); ITEMS = j.items; DROPPED = j.dropped;
  if (view === 'review') renderItems(); if (view === 'cycle') renderCycle(); if (view === 'area') renderArea(); navState();
}
function selectedIds() { const s = $$('.sel:checked').map(c => +c.closest('.item').dataset.id); return s.length ? s : null; }
async function bulkKeep(keep) {
  let ids = selectedIds();
  if (!ids) { const rows = visible(); if (!rows.length) return; if (!confirm(`선택한 항목이 없습니다. 지금 조건에 맞는 ${rows.length}개 전부를 「${keep ? '남김' : '뺌'}」으로 할까요?`)) return; ids = rows.map(i => i.id); }
  try { await save(null, {ids, keep}); } catch (e) { alert(e.message); }
}
$('#selAll').onchange = e => { $$('.sel').forEach(c => c.checked = e.target.checked); $('#selInfo').textContent = e.target.checked ? $$('.sel').length + '개 선택(화면에 보이는 것)' : ''; };
$('#btnKeepSel').onclick = () => bulkKeep(true);
$('#btnDropSel').onclick = () => bulkKeep(false);
$('#btnSave').onclick = () => save().then(() => alert('저장했습니다.')).catch(e => alert(e.message));
$('#btnAdd').onclick = async () => {
  const text = $('#addText').value.trim(); if (!text) { $('#addText').focus(); return; }
  tab = $('#addType').value; fArea = ''; fCycle = ''; q = ''; $('#q').value = '';
  try { await save({type: $('#addType').value, when: $('#addWhen').value, text, note: $('#addNote').value, area: $('#addArea').value}); } catch (e) { alert(e.message); }
  $('#addText').value = ''; $('#addWhen').value = ''; $('#addNote').value = '';
};
$('#q').oninput = () => { q = $('#q').value; if (view !== 'review') show('review'); else renderItems(); };

// ---------------------------------------------------------------- 주기 업무·분야별
function renderCycle() {
  const box = $('#cycleView');
  if (!ITEMS.length) { box.innerHTML = '<div class="hint">아직 초안이 없습니다.</div>'; return; }
  const desc = {'매주': '매주 되풀이', '매월': '매월 되풀이(월마감·월별 보고 등)', '분기': '분기마다', '반기': '상·하반기', '매년': '해마다(연말·연초 포함)', '해당 월': '특정 달에 한 번(시기가 적힌 일)', '1회': '주기가 적히지 않은 일·사람·현안'};
  let h = '';
  for (const c of CYCLES) {
    const rows = ITEMS.filter(i => (i.cycle || '1회') === c);
    if (!rows.length) continue;
    rows.sort((a, b) => (mon(a.when) - mon(b.when)) || String(a.area).localeCompare(String(b.area)));
    const kept = rows.filter(i => i.keep).length;
    h += `<div class="cyc-group card"><h3>${c} <span class="hint">${desc[c]} · ${kept}/${rows.length} 남김</span><button class="ghost sm" data-c="${c}" data-k="1">이 묶음 전부 남김</button><button class="ghost sm" data-c="${c}" data-k="0">이 묶음 전부 뺌</button></h3>
      <table><tr><th style="width:36px">남김</th><th>시기</th><th>유형</th><th>내용</th><th>분야</th><th>출처</th></tr>` +
      rows.slice(0, 400).map(i => `<tr class="${i.keep ? '' : 'off'}" data-id="${i.id}"><td><input type="checkbox" class="ck" ${i.keep ? 'checked' : ''}></td><td>${esc(i.when)}</td><td>${esc(i.type)}</td><td>${esc(i.text)}</td><td>${esc(i.area || '기타')}</td><td class="hint">${esc(i.file || '직접 적음')}</td></tr>`).join('') +
      (rows.length > 400 ? `<tr><td colspan="6" class="hint">…외 ${rows.length - 400}개(검토 화면에서 주기 필터로 보세요)</td></tr>` : '') + '</table></div>';
  }
  box.innerHTML = h;
  $$('#cycleView h3 button').forEach(b => b.onclick = async () => {
    const c = b.dataset.c, keep = b.dataset.k === '1';
    const ids = ITEMS.filter(i => (i.cycle || '1회') === c).map(i => i.id);
    if (!confirm(`「${c}」 묶음 ${ids.length}개를 전부 「${keep ? '남김' : '뺌'}」으로 할까요?`)) return;
    try { await save(null, {ids, keep}); } catch (e) { alert(e.message); }
  });
  $$('#cycleView .ck').forEach(c => c.onchange = async e => {
    const tr = e.target.closest('tr'); const id = +tr.dataset.id; pending[id] = {id, keep: e.target.checked}; const it = ITEMS.find(i => i.id === id); if (it) it.keep = e.target.checked; tr.classList.toggle('off', !e.target.checked);
    try { await api('/api/items', {changes: Object.values(pending)}); pending = {}; navState(); } catch (err) { alert(err.message); }
  });
}
function renderArea() {
  const box = $('#areaView');
  if (!ITEMS.length) { box.innerHTML = '<div class="hint">아직 초안이 없습니다.</div>'; return; }
  const rows = AREAS.concat(['기타']).map(a => { const r = ITEMS.filter(i => (i.area || '기타') === a); return {a, n: r.length, k: r.filter(i => i.keep).length, t: TYPES.map(t => r.filter(i => i.type === t).length)}; }).filter(r => r.n);
  box.innerHTML = '<div class="card"><table><tr><th>분야</th><th class="num">항목</th><th class="num">남김</th>' + TYPES.map(t => `<th class="num">${t}</th>`).join('') + '<th></th></tr>' +
    rows.map(r => `<tr><td><b>${esc(r.a)}</b></td><td class="num">${r.n}</td><td class="num">${r.k}</td>${r.t.map(n => `<td class="num">${n}</td>`).join('')}<td><button class="ghost sm" data-a="${esc(r.a)}">검토에서 보기</button></td></tr>`).join('') + '</table></div>';
  $$('#areaView button').forEach(b => b.onclick = () => { fArea = b.dataset.a; fCycle = ''; show('review'); });
}

// ---------------------------------------------------------------- 5. 내보내기·인쇄
function renderExports() {
  $('#exports').innerHTML = (ST.exports || []).length ? (ST.exports.map(n => `<div>📄 <a href="/api/download?name=${encodeURIComponent(n)}">${esc(n)}</a></div>`).join('') + `<div class="hint">작업 폴더: ${esc(ST.work)}</div>`) : '<div class="hint">아직 내보낸 파일이 없습니다.</div>';
}
async function doExport() {
  if (!ITEMS.length && !DROPPED.length) { alert('초안이 없습니다. 「초안 만들기」를 먼저 하세요.'); return; }
  try { await save(); await api('/api/export', {}); await refresh(); show('export'); } catch (e) { alert(e.message); }
}
$('#btnExport').onclick = doExport; $('#btnExport2').onclick = doExport;
function renderPrintView() {
  const kept = ITEMS.filter(i => i.keep).length;
  let h = `<h2>업무 인수인계 검토본 · ${esc($('#title').value || '전임자 확인 전')}</h2><div class="hint">남길 항목 ${kept}개 / 전체 ${ITEMS.length}개 · ${new Date().toLocaleString('ko-KR')} · 돌다리 ${esc(ST.version || '')}</div>`;
  for (const t of TYPES) {
    const rows = ITEMS.filter(i => i.type === t);
    if (t === '월별 할 일') rows.sort((a, b) => (mon(a.when) - mon(b.when)) || String(a.file).localeCompare(String(b.file)));
    h += `<h3>${t} (${rows.filter(i => i.keep).length})</h3>`;
    for (const it of rows) {
      h += `<div class="pi ${it.keep ? '' : 'off'}">${it.when ? `<span class="w">[${esc(it.when)}]</span>` : ''}${esc(it.text)} <span class="tag">${esc(it.area || '기타')}${it.cycle && it.cycle !== '1회' && it.cycle !== '해당 월' ? ' · ' + esc(it.cycle) : ''}</span> <span class="tag">${esc(it.src)}</span>` +
        (it.note ? `<span class="n">메모: ${esc(it.note)}</span>` : '') +
        `<span class="s">출처: ${it.file ? esc(it.file) + ' · 「' + esc(String(it.quote || '').replace(/\n/g, ' / ')) + '」' : '전임자가 직접 적음'}${(it.also || []).length ? ' · 같은 내용 ' + it.also.length + '곳' : ''}</span></div>`;
    }
  }
  $('#printView').innerHTML = h;
}
function doPrint() { if (!ITEMS.length) { alert('인쇄할 초안이 없습니다.'); return; } renderPrintView(); window.print(); }
$('#btnPrint').onclick = doPrint; $('#btnPrint2').onclick = doPrint; $('#btnPrint3').onclick = doPrint;

// ---------------------------------------------------------------- 머리글: 글자 크기·밝기
function applyPrefs() {
  const s = +(ls('fs') || 1); document.documentElement.style.setProperty('--s', String(s));
  const t = ls('theme'); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
$('#fsup').onclick = () => { ls('fs', Math.min(1.4, +(ls('fs') || 1) + 0.1).toFixed(2)); applyPrefs(); };
$('#fsdn').onclick = () => { ls('fs', Math.max(0.8, +(ls('fs') || 1) - 0.1).toFixed(2)); applyPrefs(); };
$('#thm').onclick = () => { ls('theme', ls('theme') === 'dark' ? '' : 'dark'); applyPrefs(); };
applyPrefs();

// ---------------------------------------------------------------- 시작
refresh().then(() => {
  if (ST.files && ST.files.length) loadModels();
  const v = ls('view');
  show(ST.running ? 'run' : v && ST.step >= 4 ? v : ST.step >= 4 ? 'review' : ST.step >= 2 ? 'setup' : 'folder');
}).catch(e => { $('#v-folder').classList.add('on'); alert('서버와 연결하지 못했습니다: ' + e.message); });
