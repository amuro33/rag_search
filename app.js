/* app.js — RAG 검색 평가 UI 로직 (vanilla) */
(function () {
  'use strict';
  const { CONFIG, loadRegistry, searchPgVector } = window.RagEval;

  const $ = (s) => document.querySelector(s);
  const tbody = $('#tbody');

  const state = {
    rows: [],
    results: new Map(),     // query_id -> { score, detail:[{q,correct,rank,results}] }
    selected: new Set(),    // query_id
    expanded: new Set(),    // query_id
    filter: 'all',          // all | unmeasured | full | partial | s0
    app: '',
    q: '',
    running: false,
    cancel: false,
    limit: 50,
  };
  const INITIAL_LIMIT = 50;
  const MAX_SCORE = CONFIG.questionCount || 5;

  const FILTERS = [
    ['all', '전체'],
    ['unmeasured', '미측정'],
    ['full', `만점 ${MAX_SCORE}/${MAX_SCORE}`],
    ['partial', `오답 포함 (<${MAX_SCORE})`],
    ['s0', `전부 오답 0/${MAX_SCORE}`],
  ];

  /* ---------- helpers ---------- */
  const scoreClass = (s) => {
    if (s == null) return 'idle';
    if (s === 0) return 's0';
    if (s === MAX_SCORE) return 's3';
    return s >= Math.ceil(MAX_SCORE / 2) ? 's2' : 's1';
  };
  const scoreText = (s) => (s == null ? '—' : s + '/' + MAX_SCORE);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const enc = (s) => encodeURIComponent(String(s));
  const dec = (s) => decodeURIComponent(String(s || ''));

  function serializeResults() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      passTopK: CONFIG.passTopK,
      questionCount: MAX_SCORE,
      results: [...state.results.entries()].map(([query_id, result]) => ({ query_id, result })),
    };
  }

  function applyResults(payload) {
    const rows = Array.isArray(payload && payload.results) ? payload.results : [];
    const knownIds = new Set(state.rows.map((row) => row.query_id));
    state.results.clear();
    rows.forEach((item) => {
      if (!item || !knownIds.has(item.query_id) || !item.result) return;
      const detail = Array.isArray(item.result.detail) ? item.result.detail : [];
      const score = Number(item.result.score);
      state.results.set(item.query_id, {
        score: Number.isFinite(score) ? score : detail.filter((d) => d && d.correct).length,
        detail,
      });
    });
  }

  function refreshAfterResultsChange() {
    renderDash();
    renderChips();
    renderTable();
  }

  function passesFilter(row) {
    const r = state.results.get(row.query_id);
    const s = r ? r.score : null;
    if (state.filter === 'unmeasured' && s != null) return false;
    if (state.filter === 'full' && s !== MAX_SCORE) return false;
    if (state.filter === 'partial' && (s == null || s >= MAX_SCORE)) return false;
    if (state.filter === 's0' && s !== 0) return false;
    if (state.app && row.app !== state.app) return false;
    if (state.q) {
      const hay = (row.query_id + ' ' + row.description + ' ' + row.author + ' ' + row.app).toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  }
  const visibleRows = () => state.rows.filter(passesFilter);

  /* ---------- dashboard ---------- */
  function renderDash() {
    const total = state.rows.length;
    const sel = state.selected.size;
    let measured = 0, sumScore = 0, totalQ = 0, correctQ = 0;
    const dist = Array(MAX_SCORE + 1).fill(0);
    state.results.forEach((r) => {
      measured++; sumScore += r.score; dist[r.score]++;
      totalQ += MAX_SCORE; correctQ += r.score;
    });
    const passRate = measured ? Math.round((dist[MAX_SCORE] / measured) * 100) : 0;
    const qRate = totalQ ? Math.round((correctQ / totalQ) * 100) : 0;
    const distPct = (n) => (measured ? (n / measured) * 100 : 0);
    const partialCount = dist.slice(1, MAX_SCORE).reduce((sum, n) => sum + n, 0);

    $('#dash').innerHTML = `
      <div class="stat"><div class="k">전체 API</div><div class="v">${total}</div></div>
      <div class="stat"><div class="k">선택됨</div><div class="v accent">${sel}</div></div>
      <div class="stat"><div class="k">측정 완료</div><div class="v">${measured}<small> / ${total}</small></div></div>
      <div class="stat"><div class="k">만점(${MAX_SCORE}/${MAX_SCORE}) 비율</div><div class="v pass">${passRate}<small>%</small></div></div>
      <div class="stat"><div class="k">문항 정답률</div><div class="v">${qRate}<small>%</small></div></div>
      <div class="dist">
        <div class="k">점수 분포 ${measured ? `· ${measured}건 측정` : '· 미측정'}</div>
        <div class="distbar">
          <span class="seg3" style="width:${distPct(dist[MAX_SCORE])}%"></span>
          <span class="seg2" style="width:${distPct(partialCount)}%"></span>
          <span class="seg0" style="width:${distPct(0)}%"></span>
        </div>
        <div class="distlegend">
          <span><i class="seg3"></i>${MAX_SCORE}/${MAX_SCORE} ${dist[MAX_SCORE]}</span>
          <span><i class="seg2"></i>1-${MAX_SCORE - 1}/${MAX_SCORE} ${partialCount}</span>
          <span><i class="seg0"></i>0/${MAX_SCORE} ${dist[0]}</span>
        </div>
      </div>`;
  }

  /* ---------- chips / toolbar ---------- */
  function renderChips() {
    const counts = { all: 0, unmeasured: 0, full: 0, partial: 0, s0: 0 };
    state.rows.forEach((row) => {
      counts.all++;
      const r = state.results.get(row.query_id);
      const s = r ? r.score : null;
      if (s == null) counts.unmeasured++;
      if (s === MAX_SCORE) counts.full++;
      if (s != null && s < MAX_SCORE) counts.partial++;
      if (s === 0) counts.s0++;
    });
    $('#chips').innerHTML = FILTERS.map(([k, label]) =>
      `<button class="chip ${state.filter === k ? 'on' : ''}" data-f="${k}">${label}<b>${counts[k]}</b></button>`
    ).join('');
    $('#chips').querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => { state.filter = c.dataset.f; state.limit = INITIAL_LIMIT; renderChips(); renderTable(); }));
  }

  function renderAppFilter() {
    const apps = [...new Set(state.rows.map((r) => r.app))];
    $('#appFilter').innerHTML = '<option value="">app 전체</option>' +
      apps.map((a) => `<option value="${a}">${a}</option>`).join('');
  }

  function updateRunBtn() {
    $('#runSelBtn').textContent = `선택 측정 (${state.selected.size})`;
    $('#runSelBtn').disabled = state.running || state.selected.size === 0;
    $('#runAllBtn').disabled = state.running;
  }

  /* ---------- table ---------- */
  function rowHtml(row) {
    const r = state.results.get(row.query_id);
    const s = r ? r.score : null;
    const sel = state.selected.has(row.query_id);
    const open = state.expanded.has(row.query_id);
    const scoreCell = state.running && state._activeId === row.query_id
      ? `<span class="score run" id="sc-${row.query_id}">측정중</span>`
      : `<span class="score ${scoreClass(s)}" id="sc-${row.query_id}">${scoreText(s)}</span>`;
    let html = `<tr class="row ${sel ? 'sel' : ''} ${open ? 'open' : ''}" data-id="${row.query_id}">
      <td class="c-check"><input type="checkbox" ${sel ? 'checked' : ''} data-chk="${row.query_id}" /></td>
      <td class="c-id"><span class="qid">${esc(row.query_id)}</span></td>
      <td><span class="desc">${esc(row.description)}</span></td>
      <td class="c-app"><span class="apptag">${esc(row.app)}</span></td>
      <td class="c-score">${scoreCell}</td>
      <td class="c-chev"><span class="chev">›</span></td>
    </tr>`;
    if (open) html += `<tr class="detail"><td colspan="6">${detailHtml(row)}</td></tr>`;
    return html;
  }

  function detailHtml(row) {
    const r = state.results.get(row.query_id);
    if (!r) return `<div class="detail-inner"><div class="empty" style="padding:20px;">아직 측정하지 않았습니다. 선택 후 ‘측정’을 실행하세요.</div></div>`;
    const cards = r.detail.map((d, i) => {
      const reslist = d.results.map((res, ri) => {
        const isHit = res.api_id === row.query_id;
        const isWrongTop = ri === 0 && !isHit;
        const content = String(res.content || '').trim();
        const author = String(res.author || '-');
        const meta = content
          ? `${author} · ${content.replace(/\s+/g, ' ').slice(0, 140)}`
          : `${author} · ${res.tables}`;
        const title = content || meta;
        const contentButton = content
          ? `<button class="content-link meta" data-title="${esc(res.api_id)}" data-content="${esc(enc(content))}">${esc(meta)}</button>`
          : `<span class="meta">${esc(meta)}</span>`;
        return `<div class="resrow ${isHit ? 'hit' : ''} ${isWrongTop ? 'wrongtop' : ''}">
          <div class="rank">${ri + 1}</div>
          <div class="resid" title="${esc(title)}"><span class="res-api">${esc(res.api_id)}</span>${contentButton}</div>
          <div class="sim">${res.similarity.toFixed(4)}</div>
        </div>`;
      }).join('');
      const rankTxt = d.rank ? `${d.rank}순위` : 'top-5 밖';
      return `<div class="qcard">
        <div class="qhead">
          <span class="qtag">Q${i + 1}</span>
          <span class="qtext">${esc(d.q)}</span>
          <span class="verdict ${d.correct ? 'ok' : 'no'}">${d.correct ? '정답 · ' + rankTxt : '오답 · ' + rankTxt}</span>
        </div>
        <div class="reslist">${reslist}</div>
      </div>`;
    }).join('');
    return `<div class="detail-inner">${cards}</div>`;
  }

  function renderTable() {
    const rows = visibleRows();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">조건에 맞는 API가 없습니다.</td></tr>`;
      syncSelAll(); return;
    }
    const shown = state.limit >= rows.length ? rows : rows.slice(0, state.limit);
    let html = shown.map(rowHtml).join('');
    const rest = rows.length - shown.length;
    if (rest > 0) {
      html += `<tr class="morerow"><td colspan="6">
        <button class="morebtn" id="moreBtn">더보기 — 남은 ${rest}개 모두 보기</button>
        <span class="morehint">${shown.length} / ${rows.length} 표시 중 · ‘전체’ 선택은 ${rows.length}개 모두에 적용됩니다</span>
      </td></tr>`;
    }
    tbody.innerHTML = html;
    syncSelAll();
  }

  // 측정 중 한 행만 부분 갱신 (전체 재렌더 회피)
  function patchScore(id) {
    const cell = document.getElementById('sc-' + id);
    if (!cell) return;
    const r = state.results.get(id);
    const running = state.running && state._activeId === id;
    cell.className = 'score ' + (running ? 'run' : scoreClass(r ? r.score : null));
    cell.textContent = running ? '측정중' : scoreText(r ? r.score : null);
    if (state.expanded.has(id)) {
      const tr = tbody.querySelector(`tr.row[data-id="${id}"]`);
      if (tr && tr.nextElementSibling && tr.nextElementSibling.classList.contains('detail')) {
        const row = state.rows.find((x) => x.query_id === id);
        tr.nextElementSibling.firstElementChild.innerHTML = detailHtml(row);
      }
    }
  }

  function syncSelAll() {
    const rows = visibleRows();
    const allSel = rows.length > 0 && rows.every((r) => state.selected.has(r.query_id));
    const some = rows.some((r) => state.selected.has(r.query_id));
    const el = $('#selAll');
    el.checked = allSel;
    el.indeterminate = !allSel && some;
  }

  /* ---------- interactions ---------- */
  function toggleSelect(id) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    const tr = tbody.querySelector(`tr.row[data-id="${id}"]`);
    if (tr) tr.classList.toggle('sel', state.selected.has(id));
    const chk = tbody.querySelector(`input[data-chk="${id}"]`);
    if (chk) chk.checked = state.selected.has(id);
    renderDash(); updateRunBtn(); syncSelAll();
  }

  function toggleExpand(id) {
    if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
    renderTable();
  }

  tbody.addEventListener('click', (e) => {
    if (e.target.closest('#moreBtn')) { state.limit = Infinity; renderTable(); return; }
    const contentBtn = e.target.closest('.content-link');
    if (contentBtn) {
      e.stopPropagation();
      openContentModal(contentBtn.dataset.title, dec(contentBtn.dataset.content));
      return;
    }
    const chk = e.target.closest('input[data-chk]');
    if (chk) { e.stopPropagation(); toggleSelect(chk.dataset.chk); return; }
    const tr = e.target.closest('tr.row');
    if (tr) toggleExpand(tr.dataset.id);
  });

  $('#selAll').addEventListener('change', (e) => {
    const rows = visibleRows();
    if (e.target.checked) rows.forEach((r) => state.selected.add(r.query_id));
    else rows.forEach((r) => state.selected.delete(r.query_id));
    renderTable(); renderDash(); updateRunBtn();
  });
  $('#clearSelBtn').addEventListener('click', () => {
    state.selected.clear(); renderTable(); renderDash(); updateRunBtn();
  });
  $('#saveResultsBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(serializeResults(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `rag-search-results-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $('#loadResultsBtn').addEventListener('click', () => $('#loadResultsFile').click());
  $('#loadResultsFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      applyResults(JSON.parse(await file.text()));
      refreshAfterResultsChange();
    } catch (err) {
      alert('결과 파일을 읽을 수 없습니다.');
      console.error(err);
    } finally {
      e.target.value = '';
    }
  });
  $('#clearResultsBtn').addEventListener('click', () => {
    if (!confirm('저장된 측정 결과를 모두 지울까요?')) return;
    state.results.clear();
    refreshAfterResultsChange();
  });
  $('#appFilter').addEventListener('change', (e) => { state.app = e.target.value; state.limit = INITIAL_LIMIT; renderTable(); });
  let searchT;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { state.q = e.target.value.trim(); state.limit = INITIAL_LIMIT; renderTable(); }, 160);
  });

  /* ---------- evaluation ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function evaluateRow(row) {
    const detail = [];
    for (let qi = 0; qi < row.questions.length; qi++) {
      const q = row.questions[qi];
      const res = await searchPgVector(q);
      const ids = res.result.map((r) => r.api_id);
      const idx = ids.indexOf(row.query_id);
      const correct = idx > -1 && idx < CONFIG.passTopK;
      detail.push({ q, correct, rank: idx > -1 ? idx + 1 : null, results: res.result });
    }
    const score = detail.filter((d) => d.correct).length;
    return { score, detail };
  }

  async function run(ids) {
    if (state.running || !ids.length) return;
    state.running = true; state.cancel = false;
    updateRunBtn();
    const prog = $('#progress'); prog.classList.add('on');
    const total = ids.length;

    for (let i = 0; i < total; i++) {
      if (state.cancel) break;
      const id = ids[i];
      const row = state.rows.find((r) => r.query_id === id);
      state._activeId = id;
      patchScore(id);
      $('#progLabel').textContent = `측정 중 ${i + 1} / ${total}`;
      $('#progNow').textContent = id;
      $('#progFill').style.width = ((i) / total * 100) + '%';

      const r = await evaluateRow(row);
      state.results.set(id, r);
      state._activeId = null;
      patchScore(id);
      renderDash();
      await sleep(14);
    }

    $('#progFill').style.width = '100%';
    state.running = false; state._activeId = null;
    renderChips(); updateRunBtn();
    const finished = !state.cancel;
    $('#progLabel').textContent = finished ? `완료 · ${total}개 측정` : '중지됨';
    setTimeout(() => { prog.classList.remove('on'); }, finished ? 1100 : 400);
    // 필터가 결과 의존적이면 갱신
    if (state.filter !== 'all') renderTable();
  }

  $('#cancelBtn').addEventListener('click', () => { state.cancel = true; });
  $('#runSelBtn').addEventListener('click', () => run([...state.selected]));
  $('#runAllBtn').addEventListener('click', () => run(visibleRows().map((r) => r.query_id)));

  function openContentModal(title, content) {
    $('#contentModalTitle').textContent = title || 'content';
    $('#contentModalPre').textContent = content || '';
    $('#contentModal').classList.add('on');
    $('#contentModal').setAttribute('aria-hidden', 'false');
  }

  function closeContentModal() {
    $('#contentModal').classList.remove('on');
    $('#contentModal').setAttribute('aria-hidden', 'true');
  }

  $('#closeContentBtn').addEventListener('click', closeContentModal);
  $('#contentModal').addEventListener('click', (e) => {
    if (e.target.id === 'contentModal') closeContentModal();
  });
  $('#copyContentBtn').addEventListener('click', async () => {
    const text = $('#contentModalPre').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    }
  });

  /* ---------- init ---------- */
  $('#topkPill').textContent = 'top-' + CONFIG.passTopK;
  loadRegistry().then((rows) => {
    state.rows = rows;
    renderDash(); renderChips(); renderAppFilter(); renderTable(); updateRunBtn();
  });
})();
