/* Phantom Flow — dashboard app
 * All DOM manipulation via createElement / textContent (no innerHTML).
 */
(() => {
  'use strict';

  /* ── constants ─────────────────────────────────────────────────────────── */
  const API = {
    status:  '/api/status',
    results: '/api/results',
    settings:'/api/settings',
    run:     '/api/run',
    upload:  '/api/upload',
    pipelineStatus: '/api/pipeline-status',
    lookup:  '/api/lookup',
  };

  const REC = {
    'immediate referral': { cls:'pill-refer',   short:'Refer',        bar:'#EF4444' },
    'compliance letter':  { cls:'pill-letter',  short:'Letter',       bar:'#F59E0B' },
    'review':             { cls:'pill-review',  short:'Review',       bar:'#3B82F6' },
    'monitor':            { cls:'pill-monitor', short:'Monitor',      bar:'#64748B' },
    'write off':          { cls:'pill-write',   short:'Write off',    bar:'#CBD5E1' },
    'insufficient evidence':{ cls:'pill-insuf', short:'Insuff. ev.', bar:'#A78BFA' },
  };

  const DEP_CLS = { high:'dep-high', medium:'dep-medium', low:'dep-low' };

  /* ── state ─────────────────────────────────────────────────────────────── */
  const state = {
    rows: [],
    filtered: [],
    sort: { key:'roi_score', dir:'desc' },
    filters: { search:'', rec:new Set(), province:'', confidence:'', dep:'', minScore:0, zombiesOnly:true },
    source: '',
    isLive: false,
    serverAvailable: false,
  };

  /* ── helpers ───────────────────────────────────────────────────────────── */
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  function el(tag, attrs={}, children=[]) {
    const n = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class')   n.className = v;
      else if (k === 'text')    n.textContent = String(v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (typeof v === 'boolean') { if (v) n.setAttribute(k, ''); }
      else n.setAttribute(k, String(v));
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c)) : c);
    }
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n)>=1e6) return '$'+(n/1e6).toFixed(1)+'M';
    if (Math.abs(n)>=1e3) return '$'+(n/1e3).toFixed(0)+'K';
    return '$'+Math.round(n).toLocaleString();
  }
  function fmtNum(n) { return n==null ? '—' : Math.round(n).toLocaleString(); }

  /* ── tab routing ───────────────────────────────────────────────────────── */
  function switchTab(name) {
    $$('.tab-panel').forEach(p => p.classList.add('hidden'));
    $$('.nav-tab, .mobile-nav-tab').forEach(b => b.classList.remove('active'));
    const panel = $(`#tab-${name}`);
    if (panel) panel.classList.remove('hidden');
    $$(`[data-tab="${name}"]`).forEach(b => b.classList.add('active'));
    if (name === 'chart') renderCharts();
  }

  $$('[data-tab]').forEach(btn => btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
    closeMobileMenu();
  }));

  /* ── mobile menu ───────────────────────────────────────────────────────── */
  const mobileMenu = $('#mobileMenu');
  function closeMobileMenu() {
    mobileMenu.classList.add('hidden');
    mobileMenu.setAttribute('aria-hidden','true');
  }
  $('#mobileMenuBtn').addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('hidden');
    mobileMenu.setAttribute('aria-hidden', String(open));
  });
  $$('[data-close-menu]').forEach(e => e.addEventListener('click', closeMobileMenu));

  /* ── settings modal ────────────────────────────────────────────────────── */
  function openSettings() {
    const m = $('#settingsModal');
    m.classList.remove('hidden');
    m.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    // Load saved values
    const saved = localStorage.getItem('pf_api_key');
    if (saved) $('#apiKeyInput').value = saved;
    fetch(API.status).then(r=>r.json()).then(d => {
      if (d.anthropic_key_set) {
        $('#apiKeyInput').placeholder = '••••••••••••••••••••••••• (set)';
      }
      $('#liveCorpToggle').checked = d.live_corp || false;
    }).catch(()=>{});
  }
  function closeSettings() {
    const m = $('#settingsModal');
    m.classList.add('hidden');
    m.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    $('#settingsSaved').classList.add('hidden');
  }
  $('#settingsBtn').addEventListener('click', openSettings);
  $$('[data-close-settings]').forEach(e => e.addEventListener('click', closeSettings));
  $('#toggleKeyVis').addEventListener('click', () => {
    const inp = $('#apiKeyInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('#saveSettingsBtn').addEventListener('click', async () => {
    const key = $('#apiKeyInput').value.trim();
    const live = $('#liveCorpToggle').checked;
    if (key) localStorage.setItem('pf_api_key', key);
    try {
      const r = await fetch(API.settings, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ anthropic_api_key: key, use_live_corp: live }),
      });
      if (r.ok) {
        $('#settingsSaved').classList.remove('hidden');
        updateKeyBadge(true);
        setTimeout(() => $('#settingsSaved').classList.add('hidden'), 3000);
      }
    } catch(e) {
      // Server not available; still save locally
      if (key) updateKeyBadge(true);
      $('#settingsSaved').classList.remove('hidden');
      setTimeout(() => $('#settingsSaved').classList.add('hidden'), 3000);
    }
  });

  function updateKeyBadge(set) {
    const dot = $('#keyDot');
    const lbl = $('#keyLabel');
    dot.className = set ? 'h-2 w-2 rounded-full bg-ok-500' : 'h-2 w-2 rounded-full bg-ink-300';
    lbl.textContent = set ? 'API key set' : 'No API key';
  }

  /* ── data loading ──────────────────────────────────────────────────────── */
  async function loadData() {
    // Always try bundled static file first (fast, works on Vercel)
    // Live API is used only when explicitly running a live pipeline
    const candidates = ['./data/results.json', '/api/results'];

    for (const url of candidates) {
      try {
        const r = await fetch(url + '?_=' + Date.now(), {cache:'no-store'});
        if (!r.ok) continue;
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) {
          state.source = url;
          state.isLive = url.includes('/api/');
          return rows;
        }
      } catch(_) {}
    }
    return [];
  }

  async function checkServerStatus() {
    try {
      const r = await fetch(API.status, {signal: AbortSignal.timeout(2000)});
      if (r.ok) {
        const d = await r.json();
        state.serverAvailable = true;
        updateKeyBadge(d.anthropic_key_set || !!localStorage.getItem('pf_api_key'));
        return d;
      }
    } catch(_) {}
    state.serverAvailable = false;
    updateKeyBadge(!!localStorage.getItem('pf_api_key'));
    // Hide "Run live" button — not usable without local server
    const liveBtn = $('#runLiveBtn');
    if (liveBtn) {
      liveBtn.classList.add('hidden');
    }
    return null;
  }

  /* ── KPIs ──────────────────────────────────────────────────────────────── */
  function updateDataBadge() {
    let badge = $('#dataBadge');
    if (!badge) return;
    if (!state.rows.length) { badge.classList.add('hidden'); return; }
    badge.classList.remove('hidden');
    if (state.isLive) {
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-ok-50 text-ok-700 border border-ok-200';
      badge.innerHTML = '<span class="h-1.5 w-1.5 rounded-full bg-ok-500 animate-pulse inline-block"></span> Live data';
    } else {
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200';
      badge.innerHTML = '<span class="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block"></span> Demo data';
    }
  }

  function setKpis() {
    const rows = state.rows;
    $('[data-kpi="entities"]').textContent = fmtNum(rows.length);
    $('[data-kpi="zombies"]').textContent = fmtNum(rows.filter(r=>r.is_zombie).length);
    $('[data-kpi="referrals"]').textContent = fmtNum(rows.filter(r=>r.recommendation==='immediate referral').length);
    $('[data-kpi="awarded"]').textContent = fmtMoney(rows.reduce((s,r)=>s+(+r.total_awarded||0),0));
    $('[data-kpi="recoverable"]').textContent = fmtMoney(rows.filter(r=>r.is_zombie).reduce((s,r)=>s+(+r.estimated_recoverable||0),0));
    updateDataBadge();
  }

  /* ── filters ───────────────────────────────────────────────────────────── */
  function buildFilterChips() {
    const box = $('#filterRec');
    if (box) {
      clear(box);
      Object.keys(REC).forEach(rec => {
        const cb = el('input',{type:'checkbox',value:rec,class:'sr-only'});
        cb.addEventListener('change', () => {
          if (cb.checked) state.filters.rec.add(rec); else state.filters.rec.delete(rec);
          applyFilters();
        });
        const chip = el('label',{class:'filter-chip'},[cb, el('span',{text:(REC[rec]||{}).short||rec})]);
        box.appendChild(chip);
        cb.addEventListener('change', () => chip.classList.toggle('selected', cb.checked));
      });
    }
    const provSel = $('#filterProvince');
    if (provSel) {
      // Only add new options (avoid duplicates on re-call)
      const existing = new Set(Array.from(provSel.options).map(o=>o.value));
      const provs = Array.from(new Set(state.rows.map(r=>r.province).filter(Boolean))).sort();
      provs.forEach(p => { if (!existing.has(p)) provSel.appendChild(el('option',{value:p,text:p})); });
    }
  }

  function bindFilterEvents() {
    $('#filterSearch').addEventListener('input', e => { state.filters.search = e.target.value.toLowerCase(); applyFilters(); });
    $('#filterProvince').addEventListener('change', e => { state.filters.province = e.target.value; applyFilters(); });
    $('#filterConfidence').addEventListener('change', e => { state.filters.confidence = e.target.value; applyFilters(); });
    $('#filterDep').addEventListener('change', e => { state.filters.dep = e.target.value; applyFilters(); });
    $('#filterScore').addEventListener('input', e => { state.filters.minScore = +e.target.value; $('#filterScoreVal').textContent = e.target.value; applyFilters(); });
    $('#filterZombies').addEventListener('change', e => { state.filters.zombiesOnly = e.target.checked; applyFilters(); });
    $('#resetFilters').addEventListener('click', resetFilters);
  }

  function resetFilters() {
    state.filters = { search:'', rec:new Set(), province:'', confidence:'', dep:'', minScore:0, zombiesOnly:false };
    $('#filterSearch').value = '';
    $('#filterProvince').value = '';
    $('#filterConfidence').value = '';
    $('#filterDep').value = '';
    $('#filterScore').value = '0';
    $('#filterScoreVal').textContent = '0';
    $('#filterZombies').checked = false;
    $$('#filterRec input').forEach(i => { i.checked = false; i.closest('.filter-chip')?.classList.remove('selected'); });
    applyFilters();
  }

  function applyFilters() {
    const f = state.filters;
    state.filtered = state.rows.filter(r => {
      if (f.zombiesOnly && !r.is_zombie) return false;
      if (f.rec.size && !f.rec.has(r.recommendation)) return false;
      if (f.province && r.province !== f.province) return false;
      if (f.confidence && r.confidence !== f.confidence) return false;
      if (f.dep && r.funding_dependency !== f.dep) return false;
      if ((+r.roi_score||0) < f.minScore) return false;
      if (f.search) {
        const hay = ((r.display_name||'')+(r.name_clean||'')).toLowerCase();
        if (!hay.includes(f.search)) return false;
      }
      return true;
    });
    sortRows();
    renderQueue();
  }

  function sortRows() {
    const { key, dir } = state.sort;
    const m = dir==='asc' ? 1 : -1;
    state.filtered.sort((a,b) => {
      const av=a[key], bv=b[key];
      if (av==null && bv==null) return 0;
      if (av==null) return 1; if (bv==null) return -1;
      if (typeof av==='number' && typeof bv==='number') return (av-bv)*m;
      return String(av).localeCompare(String(bv))*m;
    });
  }

  /* ── pill helpers ──────────────────────────────────────────────────────── */
  function recPill(rec) {
    const m = REC[rec]||REC['monitor'];
    return el('span',{class:'pill '+(REC[rec]?.cls||'pill-monitor'),role:'status',text:m.short});
  }
  function confPill(c) {
    const cls = ({high:'conf-high',medium:'conf-medium',low:'conf-low'})[c]||'conf-none';
    return el('span',{class:'pill '+cls,text:c||'none'});
  }
  function depPill(d) {
    const cls = DEP_CLS[d]||'dep-low';
    const labels = {high:'High dep.', medium:'Med. dep.', low:'Low dep.'};
    return el('span',{class:'pill '+cls,text:labels[d]||d||'—'});
  }
  function roiBar(score) {
    const pct = Math.max(0,Math.min(100,+score||0));
    return el('div',{class:'flex items-center gap-2'},[
      el('span',{class:'font-mono text-sm font-semibold tabular-nums text-ink-700 w-8 text-right',text:pct.toFixed(0)}),
      el('div',{class:'bar',aria_hidden:'true'},[el('span',{style:{transform:`scaleX(${pct/100})`}})]),
    ]);
  }

  /* ── queue render ──────────────────────────────────────────────────────── */
  function renderQueue() {
    $('#queueCount').textContent = state.filtered.length.toLocaleString();
    $('#loading').classList.add('hidden');
    const empty = state.rows.length===0;
    $('#emptyState').classList.toggle('hidden',!empty);
    if (empty) { clear($('#queueCards')); clear($('#queueRows')); return; }
    renderTable();
    renderCards();
  }

  function renderTable() {
    const tbody = $('#queueRows');
    clear(tbody);
    const frag = document.createDocumentFragment();
    state.filtered.forEach((r,i) => {
      const programs = (r.programs||[]).slice(0,2).join(' · ');
      const tr = el('tr',{tabindex:0,role:'button','aria-label':'Open case '+(r.display_name||r.name_clean||''),class:'transition-colors'});
      tr.appendChild(el('td',{class:'px-4 py-3.5'},[
        el('div',{class:'font-semibold text-ink-900 max-w-xs truncate text-[15px]',text:r.display_name||r.name_clean||'—'}),
        el('div',{class:'text-xs text-ink-400 mt-0.5 truncate max-w-xs',text:programs}),
      ]));
      const zombieTd = el('td',{class:'px-4 py-3.5 text-center'});
      zombieTd.appendChild(r.is_zombie
        ? el('span',{class:'inline-flex items-center justify-center h-6 w-6 rounded-full bg-danger-100 text-danger-700',title:'Zombie — dissolved ≤12 months after last award'},[
            el('svg',{viewBox:'0 0 24 24',fill:'none','stroke-width':'2.5','stroke-linecap':'round','stroke-linejoin':'round',class:'h-3.5 w-3.5',stroke:'currentColor',innerHTML:''}, [
              (() => { const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d','M5 13l4 4L19 7'); return p; })()
            ])
          ])
        : el('span',{class:'inline-flex items-center justify-center h-6 w-6 rounded-full bg-ink-100 text-ink-400',title:'Not a zombie'},[
            (() => { const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('fill','none'); s.setAttribute('stroke-width','2'); s.setAttribute('class','h-3.5 w-3.5'); s.setAttribute('stroke','currentColor'); const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d','M18 6 6 18M6 6l12 12'); s.appendChild(p); return s; })()
          ])
      );
      tr.appendChild(zombieTd);
      tr.appendChild(el('td',{class:'px-4 py-3.5 font-mono text-sm text-ink-600',text:r.province||'—'}));
      tr.appendChild(el('td',{class:'px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-ink-900',text:fmtMoney(r.total_awarded)}));
      tr.appendChild(el('td',{class:'px-4 py-3.5 text-right font-mono text-sm font-semibold tabular-nums text-accent-600',text:fmtMoney(r.estimated_recoverable)}));
      tr.appendChild(el('td',{class:'px-4 py-3.5 text-right font-mono text-sm tabular-nums text-ink-700',text:r.months_to_dissolution==null?'—':(+r.months_to_dissolution).toFixed(0)}));
      tr.appendChild(el('td',{class:'px-4 py-3.5'},[roiBar(r.roi_score)]));
      tr.appendChild(el('td',{class:'px-4 py-3.5'},[recPill(r.recommendation)]));
      tr.appendChild(el('td',{class:'px-4 py-3.5'},[depPill(r.funding_dependency)]));
      tr.addEventListener('click',()=>openCase(i));
      tr.addEventListener('keydown',e=>{ if (e.key==='Enter'||e.key===' '){ e.preventDefault(); openCase(i); }});
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }

  function renderCards() {
    const ul = $('#queueCards');
    clear(ul);
    const frag = document.createDocumentFragment();
    state.filtered.forEach((r,i) => {
      const programs = (r.programs||[]).slice(0,2).join(' · ');
      const sub = (r.province?r.province:'')+(r.province&&programs?' · ':'')+programs;
      const btn = el('button',{type:'button',class:'w-full text-left rounded-xl border border-ink-200 bg-white p-4 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors hover:bg-ink-50 hover:border-ink-300'});
      btn.appendChild(el('div',{class:'flex items-start justify-between gap-2 mb-3'},[
        el('div',{class:'min-w-0'},[
          el('div',{class:'font-semibold text-ink-900 truncate text-[15px]',text:r.display_name||r.name_clean||'—'}),
          el('div',{class:'text-xs text-ink-400 mt-0.5 truncate',text:sub}),
        ]),
        recPill(r.recommendation),
      ]));
      btn.appendChild(el('div',{class:'grid grid-cols-3 gap-3 text-xs text-ink-500'},[
        el('div',{},[el('div',{class:'uppercase tracking-wide font-medium',text:'Awarded'}),el('div',{class:'mt-1 font-mono text-sm font-bold text-ink-900 tabular-nums',text:fmtMoney(r.total_awarded)})]),
        el('div',{},[el('div',{class:'uppercase tracking-wide font-medium',text:'Recoverable'}),el('div',{class:'mt-1 font-mono text-sm font-bold text-accent-600 tabular-nums',text:fmtMoney(r.estimated_recoverable)})]),
        el('div',{},[el('div',{class:'uppercase tracking-wide font-medium',text:'ROI score'}),el('div',{class:'mt-1'},[roiBar(r.roi_score)])]),
      ]));
      if (r.funding_dependency && r.funding_dependency !== 'low') {
        btn.appendChild(el('div',{class:'mt-3 pt-3 border-t border-ink-100 flex items-center gap-2'},[
          depPill(r.funding_dependency),
          r.is_zombie ? el('span',{class:'pill pill-refer',text:'Zombie ≤12mo'}) : null,
        ].filter(Boolean)));
      }
      btn.addEventListener('click',()=>openCase(i));
      frag.appendChild(el('li',{},[btn]));
    });
    ul.appendChild(frag);
  }

  /* ── sort headers ──────────────────────────────────────────────────────── */
  function bindSort() {
    $$('#queueTable .th[data-sort]').forEach(th => {
      th.addEventListener('click',()=>toggleSort(th.dataset.sort,th));
      th.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleSort(th.dataset.sort,th); }});
    });
  }
  function toggleSort(key, th) {
    state.sort.dir = state.sort.key===key ? (state.sort.dir==='asc'?'desc':'asc') : 'desc';
    state.sort.key = key;
    $$('#queueTable .th').forEach(t => t.removeAttribute('aria-sort'));
    th.setAttribute('aria-sort', state.sort.dir==='asc'?'ascending':'descending');
    sortRows(); renderQueue();
  }

  /* ── case detail ───────────────────────────────────────────────────────── */
  function openCase(idx) {
    const r = state.filtered[idx];
    if (!r) return;
    $('#caseTitle').textContent = r.display_name||r.name_clean||'Case';
    const body = $('#caseBody');
    clear(body);

    const bd = r.score_breakdown||{};
    const flags = r.flags||[];
    const programs = r.programs||[];
    const summary = r.case_summary||'No AI summary yet — run the pipeline with ANTHROPIC_API_KEY set.';

    // Financials summary bar
    body.appendChild(el('div',{class:'grid grid-cols-3 gap-4 rounded-xl bg-ink-50 border border-ink-200 px-5 py-4'},[
      el('div',{},[el('div',{class:'text-xs font-bold uppercase tracking-wide text-ink-500',text:'Total awarded'}), el('div',{class:'text-2xl font-mono font-bold text-ink-900 mt-1 tabular-nums',text:fmtMoney(r.total_awarded)})]),
      el('div',{},[el('div',{class:'text-xs font-bold uppercase tracking-wide text-ink-500',text:'Est. recoverable'}), el('div',{class:'text-2xl font-mono font-bold text-accent-600 mt-1 tabular-nums',text:fmtMoney(r.estimated_recoverable)})]),
      el('div',{},[el('div',{class:'text-xs font-bold uppercase tracking-wide text-ink-500',text:'ROI score'}), el('div',{class:'text-2xl font-mono font-bold text-brand-700 mt-1 tabular-nums',text:(+r.roi_score||0).toFixed(0)+' / 100'})]),
    ]));

    // Pills row
    body.appendChild(el('div',{class:'flex flex-wrap gap-2 pb-1'},[
      recPill(r.recommendation),
      confPill(r.confidence),
      r.is_zombie ? el('span',{class:'pill pill-refer',text:'Zombie ≤12mo'}) : null,
      r.funding_dependency ? depPill(r.funding_dependency) : null,
    ].filter(Boolean)));

    // ── Two-column grid on large panel ───────────────────────────────────────
    const leftCol = el('div',{class:'space-y-5'});
    const rightCol = el('div',{class:'space-y-5'});
    const twoCol = el('div',{class:'grid grid-cols-1 lg:grid-cols-2 gap-5'});
    twoCol.appendChild(leftCol);
    twoCol.appendChild(rightCol);
    body.appendChild(twoCol);

    // LEFT — AI Summary
    leftCol.appendChild(sectionCard('AI case summary',[
      el('p',{class:'text-base text-ink-800 leading-relaxed',text:summary}),
    ]));

    // LEFT — ROI Breakdown
    const scoreRows = [
      ['Recoverable amount', bd.recoverable, 35],
      ['Evidence strength',  bd.evidence,    30],
      ['Pursuit cost',       bd.pursuit_cost,20],
      ['Public exposure',    bd.exposure,    15],
    ].map(([label,val,max]) => {
      const v=+val||0, pct=Math.min(100,(v/max)*100);
      return el('div',{class:'space-y-1.5'},[
        el('div',{class:'flex justify-between text-[15px]'},[
          el('span',{class:'text-ink-700 font-medium',text:label}),
          el('span',{class:'font-mono tabular-nums font-bold text-ink-900',text:v.toFixed(1)+' / '+max}),
        ]),
        el('div',{class:'h-2.5 rounded-full bg-ink-100 overflow-hidden'},[
          el('div',{class:'h-full bg-brand-700 rounded-full transition-all',style:{width:pct+'%'}}),
        ]),
      ]);
    });
    const total = (+r.roi_score||0);
    scoreRows.push(el('div',{class:'flex justify-between text-lg font-bold border-t-2 border-ink-200 pt-3 mt-2'},[
      el('span',{class:'text-ink-900',text:'Total ROI score'}),
      el('span',{class:'font-mono tabular-nums text-brand-700',text:total.toFixed(0)+' / 100'}),
    ]));
    leftCol.appendChild(sectionCard('ROI score breakdown',scoreRows));

    // RIGHT — Evidence
    const dl = el('dl',{class:'grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]'});
    const ev = [
      ['Matched name',    r.matched_name],
      ['Corp status',     r.status],
      ['Dissolution',     r.dissolution_date],
      ['Last award',      r.last_award_date ? String(r.last_award_date).slice(0,10) : null],
      ['Months to diss.', r.months_to_dissolution==null?null:(+r.months_to_dissolution).toFixed(0)+' mo'],
      ['Match score',     r.match_confidence!=null ? r.match_confidence+' / 100' : null],
      ['Jurisdiction',    r.jurisdiction],
      ['# grants',        r.num_grants],
      ['Province',        r.province],
    ];
    ev.forEach(([label,value])=>{
      dl.appendChild(el('dt',{class:'text-ink-500 font-semibold',text:label}));
      dl.appendChild(el('dd',{class:'font-mono text-ink-900 truncate font-medium',text:String(value||'—')}));
    });
    rightCol.appendChild(sectionCard('Evidence',[ dl ]));

    // RIGHT — Programs
    const pBox = el('div',{class:'flex flex-wrap gap-2'});
    if (programs.length) {
      programs.forEach(p => pBox.appendChild(el('span',{class:'rounded-lg bg-ink-100 px-2.5 py-1 font-mono text-xs text-ink-700',text:p})));
    } else {
      pBox.appendChild(el('span',{class:'text-sm text-ink-400',text:'none recorded'}));
    }
    rightCol.appendChild(sectionCard('Programs ('+programs.length+')',[pBox]));

    // RIGHT — Flags
    if (flags.length) {
      const fBox = el('div',{class:'flex flex-wrap gap-2'});
      flags.forEach(f => fBox.appendChild(el('span',{class:'rounded-lg bg-accent-50 border border-accent-400 px-2.5 py-1 text-xs font-semibold text-accent-600',text:f})));
      rightCol.appendChild(sectionCard('Flags',[fBox]));
    }

    // Caveat (full width)
    body.appendChild(el('p',{class:'text-xs text-ink-400 leading-relaxed border-t border-ink-100 pt-4',text:'Phantom Flow surfaces public-record patterns only. Do not assert wrongdoing based on this summary alone. Verify against authoritative sources before acting.'}));

    const panel = $('#casePanel');
    panel.classList.remove('hidden');
    panel.classList.add('flex');
    panel.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    $('[data-close-case]',panel).focus();
  }

  function sectionCard(title, children) {
    return el('section',{class:'space-y-3'},[
      el('h3',{class:'text-xs font-bold uppercase tracking-widest text-ink-400 pb-1 border-b border-ink-100',text:title}),
      ...children,
    ]);
  }

  function closeCase() {
    const p = $('#casePanel');
    p.classList.add('hidden');
    p.classList.remove('flex');
    p.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }
  $$('[data-close-case]').forEach(e => e.addEventListener('click',closeCase));
  document.addEventListener('keydown', e => { if (e.key==='Escape') { closeCase(); closeSettings(); closeInvestigate(); } });

  /* ── mobile filter drawer ──────────────────────────────────────────────── */
  function bindFilterDrawer() {
    const drawer = $('#filtersDrawer');
    const slot = $('#filtersDrawerSlot');
    const sidebar = $('#filtersPanel') || el('div');
    const inner = $('#filtersInner');

    function openDrawer() {
      slot.appendChild(inner);
      drawer.classList.remove('hidden');
      drawer.setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
      const sidebar2 = $$('.lg\\:block aside, aside.hidden')[0];
      // Re-attach to the lg sidebar
      const target = document.querySelector('.sticky.top-20 .rounded-xl');
      if (target) target.appendChild(inner);
      else document.querySelector('.lg\\:block aside')?.appendChild(inner);
      drawer.classList.add('hidden');
      drawer.setAttribute('aria-hidden','true');
      document.body.style.overflow = '';
    }
    const toggle = $('#filtersToggleMobile');
    if (toggle) toggle.addEventListener('click',openDrawer);
    $$('[data-close-drawer]',drawer).forEach(e=>e.addEventListener('click',closeDrawer));
  }

  /* ── charts ────────────────────────────────────────────────────────────── */
  function renderCharts() {
    renderRoiChart();
    renderDepChart();
  }

  function renderRoiChart() {
    const canvas = $('#roiChart');
    if (!canvas) return;
    const top = state.rows.slice().sort((a,b)=>(b.roi_score||0)-(a.roi_score||0)).slice(0,15);
    if (!top.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio||1;
    const W = canvas.parentElement.clientWidth - 48;
    const ROW_H = 36, PAD_LEFT = 160, PAD_RIGHT = 60, PAD_TOP = 24, PAD_BOT = 16;
    const H = ROW_H * top.length + PAD_TOP + PAD_BOT;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr,dpr);
    ctx.clearRect(0,0,W,H);
    const barW = W - PAD_LEFT - PAD_RIGHT;
    const maxScore = 100;

    // Grid lines
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    [0,25,50,75,100].forEach(v => {
      const x = PAD_LEFT + (v/maxScore)*barW;
      ctx.beginPath(); ctx.moveTo(x,PAD_TOP-8); ctx.lineTo(x,H-PAD_BOT); ctx.stroke();
      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v, x, PAD_TOP-12);
    });

    top.forEach((r,i) => {
      const y = PAD_TOP + i*ROW_H;
      const w = ((+r.roi_score||0)/maxScore)*barW;
      const rec = REC[r.recommendation]||REC['monitor'];

      // Bar background
      ctx.fillStyle = '#F1F5F9';
      ctx.beginPath();
      ctx.roundRect(PAD_LEFT, y+6, barW, ROW_H-12, 4);
      ctx.fill();

      // Bar fill
      ctx.fillStyle = rec.bar;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(PAD_LEFT, y+6, Math.max(w,4), ROW_H-12, 4);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Score label
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 12px "Fira Code", monospace';
      ctx.textAlign = 'left';
      ctx.fillText((+r.roi_score||0).toFixed(0), PAD_LEFT+w+6, y+ROW_H/2+4);

      // Entity name
      const name = (r.display_name||r.name_clean||'').slice(0,22)+(((r.display_name||r.name_clean||'').length>22)?'…':'');
      ctx.fillStyle = '#334155';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(name, PAD_LEFT-8, y+ROW_H/2+4);
    });
  }

  function renderDepChart() {
    const canvas = $('#depChart');
    if (!canvas) return;
    const counts = {high:0,medium:0,low:0};
    state.rows.forEach(r => { if (r.funding_dependency in counts) counts[r.funding_dependency]++; });
    const total = Object.values(counts).reduce((a,b)=>a+b,0);
    if (!total) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio||1;
    const SIZE = Math.min(canvas.parentElement.clientWidth-32, 200);
    canvas.width = SIZE*dpr; canvas.height = SIZE*dpr;
    canvas.style.width = SIZE+'px'; canvas.style.height = SIZE+'px';
    ctx.scale(dpr,dpr);
    const cx=SIZE/2, cy=SIZE/2, R=SIZE/2-16;
    const colors = { high:'#EF4444', medium:'#F59E0B', low:'#CBD5E1' };
    let start = -Math.PI/2;
    Object.entries(counts).forEach(([k,v]) => {
      if (!v) return;
      const sweep = (v/total)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,R,start,start+sweep);
      ctx.closePath();
      ctx.fillStyle = colors[k];
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      // Label
      const mid = start+sweep/2;
      const lx = cx+Math.cos(mid)*(R*0.65);
      const ly = cy+Math.sin(mid)*(R*0.65);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v, lx, ly+4);
      start += sweep;
    });
  }

  /* ── pipeline runner ───────────────────────────────────────────────────── */
  function runPipeline(demo) {
    // Demo always loads bundled static JSON — no server needed
    if (demo) {
      showPipelineStatus('Loading demo data…', false, 10);
      fetch('./data/results.json?_=' + Date.now(), {cache:'no-store'})
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(rows => {
          if (!Array.isArray(rows) || !rows.length) throw new Error('Empty data');
          state.rows = rows; state.isLive = false;
          setKpis(); buildFilterChips(); applyFilters();
          showPipelineStatus('Demo data loaded — ' + rows.length + ' entities', false, 100, true);
        })
        .catch(() => showPipelineStatus('Could not load demo data. Check web/data/results.json.', true));
      return;
    }
    // Live: requires local server
    if (!state.serverAvailable) return;
    showPipelineStatus('Downloading real grants CSV (~200MB). This takes 2–5 min…', false, 3);
    setRunState('running');
    fetch(API.run, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({demo:false,top_n:25})})
      .then(r => {
        if (!r.ok) throw new Error('Server returned ' + r.status + ' — is python server.py running?');
        return r.json();
      })
      .then(d => {
        if (d.error) { setRunState('error'); showPipelineStatus(d.error, true); return; }
        pollPipeline();
      })
      .catch(e => { setRunState('error'); showPipelineStatus(e.message, true); });
  }

  const PIPELINE_STEPS = [
    [3,  'Downloading grants data…'],
    [8,  'Normalizing entity names…'],
    [14, 'Aggregating by recipient…'],
    [22, 'Looking up corporate records…'],
    [35, 'Matching entities to corps…'],
    [50, 'Scoring recovery ROI…'],
    [70, 'Flagging zombie candidates…'],
    [85, 'Generating AI case summaries…'],
    [95, 'Writing results…'],
  ];
  let _pollStep = 0;
  let _pollTick = 0;

  let _pollInterval = null;
  function pollPipeline() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    _pollStep = 0; _pollTick = 0;
    let _pollTimeout = setTimeout(() => {
      if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
      hidePipelineStatus(); setRunState('error');
      showPipelineStatus('Pipeline timed out after 5 minutes.', true);
    }, 300_000); // 5 min max

    _pollInterval = setInterval(async () => {
      try {
        const d = await fetch(API.pipelineStatus).then(r=>r.json());
        if (d.running) {
          _pollTick++;
          if (_pollTick % 3 === 0 && _pollStep < PIPELINE_STEPS.length - 1) _pollStep++;
          const [pct, msg] = PIPELINE_STEPS[_pollStep];
          showPipelineStatus(msg, false, pct);
          return;
        }
        clearInterval(_pollInterval); _pollInterval = null;
        clearTimeout(_pollTimeout);
        hidePipelineStatus();
        if (d.error) {
          setRunState('error');
          const msg = (d.error.includes('404') || d.error.includes('403') || d.error.includes('SAS') || d.error.includes('download'))
            ? 'Grants CSV download failed (URL expired). Use the Upload CSV tab to upload it manually from open.canada.ca.'
            : 'Pipeline error: ' + d.error;
          showPipelineStatus(msg, true, 0);
          return;
        }
        setRunState('done');
        state.rows = await loadData();
        setKpis(); buildFilterChips(); applyFilters();
        showLiveBadge();
      } catch(e) {
        clearInterval(_pollInterval); _pollInterval = null;
        clearTimeout(_pollTimeout);
        hidePipelineStatus(); setRunState('error');
      }
    }, 1500);
  }

  /* ── persistent run-state badge ─────────────────────────────────────────── */
  function setRunState(state_) {
    // state_: 'running' | 'done' | 'error' | 'hidden'
    const badge = $('#runStateBadge');
    const dot   = $('#runStateDot');
    const txt   = $('#runStateText');
    if (!badge) return;
    if (state_ === 'hidden') { badge.classList.add('hidden'); return; }
    badge.classList.remove('hidden');
    badge.className = 'mt-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ' + {
      running: 'bg-brand-50 text-brand-700 border-brand-200',
      done:    'bg-ok-50 text-ok-700 border-ok-200',
      error:   'bg-danger-50 text-danger-700 border-danger-200',
    }[state_];
    dot.className = 'h-2 w-2 rounded-full flex-shrink-0 ' + {
      running: 'bg-brand-500 animate-pulse',
      done:    'bg-ok-500',
      error:   'bg-danger-500',
    }[state_];
    txt.textContent = { running: 'Processing…', done: 'Pipeline complete', error: 'Run failed' }[state_];
    if (state_ === 'done') setTimeout(() => setRunState('hidden'), 8000);
  }

  let _statusTimer = null;
  function showPipelineStatus(msg, error=false, pct=null, autoDismiss=false) {
    if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
    const box = $('#pipelineStatus');
    box.classList.remove('hidden');
    box.className = 'mt-3 text-sm rounded-xl p-3 border '+(error?'bg-danger-50 text-danger-700 border-danger-200':'bg-brand-50 text-brand-800 border-brand-200');
    clear(box);
    const dot = el('span',{class:'inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 '+(error?'bg-danger-500':'bg-brand-500 animate-pulse')});
    box.appendChild(el('div',{class:'flex items-center gap-2 font-medium'},[dot, el('span',{text:msg})]));
    // For download errors show Upload shortcut link
    if (error && (msg.includes('Upload CSV') || msg.includes('download') || msg.includes('expired'))) {
      const link = el('button',{
        class:'mt-1.5 text-xs underline text-danger-700 cursor-pointer bg-transparent border-none p-0',
        text:'Go to Upload CSV tab →',
      });
      link.addEventListener('click', () => { switchTab('upload'); hidePipelineStatus(); });
      box.appendChild(link);
    }
    if (!error && pct !== null) {
      const track = el('div',{class:'mt-2 h-1.5 rounded-full bg-brand-200 overflow-hidden'});
      track.appendChild(el('div',{class:'h-full bg-brand-600 rounded-full transition-all',style:{width:pct+'%'}}));
      box.appendChild(track);
    }
    if (autoDismiss) _statusTimer = setTimeout(hidePipelineStatus, 3000);
    // Errors stay visible until dismissed or next action (no auto-dismiss)
  }
  function hidePipelineStatus() { $('#pipelineStatus').classList.add('hidden'); }

  $('#runDemoBtn')?.addEventListener('click', () => runPipeline(true));
  $('#runLiveBtn')?.addEventListener('click', () => runPipeline(false));
  $('#emptyRunBtn')?.addEventListener('click', () => runPipeline(true));

  /* ── AI investigate ────────────────────────────────────────────────────── */
  function openInvestigateModal() {
    const modal = $('#investigateModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';

    const body = $('#investigateBody');
    clear(body);
    body.appendChild(el('div',{class:'flex flex-col items-center justify-center py-10 gap-4'},[
      el('div',{class:'h-10 w-10 rounded-full border-4 border-brand-600 border-t-transparent animate-spin'}),
      el('p',{class:'text-base font-medium text-ink-700',text:'Reviewing top zombie candidates…'}),
      el('p',{class:'text-sm text-ink-500 text-center',text:'The AI is selecting the most compelling case and writing a forensic investigation.'}),
    ]));

    if (!state.serverAvailable) {
      renderInvestigateResult(buildStaticInvestigation());
      return;
    }

    fetch('/api/investigate', {method:'POST', headers:{'Content-Type':'application/json'}})
      .then(r => {
        if (!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
      })
      .then(d => {
        if (d.error) {
          // LLM not configured — still show static investigation
          renderInvestigateResult(buildStaticInvestigation());
          return;
        }
        renderInvestigateResult(d);
      })
      .catch(() => {
        // Server not available or endpoint error — use static fallback
        renderInvestigateResult(buildStaticInvestigation());
      });
  }

  function buildStaticInvestigation() {
    const top = state.filtered.slice().sort((a,b) => (b.roi_score||0)-(a.roi_score||0))[0];
    if (!top) return {investigation:'No zombie candidates loaded. Run the demo pipeline first.', selected_entity:null, candidates_reviewed:0};
    const flags = (top.flags||[]).map(f => '- '+f).join('\n') || '- zombie_12mo';
    const inv = `## Selected case: ${top.display_name||top.name_clean}
### Why this case
This entity received ${fmtMoney(top.total_awarded)} from ${(top.programs||[]).length} federal program(s) and ${top.status||'dissolved'} ${top.months_to_dissolution!=null?(+top.months_to_dissolution).toFixed(0)+' months':''} after its last award — the highest ROI score in the current dataset at ${(+top.roi_score||0).toFixed(0)}/100. Match confidence is ${top.confidence||'medium'}, making it the most defensible referral candidate.
### Forensic narrative
${top.case_summary||'No AI summary generated yet. Configure GEMINI_API_KEY and rerun the pipeline to generate AI-written narratives.'}
### Red flags
${flags}`;
    return {investigation: inv, selected_entity: top, candidates_reviewed: state.filtered.filter(r=>r.is_zombie).length};
  }

  function renderInvestigateResult(d) {
    const body = $('#investigateBody');
    clear(body);

    const entity = d.selected_entity;
    const investigation = d.investigation || '';
    const candidatesReviewed = d.candidates_reviewed || 0;

    // Meta bar
    if (entity) {
      body.appendChild(el('div',{class:'flex flex-wrap items-center gap-3 rounded-xl bg-ink-50 border border-ink-200 px-5 py-3'},[
        el('div',{class:'flex-1 min-w-0'},[
          el('div',{class:'text-xs font-bold uppercase tracking-wide text-ink-500',text:'AI selected'}),
          el('div',{class:'font-bold text-ink-900 text-base truncate',text:entity.display_name||entity.name_clean||'—'}),
        ]),
        el('div',{class:'text-right'},[
          el('div',{class:'text-xs text-ink-500',text:'ROI score'}),
          el('div',{class:'font-mono font-bold text-brand-700 text-lg',text:(+entity.roi_score||0).toFixed(0)+'/100'}),
        ]),
        el('div',{class:'text-right'},[
          el('div',{class:'text-xs text-ink-500',text:'Total awarded'}),
          el('div',{class:'font-mono font-bold text-ink-900',text:fmtMoney(entity.total_awarded)}),
        ]),
        el('div',{class:'text-right'},[
          el('div',{class:'text-xs text-ink-500',text:'Candidates reviewed'}),
          el('div',{class:'font-mono font-bold text-ink-900',text:String(candidatesReviewed)}),
        ]),
      ]));
    }

    // Parse and render markdown sections
    const sections = investigation.split(/^##\s+/m).filter(Boolean);
    sections.forEach(section => {
      const lines = section.trim().split('\n');
      const heading = lines[0].trim();
      const rest = lines.slice(1).join('\n').trim();

      const subSections = rest.split(/^###\s+/m).filter(Boolean);
      if (subSections.length > 0) {
        subSections.forEach(sub => {
          const subLines = sub.split('\n');
          const subHeading = subLines[0].trim();
          const subContent = subLines.slice(1).join('\n').trim();
          const sec = el('section',{class:'space-y-2'},[
            el('h3',{class:'text-xs font-bold uppercase tracking-widest text-ink-400 border-b border-ink-100 pb-1',text:subHeading}),
          ]);
          if (subContent.startsWith('-')) {
            const ul = el('ul',{class:'space-y-1.5'});
            subContent.split('\n').filter(l=>l.startsWith('-')).forEach(line => {
              ul.appendChild(el('li',{class:'flex gap-2 text-sm text-ink-800'},[
                el('span',{class:'text-danger-500 font-bold flex-shrink-0',text:'▸'}),
                el('span',{text:line.slice(1).trim()}),
              ]));
            });
            sec.appendChild(ul);
          } else {
            sec.appendChild(el('p',{class:'text-base text-ink-800 leading-relaxed',text:subContent}));
          }
          body.appendChild(sec);
        });
      } else {
        body.appendChild(el('p',{class:'text-base text-ink-800 leading-relaxed',text:rest}));
      }
    });

    // Caveat
    body.appendChild(el('p',{class:'text-xs text-ink-400 border-t border-ink-100 pt-4',text:'AI investigation is based on structured facts only. It does not assert fraud, intent, or legal liability. Verify against authoritative sources before any enforcement action.'}));
  }

  function renderInvestigateError(msg) {
    const body = $('#investigateBody');
    clear(body);
    body.appendChild(el('div',{class:'rounded-xl bg-danger-50 border border-danger-200 p-5 text-sm text-danger-700',text:'Investigation failed: '+msg}));
  }

  function closeInvestigate() {
    const m = $('#investigateModal');
    m.classList.add('hidden');
    m.classList.remove('flex');
    m.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  $('#investigateBtn')?.addEventListener('click', openInvestigateModal);
  $$('[data-close-investigate]').forEach(e => e.addEventListener('click', closeInvestigate));

  /* ── entity lookup ─────────────────────────────────────────────────────── */
  function bindLookup() {
    const doLookup = async () => {
      const name = $('#lookupInput').value.trim();
      if (!name) return;
      $('#lookupResult').classList.add('hidden');
      $('#lookupError').classList.add('hidden');
      $('#lookupLoading').classList.remove('hidden');

      if (state.serverAvailable) {
        try {
          const r = await fetch(API.lookup, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
          const d = await r.json();
          $('#lookupLoading').classList.add('hidden');
          renderLookupResult(d);
          return;
        } catch(_) {}
      }

      // Offline fallback: search loaded rows
      $('#lookupLoading').classList.add('hidden');
      const q = name.toLowerCase();
      const hit = state.rows.find(r =>
        (r.display_name||'').toLowerCase().includes(q) ||
        (r.name_clean||'').toLowerCase().includes(q)
      );
      if (hit) {
        renderLookupResult({
          matched: true,
          name_clean: hit.name_clean,
          is_zombie: hit.is_zombie,
          roi_score: hit.roi_score,
          recommendation: hit.recommendation,
          match: {
            matched_name: hit.matched_name || hit.display_name,
            confidence_label: hit.confidence,
            status: hit.status,
            dissolution_date: hit.dissolution_date,
            incorporation_date: hit.incorporation_date,
            jurisdiction: hit.province,
          },
        });
      } else if (state.rows.length) {
        renderLookupResult({ matched: false, name_clean: name });
      } else {
        const errBox = $('#lookupError');
        clear(errBox);
        errBox.appendChild(el('span',{text:'Server not available. Run the demo pipeline first or start: PYTHONPATH=src python server.py'}));
        errBox.classList.remove('hidden');
      }
    };
    $('#lookupBtn')?.addEventListener('click', doLookup);
    $('#lookupInput')?.addEventListener('keydown', e => { if (e.key==='Enter') doLookup(); });
  }

  function renderLookupResult(d) {
    const box = $('#lookupResult');
    clear(box);
    box.classList.remove('hidden');
    if (!d.matched) {
      box.appendChild(el('p',{class:'text-sm text-ink-700',text:'No corporate match found for: '+d.name_clean}));
      return;
    }
    const m = d.match||{};
    box.appendChild(el('div',{class:'space-y-4'},[
      el('div',{class:'flex flex-wrap gap-2'},[
        recPill(d.recommendation||'review'),
        confPill(m.confidence_label),
        d.is_zombie ? el('span',{class:'pill pill-refer',text:'Zombie ≤12mo'}) : null,
      ].filter(Boolean)),
      el('div',{class:'grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-2'},[
        ...([
          ['Matched name', m.matched_name],
          ['Status',       m.status],
          ['Dissolution',  m.dissolution_date],
          ['Incorporated', m.incorporation_date],
          ['Jurisdiction', m.jurisdiction],
          ['ROI score',    d.roi_score!=null ? (+d.roi_score).toFixed(1)+'/100' : null],
        ].flatMap(([l,v]) => [
          el('dt',{class:'text-ink-500 font-medium',text:l}),
          el('dd',{class:'font-mono text-ink-900',text:String(v||'—')}),
        ])),
      ]),
    ]));
  }

  /* ── CSV upload ────────────────────────────────────────────────────────── */
  function bindUpload() {
    const dropzone = $('#dropzone');
    const fileInput = $('#fileInput');
    const uploadBtn = $('#uploadBtn');
    const uploadRunBtn = $('#uploadRunBtn');
    let selectedFile = null;

    function setFile(file) {
      if (!file || !file.name.toLowerCase().endsWith('.csv')) {
        showUploadStatus('Only .csv files accepted.', 'error'); return;
      }
      selectedFile = file;
      showUploadStatus('Selected: '+file.name+' ('+( file.size/1e3).toFixed(0)+' KB)', 'info');
      uploadBtn.disabled = false;
      uploadRunBtn.disabled = false;
    }

    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') fileInput?.click(); });
    fileInput?.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
    dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone?.addEventListener('drop', e => {
      e.preventDefault(); dropzone.classList.remove('drag-over');
      const f = e.dataTransfer?.files[0]; if (f) setFile(f);
    });

    async function doUpload(andRun) {
      if (!selectedFile) return;
      if (!state.serverAvailable) { showUploadStatus('Local server not running. Start with: PYTHONPATH=src python server.py', 'error'); return; }
      const form = new FormData();
      form.append('file', selectedFile);
      showUploadStatus('Uploading…', 'info');
      try {
        const r = await fetch(API.upload, {method:'POST', body:form});
        const d = await r.json();
        if (!r.ok) { showUploadStatus(d.error||'Upload failed.', 'error'); return; }
        showUploadStatus('Uploaded '+d.size_mb+' MB to '+d.path, 'ok');
        if (andRun) runPipeline(false);
      } catch(e) { showUploadStatus('Upload failed: '+e.message, 'error'); }
    }
    uploadBtn?.addEventListener('click', () => doUpload(false));
    uploadRunBtn?.addEventListener('click', () => doUpload(true));
  }

  function showUploadStatus(msg, type) {
    const box = $('#uploadStatus');
    box.classList.remove('hidden');
    const cls = {info:'bg-brand-50 text-brand-700 border border-brand-200', ok:'bg-ok-50 text-ok-700 border border-ok-400', error:'bg-danger-50 text-danger-700 border border-danger-200'}[type]||'bg-ink-50';
    box.className = 'mt-4 rounded-lg p-3 text-sm '+cls;
    clear(box);
    box.appendChild(el('span',{text:msg}));
  }

  /* ── CSV export ────────────────────────────────────────────────────────── */
  $('#exportBtn')?.addEventListener('click', () => {
    const cols = ['display_name','province','recipient_type','total_awarded','estimated_recoverable','months_to_dissolution','roi_score','recommendation','funding_dependency','confidence','matched_name','status','dissolution_date','is_zombie'];
    const csv = [cols.join(','), ...state.filtered.map(r =>
      cols.map(c => { const v=r[c]; if (v==null) return ''; const s=String(v).replace(/"/g,'""'); return /[",\n]/.test(s)?'"'+s+'"':s; }).join(',')
    )].join('\n');
    const a = el('a',{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download:'phantom-flow-results.csv'});
    document.body.appendChild(a); a.click();
    requestAnimationFrame(()=>{ URL.revokeObjectURL(a.href); a.remove(); });
  });

  /* ── live fetch — auto-refresh every 30s when server available ──────────── */
  function startLiveFetch() {
    if (!state.serverAvailable) return;
    let lastMod = '';
    setInterval(async () => {
      if (_pipeline_status_running()) return; // don't interrupt in-progress run
      try {
        const r = await fetch(API.results + '?_=' + Date.now(), {cache:'no-store'});
        if (!r.ok) return;
        const etag = r.headers.get('etag') || r.headers.get('last-modified') || '';
        if (etag && etag === lastMod) return; // unchanged
        lastMod = etag;
        const rows = await r.json();
        if (!Array.isArray(rows) || rows.length === state.rows.length) return;
        state.rows = rows;
        setKpis(); buildFilterChips(); applyFilters();
        showLiveBadge();
      } catch(_) {}
    }, 30_000);
  }

  function _pipeline_status_running() {
    const box = $('#pipelineStatus');
    return box && !box.classList.contains('hidden') &&
      box.textContent.toLowerCase().includes('running');
  }

  function showLiveBadge() {
    const badge = el('span',{
      class:'fixed bottom-4 right-4 z-50 rounded-full bg-ok-500 text-white text-xs font-bold px-3 py-1.5 shadow-lg',
      text:'Live data refreshed',
    });
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 3000);
  }

  /* ── AI Chat FAB ────────────────────────────────────────────────────────── */
  function bindAiChat() {
    const fab      = $('#aiChatFab');
    const modal    = $('#aiChatModal');
    const input    = $('#chatInput');
    const sendBtn  = $('#chatSendBtn');
    const messages = $('#chatMessages');
    if (!fab || !modal) return;

    function openChat()  { modal.style.display = 'flex'; modal.removeAttribute('aria-hidden'); input?.focus(); }
    function closeChat() { modal.style.display = 'none'; modal.setAttribute('aria-hidden','true'); }

    fab.addEventListener('click', openChat);
    // Close button (×) — direct click
    $$('[data-close-chat]', modal).forEach(btn => {
      if (btn.tagName === 'BUTTON') btn.addEventListener('click', closeChat);
    });
    // Backdrop — only close when clicking the backdrop itself, not children
    const backdrop = modal.querySelector('[data-close-chat]:not(button)');
    if (backdrop) backdrop.addEventListener('click', e => { if (e.target === backdrop) closeChat(); });

    // suggestion chips
    $$('.chat-suggestion').forEach(chip => {
      chip.addEventListener('click', () => {
        if (input) input.value = chip.textContent.trim();
        sendMessage();
      });
    });

    sendBtn?.addEventListener('click', sendMessage);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

    function appendMsg(text, role) {
      const wrap = el('div', { class: role === 'user'
        ? 'flex justify-end'
        : 'flex justify-start' });
      const bubble = el('div', {
        class: role === 'user'
          ? 'max-w-[80%] rounded-2xl rounded-tr-sm bg-brand-600 text-white px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap'
          : 'max-w-[88%] rounded-2xl rounded-tl-sm bg-white border border-ink-100 text-ink-700 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm',
        text,
      });
      wrap.appendChild(bubble);
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
      return bubble;
    }

    function buildContext() {
      const zombies = state.filtered.filter(r => r.is_zombie).slice(0, 10);
      const all = state.filtered.slice(0, 5);
      const dataSource = state.isLive ? 'live Government of Canada grants data' : state.rows.length ? 'demo dataset (20 sample entities)' : 'no data loaded yet';
      const header = `Data source: ${dataSource}. Total entities: ${state.rows.length}. Zombie candidates: ${state.filtered.filter(r=>r.is_zombie).length}.`;
      if (!zombies.length) return header + '\nNo zombie candidates in current view.';
      return header + '\nTop zombie candidates:\n' + zombies.map((r, i) =>
        `#${i+1} ${r.display_name||r.name_clean} — $${Number(r.total_awarded||0).toLocaleString()} awarded, `+
        `status: ${r.status||'?'}, dissolved: ${r.dissolution_date||'?'}, `+
        `ROI: ${(r.roi_score||0).toFixed(0)}/100, province: ${r.province||'?'}, `+
        `recommendation: ${r.recommendation||'?'}`
      ).join('\n');
    }

    // Animated typing indicator
    function appendTyping() {
      const wrap = el('div', { class: 'flex justify-start' });
      const bubble = el('div', { class: 'flex items-center gap-1 bg-white border border-ink-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm' });
      for (let i = 0; i < 3; i++) {
        const dot = el('span', { class: 'h-2 w-2 rounded-full bg-ink-400', style: { animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` } });
        bubble.appendChild(dot);
      }
      wrap.appendChild(bubble);
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
      return wrap;
    }

    async function sendMessage() {
      const text = input?.value.trim();
      if (!text) return;
      input.value = '';
      sendBtn.disabled = true;
      appendMsg(text, 'user');

      const sugg = $('#chatSuggestions');
      if (sugg) sugg.classList.add('hidden');

      const typingWrap = appendTyping();

      let answer = null;

      // Try server LLM first
      if (state.serverAvailable) {
        try {
          const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: text, context: buildContext(), has_data: state.rows.length > 0 }),
          });
          const d = await resp.json();
          if (resp.ok && d.answer) answer = d.answer;
        } catch(_) {}
      }

      typingWrap.remove();
      sendBtn.disabled = false;
      appendMsg(answer || localAnswer(text), 'assistant');
    }

    // Comprehensive local knowledge base — works with or without loaded data
    function localAnswer(q) {
      const lq = q.toLowerCase();
      const zombies = state.filtered.filter(r => r.is_zombie);
      const hasData = state.rows.length > 0;

      // ── Greetings
      if (/^(hi|hello|hey|sup|yo)\b/.test(lq)) {
        return `Hi! I'm Phantom Flow's enforcement assistant. I can help you understand zombie grant recipients, explain the scoring methodology, or query the${hasData ? ' loaded' : ''} data. What would you like to know?`;
      }

      // ── What is Phantom Flow
      if (lq.includes('what is phantom flow') || lq.includes('what does this') || lq.includes('how does this work') || lq.includes('what is this')) {
        return `Phantom Flow is an enforcement triage tool for the Ottawa AI Hackathon "Zombie Recipients" challenge.\n\nIt identifies Canadian companies and nonprofits that:\n1. Received federal grants from open.canada.ca\n2. Dissolved or went inactive within 12 months of their last award\n\nThose are called "zombie recipients" — public funds went to entities that no longer exist to account for them. Phantom Flow ranks them by ROI score to help enforcement analysts prioritize recovery actions.`;
      }

      // ── What is a zombie
      if (lq.includes('zombie') && (lq.includes('what') || lq.includes('explain') || lq.includes('define') || lq.includes('mean'))) {
        return `A zombie recipient is an organization that:\n• Received public grant money from the Government of Canada\n• Then dissolved, was struck off, or went inactive\n• Within 12 months of receiving the last award\n\nThe 12-month window is the challenge spec from the Ottawa AI Hackathon. It suggests the entity may have dissolved specifically to avoid accountability for the funds received.`;
      }

      // ── Scoring methodology
      if (lq.includes('score') || lq.includes('roi') || lq.includes('how is') || lq.includes('methodology') || lq.includes('algorithm') || lq.includes('rank')) {
        return `ROI score (0–100) has 4 components:\n\n• Recoverable amount (35 pts) — estimated recoverable = total awarded × zombie flag multiplier\n• Evidence strength (30 pts) — corporate match confidence × dissolution timing sharpness\n• Pursuit cost (20 pts) — inverse of complexity (simpler = higher score)\n• Public exposure (15 pts) — funding size relative to peers\n\nScore ≥ 70 → Immediate referral\nScore 50–69 → Compliance letter\nScore 30–49 → Review\nBelow 30 → Monitor or write off`;
      }

      // ── Recommendations
      if (lq.includes('recommend') || lq.includes('referral') || lq.includes('compliance') || lq.includes('action')) {
        return `Phantom Flow generates 5 recommendation tiers:\n\n🔴 Immediate referral — high ROI, high confidence, strong dissolution evidence\n🟡 Compliance letter — moderate risk, worth formal outreach\n🔵 Review — needs more investigation before action\n⚫ Monitor — low confidence, keep watching\n⬜ Write off — recovery cost exceeds likely return`;
      }

      // ── Data source
      if (lq.includes('data') && (lq.includes('source') || lq.includes('come from') || lq.includes('where'))) {
        return `Grant data comes from the Government of Canada's proactive disclosure portal:\nopen.canada.ca — ~200K rows of federal grants since 2011\n\nCorporate status is matched against Corporations Canada (federal registry) using fuzzy name matching (rapidfuzz).\n\nDemo mode uses 20 representative sample entities. Live mode downloads the full dataset (~200MB CSV).`;
      }

      // ── Demo vs live
      if (lq.includes('demo') || lq.includes('live') || lq.includes('real data') || lq.includes('difference')) {
        return `Demo data: 20 hand-picked sample entities that illustrate different zombie patterns — dissolved companies, inactive nonprofits, various provinces and sectors. Great for exploring the UI.\n\nLive data: Full Government of Canada grants dataset (~200K rows, ~200MB). Requires running the local Python server (PYTHONPATH=src python server.py) and takes 2–5 minutes to process.\n\n${state.isLive ? 'You are currently viewing live data.' : 'You are currently viewing ' + (hasData ? 'demo data.' : 'no data yet — click "Run demo pipeline" to load samples.')}`;
      }

      // ── How to use
      if (lq.includes('how to') || lq.includes('get started') || lq.includes('use this') || lq.includes('tutorial')) {
        return `Getting started:\n\n1. Click "Run demo pipeline" in the sidebar to load 20 sample entities\n2. Browse the Queue tab — sorted by ROI score\n3. Click any row to open a detailed case view\n4. Click "AI Investigator" to get an autonomous AI case selection\n5. Use filters (province, confidence, dependency) to narrow the queue\n6. Export to CSV for your own analysis\n\nFor live data: start the Python server locally and click "Run live (real data)".`;
      }

      // ── Funding dependency
      if (lq.includes('depend') || lq.includes('concentration')) {
        return `Funding dependency measures how reliant an entity was on government grants:\n\nHIGH — funded 3+ consecutive years across 3+ departments (structurally dependent)\nMEDIUM — funded 2+ years across 2+ departments\nLOW — single year or single department\n\nHigh dependency + dissolution = stronger zombie signal, as the entity had no apparent path to self-sufficiency.`;
      }

      // ── Province / geography
      if (lq.includes('province') || lq.includes('region') || lq.includes('ontario') || lq.includes('quebec') || lq.includes('bc') || lq.includes('alberta')) {
        if (hasData && zombies.length) {
          const counts = {};
          zombies.forEach(r => { const p = r.province||'Unknown'; counts[p]=(counts[p]||0)+1; });
          const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
          return `Zombie candidates by province in current view:\n${sorted.map(([p,n])=>`  ${p}: ${n} candidate${n>1?'s':''}`).join('\n')}\n\nTotal: ${zombies.length} zombies across ${sorted.length} province(s).`;
        }
        return `In the full federal grants dataset, Ontario and Quebec typically have the most grant recipients. Load the data to see the province breakdown for your current filter.`;
      }

      // ── Data queries (need loaded data)
      if (lq.includes('how many') || lq.includes('count')) {
        if (!hasData) return `No data loaded yet. Click "Run demo pipeline" in the sidebar to load 20 sample entities, then I can answer counts and statistics.`;
        return `Current view: ${state.filtered.length} entities total, ${zombies.length} zombie candidates (dissolved ≤12 months after last award).`;
      }

      if (lq.includes('top') || lq.includes('highest') || lq.includes('worst') || lq.includes('biggest')) {
        if (!hasData) return `Load the demo data first (sidebar → "Run demo pipeline"), then ask me about top cases.`;
        const top = [...zombies].sort((a,b)=>(b.roi_score||0)-(a.roi_score||0)).slice(0,3);
        if (!top.length) return `No zombie candidates in the current view. Try removing filters.`;
        return `Top zombie candidates by ROI score:\n` + top.map((r,i)=>`${i+1}. ${r.display_name||r.name_clean}\n   ROI: ${(r.roi_score||0).toFixed(0)}/100 | $${Number(r.total_awarded||0).toLocaleString()} awarded | ${r.status||'?'}`).join('\n');
      }

      if (lq.includes('total') && (lq.includes('fund') || lq.includes('award') || lq.includes('money') || lq.includes('dollar'))) {
        if (!hasData) return `Load data first to see funding totals.`;
        const total = zombies.reduce((s,r)=>s+(r.total_awarded||0),0);
        const recov = zombies.reduce((s,r)=>s+(r.estimated_recoverable||0),0);
        return `Across ${zombies.length} zombie candidates:\n• Total awarded: $${total.toLocaleString(undefined,{maximumFractionDigits:0})}\n• Estimated recoverable: $${recov.toLocaleString(undefined,{maximumFractionDigits:0})}\n• Recovery rate assumption: ~${total > 0 ? ((recov/total)*100).toFixed(0) : 0}%`;
      }

      // ── API key
      if (lq.includes('api key') || lq.includes('gemini') || lq.includes('anthropic') || lq.includes('openai')) {
        return `Phantom Flow supports Gemini (recommended) and Anthropic Claude for AI summaries.\n\nTo enable AI case narratives:\n1. Get a free Gemini API key at aistudio.google.com\n2. Click "Settings" (top-right) and paste your key\n3. Re-run the pipeline — each zombie case gets a 200-word forensic narrative\n\nWithout an API key, the tool still works — it uses template-based summaries instead.`;
      }

      // ── Generic with data
      if (hasData) {
        return `I can answer questions about the ${zombies.length} zombie candidate${zombies.length!==1?'s':''} loaded, the scoring methodology, or how to use Phantom Flow. Try asking:\n• "Show me the top 3 cases"\n• "How is the ROI score calculated?"\n• "Which province has the most zombies?"`;
      }

      // ── Generic without data
      return `I'm Phantom Flow's AI assistant. I can explain:\n• How the zombie detection algorithm works\n• What the ROI score components mean\n• How to use the tool\n• Where the grant data comes from\n\nOr click "Run demo pipeline" in the sidebar to load data, then ask me about specific cases.`;
    }
  }

  /* ── init ──────────────────────────────────────────────────────────────── */
  async function init() {
    switchTab('queue');
    await checkServerStatus();
    state.rows = await loadData();
    setKpis();
    buildFilterChips();
    bindFilterEvents();
    bindSort();
    bindFilterDrawer();
    bindLookup();
    bindUpload();
    bindAiChat();
    applyFilters();
    startLiveFetch();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
