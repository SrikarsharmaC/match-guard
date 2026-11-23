// Match Guard prototype UI. The build inlines engine.js and llm.js above this file.
/* global MG_DATA */
function mgStart(DATA, source) {
  const DEMO = source === 'demo';
  const byId = indexProfiles(DATA.profiles);
  const clients = DATA.profiles.filter((p) => p.client).sort((a, b) => a.mm.localeCompare(b.mm) || a.name.localeCompare(b.name));
  const sharedByClient = new Map();
  for (const s of DATA.shares) {
    if (!sharedByClient.has(s.client)) sharedByClient.set(s.client, new Set());
    sharedByClient.get(s.client).add(s.cand);
  }

  const state = {
    view: 'check',
    policy: clonePolicy(),
    clientId: DEMO ? 'C14' : null,
    filter: 'ready',
    limit: 10,
    picked: new Map(), // id -> {override: reason|null}
    inboxId: null,
    tryClientId: DEMO ? 'C14' : null,
    tryText: "She's a doctor, the hours won't work for us. I'd said this on the call.",
    tryResult: null,
    llm: { key: '', model: LLM_DEFAULT_MODEL, busy: false, error: '' },
    decisions: {},
    upload: { profiles: null, shares: null, result: null, busy: false, error: '' },
  };
  if (!byId.get(state.clientId)) state.clientId = clients.length ? clients[0].id : null;
  if (!byId.get(state.tryClientId)) state.tryClientId = state.clientId;
  const MONTH = (iso) => new Date(`${iso}T00:00:00`).toLocaleString('en-GB', { day: 'numeric', month: 'short' });

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`;
  const num = (x, d = 0) => Number(x).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
  const first = (p) => p.name.split(' ')[0];
  const initials = (p) => p.name.replace('.', '').split(' ').map((w) => w[0]).join('');
  const seekWord = (c) => (c.seeking === 'M' ? 'men' : 'women');
  const attrLine = (p) => [p.religion, p.tongue, DIET_LABEL[p.diet] || p.diet, `Smokes: ${p.smoke ?? 'not recorded'}`, `Drinks: ${p.drink ?? 'not recorded'}`, kidsWord(p.kids), p.marital].join(' · ');
  const VERDICT = { clear: ['ok', 'Ready to send'], review: ['soft', 'Check first'], blocked: ['hard', 'Blocked'] };
  const SEV_TAG = { hard: 'Hard', soft: 'Soft', unknown: 'Unknown' };

  function verdictPill(v) {
    const [cls, label] = VERDICT[v];
    const icon = v === 'clear' ? '✓' : v === 'review' ? '!' : '×';
    return `<span class="pill ${cls}"><span aria-hidden="true">${icon}</span> ${label}</span>`;
  }

  function sevPill(row, policy) {
    if (row.dealbreaker) return '<span class="pill hard" data-tip="Marked as a deal-breaker by the client: always blocks">Deal-breaker</span>';
    if (row.sev === 'band') {
      const tol = row.field === 'age' ? `${policy.tolerance.age} yrs` : `${policy.tolerance.height} cm`;
      return `<span class="pill neutral" data-tip="Within ${tol} of the range: warning. Further out: blocked. Set from 30 days of accept/reject data.">Soft ±${tol}</span>`;
    }
    return row.sev === 'hard'
      ? '<span class="pill hard" data-tip="Clients almost never accept a profile that breaks this (see the 30-day replay)">Hard</span>'
      : '<span class="pill neutral" data-tip="Clients often accept profiles that break this: shown as a warning, matchmaker decides">Soft</span>';
  }

  function toggle(key, label, hint) {
    const on = state.policy[key];
    return `<label class="switch"><input type="checkbox" data-toggle="${key}" ${on ? 'checked' : ''}><span class="track" aria-hidden="true"></span><span class="txt"><strong>${label}</strong><small>${hint}</small></span></label>`;
  }

  function issueLine(i, c) {
    const who = i.side === 'client' ? `${esc(first(c))} wants` : 'They want';
    const have = i.side === 'client' ? 'Profile' : esc(first(c));
    const db = i.dealbreaker ? ' <em>(deal-breaker)</em>' : '';
    const ai = i.ai ? ' <span class="chip ai tiny" data-tip="Rule extracted from the call notes">from call notes</span>' : '';
    const side = i.side === 'candidate' ? '<span class="side" data-tip="Two-way check: their own stated preferences about your client">their side</span>' : '';
    return `<li class="issue ${i.sev}"><span class="tag">${SEV_TAG[i.sev]}</span><span><b>${esc(FIELD_LABELS[i.field])}</b> · ${have}: ${esc(i.have)} · ${who}: ${esc(i.want)}${db}${ai}</span>${side}</li>`;
  }

  function renderDataNote() {
    const el = $('#datanote');
    if (!el) return;
    if (DEMO) {
      el.innerHTML = 'Demo data calibrated to the brief: 1,000 profiles shared in 30 days, 310 accepted, 42 meetings completed. <a href="#data">Use your own data</a>';
    } else {
      const w = DATA.meta && DATA.meta.window ? ` · shares ${MONTH(DATA.meta.window[0])} – ${MONTH(DATA.meta.window[1])}` : '';
      el.innerHTML = `<span class="pill ok">Your data</span> ${num(DATA.profiles.length)} profiles · ${num(clients.length)} Partner Search clients · ${num(DATA.shares.length)} shares${w}. Stored only in this browser. <button type="button" class="linkbtn" data-reset>Back to demo data</button>`;
    }
  }

  function emptyState(title, body) {
    return `<section class="card empty-state"><h2>${title}</h2><p class="sub">${body}</p><a class="btn" href="#data">Add your data</a></section>`;
  }

  // ---------- view 1: pre-send check ----------
  function renderCheck() {
    const c = byId.get(state.clientId);
    if (!c) { $('#view-check').innerHTML = emptyState('No clients yet', 'Load a profiles file with at least one Partner Search client (role = client).'); return; }
    const res = searchPool(c, DATA.profiles, sharedByClient.get(c.id) || new Set(), state.policy);
    const groups = {
      ready: res.results.filter((r) => r.verdict === 'clear'),
      review: res.results.filter((r) => r.verdict === 'review'),
      blocked: res.results.filter((r) => r.verdict === 'blocked'),
    };
    if (!groups[state.filter].length) state.filter = groups.ready.length ? 'ready' : groups.review.length ? 'review' : 'blocked';
    const list = groups[state.filter].slice(0, state.limit);
    const rest = groups[state.filter].length - list.length;
    const f = res.funnel;
    const rules = noteRulesOf(c);
    const mmOptions = DATA.matchmakers.map((m) => `<optgroup label="${esc(m.name)}">${clients.filter((x) => x.mm === m.id).map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.name)} · ${x.age} · ${esc(x.city)}</option>`).join('')}</optgroup>`).join('');

    $('#view-check').innerHTML = `
      <div class="check-grid">
        <aside class="card client" aria-label="Partner Search client">
          <label class="lbl" for="client-select">Partner Search client</label>
          <select id="client-select">${mmOptions}</select>
          <div class="who">
            <span class="avatar" aria-hidden="true">${esc(initials(c))}</span>
            <div><strong>${esc(c.name)}</strong><span>${c.age} · ${c.height} cm · ${esc(c.city)} · ${esc(c.profession)}</span><span>Matchmaker ${c.mm} · looking for ${c.seeking === 'M' ? 'a man' : 'a woman'}</span></div>
          </div>
          <h3>Stated preferences</h3>
          <ul class="prefs">${prefRows(c, state.policy).map((row) => `<li><span class="k">${esc(row.label)}</span><span class="v">${esc(row.text)}</span>${sevPill(row, state.policy)}</li>`).join('')}</ul>
          <h3>Call notes</h3>
          <blockquote>${esc(c.notes)}</blockquote>
          <div class="ai-rules">${rules.length ? rules.map((r) => `<span class="chip ai" data-tip="Extracted from: ${esc(r.source)}">AI rule · ${esc(noteRuleWord(r))}</span>`).join('') : '<span class="muted small">No rule found in these notes.</span>'}</div>
          <div class="switches">
            ${toggle('twoWay', 'Two-way check', 'Also check their stated preferences about this client')}
            ${toggle('useNoteRules', 'Apply call-note rules', 'AI-extracted rules show as soft warnings')}
          </div>
        </aside>
        <section class="results" aria-label="Shortlist">
          <div class="card funnel">
            <p class="lead"><strong>${num(f.passBoth)}</strong> of ${num(f.pool)} ${seekWord(c)} in the network pass both sides' hard rules; <strong>${num(f.clear)}</strong> have no warnings at all.</p>
            <ol class="steps">
              <li><span class="n">${num(f.pool)}</span><span class="l">${seekWord(c)} in the network</span></li>
              <li><span class="n">${num(f.passClient)}</span><span class="l">pass ${esc(first(c))}'s hard rules</span></li>
              <li><span class="n">${num(f.passBoth)}</span><span class="l">pass theirs too</span></li>
              <li class="em"><span class="n">${num(f.clear)}</span><span class="l">no warnings</span></li>
            </ol>
            <p class="sub">${f.alreadyShared} profiles already shared with ${esc(first(c))} in the last 30 days are left out. The matchmaker starts from ${num(f.passBoth)} ranked profiles instead of ${num(f.pool)}.</p>
          </div>
          <div class="seg" role="group" aria-label="Filter the shortlist">
            ${['ready', 'review', 'blocked'].map((k) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'on' : ''}" aria-pressed="${state.filter === k}">${{ ready: 'Ready to send', review: 'Check first', blocked: 'Blocked' }[k]} <b>${groups[k].length}</b></button>`).join('')}
          </div>
          <ol class="cands">${list.map((r) => candRow(r, c)).join('') || '<li class="empty">Nothing in this group.</li>'}</ol>
          ${rest > 0 ? `<button type="button" class="btn ghost more" data-more>Show ${Math.min(10, rest)} more of ${rest}</button>` : ''}
        </section>
      </div>
      ${state.picked.size ? `<div class="tray" role="region" aria-label="Introduction shortlist"><span><b>${state.picked.size}</b> selected for ${esc(first(c))}'s next introduction</span><button type="button" class="btn" data-preview>Preview introduction</button><button type="button" class="btn ghost" data-clear>Clear</button></div>` : ''}`;
  }

  function candRow(r, c) {
    const p = r.p;
    const picked = state.picked.has(p.id);
    const action = r.verdict === 'blocked'
      ? `<button type="button" class="btn small ghost" data-override="${p.id}">Override…</button>`
      : `<button type="button" class="btn small ${picked ? 'on' : ''}" data-pick="${p.id}" aria-pressed="${picked}">${picked ? 'Shortlisted ✓' : 'Shortlist'}</button>`;
    return `<li class="cand ${r.verdict}">
      <div class="score" data-tip="Fit score: 60 for passing the hard rules, up to 40 more for shared city, language, diet, age near the middle of the range and meeting their preferences, minus warnings."><span>${r.score}</span><i style="width:${r.score}%"></i></div>
      <div class="info">
        <div class="name"><strong>${esc(p.name)}</strong><span>${p.age} · ${p.height} cm · ${esc(p.city)}${p.relocate ? ' · will relocate' : ''} · ${esc(p.profession)}</span></div>
        <div class="attrs">${esc(attrLine(p))}</div>
        ${r.issues.length ? `<ul class="issues">${r.issues.map((i) => issueLine(i, c)).join('')}</ul>` : ''}
        ${r.positives.length ? `<div class="pos">${r.positives.map(esc).join(' · ')}</div>` : ''}
        ${picked && state.picked.get(p.id).override ? `<div class="override-note">Override logged: ${esc(state.picked.get(p.id).override)}</div>` : ''}
      </div>
      <div class="act">${verdictPill(r.verdict)}${action}</div>
    </li>`;
  }

  // ---------- view 2: 30-day replay ----------
  function renderBacktest() {
    if (!DATA.shares.length) { $('#view-backtest').innerHTML = emptyState('Add your share history to replay it', 'The replay needs shares.csv: every profile sent, who sent it, and how far it got. With it, this page shows what Match Guard would have blocked, the impact on mutual matches and meetings, and which rules your clients really treat as deal-breakers.'); return; }
    const r = backtest(DATA, state.policy);
    const mmName = (id) => { const m = DATA.matchmakers.find((x) => x.id === id); return m ? m.name : `Matchmaker ${id}`; };
    const t = r.totals;
    const p1 = r.projection.blockHard;
    const p2 = r.projection.blockHardAndReview;
    const caught = r.avoidable.blocked + r.avoidable.review;
    const maxAxis = Math.max(0.6, Math.ceil(Math.max(...r.perMatchmaker.map((m) => Math.max(m.acceptRate, m.projectedAcceptRate))) * 5) / 5);
    const mmRows = r.perMatchmaker.map((m) => {
      const x0 = (m.acceptRate / maxAxis) * 100; const x1 = (m.projectedAcceptRate / maxAxis) * 100;
      const lo = Math.min(x0, x1); const w = Math.abs(x1 - x0);
      return `<div class="db-row">
        <span class="db-name">${esc(mmName(m.mm))}</span>
        <div class="db-track">
          <span class="db-line" style="left:${lo}%;width:${w}%"></span>
          <span class="db-dot now" style="left:${x0}%" tabindex="0" data-tip="Matchmaker ${m.mm} today: ${pct(m.acceptRate, 1)} of ${m.shares} profiles accepted; ${pct(m.avoidableShare)} of shares broke a stated preference"></span>
          <span class="db-dot next" style="left:${x1}%" tabindex="0" data-tip="With Match Guard (projected): ${pct(m.projectedAcceptRate, 1)} accepted; mutual matches per 100 shares ${num(m.contactsPer100, 1)} → ${num(m.projectedContactsPer100, 1)}"></span>
        </div>
        <span class="db-val">${pct(m.acceptRate)} → <b>${pct(m.projectedAcceptRate)}</b></span>
        <span class="db-av">${pct(m.avoidableShare)}</span>
      </div>`;
    }).join('');
    const best = [...r.perMatchmaker].sort((a, b) => b.acceptRate - a.acceptRate)[0];
    const gainer = [...r.perMatchmaker].sort((a, b) => (b.projectedAcceptRate - b.acceptRate) - (a.projectedAcceptRate - a.acceptRate))[0];
    const gapNow = best.acceptRate - gainer.acceptRate;
    const gapNext = best.projectedAcceptRate - gainer.projectedAcceptRate;
    const estimated = DATA.shares.some((s) => s.label && s.label.estimated);
    const mmTitle = r.perMatchmaker.length < 2 ? 'Per matchmaker' : `${esc(mmName(gainer.mm))} gains the most`;
    const mmSub = r.perMatchmaker.length < 2 || gainer.mm === best.mm
      ? `${pct(gainer.avoidableShare)} of ${esc(mmName(gainer.mm))}'s shares broke a stated preference.`
      : `${pct(gainer.avoidableShare)} of ${esc(mmName(gainer.mm))}'s shares broke a stated preference, against ${pct(best.avoidableShare)} of ${esc(mmName(best.mm))}'s. Removing them ${gapNext < gapNow ? `closes the gap to ${esc(mmName(best.mm))} from ${Math.round(gapNow * 100)} to ${Math.round(Math.max(0, gapNext) * 100)} points; the rest is method, so codify ${esc(mmName(best.mm))}'s playbook` : 'does not close the gap: the difference is method, not mismatches'}.`;
    const base = r.clear.acceptRate;
    const calRows = r.calibration.map((c) => {
      const w = c.rate == null ? 0 : (c.rate / 0.5) * 100;
      const mismatch = c.recommended !== 'needs data' && c.recommended !== c.setting;
      const note = c.key === 'note' && mismatch ? '<small class="muted">Kept soft until a matchmaker approves each AI-extracted rule</small>' : '';
      return `<tr class="${mismatch ? 'mismatch' : ''}">
        <th scope="row">${esc(c.label)}${note}</th>
        <td class="num">${c.n}</td>
        <td class="num">${c.accepted}</td>
        <td><div class="barcell"><div class="cal-bar" tabindex="0" data-tip="${c.n ? `${c.accepted} of ${c.n} profiles that broke this were accepted anyway (${pct(c.rate, 1)}). Profiles with no issues: ${pct(base, 1)}.` : 'Not broken in 30 days'}"><i style="width:${Math.min(100, w)}%"></i><span class="base" style="left:${(base / 0.5) * 100}%"></span></div><span class="cal-val">${c.rate == null ? '–' : pct(c.rate)}</span></div></td>
        <td>${c.recommended === 'needs data' ? '<span class="pill neutral">Needs data</span>' : c.recommended === 'hard' ? '<span class="pill hard">Hard</span>' : '<span class="pill neutral">Soft</span>'}</td>
        <td><button type="button" class="sev ${c.setting}" data-sev="${c.key}" aria-label="${esc(c.label)}: currently ${c.setting}. Switch to ${c.setting === 'hard' ? 'soft' : 'hard'}">${c.setting === 'hard' ? 'Hard' : 'Soft'}</button></td>
      </tr>`;
    }).join('');
    const fb = r.flips.buckets;
    const flipParts = [['taste', 'taste'], ['vague', 'vague'], ['timing', 'timing'], ['presentation', 'presentation'], ['avoidable', 'a stated preference'], ['new_pref', 'a new preference']]
      .filter(([k]) => fb[k]).map(([k, label]) => `${label} ${fb[k]}`).join(' · ');

    $('#view-backtest').innerHTML = `
      <div class="intro">
        <p class="lead">If Match Guard had checked every profile before it went out in the last 30 days, <strong>${num(r.blocked.n)}</strong> shares would have been blocked, and <strong>${pct(r.blocked.rejectedOrNoMutual / r.blocked.n, 1)}</strong> of those were rejected or never reached mutual consent anyway.</p>
        <div class="switches row">${toggle('twoWay', 'Two-way check', 'Their stated preferences too')}${toggle('useNoteRules', 'Call-note rules', 'AI-extracted, soft')}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="k">Avoidable rejections caught</span><span class="big">${caught} <small>of ${r.avoidable.n}</small></span><span class="sub">${r.avoidable.blocked} blocked · ${r.avoidable.review} flagged · ${r.avoidable.missed} missed${r.avoidable.missed && DEMO ? ' (preferences hidden in vague call notes)' : ''}${estimated ? ' · read from the replies' : ''}</span></div>
        <div class="kpi"><span class="k">Mutual matches per 100 shares</span><span class="big">${num(t.contactsPer100, 1)} <small>→</small> ${num(p1.contactsPer100, 1)}</span><span class="sub">Contact details shared · ${num(p2.contactsPer100, 1)} if matchmakers also act on warnings</span></div>
        <div class="kpi"><span class="k">Profile acceptance</span><span class="big">${pct(t.acceptRate)} <small>→</small> ${pct(p1.acceptRate)}</span><span class="sub">${pct(p2.acceptRate)} if warnings are acted on too</span></div>
        <div class="kpi accent"><span class="k">Completed meetings a month</span><span class="big">${t.meetings} <small>→</small> ${num(p1.meetings)}</span><span class="sub">${t.meetings ? `+${pct(p1.meetings / t.meetings - 1)} from the same number of shares` : 'No completed meetings in this window yet'}</span></div>
      </div>
      <div class="two">
        <section class="card">
          <h2>${mmTitle}</h2>
          <p class="sub">${mmSub}</p>
          <div class="legend"><span><i class="dot now"></i>Today</span><span><i class="dot next"></i>With Match Guard (projected)</span><span class="right">Shares breaking a stated preference</span></div>
          <div class="dumbbell">${mmRows}
            <div class="db-axis">${[0, 1, 2, 3].map((k) => `<span style="left:${(k / 3) * 100}%">${Math.round((maxAxis * k / 3) * 100)}%</span>`).join('')}</div>
          </div>
          <p class="foot">Profile acceptance rate. Projection: each blocked share is replaced by a profile that does as well as today's clear ones (${pct(base)} accepted, ${pct(r.clear.contactGivenAccept)} of accepts reach contact).</p>
        </section>
        <section class="card">
          <h2>Rejections are not always about the profile</h2>
          <p class="big-line"><b>${r.flips.n}</b> times a client said no, then yes to a near-identical profile later.</p>
          <p class="sub">Same city, religion, diet, smoking and industry; age within 2 years.${flipParts ? ` The first "no" was: ${flipParts}.` : ''}</p>
          <p>So preferences learned from feedback stay <b>soft</b>: the tool warns, the matchmaker decides. Only deal-breakers and rules the data proves hard can block.</p>
        </section>
      </div>
      <section class="card">
        <h2>Calibrate the rules from behaviour, not opinion</h2>
        <p class="sub">How often clients accepted a profile that broke each rule. Near zero means it behaves like a deal-breaker, so it blocks; anything higher is a warning. Click a setting to flip it and watch the numbers above move.</p>
        <div class="table-wrap"><table class="cal">
          <thead><tr><th scope="col">Rule</th><th scope="col" class="num">Broken</th><th scope="col" class="num">Accepted anyway</th><th scope="col">Acceptance when broken <span class="muted">(line = profiles with no issues, ${pct(base)})</span></th><th scope="col">Data says</th><th scope="col">Setting</th></tr></thead>
          <tbody>${calRows}</tbody>
        </table></div>
      </section>`;
  }

  // ---------- view 3: feedback -> reasons ----------
  const rejected = DATA.shares.filter((s) => s.outcome === 'rejected');
  const parsedAll = rejected.map((s) => ({ s, out: parseFeedback(s.feedback, byId.get(s.client), byId.get(s.cand)) }));
  const bucketCounts = {};
  for (const x of parsedAll) bucketCounts[x.out.bucket] = (bucketCounts[x.out.bucket] || 0) + 1;
  const agree = parsedAll.filter((x) => x.s.label && x.s.label.bucket === x.out.bucket).length;

  const INBOX_WANT_DEMO = [['avoidable', 'SMOKING'], ['avoidable', 'PROFESSION', 'miss'], ['timing', 'TIMING'], ['new_pref', 'PROFESSION'], ['avoidable', 'AGE'], ['taste', 'ATTRACTION'], ['presentation', 'PHOTOS'], ['avoidable', 'KIDS'], ['vague', 'VAGUE'], ['new_pref', 'HEIGHT'], ['avoidable', 'PROFESSION'], ['taste', 'PERSONALITY'], ['avoidable', 'LOCATION'], ['timing', 'TIMING']];
  const inbox = [];
  const byDate = [...parsedAll].sort((a, b) => b.s.date.localeCompare(a.s.date) || b.s.id.localeCompare(a.s.id));
  (DEMO ? INBOX_WANT_DEMO : []).forEach(([bucket, code, flag], i) => {
    const hits = byDate.filter((x) => !inbox.includes(x) && x.s.label && x.s.label.bucket === bucket && x.s.label.code === code && (flag === 'miss' ? x.out.bucket !== bucket : x.out.bucket === bucket));
    const hit = hits[Math.min(hits.length - 1, i % 5)];
    if (hit) inbox.push(hit);
  });
  if (!DEMO) inbox.push(...byDate.filter((x) => x.s.feedback).slice(0, 14));
  inbox.sort((a, b) => b.s.date.localeCompare(a.s.date) || a.s.id.localeCompare(b.s.id));
  const startWith = inbox.find((x) => x.s.label && x.s.label.code === 'SMOKING') || inbox[0];
  state.inboxId = startWith ? startWith.s.id : null;

  function highlight(text, reasons) {
    let html = esc(text);
    for (const r of reasons || []) {
      if (!r.evidence || r.code === 'VAGUE') continue;
      const e = esc(r.evidence);
      const i = html.toLowerCase().indexOf(e.toLowerCase());
      if (i >= 0) html = `${html.slice(0, i)}<mark>${html.slice(i, i + e.length)}</mark>${html.slice(i + e.length)}`;
    }
    return html;
  }

  function resultBlock(out, ctx) {
    const b = BUCKETS[out.bucket] || BUCKETS.vague;
    const decision = ctx.id ? state.decisions[ctx.id] : null;
    const sug = out.suggestion
      ? `<div class="sug"><span class="k">Suggested soft preference</span><span class="v">${esc(out.suggestion)}</span>
          ${decision ? `<span class="decided">${decision === 'approved' ? 'Approved: added as a soft preference, to confirm with the client' : 'Dismissed'}</span>` : ctx.id ? `<span class="btns"><button type="button" class="btn small" data-decide="approved" data-id="${ctx.id}">Approve</button><button type="button" class="btn small ghost" data-decide="dismissed" data-id="${ctx.id}">Dismiss</button></span>` : ''}</div>`
      : '';
    return `<div class="result">
      <div class="codes">${(out.reasons || []).map((r) => `<span class="chip">${esc(r.code)}</span>`).join('')}<span class="pill bucket ${out.bucket}">${esc(b.label)}</span>${out.source === 'claude' ? '<span class="chip ai">Claude</span>' : '<span class="chip">offline rules</span>'}</div>
      <dl>
        <dt>Why</dt><dd>${esc(out.why)}</dd>
        <dt>Next action</dt><dd>${esc(b.action)}</dd>
      </dl>
      ${sug}
    </div>`;
  }

  function renderFeedback() {
    if (!parsedAll.length || !inbox.length) { $('#view-feedback').innerHTML = emptyState('Add rejection replies to read them', 'This page needs shares.csv with the rejected profiles and what each client wrote back. Every reply is then sorted into one of six buckets, each with its own next action.'); return; }
    const total = parsedAll.length;
    const order = ['avoidable', 'taste', 'vague', 'new_pref', 'timing', 'presentation'];
    const maxCount = Math.max(...order.map((k) => bucketCounts[k] || 0));
    const bars = order.map((k) => {
      const n = bucketCounts[k] || 0;
      return `<div class="fb-row ${k === 'avoidable' ? 'hi' : ''}">
        <span class="fb-name">${esc(BUCKETS[k].label)}</span>
        <div class="fb-track" tabindex="0" data-tip="${n} of ${total} rejections (${pct(n / total, 1)}). Next action: ${esc(BUCKETS[k].action)}"><i style="width:${(n / maxCount) * 100}%"></i></div>
        <span class="fb-val">${n} <small>${pct(n / total)}</small></span>
        <span class="fb-act">${esc(BUCKETS[k].action)}</span>
      </div>`;
    }).join('');

    const sel = inbox.find((x) => x.s.id === state.inboxId) || inbox[0];
    const c = byId.get(sel.s.client);
    const cand = byId.get(sel.s.cand);
    const miss = DEMO && sel.s.label && !sel.s.label.estimated && sel.s.label.bucket !== sel.out.bucket;
    const relevant = prefRows(c, state.policy).filter((row) => (sel.out.reasons || []).some((r) => CODE_FIELD[r.code] === row.field));
    const tryClient = byId.get(state.tryClientId) || c;
    const clientOptions = clients.map((x) => `<option value="${x.id}" ${x.id === tryClient.id ? 'selected' : ''}>${esc(x.name)} · Matchmaker ${x.mm}</option>`).join('');

    $('#view-feedback').innerHTML = `
      <section class="card">
        <h2>All ${total} rejections in 30 days, read and sorted</h2>
        <p class="sub">Each bucket needs a different fix. Only the first one is about sending the wrong profile; the rest are taste, timing or presentation, which a filter must not learn from.</p>
        <div class="fb-chart">${bars}</div>
        <p class="foot">${DEMO ? `Offline keyword rules agree with the labelled mock data on ${agree} of ${total} (${pct(agree / total, 1)}). The misses are preferences buried in vague call notes, which is where an LLM extractor earns its place.` : 'Sorted by the offline keyword rules, or by your matchmakers\' tags where shares.csv has a reason_bucket. For production accuracy, switch the reader to Claude (below).'}</p>
      </section>
      <div class="fb-grid">
        <section class="card inbox" aria-label="Recent replies">
          <h2>Recent replies</h2>
          <ol>${inbox.map((x) => {
            const cl = byId.get(x.s.client);
            return `<li><button type="button" class="${x.s.id === sel.s.id ? 'on' : ''}" data-inbox="${x.s.id}" aria-pressed="${x.s.id === sel.s.id}"><span class="ib-top"><b>${esc(cl.name)}</b><span class="muted">${MONTH(x.s.date)} · ${esc(x.s.mm)}</span></span><span class="q">“${esc(x.s.feedback)}”</span><span class="pill bucket ${x.out.bucket}">${esc(BUCKETS[x.out.bucket].label)}</span></button></li>`;
          }).join('')}</ol>
        </section>
        <section class="card detail" aria-label="Parsed reply">
          <div class="meta"><b>${esc(c.name)}</b> rejected <b>${esc(cand.name)}</b> <span class="muted">(${cand.age}, ${esc(cand.city)}, ${esc(cand.profession)}) · Matchmaker ${sel.s.mm} · ${sel.s.date}</span></div>
          <blockquote class="reply">${highlight(sel.s.feedback, sel.out.reasons)}</blockquote>
          ${resultBlock(sel.out, { id: sel.s.id })}
          ${miss ? `<div class="callout"><b>Missed by the offline rules.</b> The mock label says this was avoidable: the call notes say “${esc((c.notes.match(/[^.]*24x7[^.]*\./) || [c.notes])[0].trim())}”. That is a preference, but not one a keyword rule can read. An LLM reading the notes would turn it into a rule.</div>` : ''}
          ${relevant.length ? `<div class="rel"><span class="k">From ${esc(first(c))}'s stated preferences</span>${relevant.map((row) => `<span class="chip">${esc(row.label)}: ${esc(row.text)}${row.dealbreaker ? ' (deal-breaker)' : ''}</span>`).join('')}</div>` : ''}
        </section>
      </div>
      <section class="card try">
        <h2>Try a reply</h2>
        <div class="try-grid">
          <div>
            <label class="lbl" for="try-client">Client (their preferences and call notes are used)</label>
            <select id="try-client">${clientOptions}</select>
            <label class="lbl" for="try-text">Client's reply</label>
            <textarea id="try-text" rows="3">${esc(state.tryText)}</textarea>
            <div class="btnrow">
              <button type="button" class="btn" data-try="offline">Read it (offline rules)</button>
              <button type="button" class="btn ghost" data-try="claude" ${state.llm.busy ? 'disabled' : ''}>${state.llm.busy ? 'Asking Claude…' : 'Read it with Claude'}</button>
            </div>
            <details class="llm" ${state.llm.error ? 'open' : ''}>
              <summary>Use Claude (optional, needs an Anthropic API key)</summary>
              <p class="small muted">The key stays in this tab's memory and is sent only to api.anthropic.com. This works when the page is opened from GitHub Pages or as a local file; the Claude preview blocks outside calls.</p>
              <label class="lbl" for="llm-key">API key</label>
              <input id="llm-key" type="password" autocomplete="off" spellcheck="false" value="${esc(state.llm.key)}" placeholder="sk-ant-…">
              <label class="lbl" for="llm-model">Model</label>
              <input id="llm-model" type="text" spellcheck="false" value="${esc(state.llm.model)}">
              ${state.llm.error ? `<p class="err" role="alert">${esc(state.llm.error)}</p>` : ''}
            </details>
          </div>
          <div class="try-out" aria-live="polite">${state.tryResult ? `<blockquote class="reply">${highlight(state.tryResult.text, state.tryResult.out.reasons)}</blockquote>${resultBlock(state.tryResult.out, {})}` : '<p class="muted">The structured result appears here.</p>'}</div>
        </div>
      </section>`;
  }


  // ---------- view 4: use your own data ----------
  function colTable(cols) {
    return `<div class="table-wrap"><table class="cols"><thead><tr><th scope="col">Column</th><th scope="col">What goes in it</th><th scope="col">Required</th></tr></thead><tbody>${cols.map(([c, d, req]) => `<tr><th scope="row"><code>${esc(c)}</code></th><td>${esc(d)}</td><td>${req ? 'Yes' : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function blankTemplates() {
    const c = DATA.profiles.find((x) => x.client) || DATA.profiles[0];
    const sh = DATA.shares.find((x) => x.client === c.id) || DATA.shares[0];
    const cand = sh ? byId.get(sh.cand) : DATA.profiles.find((x) => !x.client);
    return {
      profiles: toCSV(PROFILE_COLUMNS, [c, cand].filter(Boolean).map(profileToRow)),
      shares: toCSV(SHARE_COLUMNS, sh ? [shareToRow(sh)] : []),
    };
  }
  function renderData() {
    const u = state.upload; const res = u.result;
    const errs = res ? res.issues.filter((i) => i.level === 'error') : [];
    const warns = res ? res.issues.filter((i) => i.level === 'warning') : [];
    const fileBox = (key, label, hint) => `<label class="file ${u[key] ? 'has' : ''}"><input type="file" accept=".csv,text/csv" data-file="${key}"><span class="fname">${u[key] ? `✓ ${esc(u[key].name)} · ${num(Math.max(0, u[key].text.split(/\r?\n/).filter((l) => l.trim()).length - 1))} rows` : label}</span><small>${hint}</small></label>`;
    const issueRows = [...errs, ...warns].slice(0, 60).map((i) => `<tr class="${i.level}"><td><span class="pill ${i.level === 'error' ? 'hard' : 'soft'}">${i.level === 'error' ? 'Error' : 'Warning'}</span></td><td>${esc(i.file)}${i.line ? `, line ${i.line}` : ''}</td><td>${i.column ? `<code>${esc(i.column)}</code>` : ''}</td><td>${esc(i.msg)}</td></tr>`).join('');
    $('#view-data').innerHTML = `
      <div class="intro"><p class="lead">Run Match Guard on your own clients in three steps. <strong>Your data never leaves this browser</strong>: nothing is uploaded, and it is kept on this device only until you switch back to the demo.</p></div>
      <div class="data-steps">
        <section class="card step">
          <span class="stepn">1</span>
          <h2>Export two sheets</h2>
          <p class="sub">From your CRM or Google Sheets, export <b>profiles.csv</b> (Partner Search clients and the members you introduce, with their Partner Preferences) and, for the replay and feedback pages, <b>shares.csv</b> (every profile sent and how far it got). Column names are fixed; values are forgiving ("Vegetarian" and "Veg" both work).</p>
          <div class="btnrow">
            <button type="button" class="btn" data-template="blank">Download blank templates</button>
            <button type="button" class="btn ghost" data-template="current">Download ${DEMO ? 'the demo data' : 'your current data'} as CSV</button>
          </div>
          <details class="cols-guide"><summary>Column guide: profiles.csv (${PROFILE_COLUMNS.length} columns)</summary>${colTable(PROFILE_COLUMNS)}</details>
          <details class="cols-guide"><summary>Column guide: shares.csv (${SHARE_COLUMNS.length} columns)</summary>${colTable(SHARE_COLUMNS)}</details>
        </section>
        <section class="card step">
          <span class="stepn">2</span>
          <h2>Choose the files</h2>
          <p class="sub">Profiles are required. Shares are optional: without them the pre-send check works, and the replay and feedback pages wait for them.</p>
          <div class="files">
            ${fileBox('profiles', 'Choose profiles.csv', 'Required')}
            ${fileBox('shares', 'Choose shares.csv', 'Optional: unlocks the replay and feedback pages')}
          </div>
          <div class="btnrow"><button type="button" class="btn" data-validate ${u.profiles ? '' : 'disabled'}>Check the files</button>${u.profiles || u.shares ? '<button type="button" class="btn ghost" data-unpick>Start over</button>' : ''}</div>
          ${u.error ? `<p class="err" role="alert">${esc(u.error)}</p>` : ''}
        </section>
        <section class="card step ${res ? '' : 'waiting'}" aria-live="polite">
          <span class="stepn">3</span>
          <h2>Check and load</h2>
          ${res ? `
            <ul class="stats">
              <li><b>${num(res.stats.clients)}</b> Partner Search clients</li><li><b>${num(res.stats.candidates)}</b> members in the network</li>
              <li><b>${num(res.stats.shares)}</b> shares</li><li><b>${num(res.stats.matchmakers)}</b> matchmakers</li>
            </ul>
            <p class="${errs.length ? 'err' : 'okline'}">${errs.length ? `${errs.length} error${errs.length > 1 ? 's' : ''} to fix before loading. Rows with errors are left out, so fix them in the sheet and choose the file again.` : `Ready to load.${warns.length ? ` ${warns.length} warning${warns.length > 1 ? 's' : ''}: those values are treated as not recorded, which Match Guard flags for the matchmaker rather than assuming.` : ' No problems found.'}`}</p>
            ${issueRows ? `<div class="table-wrap issues-table"><table><thead><tr><th scope="col">Type</th><th scope="col">Where</th><th scope="col">Column</th><th scope="col">Problem</th></tr></thead><tbody>${issueRows}</tbody></table></div>${errs.length + warns.length > 60 ? `<p class="small muted">Showing the first 60 of ${errs.length + warns.length}.</p>` : ''}` : ''}
            <div class="btnrow"><button type="button" class="btn" data-load ${res.ok ? '' : 'disabled'}>${u.busy ? 'Loading…' : 'Load into Match Guard'}</button></div>`
          : '<p class="muted">The check lists every problem by file, line and column. Nothing loads until there are no errors.</p>'}
        </section>
      </div>
      <section class="card prod">
        <h2>From this page to production</h2>
        <ol class="prod-steps">
          <li><b>Week 1:</b> a nightly export from the CRM or Google Sheet replaces the manual upload; the same columns, so nothing here changes.</li>
          <li><b>Week 2:</b> the check sits in the matchmaker's send flow, Gmail replies feed the reader through Claude, and overrides are logged for the monthly rule review.</li>
          <li><b>Privacy:</b> profiles stay in your own Google or database account; only reply text goes to the Claude API, under your own key (Anthropic does not train on API data by default).</li>
        </ol>
      </section>`;
  }

  const CODE_FIELD = { SMOKING: 'smoke', KIDS: 'kids', RELIGION: 'religion', DIET: 'diet', MARITAL: 'marital', AGE: 'age', HEIGHT: 'height', LOCATION: 'city', EDUCATION: 'edu', LANGUAGE: 'tongue', DRINKING: 'drink' };

  // ---------- modals ----------
  function openModal(html) {
    const m = $('#modal');
    m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">${html}</div>`;
    m.hidden = false;
    const focusable = m.querySelector('button, [href], input, select, textarea');
    if (focusable) focusable.focus();
  }
  function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

  function openEmail() {
    const c = byId.get(state.clientId);
    const items = [...state.picked.keys()].map((id) => {
      const p = byId.get(id);
      const ev = evaluatePair(c, p, state.policy);
      const why = ev.positives.length ? ev.positives.join(' · ') : 'Matches your stated preferences';
      return `<div class="mail-card">
        <div class="mail-head"><span class="avatar" aria-hidden="true">${esc(initials(p))}</span><div><b>${esc(p.name)}</b>, ${p.age} · ${esc(p.city)}<br><span class="muted">${esc(p.profession)} · ${esc(p.religion)} · ${esc(p.tongue)}</span></div></div>
        <p class="why"><b>Compatibility summary:</b> ${esc(why)}</p>
        <p class="ml"><span class="chip ml-chip">Magic Link ↗</span> <span class="muted small">Verified: ID, degree, income</span></p>
        <div class="mail-btns"><span class="mb yes">Interested</span><span class="lbl-inline">Not for me:</span>${['Age', 'Height', 'Location', 'Lifestyle', 'Profession', 'Family', 'Photos or profile', 'Not now'].map((x) => `<span class="mb">${x}</span>`).join('')}</div>
      </div>`;
    }).join('');
    openModal(`
      <div class="dlg-head"><h2 id="dlg-title">Introduction preview</h2><button type="button" class="x" data-close aria-label="Close">×</button></div>
      <div class="mail">
        <p class="subject"><span class="muted">Subject</span> ${state.picked.size} hand-picked introduction${state.picked.size > 1 ? 's' : ''} for you, ${esc(first(c))}</p>
        <p>Hi ${esc(first(c))}, here ${state.picked.size > 1 ? 'are this week\'s introductions, each' : 'is this week\'s introduction,'} compatibility-checked against your Partner Preferences and theirs. One tap under each tells me what to refine next time.</p>
        ${items}
        <p class="muted small">Your matchmaker (Matchmaker ${esc(c.mm)}), The Date Crew</p>
      </div>
      <p class="foot">Each button is a one-click link that records a structured reason against this share. Free-text replies still go through the feedback reader.</p>`);
  }

  function openOverride(id) {
    const c = byId.get(state.clientId);
    const p = byId.get(id);
    const ev = evaluatePair(c, p, state.policy);
    const hard = ev.issues.filter((i) => i.sev === 'hard');
    openModal(`
      <div class="dlg-head"><h2 id="dlg-title">Override a block</h2><button type="button" class="x" data-close aria-label="Close">×</button></div>
      <p>${esc(p.name)} breaks: ${hard.map((i) => `<b>${esc(FIELD_LABELS[i.field])}</b> (${esc(i.have)} vs ${esc(i.want)})`).join(', ')}.</p>
      <fieldset class="reasons"><legend>Why send it anyway? Overrides are logged and feed the rule calibration.</legend>
        ${['Client told me this is flexible', 'Exceptional profile, client asked to see such cases', 'The profile data is wrong'].map((x, i) => `<label><input type="radio" name="ovr" value="${esc(x)}" ${i === 0 ? 'checked' : ''}> ${esc(x)}</label>`).join('')}
      </fieldset>
      <div class="btnrow"><button type="button" class="btn" data-override-save="${id}">Add with override</button><button type="button" class="btn ghost" data-close>Cancel</button></div>`);
  }

  // ---------- routing, events ----------
  const VIEWS = ['check', 'backtest', 'feedback', 'data'];
  function route() {
    const h = location.hash.replace('#', '');
    state.view = VIEWS.includes(h) ? h : 'check';
    for (const v of VIEWS) {
      $(`#view-${v}`).hidden = v !== state.view;
      const tab = $(`#tab-${v}`);
      tab.setAttribute('aria-selected', String(v === state.view));
      tab.classList.toggle('on', v === state.view);
    }
  }
  function renderAll() { renderDataNote(); renderCheck(); renderBacktest(); renderFeedback(); renderData(); }

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'client-select') { state.clientId = t.value; state.picked.clear(); state.filter = 'ready'; state.limit = 10; renderCheck(); }
    if (t.dataset.toggle) { state.policy[t.dataset.toggle] = t.checked; renderAll(); }
    if (t.id === 'try-client') state.tryClientId = t.value;
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.file || !t.files || !t.files[0]) return;
    const f = t.files[0];
    if (f.size > 50 * 1024 * 1024) { state.upload.error = `${f.name} is over 50 MB; split it or filter to active clients.`; renderData(); return; }
    state.upload[t.dataset.file] = { name: f.name, text: await f.text() };
    state.upload.result = null; state.upload.error = '';
    renderData();
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'try-text') state.tryText = t.value;
    if (t.id === 'llm-key') state.llm.key = t.value.trim();
    if (t.id === 'llm-model') state.llm.model = t.value.trim();
  });
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-close]');
    if (!t) { if (e.target.id === 'modal') closeModal(); return; }
    const d = t.dataset;
    if (d.filter) { state.filter = d.filter; state.limit = 10; renderCheck(); }
    else if ('more' in d) { state.limit += 10; renderCheck(); }
    else if (d.pick) { if (state.picked.has(d.pick)) state.picked.delete(d.pick); else state.picked.set(d.pick, { override: null }); renderCheck(); }
    else if (d.override) openOverride(d.override);
    else if (d.overrideSave) { const v = (document.querySelector('input[name="ovr"]:checked') || {}).value || 'Override'; state.picked.set(d.overrideSave, { override: v }); closeModal(); renderCheck(); }
    else if ('preview' in d) openEmail();
    else if ('clear' in d) { state.picked.clear(); renderCheck(); }
    else if ('close' in d) closeModal();
    else if (d.sev) { state.policy.severity[d.sev] = state.policy.severity[d.sev] === 'hard' ? 'soft' : 'hard'; renderAll(); }
    else if (d.inbox) { state.inboxId = d.inbox; renderFeedback(); }
    else if (d.decide) { state.decisions[d.id] = d.decide; renderFeedback(); }
    else if (d.template) {
      const csv = d.template === 'blank' ? blankTemplates() : datasetToCSV(DATA);
      const tag = d.template === 'blank' ? 'template' : DEMO ? 'demo' : 'export';
      download(`match-guard-profiles-${tag}.csv`, csv.profiles);
      setTimeout(() => download(`match-guard-shares-${tag}.csv`, csv.shares), 400);
    }
    else if ('validate' in d) {
      try {
        state.upload.result = importCSV(state.upload.profiles.text, state.upload.shares ? state.upload.shares.text : '', { parseFeedbackFn: (txt, c, p) => parseFeedback(txt, c, p) });
        state.upload.error = '';
      } catch (err) { state.upload.error = `Could not read the files: ${err.message}`; }
      renderData();
    }
    else if ('unpick' in d) { state.upload = { profiles: null, shares: null, result: null, busy: false, error: '' }; renderData(); }
    else if ('load' in d) {
      state.upload.busy = true; renderData();
      try { await mgStore.set(state.upload.result.data); location.hash = '#check'; location.reload(); }
      catch (err) { state.upload.busy = false; state.upload.error = 'This browser would not keep the data (private browsing, or storage is full). Open the page in a normal window and try again.'; renderData(); }
    }
    else if ('reset' in d) { try { await mgStore.clear(); } catch (err) { /* nothing stored */ } location.hash = '#check'; location.reload(); }
    else if (d.try === 'offline') {
      const c = byId.get(state.tryClientId);
      state.tryResult = { text: state.tryText, out: parseFeedback(state.tryText, c, null, state.policy) };
      renderFeedback();
    } else if (d.try === 'claude') {
      const c = byId.get(state.tryClientId);
      if (!state.llm.key) { state.llm.error = 'Add an Anthropic API key first, or use the offline rules.'; renderFeedback(); return; }
      state.llm.busy = true; state.llm.error = ''; renderFeedback();
      try {
        const out = await classifyWithClaude({ apiKey: state.llm.key, model: state.llm.model, text: state.tryText, client: c, cand: null, browser: true });
        state.tryResult = { text: state.tryText, out };
      } catch (err) {
        state.llm.error = err instanceof TypeError
          ? 'The request was blocked before it reached Anthropic. Inside the Claude preview, pages cannot call outside services: open the GitHub Pages copy or index.html locally.'
          : `Claude returned an error: ${err.message}`;
      }
      state.llm.busy = false; renderFeedback();
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  // Tooltips for anything with data-tip (mouse and keyboard).
  const tip = $('#tip');
  function showTip(el, x, y) {
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 12, Math.max(12, x + 14));
    const topY = y + 18 + r.height > window.innerHeight ? y - r.height - 12 : y + 18;
    tip.style.left = `${left}px`; tip.style.top = `${topY}px`;
  }
  document.addEventListener('mousemove', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left, r.bottom - 10); } });
  document.addEventListener('focusout', () => { tip.hidden = true; });

  window.addEventListener('hashchange', route);
  renderAll();
  route();
}

// Keeps an imported dataset on this device (IndexedDB), so a page reload keeps the user's data.
const mgStore = (() => {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('match-guard', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = (mode, fn) => open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode); const r = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(r && r.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }));
  return {
    get: () => run('readonly', (st) => st.get('dataset')),
    set: (v) => run('readwrite', (st) => st.put(v, 'dataset')),
    clear: () => run('readwrite', (st) => st.delete('dataset')),
  };
})();

(async function boot() {
  let mine = null;
  try { mine = await mgStore.get(); } catch (err) { mine = null; }
  if (mine && Array.isArray(mine.profiles) && mine.profiles.length) mgStart(mine, 'user');
  else mgStart(window.MG_DATA, 'demo');
})();
