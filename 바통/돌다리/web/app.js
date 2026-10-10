'use strict';
const $ = s => document.querySelector(s);
const TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안'];
let ST = null, ITEMS = [], DROPPED = [], tab = '월별 할 일', pending = {}, timer = null;

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || ('오류 ' + r.status));
  return j;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])); }
function secText(s) { s = Math.round(s); return s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초'; }

function setSteps(step) {
  for (let i = 1; i <= 5; i++) {
    const el = $('#s' + i); el.classList.remove('cur', 'done', 'off');
    el.classList.add(i < step ? 'done' : i === step ? 'cur' : 'off');
  }
}

async function refresh() {
  ST = await api('/api/state');
  setSteps(ST.step); if (ST.version) $('#ver').textContent = 'v' + ST.version;
  if (ST.folder && !$('#folder').value) $('#folder').value = ST.folder;
  if (!$('#url').value) $('#url').value = ST.url;
  $('#tables').checked = !!ST.include_tables; $('#recent').value = String(ST.recent_years || 0); $('#maxCalls').value = String(ST.max_calls || 3);
  $('#title').value = ST.title || '';
  $('#log').textContent = (ST.log || []).join('\n');
  renderFiles(); renderSubdirs(); renderPlan(); renderProgress();
  if (ST.step >= 4 && !ITEMS.length) await loadItems();
  if (ST.step === 5) renderExports();
  if (ST.running) { clearTimeout(timer); timer = setTimeout(refresh, 1500); }
}

function renderFiles() {
  if (!ST.files || !ST.files.length) { $('#files').innerHTML = ''; return; }
  const kinds = {};
  ST.files.forEach(f => { kinds[f.kind] = kinds[f.kind] || {n: 0, c: 0}; kinds[f.kind].n++; kinds[f.kind].c += f.chars; });
  let h = `<div class="good">읽음 <b>${ST.files.length}</b>개 · 못 읽음 <b>${ST.failures.length}</b>개 · 원본 변경 <b>${ST.originals_changed}</b>개(처리 전후 지문 대조)</div>`;
  h += '<table><tr><th>형식</th><th class="num">파일</th><th class="num">글자 수</th></tr>' + Object.keys(kinds).sort().map(k => `<tr><td>.${k}</td><td class="num">${kinds[k].n}</td><td class="num">${kinds[k].c.toLocaleString()}</td></tr>`).join('') + '</table>';
  if (ST.failures.length) h += '<details><summary>못 읽은 파일 ' + ST.failures.length + '개(인수인계서에 「직접 열어 볼 것」으로 적힘)</summary><table>' + ST.failures.map(x => `<tr><td>${esc(x.file)}</td><td>${esc(x.reason)}</td></tr>`).join('') + '</table></details>';
  $('#files').innerHTML = h;
}

function renderSubdirs() {
  const box = $('#subdirs');
  const warn = ST.warn ? `<div class="note">${esc(ST.warn)}${ST.suggest ? ` <button id="btnSuggest" style="padding:4px 10px;margin-left:8px">이 폴더로 바꿔 읽기</button>` : ''}</div>` : '';
  if (!ST.folder || !ST.subdirs || !ST.subdirs.length) { box.innerHTML = warn; bindSuggest(); return; }
  const ex = new Set(ST.exclude || []);
  box.innerHTML = warn + '<div class="hint">읽을 하위 폴더(체크를 풀면 뺍니다): ' +
    ST.subdirs.map(d => `<label style="margin-right:12px"><input type="checkbox" class="sub" value="${esc(d)}" ${ex.has(d) ? '' : 'checked'}> ${esc(d)}</label>`).join('') +
    ' <button class="ghost" id="btnReread" style="padding:4px 10px">다시 읽기</button></div>';
  $('#btnReread').onclick = async () => {
    const exclude = [...box.querySelectorAll('.sub')].filter(c => !c.checked).map(c => c.value);
    try { await api('/api/extract', {folder: $('#folder').value, exclude}); ITEMS = []; DROPPED = []; await refresh(); await loadModels(); await settings(); } catch (e) { alert(e.message); }
  };
  bindSuggest();
}
function bindSuggest() {
  const b = $('#btnSuggest'); if (!b) return;
  b.onclick = async () => { $('#folder').value = ST.suggest; try { await api('/api/extract', {folder: ST.suggest}); ITEMS = []; DROPPED = []; await refresh(); await loadModels(); await settings(); } catch (e) { alert(e.message); } };
}

function renderPlan() {
  const p = ST.plan; if (!p) { $('#plan').innerHTML = ''; return; }
  const model = ST.model;
  let h = '';
  if (!model) h = `<div class="note">모델 없이 규칙만으로 뽑습니다(몇 초). 전화번호·기한·현안 신호어가 있는 줄만 나옵니다. 모델을 고르면 문장 파일 ${p.files_model}개를 더 읽어 항목을 보탭니다.</div>`;
  else h = `<div class="note">모델 <b>${esc(model)}</b>에 문장 파일 <b>${p.files_model}</b>개(호출 ${p.calls}회)를 보내고, 나머지 ${p.files_rule_only}개는 규칙만 적용합니다. 예상 시간 <b>약 ${secText(p.est_sec)}</b>(호출당 ${p.avg_sec}초 기준, 이 PC에서 잰 값으로 갱신됨). 긴 작업은 「여기까지만」으로 끊을 수 있습니다.</div>`;
  $('#plan').innerHTML = h;
  $('#planHint').textContent = model ? '' : '모델이 없어도 됩니다.';
}

function renderProgress() {
  const p = ST.progress; if (!p) return;
  const done = p.calls_total ? p.calls_done / p.calls_total : (p.index / Math.max(1, p.total));
  $('#barFill').style.width = Math.round(done * 100) + '%';
  const left = p.calls_total && p.calls_done ? (p.sec / p.calls_done) * (p.calls_total - p.calls_done) : (p.calls_total - p.calls_done) * (ST.avg_sec || 22);
  $('#progText').textContent = ST.running ? `파일 ${p.index}/${p.total} · 모델 호출 ${p.calls_done}/${p.calls_total} · 지난 시간 ${secText(p.sec || 0)} · 남은 시간 약 ${secText(left)} · ${esc(p.file || '')}` : '';
  $('#btnStop').disabled = !ST.running;
}

async function loadItems() {
  const j = await api('/api/items'); ITEMS = j.items; DROPPED = j.dropped; renderItems();
}

function itemHtml(it, dropped) {
  const tag = it.src === '규칙' ? '<span class="tag">규칙</span>' : it.src === '직접 입력' ? '<span class="tag man">직접 적음</span>' : it.src.indexOf('보정') >= 0 ? '<span class="tag fix">모델 · 발췌 보정</span>' : it.src.indexOf('복원') >= 0 ? '<span class="tag man">전임자 복원</span>' : '<span class="tag">모델</span>';
  const also = (it.also || []).length ? `<div class="also">같은 내용 ${it.also.length}곳: ${it.also.slice(0, 4).map(a => esc(a.file)).join(' · ')}${it.also.length > 4 ? ' …' : ''}</div>` : '';
  const src = (it.file ? `<div class="src"><b>출처</b> ${esc(it.file)} · 「${esc(String(it.quote || it.quote_raw || '').replace(/\n/g, ' / '))}」</div>` : '<div class="src"><b>출처</b> 전임자가 직접 적음</div>') + also;
  return `<div class="item ${it.keep ? '' : 'off'}" data-id="${it.id}">
    <div><input type="checkbox" class="keep" ${it.keep ? 'checked' : ''} title="${dropped ? '체크하면 초안에 넣습니다' : '체크를 풀면 인수인계서에서 뺍니다'}"></div>
    <div><div class="t"><select class="type">${TYPES.map(t => `<option ${t === it.type ? 'selected' : ''}>${t}</option>`).join('')}</select><input class="when" type="text" value="${esc(it.when)}" placeholder="시기"><input class="text" type="text" value="${esc(it.text)}">${tag}</div>
    ${src}<input class="note" type="text" value="${esc(it.note || '')}" placeholder="후임자에게 남길 메모(선택)"></div></div>`;
}

function renderItems() {
  const counts = {}; TYPES.forEach(t => counts[t] = ITEMS.filter(i => i.type === t && i.keep).length);
  $('#tabs').innerHTML = TYPES.map(t => `<button data-t="${t}" class="${t === tab ? 'on' : ''}">${t} (${counts[t]})</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.t; renderItems(); });
  const rows = ITEMS.filter(i => i.type === tab);
  if (tab === '월별 할 일') rows.sort((a, b) => (mon(a.when) - mon(b.when)) || a.file.localeCompare(b.file));
  $('#items').innerHTML = rows.map(i => itemHtml(i, false)).join('') || '<div class="hint">이 유형의 항목이 없습니다. 아래 「직접 적기」로 보탤 수 있습니다.</div>';
  $('#dropped').innerHTML = DROPPED.map(i => itemHtml(i, true)).join('') || '<div class="hint">없음</div>';
  $('#nDropped').textContent = DROPPED.length; $('#nErr').textContent = (ST.errors || []).length;
  $('#errs').innerHTML = (ST.errors || []).map(e => esc(e.file + ' · ' + e.reason)).join('<br>') || '없음';
  $('#counts').textContent = `남길 항목 ${ITEMS.filter(i => i.keep).length}개 / 전체 ${ITEMS.length}개`;
  document.querySelectorAll('.item').forEach(el => {
    const id = +el.dataset.id;
    const mark = (k, v) => { pending[id] = pending[id] || {id}; pending[id][k] = v; const it = (ITEMS.concat(DROPPED)).find(i => i.id === id); if (it) it[k] = v; };
    el.querySelector('.keep').onchange = e => { mark('keep', e.target.checked); el.classList.toggle('off', !e.target.checked); if (DROPPED.some(i => i.id === id)) save(); else renderCounts(); };
    el.querySelector('.type').onchange = e => mark('type', e.target.value);
    el.querySelector('.when').onchange = e => mark('when', e.target.value);
    el.querySelector('.text').onchange = e => mark('text', e.target.value);
    el.querySelector('.note').onchange = e => mark('note', e.target.value);
  });
}
function mon(w) { const m = /(\d{1,2})월/.exec(w || ''); return m ? +m[1] : 99; }
function renderCounts() {
  const counts = {}; TYPES.forEach(t => counts[t] = ITEMS.filter(i => i.type === t && i.keep).length);
  $('#tabs').querySelectorAll('button').forEach(b => b.textContent = `${b.dataset.t} (${counts[b.dataset.t]})`);
  $('#counts').textContent = `남길 항목 ${ITEMS.filter(i => i.keep).length}개 / 전체 ${ITEMS.length}개`;
}

async function save(add) {
  const body = {changes: Object.values(pending), add: add ? [add] : []};
  pending = {};
  const j = await api('/api/items', body); ITEMS = j.items; DROPPED = j.dropped; renderItems();
}

function renderExports() {
  $('#exports').innerHTML = (ST.exports || []).map(n => `<div>📄 <a href="/api/download?name=${encodeURIComponent(n)}">${esc(n)}</a></div>`).join('') + `<div class="hint">작업 폴더: ${esc(ST.work)}</div>`;
}

async function loadModels() {
  try {
    const j = await api('/api/models');
    const sel = $('#model'); const cur = ST.model || '';
    sel.innerHTML = '<option value="">없음(규칙만, 몇 초)</option>' + j.models.map(m => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('');
    if (cur && !j.models.includes(cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>${esc(cur)}</option>`);
    if (!j.models.length) $('#planHint').textContent = 'Ollama가 켜져 있지 않거나 모델이 없습니다. 모델 없이(규칙만) 진행할 수 있습니다.';
  } catch (e) { $('#planHint').textContent = e.message; }
}

async function settings() {
  const j = await api('/api/settings', {model: $('#model').value, url: $('#url').value.trim(), include_tables: $('#tables').checked, recent_years: +$('#recent').value, max_calls: +$('#maxCalls').value, title: $('#title').value});
  ST.model = $('#model').value; ST.include_tables = $('#tables').checked; ST.recent_years = +$('#recent').value; ST.plan = j.plan; renderPlan();
}

$('#btnBrowse').onclick = async () => { const j = await api('/api/browse', {}); if (j.folder) $('#folder').value = j.folder; else $('#extractMsg').innerHTML = '<div class="note">폴더 고르기 창을 열지 못했습니다. 탐색기 주소창의 경로를 복사해 붙여 넣어 주세요.</div>'; };
$('#btnExtract').onclick = async () => {
  $('#extractMsg').innerHTML = '<div class="hint">읽는 중…</div>'; $('#btnExtract').disabled = true;
  try { await api('/api/extract', {folder: $('#folder').value}); ITEMS = []; DROPPED = []; $('#extractMsg').innerHTML = ''; await refresh(); await loadModels(); await settings(); }
  catch (e) { $('#extractMsg').innerHTML = '<div class="note">' + esc(e.message) + '</div>'; }
  $('#btnExtract').disabled = false;
};
$('#btnModels').onclick = loadModels;
['#model', '#url', '#tables', '#recent', '#maxCalls', '#title'].forEach(s => $(s).onchange = () => settings().catch(e => alert(e.message)));
$('#btnDraft').onclick = async () => { try { await settings(); await api('/api/draft', {}); ITEMS = []; DROPPED = []; await refresh(); } catch (e) { alert(e.message); } };
$('#btnStop').onclick = () => api('/api/stop', {});
$('#btnSave').onclick = () => save().catch(e => alert(e.message));
$('#btnPrint').onclick = () => window.print();   // 화면 안 onclick은 CSP(script-src 'self')에 막히므로 여기서 묶는다
$('#btnAdd').onclick = async () => {
  const text = $('#addText').value.trim(); if (!text) { $('#addText').focus(); return; }
  tab = $('#addType').value;
  await save({type: $('#addType').value, when: $('#addWhen').value, text, note: $('#addNote').value});
  $('#addText').value = ''; $('#addWhen').value = ''; $('#addNote').value = '';
};
$('#btnExport').onclick = async () => { try { await save(); await api('/api/export', {}); await refresh(); renderExports(); $('#s5').scrollIntoView({behavior: 'smooth'}); } catch (e) { alert(e.message); } };

refresh().then(() => { if (ST.files && ST.files.length) loadModels(); });
