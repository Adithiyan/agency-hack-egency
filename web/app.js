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
    const candidates = ['/api/results', './data/results.json', '../data/processed/results.json', '../data/demo/results_demo.json'];
    for (const url of candidates) {
      try {
        const r = await fetch(url, {cache:'no-store'});
        if (!r.ok) continue;
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) { state.source = url; return rows; }
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
    return null;
  }

  /* ── KPIs ──────────────────────────────────────────────────────────────── */
  function setKpis() {
    const rows = state.rows;
    $('[data-kpi="entities"]').textContent = fmtNum(rows.length);
    $('[data-kpi="zombies"]').textContent = fmtNum(rows.filter(r=>r.is_zombie).length);
    $('[data-kpi="referrals"]').textContent = fmtNum(rows.filter(r=>r.recommendation==='immediate referral').length);
    $('[data-kpi="awarded"]').textContent = fmtMoney(rows.reduce((s,r)=>s+(+r.total_awarded||0),0));
    $('[data-kpi="recoverable"]').textContent = fmtMoney(rows.filter(r=>r.is_zombie).reduce((s,r)=>s+(+r.estimated_recoverable||0),0));
  }

  /* ── filters ───────────────────────────────────────────────────────────── */
  function buildFilterChips() {
    const box = $('#filterRec');
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

    const provSel = $('#filterProvince');
    const provs = Array.from(new Set(state.rows.map(r=>r.province).filter(Boolean))).sort();
    provs.forEach(p => provSel.appendChild(el('option',{value:p,text:p})));
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
      el('p',{class:'text-[15px] text-ink-800 leading-relaxed',text:summary}),
    ]));

    // LEFT — ROI Breakdown
    const scoreRows = [
      ['Recoverable amount', bd.recoverable, 35],
      ['Evidence strength',  bd.evidence,    30],
      ['Pursuit cost',       bd.pursuit_cost,20],
      ['Public exposure',    bd.exposure,    15],
    ].map(([label,val,max]) => {
      const v=+val||0, pct=Math.min(100,(v/max)*100);
      return el('div',{class:'space-y-1'},[
        el('div',{class:'flex justify-between text-sm'},[
          el('span',{class:'text-ink-700',text:label}),
          el('span',{class:'font-mono tabular-nums font-semibold text-ink-800',text:v.toFixed(1)+' / '+max}),
        ]),
        el('div',{class:'score-bar'},[el('div',{style:{width:pct+'%'}})]),
      ]);
    });
    const total = (+r.roi_score||0);
    scoreRows.push(el('div',{class:'flex justify-between text-base font-bold border-t border-ink-200 pt-3 mt-1'},[
      el('span',{class:'text-ink-900',text:'Total ROI score'}),
      el('span',{class:'font-mono tabular-nums text-ink-900',text:total.toFixed(1)+' / 100'}),
    ]));
    leftCol.appendChild(sectionCard('ROI score breakdown',scoreRows));

    // RIGHT — Evidence
    const dl = el('dl',{class:'grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm'});
    const ev = [
      ['Matched name',    r.matched_name],
      ['Corp status',     r.status],
      ['Dissolution',     r.dissolution_date],
      ['Last award',      r.last_award_date ? String(r.last_award_date).slice(0,10) : null],
      ['Months to diss.', r.months_to_dissolution==null?null:(+r.months_to_dissolution).toFixed(0)],
      ['Match score',     r.match_confidence!=null ? r.match_confidence+'/100' : null],
      ['Jurisdiction',    r.jurisdiction],
      ['# grants',        r.num_grants],
      ['Province',        r.province],
      ['Awarded',         fmtMoney(r.total_awarded)],
      ['Recoverable',     fmtMoney(r.estimated_recoverable)],
    ];
    ev.forEach(([label,value])=>{
      dl.appendChild(el('dt',{class:'text-ink-500 font-medium',text:label}));
      dl.appendChild(el('dd',{class:'font-mono text-ink-900 truncate',text:String(value||'—')}));
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
    panel.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    $('[data-close-case]',panel).focus();
  }

  function sectionCard(title, children) {
    return el('section',{class:'space-y-3'},[
      el('h3',{class:'text-xs font-bold uppercase tracking-widest text-ink-400',text:title}),
      ...children,
    ]);
  }

  function closeCase() {
    const p = $('#casePanel');
    p.classList.add('hidden');
    p.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }
  $$('[data-close-case]').forEach(e => e.addEventListener('click',closeCase));
  document.addEventListener('keydown', e => { if (e.key==='Escape') { closeCase(); closeSettings(); } });

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
    if (!state.serverAvailable) {
      if (demo) {
        // Static hosting (Vercel) — just reload from bundled results.json
        showPipelineStatus('Loading demo data…');
        loadData().then(rows => {
          hidePipelineStatus();
          if (!rows.length) { showPipelineStatus('No data found. Run server locally for live pipeline.', true); return; }
          state.rows = rows;
          setKpis(); buildFilterChips(); applyFilters();
        });
      } else {
        showPipelineStatus('Live pipeline needs local server: PYTHONPATH=src python server.py', true);
      }
      return;
    }
    showPipelineStatus('Pipeline running…');
    fetch(API.run, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({demo,top_n:25})})
      .then(r=>r.json())
      .then(() => pollPipeline())
      .catch(e => showPipelineStatus('Error: '+e.message, true));
  }

  function pollPipeline() {
    const interval = setInterval(async () => {
      try {
        const d = await fetch(API.pipelineStatus).then(r=>r.json());
        if (d.running) { showPipelineStatus('Pipeline running…'); return; }
        clearInterval(interval);
        hidePipelineStatus();
        if (d.error) { showPipelineStatus('Pipeline error: '+d.error, true); return; }
        state.rows = await loadData();
        setKpis(); buildFilterChips(); applyFilters();
      } catch(e) { clearInterval(interval); hidePipelineStatus(); }
    }, 1500);
  }

  function showPipelineStatus(msg, error=false) {
    const box = $('#pipelineStatus');
    box.classList.remove('hidden');
    box.className = 'mt-3 text-sm rounded-lg p-3 border '+(error?'bg-danger-50 text-danger-700 border-danger-200':'bg-brand-50 text-brand-700 border-brand-200');
    clear(box);
    const dot = el('span',{class:'inline-block h-3 w-3 rounded-full flex-shrink-0 '+(error?'bg-danger-500':'bg-brand-500 animate-pulse')});
    box.appendChild(el('div',{class:'flex items-center gap-2'},[dot, el('span',{text:msg})]));
  }
  function hidePipelineStatus() { $('#pipelineStatus').classList.add('hidden'); }

  $('#runDemoBtn')?.addEventListener('click', () => runPipeline(true));
  $('#runLiveBtn')?.addEventListener('click', () => runPipeline(false));
  $('#emptyRunBtn')?.addEventListener('click', () => runPipeline(true));

  /* ── entity lookup ─────────────────────────────────────────────────────── */
  function bindLookup() {
    const doLookup = async () => {
      const name = $('#lookupInput').value.trim();
      if (!name) return;
      $('#lookupResult').classList.add('hidden');
      $('#lookupError').classList.add('hidden');
      $('#lookupLoading').classList.remove('hidden');
      try {
        const r = await fetch(API.lookup, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
        const d = await r.json();
        $('#lookupLoading').classList.add('hidden');
        renderLookupResult(d);
      } catch(e) {
        $('#lookupLoading').classList.add('hidden');
        const errBox = $('#lookupError');
        clear(errBox); errBox.appendChild(el('span',{text:'Server not available. Run: PYTHONPATH=src python server.py'}));
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
    applyFilters();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
