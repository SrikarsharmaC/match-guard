// Bring-your-own-data: CSV <-> the dataset shape the engine uses. Pure functions, no DOM.
// A matchmaking team exports two sheets (profiles, shares) from their CRM or Google Sheets,
// and Match Guard runs on them in the browser. Nothing is uploaded anywhere.

// ---------------------------------------------------------------------------
// Column schema. Order here is the order of the template.
// ---------------------------------------------------------------------------
export const PROFILE_COLUMNS = [
  ['id', 'Unique ID, e.g. C001 or P1042', true],
  ['name', 'Display name, e.g. Ananya R.', true],
  ['role', 'client (Partner Search: receives introductions) or member (TDC Member in the network)', true],
  ['matchmaker', 'Dedicated matchmaker (Partner Search clients only)', false],
  ['gender', 'F or M', true],
  ['seeking', 'F or M', true],
  ['age', 'Years', true],
  ['height_cm', 'Centimetres', false],
  ['religion', 'e.g. Hindu', false],
  ['mother_tongue', 'e.g. Telugu', false],
  ['city', 'Current city', false],
  ['will_relocate', 'yes / no', false],
  ['education', 'Graduate / Postgraduate / Doctorate', false],
  ['industry', 'e.g. Tech, Finance, Medicine', false],
  ['profession', 'e.g. Product Manager', false],
  ['marital_status', 'Never married / Divorced / Widowed', false],
  ['diet', 'Veg / Eggetarian / Non-veg', false],
  ['smokes', 'No / Occasionally / Yes (blank = not recorded)', false],
  ['drinks', 'No / Socially / Regularly (blank = not recorded)', false],
  ['wants_kids', 'Yes / No / Open', false],
  ['family_type', 'Nuclear / Joint', false],
  ['pref_age_min', 'Youngest acceptable age', false],
  ['pref_age_max', 'Oldest acceptable age', false],
  ['pref_height_min', 'cm (blank = no minimum)', false],
  ['pref_height_max', 'cm (blank = no maximum)', false],
  ['pref_religion', 'Accepted values, separated by |', false],
  ['pref_mother_tongue', 'Accepted values, separated by |', false],
  ['pref_city', 'Accepted cities, separated by | (relocating also passes)', false],
  ['pref_education', 'Minimum: Graduate / Postgraduate / Doctorate', false],
  ['pref_marital_status', 'Accepted values, separated by |', false],
  ['pref_diet', 'Veg or Veg+Egg', false],
  ['pref_smoking', 'No or Occasionally (= at most occasionally)', false],
  ['pref_drinking', 'No or Socially (= at most socially)', false],
  ['pref_kids', 'Yes or No', false],
  ['dealbreakers', 'Fields that must always block, separated by |: smoking, kids, religion, diet, marital_status, age, height, city, education, mother_tongue, drinking', false],
  ['call_notes', 'Free text from the intake call and fortnightly check-ins', false],
];

export const SHARE_COLUMNS = [
  ['share_id', 'Unique ID (blank = generated)', false],
  ['date', 'YYYY-MM-DD', true],
  ['matchmaker', 'Who sent it', true],
  ['client_id', 'Profile ID of the Partner Search client', true],
  ['candidate_id', 'Profile ID of the member introduced', true],
  ['furthest_stage', 'rejected / accepted / contact_shared / conversation / meeting_fixed / meeting_completed', true],
  ['feedback', "The client's reply, as written (rejections)", false],
  ['reason_bucket', 'Optional, if a matchmaker tagged it: avoidable / new_pref / taste / timing / presentation / vague', false],
];

export const STAGES = ['rejected', 'accepted', 'contact_shared', 'conversation', 'meeting_fixed', 'meeting_completed'];
const BUCKET_KEYS = ['avoidable', 'new_pref', 'taste', 'timing', 'presentation', 'vague'];

// CSV field name <-> engine field name, for dealbreakers.
const DB_FIELD = {
  smoking: 'smoke', smoke: 'smoke', kids: 'kids', children: 'kids', religion: 'religion', diet: 'diet',
  marital_status: 'marital', marital: 'marital', age: 'age', height: 'height', city: 'city', location: 'city',
  education: 'edu', edu: 'edu', mother_tongue: 'tongue', language: 'tongue', tongue: 'tongue', drinking: 'drink', drink: 'drink',
};
const DB_NAME = { smoke: 'smoking', kids: 'kids', religion: 'religion', diet: 'diet', marital: 'marital_status', age: 'age', height: 'height', city: 'city', edu: 'education', tongue: 'mother_tongue', drink: 'drinking' };

// Friendly spellings accepted for each enum (lower-case keys).
const ENUMS = {
  gender: { f: 'F', female: 'F', woman: 'F', m: 'M', male: 'M', man: 'M' },
  education: { graduate: 'Graduate', bachelors: 'Graduate', "bachelor's": 'Graduate', ug: 'Graduate', postgraduate: 'Postgraduate', masters: 'Postgraduate', "master's": 'Postgraduate', pg: 'Postgraduate', doctorate: 'Doctorate', phd: 'Doctorate' },
  diet: { veg: 'Veg', vegetarian: 'Veg', eggetarian: 'Eggetarian', egg: 'Eggetarian', 'non-veg': 'Non-veg', nonveg: 'Non-veg', 'non veg': 'Non-veg', 'non-vegetarian': 'Non-veg' },
  smokes: { no: 'No', never: 'No', 'non-smoker': 'No', occasionally: 'Occasionally', sometimes: 'Occasionally', yes: 'Yes', regularly: 'Yes', smoker: 'Yes' },
  drinks: { no: 'No', never: 'No', 'non-drinker': 'No', socially: 'Socially', occasionally: 'Socially', yes: 'Regularly', regularly: 'Regularly' },
  wants_kids: { yes: 'Yes', no: 'No', open: 'Open', maybe: 'Open', 'not sure': 'Open' },
  family_type: { nuclear: 'Nuclear', joint: 'Joint' },
  marital_status: { 'never married': 'Never married', single: 'Never married', unmarried: 'Never married', divorced: 'Divorced', widowed: 'Widowed', 'awaiting divorce': 'Awaiting divorce' },
  pref_diet: { veg: 'Veg', vegetarian: 'Veg', 'veg+egg': 'VegEgg', 'veg or egg': 'VegEgg', 'veg or eggetarian': 'VegEgg', vegegg: 'VegEgg', eggetarian: 'VegEgg' },
  pref_smoking: { no: 'No', 'non-smoker': 'No', never: 'No', occasionally: 'Occasionally', 'at most occasionally': 'Occasionally' },
  pref_drinking: { no: 'No', 'non-drinker': 'No', never: 'No', socially: 'Socially', 'at most socially': 'Socially' },
  pref_kids: { yes: 'Yes', no: 'No' },
  yesno: { yes: true, y: true, true: true, 1: true, no: false, n: false, false: false, 0: false },
};

// ---------------------------------------------------------------------------
// CSV text <-> rows (RFC 4180: quotes, escaped quotes, commas and newlines in fields)
// ---------------------------------------------------------------------------
export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i += 1; } else q = false; } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { header: [], records: [] };
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const records = nonEmpty.slice(1).map((r, idx) => {
    const o = { _line: idx + 2 };
    header.forEach((h, j) => { o[h] = (r[j] ?? '').trim(); });
    return o;
  });
  return { header, records };
}

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCSV(columns, objects) {
  return [columns.map(([c]) => c).join(','), ...objects.map((o) => columns.map(([c]) => cell(o[c])).join(','))].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Dataset -> CSV rows (for templates and for exporting the demo data)
// ---------------------------------------------------------------------------
const list = (a) => (a && a.length ? a.join('|') : '');
const PREF_DIET_OUT = { Veg: 'Veg', VegEgg: 'Veg+Egg' };

export function profileToRow(p) {
  const pr = p.prefs || {};
  return {
    id: p.id, name: p.name, role: p.client ? 'client' : 'member', matchmaker: p.client ? p.mm : '',
    gender: p.gender, seeking: p.seeking, age: p.age, height_cm: p.height ?? '', religion: p.religion ?? '',
    mother_tongue: p.tongue ?? '', city: p.city ?? '', will_relocate: p.relocate ? 'yes' : 'no', education: p.edu ?? '',
    industry: p.industry ?? '', profession: p.profession ?? '', marital_status: p.marital ?? '', diet: p.diet ?? '',
    smokes: p.smoke ?? '', drinks: p.drink ?? '', wants_kids: p.kids ?? '', family_type: p.family ?? '',
    pref_age_min: pr.age ? pr.age[0] : '', pref_age_max: pr.age ? pr.age[1] : '',
    pref_height_min: pr.height && pr.height[0] > 140 ? pr.height[0] : '', pref_height_max: pr.height && pr.height[1] < 200 ? pr.height[1] : '',
    pref_religion: list(pr.religion), pref_mother_tongue: list(pr.tongue), pref_city: list(pr.city),
    pref_education: pr.edu ?? '', pref_marital_status: list(pr.marital), pref_diet: PREF_DIET_OUT[pr.diet] ?? '',
    pref_smoking: pr.smoke ?? '', pref_drinking: pr.drink ?? '', pref_kids: pr.kids ?? '',
    dealbreakers: (p.dealbreakers || []).map((f) => DB_NAME[f] || f).join('|'), call_notes: p.notes ?? '',
  };
}

export function shareToRow(s) {
  return {
    share_id: s.id, date: s.date, matchmaker: s.mm, client_id: s.client, candidate_id: s.cand,
    furthest_stage: STAGES[s.stage] ?? (s.outcome === 'rejected' ? 'rejected' : 'accepted'),
    feedback: s.feedback ?? '', reason_bucket: s.label && !s.label.estimated ? s.label.bucket : '',
  };
}

export function datasetToCSV(data) {
  return {
    profiles: toCSV(PROFILE_COLUMNS, data.profiles.map(profileToRow)),
    shares: toCSV(SHARE_COLUMNS, data.shares.map(shareToRow)),
  };
}

// ---------------------------------------------------------------------------
// CSV rows -> dataset, with a row-by-row validation report
// ---------------------------------------------------------------------------
function makeReport() {
  const issues = [];
  return {
    issues,
    error(file, line, column, msg) { issues.push({ level: 'error', file, line, column, msg }); },
    warn(file, line, column, msg) { issues.push({ level: 'warning', file, line, column, msg }); },
  };
}

function enumOf(kind, raw, rep, file, line, column) {
  if (raw === '' || raw == null) return null;
  const v = ENUMS[kind][String(raw).trim().toLowerCase()];
  if (v === undefined) { rep.warn(file, line, column, `"${raw}" is not a recognised value; treated as not recorded`); return null; }
  return v;
}
function intOf(raw, rep, file, line, column, { min, max, required } = {}) {
  if (raw === '' || raw == null) { if (required) rep.error(file, line, column, 'is required'); return null; }
  const n = Number(raw);
  if (!Number.isFinite(n) || (min != null && n < min) || (max != null && n > max)) {
    rep.error(file, line, column, `"${raw}" is not a valid number${min != null ? ` (${min}–${max})` : ''}`);
    return null;
  }
  return Math.round(n);
}
const splitList = (raw) => (raw ? raw.split(/[|;]/).map((x) => x.trim()).filter(Boolean) : null);

export function rowsToProfiles(records, rep) {
  const F = 'profiles.csv';
  const out = []; const seen = new Set();
  for (const r of records) {
    const L = r._line;
    if (!r.id) { rep.error(F, L, 'id', 'is required'); continue; }
    if (seen.has(r.id)) { rep.error(F, L, 'id', `"${r.id}" appears twice`); continue; }
    seen.add(r.id);
    const ROLE = { client: 'client', partner_search: 'client', 'partner search': 'client', premium: 'client', candidate: 'candidate', member: 'candidate', 'tdc member': 'candidate' };
    const role = ROLE[(r.role || '').trim().toLowerCase()] || '';
    if (!role) rep.error(F, L, 'role', 'must be client (Partner Search) or member');
    const gender = enumOf('gender', r.gender, rep, F, L, 'gender');
    const seeking = enumOf('gender', r.seeking, rep, F, L, 'seeking');
    if (!gender) rep.error(F, L, 'gender', 'must be F or M');
    if (!seeking) rep.error(F, L, 'seeking', 'must be F or M');
    const age = intOf(r.age, rep, F, L, 'age', { min: 18, max: 90, required: true });
    const p = {
      id: r.id, name: r.name || r.id, gender, seeking, age,
      height: intOf(r.height_cm, rep, F, L, 'height_cm', { min: 120, max: 230 }),
      religion: r.religion || null, tongue: r.mother_tongue || null, city: r.city || null,
      relocate: r.will_relocate ? enumOf('yesno', r.will_relocate, rep, F, L, 'will_relocate') === true : false,
      edu: enumOf('education', r.education, rep, F, L, 'education'),
      industry: r.industry || null, profession: r.profession || '', marital: enumOf('marital_status', r.marital_status, rep, F, L, 'marital_status'),
      diet: enumOf('diet', r.diet, rep, F, L, 'diet'), smoke: enumOf('smokes', r.smokes, rep, F, L, 'smokes'),
      drink: enumOf('drinks', r.drinks, rep, F, L, 'drinks'), kids: enumOf('wants_kids', r.wants_kids, rep, F, L, 'wants_kids'),
      family: enumOf('family_type', r.family_type, rep, F, L, 'family_type'),
    };
    const amin = intOf(r.pref_age_min, rep, F, L, 'pref_age_min', { min: 18, max: 90 });
    const amax = intOf(r.pref_age_max, rep, F, L, 'pref_age_max', { min: 18, max: 90 });
    const hmin = intOf(r.pref_height_min, rep, F, L, 'pref_height_min', { min: 120, max: 230 });
    const hmax = intOf(r.pref_height_max, rep, F, L, 'pref_height_max', { min: 120, max: 230 });
    if ((amin == null) !== (amax == null)) rep.warn(F, L, 'pref_age_min', 'give both pref_age_min and pref_age_max, or neither; age preference ignored');
    if (amin != null && amax != null && amin > amax) rep.error(F, L, 'pref_age_min', 'is higher than pref_age_max');
    const eduMin = enumOf('education', r.pref_education, rep, F, L, 'pref_education');
    p.prefs = {
      age: amin != null && amax != null && amin <= amax ? [amin, amax] : null,
      height: hmin != null || hmax != null ? [hmin ?? 140, hmax ?? 200] : null,
      religion: splitList(r.pref_religion), tongue: splitList(r.pref_mother_tongue), city: splitList(r.pref_city),
      edu: eduMin, marital: splitList(r.pref_marital_status)?.map((x) => ENUMS.marital_status[x.toLowerCase()] || x) ?? null,
      diet: enumOf('pref_diet', r.pref_diet, rep, F, L, 'pref_diet'),
      smoke: enumOf('pref_smoking', r.pref_smoking, rep, F, L, 'pref_smoking'),
      drink: enumOf('pref_drinking', r.pref_drinking, rep, F, L, 'pref_drinking'),
      kids: enumOf('pref_kids', r.pref_kids, rep, F, L, 'pref_kids'),
    };
    p.dealbreakers = [];
    for (const d of splitList(r.dealbreakers) || []) {
      const f = DB_FIELD[d.toLowerCase().replace(/\s+/g, '_')];
      if (f) p.dealbreakers.push(f); else rep.warn(F, L, 'dealbreakers', `"${d}" is not a known field; ignored`);
    }
    if (r.call_notes) p.notes = r.call_notes;
    if (role === 'client') {
      p.client = true;
      p.mm = r.matchmaker || 'Unassigned';
      if (!r.matchmaker) rep.warn(F, L, 'matchmaker', 'client has no matchmaker; grouped under "Unassigned"');
    }
    out.push(p);
  }
  return out;
}

export function rowsToShares(records, byId, rep, parseFeedbackFn) {
  const F = 'shares.csv';
  const out = []; let n = 0;
  for (const r of records) {
    const L = r._line;
    const c = byId.get(r.client_id); const p = byId.get(r.candidate_id);
    if (!r.client_id || !c) { rep.error(F, L, 'client_id', r.client_id ? `"${r.client_id}" is not in profiles.csv` : 'is required'); continue; }
    if (!c.client) rep.warn(F, L, 'client_id', `"${r.client_id}" is not marked as a client in profiles.csv`);
    if (!r.candidate_id || !p) { rep.error(F, L, 'candidate_id', r.candidate_id ? `"${r.candidate_id}" is not in profiles.csv` : 'is required'); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) { rep.error(F, L, 'date', 'must be YYYY-MM-DD'); continue; }
    const stage = STAGES.indexOf((r.furthest_stage || '').toLowerCase().replace(/[\s-]+/g, '_'));
    if (stage < 0) { rep.error(F, L, 'furthest_stage', `must be one of: ${STAGES.join(', ')}`); continue; }
    n += 1;
    const s = {
      id: r.share_id || `S${String(n).padStart(5, '0')}`, date: r.date, mm: r.matchmaker || c.mm || 'Unassigned',
      client: c.id, cand: p.id, outcome: stage === 0 ? 'rejected' : 'accepted', stage, feedback: r.feedback || '',
    };
    if (stage === 0) {
      const tagged = (r.reason_bucket || '').toLowerCase();
      if (tagged && BUCKET_KEYS.includes(tagged)) s.label = { bucket: tagged, code: 'TAGGED' };
      else {
        if (tagged) rep.warn(F, L, 'reason_bucket', `"${r.reason_bucket}" is not a known bucket; read from the feedback instead`);
        if (parseFeedbackFn) { const o = parseFeedbackFn(s.feedback, c, p); s.label = { bucket: o.bucket, code: (o.reasons && o.reasons[0] && o.reasons[0].code) || 'VAGUE', estimated: true }; }
      }
    }
    out.push(s);
  }
  return out;
}

// Build a full dataset from the two CSV texts. sharesText may be empty.
export function importCSV(profilesText, sharesText, { parseFeedbackFn } = {}) {
  const rep = makeReport();
  const P = parseCSV(profilesText || '');
  const missing = PROFILE_COLUMNS.filter(([c, , req]) => req && !P.header.includes(c)).map(([c]) => c);
  if (!P.records.length) rep.error('profiles.csv', 1, '', 'has no rows');
  if (missing.length) rep.error('profiles.csv', 1, '', `is missing required columns: ${missing.join(', ')}`);
  const profiles = missing.length ? [] : rowsToProfiles(P.records, rep);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  let shares = [];
  if (sharesText && sharesText.trim()) {
    const S = parseCSV(sharesText);
    const miss = SHARE_COLUMNS.filter(([c, , req]) => req && !S.header.includes(c)).map(([c]) => c);
    if (miss.length) rep.error('shares.csv', 1, '', `is missing required columns: ${miss.join(', ')}`);
    else shares = rowsToShares(S.records, byId, rep, parseFeedbackFn);
  }
  const clients = profiles.filter((p) => p.client);
  if (profiles.length && !clients.length) rep.error('profiles.csv', 1, 'role', 'no row has role = client');
  const mmIds = [...new Set([...clients.map((c) => c.mm), ...shares.map((s) => s.mm)])].sort();
  const dates = shares.map((s) => s.date).sort();
  const data = {
    meta: { title: 'Imported data', source: 'csv', imported: new Date().toISOString(), window: dates.length ? [dates[0], dates[dates.length - 1]] : null },
    matchmakers: mmIds.map((id) => ({ id, name: /^[A-Z]$/.test(id) ? `Matchmaker ${id}` : id })),
    profiles, shares,
  };
  const errors = rep.issues.filter((i) => i.level === 'error').length;
  return { data, issues: rep.issues, ok: errors === 0 && clients.length > 0, stats: { profiles: profiles.length, clients: clients.length, candidates: profiles.length - clients.length, shares: shares.length, matchmakers: mmIds.length } };
}
