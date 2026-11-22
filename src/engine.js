// Match Guard engine: pure functions, no DOM.
// Used by the web prototype (inlined at build time) and by the Node scripts and tests.
//
// Core idea: before a matchmaker shares a profile, check it against the client's stated
// preferences AND the other person's stated preferences (two-way). Deal-breakers and
// fields that behave like deal-breakers in historical data are HARD (block); everything
// else is SOFT (warn, matchmaker decides). Unknown values are never treated as "OK".

export const ABROAD = ['Dubai', 'London', 'Singapore', 'New York'];
export const EDU_LEVEL = { Graduate: 1, Postgraduate: 2, Doctorate: 3 };

export const FIELD_LABELS = {
  age: 'Age', height: 'Height', religion: 'Religion', tongue: 'Mother tongue', city: 'Location',
  edu: 'Education', marital: 'Marital status', diet: 'Diet', smoke: 'Smoking', drink: 'Drinking',
  kids: 'Children', note: 'Call-note rule',
};

// Rule keys used for severity settings and calibration.
export const RULE_KEYS = [
  'smoke', 'kids', 'religion', 'diet', 'marital', 'age:far', 'height:far',
  'age:near', 'height:near', 'city', 'edu', 'tongue', 'drink', 'note',
];

export const RULE_LABELS = {
  smoke: 'Smoking', kids: 'Children', religion: 'Religion', diet: 'Diet', marital: 'Marital status',
  'age:far': 'Age, more than 2 yrs outside range', 'height:far': 'Height, more than 5 cm outside range',
  'age:near': 'Age, within 2 yrs of range', 'height:near': 'Height, within 5 cm of range',
  city: 'Location', edu: 'Education', tongue: 'Mother tongue', drink: 'Drinking', note: 'Call-note rules (AI-extracted)',
};

export const DEFAULT_POLICY = {
  severity: {
    smoke: 'hard', kids: 'hard', religion: 'hard', diet: 'hard', marital: 'hard',
    'age:far': 'hard', 'height:far': 'hard',
    'age:near': 'soft', 'height:near': 'soft', city: 'soft', edu: 'soft', tongue: 'soft', drink: 'soft',
    note: 'soft', // AI-extracted rules never start as hard blocks
  },
  tolerance: { age: 2, height: 5 },
  twoWay: true,
  useNoteRules: true,
};

export function clonePolicy(p = DEFAULT_POLICY) {
  return { ...p, severity: { ...p.severity }, tolerance: { ...p.tolerance } };
}

const DIET_WANT = { Veg: ['Veg'], VegEgg: ['Veg', 'Eggetarian'] };
const DIET_WORD = { Veg: 'Vegetarian', VegEgg: 'Veg or eggetarian' };
const SMOKE_WANT = { No: ['No'], Occasionally: ['No', 'Occasionally'] };
const SMOKE_WORD = { No: 'Non-smoker', Occasionally: 'Non or occasional smoker' };
const DRINK_WANT = { No: ['No'], Socially: ['No', 'Socially'] };
const DRINK_WORD = { No: 'Non-drinker', Socially: 'Social drinker at most' };
const KIDS_WANT = { Yes: ['Yes', 'Open'], No: ['No', 'Open'] };
const KIDS_WORD = { Yes: 'Wants children', No: 'Does not want children', Open: 'Open on children' };

export function kidsWord(v) { return KIDS_WORD[v] || 'Not stated'; }

function fmtHeightRange([lo, hi]) {
  if (hi >= 200) return `${lo} cm+`;
  if (lo <= 140) return `up to ${hi} cm`;
  return `${lo}–${hi} cm`;
}

export const DIET_LABEL = { Veg: 'Vegetarian', Eggetarian: 'Eggetarian', 'Non-veg': 'Non-vegetarian' };

// Human-readable stated preferences, with how each one is enforced under a policy.
export function prefRows(person, policy = DEFAULT_POLICY) {
  const p = person.prefs || {};
  const db = new Set(person.dealbreakers || []);
  const rows = [];
  const add = (field, text, sev) => rows.push({ field, label: FIELD_LABELS[field], text, dealbreaker: db.has(field), sev: db.has(field) ? 'hard' : sev });
  if (p.age) add('age', `${p.age[0]}–${p.age[1]}`, 'band');
  if (p.height) add('height', fmtHeightRange(p.height), 'band');
  if (p.religion) add('religion', p.religion.join(' / '), policy.severity.religion);
  if (p.tongue) add('tongue', p.tongue.join(' / '), policy.severity.tongue);
  if (p.city) add('city', `${p.city.join(' / ')}, or willing to relocate`, policy.severity.city);
  if (p.edu) add('edu', `${p.edu}+`, policy.severity.edu);
  if (p.marital) add('marital', p.marital.join(' / '), policy.severity.marital);
  if (p.diet) add('diet', DIET_WORD[p.diet], policy.severity.diet);
  if (p.smoke) add('smoke', SMOKE_WORD[p.smoke], policy.severity.smoke);
  if (p.drink) add('drink', DRINK_WORD[p.drink], policy.severity.drink);
  if (p.kids) add('kids', KIDS_WORD[p.kids], policy.severity.kids);
  return rows;
}

// One-line profile description (also what the LLM is shown).
export function profileText(x) {
  const parts = [
    `${x.gender === 'F' ? 'Woman' : 'Man'}, ${x.age}`, `${x.height} cm`, x.religion, `mother tongue ${x.tongue}`,
    `lives in ${x.city}${x.relocate ? ' (open to relocating)' : ''}`, x.edu, `${x.profession} (${x.industry})`, x.marital,
    DIET_LABEL[x.diet] || x.diet, `smokes: ${x.smoke ?? 'not recorded'}`, `drinks: ${x.drink ?? 'not recorded'}`,
    kidsWord(x.kids), `${x.family} family`,
  ];
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Call notes -> rules. Offline stand-in for the LLM extractor used in production.
// Only explicit, negated statements become rules; vague notes stay notes.
// ---------------------------------------------------------------------------
const NEG = /(not keen|rather not|doesn'?t want|does not want|no one from|nobody from|avoid|not open to|not interested in|won'?t consider|wants to stay in india|no nris?)/i;
const INDUSTRY_WORDS = [
  ['Finance', /(finance|banker|banking|investment bank|chartered accountant)/i],
  ['Medicine', /(doctor|medicine|medical|surgeon)/i],
  ['Consulting', /(consulting|consultant)/i],
  ['Law', /(lawyer|law firm|\blaw\b)/i],
];

export function extractNoteRules(notes) {
  const rules = [];
  if (!notes) return rules;
  for (const sentence of notes.split(/(?<=[.;!?])\s+/)) {
    if (!NEG.test(sentence)) continue;
    const inds = INDUSTRY_WORDS.filter(([, re]) => re.test(sentence)).map(([name]) => name);
    if (inds.length) rules.push({ type: 'industry_not', values: inds, source: sentence.trim() });
    if (/(nri|abroad|stay in india|outside india)/i.test(sentence)) rules.push({ type: 'india_only', source: sentence.trim() });
    if (/joint family/i.test(sentence)) rules.push({ type: 'nuclear_only', source: sentence.trim() });
  }
  // One rule per type; industry exclusions are merged.
  const out = [];
  for (const r of rules) {
    const prev = out.find((x) => x.type === r.type);
    if (!prev) out.push({ ...r });
    else if (r.values) prev.values = [...new Set([...prev.values, ...r.values])];
  }
  return out;
}

export function noteRuleWord(r) {
  if (r.type === 'industry_not') return `Not in ${r.values.join(' / ')}`;
  if (r.type === 'india_only') return 'Based in India';
  if (r.type === 'nuclear_only') return 'No joint family';
  return r.type;
}

// Cache extracted rules per person (notes are static in the prototype).
const ruleCache = new Map();
export function noteRulesOf(person) {
  if (!person.notes) return [];
  if (!ruleCache.has(person.id)) ruleCache.set(person.id, extractNoteRules(person.notes));
  return ruleCache.get(person.id);
}

// ---------------------------------------------------------------------------
// One side of the check: chooser's preferences vs the other person's attributes.
// ---------------------------------------------------------------------------
export function checkPrefs(chooser, other, policy = DEFAULT_POLICY) {
  const p = chooser.prefs || {};
  const db = new Set(chooser.dealbreakers || []);
  const issues = [];
  const sevFor = (field, key) => (db.has(field) ? 'hard' : policy.severity[key] || 'soft');
  const push = (field, key, have, want, extra = {}) => {
    issues.push({ field, key, sev: sevFor(field, key), dealbreaker: db.has(field), have, want, ...extra });
  };
  const unknown = (field, want) => {
    issues.push({ field, key: field, sev: 'unknown', dealbreaker: db.has(field), have: 'Not recorded', want });
  };

  // Range fields: inside the tolerance band = soft, beyond it = hard.
  for (const field of ['age', 'height']) {
    const r = p[field];
    if (!r) continue;
    const v = other[field];
    if (v == null) { unknown(field, field === 'age' ? `${r[0]}–${r[1]}` : fmtHeightRange(r)); continue; }
    const gap = v < r[0] ? r[0] - v : v > r[1] ? v - r[1] : 0;
    if (gap > 0) {
      const near = gap <= policy.tolerance[field];
      const key = `${field}:${near ? 'near' : 'far'}`;
      const have = field === 'age' ? `${v}` : `${v} cm`;
      const want = field === 'age' ? `${r[0]}–${r[1]}` : fmtHeightRange(r);
      push(field, key, have, want, { gap });
    }
  }

  const listField = (field, values, have, word) => {
    if (!values) return;
    if (have == null) { unknown(field, word); return; }
    if (!values.includes(have)) push(field, field, have, word);
  };
  listField('religion', p.religion, other.religion, p.religion && p.religion.join(' / '));
  listField('tongue', p.tongue, other.tongue, p.tongue && p.tongue.join(' / '));
  listField('marital', p.marital, other.marital, p.marital && p.marital.join(' / '));

  if (p.city) {
    const ok = p.city.includes(other.city) || other.relocate === true;
    if (!ok) push('city', 'city', `${other.city}, not relocating`, p.city.join(' / '));
  }
  if (p.edu) {
    if (other.edu == null) unknown('edu', `${p.edu}+`);
    else if (EDU_LEVEL[other.edu] < EDU_LEVEL[p.edu]) push('edu', 'edu', other.edu, `${p.edu}+`);
  }
  const habit = (field, wantMap, wordMap) => {
    const w = p[field];
    if (!w) return;
    const v = other[field];
    if (v == null) { unknown(field, wordMap[w]); return; }
    if (!wantMap[w].includes(v)) push(field, field, field === 'kids' ? kidsWord(v) : v, wordMap[w]);
  };
  habit('diet', DIET_WANT, DIET_WORD);
  habit('smoke', SMOKE_WANT, SMOKE_WORD);
  habit('drink', DRINK_WANT, DRINK_WORD);
  habit('kids', KIDS_WANT, { Yes: KIDS_WORD.Yes, No: KIDS_WORD.No });

  if (policy.useNoteRules) {
    for (const r of noteRulesOf(chooser)) {
      let bad = false; let have = '';
      if (r.type === 'industry_not' && r.values.includes(other.industry)) { bad = true; have = `${other.profession} (${other.industry})`; }
      if (r.type === 'india_only' && ABROAD.includes(other.city)) { bad = true; have = `Lives in ${other.city}`; }
      if (r.type === 'nuclear_only' && other.family === 'Joint') { bad = true; have = 'Joint family'; }
      if (bad) issues.push({ field: 'note', key: 'note', sev: policy.severity.note || 'soft', dealbreaker: false, ai: true, have, want: noteRuleWord(r), source: r.source });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Fit score (0–100) for ranking profiles that pass the hard rules. Explainable on purpose.
// ---------------------------------------------------------------------------
export function fitScore(client, cand, clientIssues, candIssues) {
  let s = 60;
  const pos = [];
  const p = client.prefs || {};
  if (p.age) {
    const mid = (p.age[0] + p.age[1]) / 2;
    const half = (p.age[1] - p.age[0]) / 2 + 2;
    const k = Math.max(0, 1 - Math.abs(cand.age - mid) / half);
    s += 8 * k;
    if (k > 0.65) pos.push('Age near the middle of the range');
  } else s += 4;
  if (cand.city === client.city) { s += 6; pos.push(`Both in ${cand.city}`); } else if (cand.relocate) { s += 3; pos.push('Open to relocating'); }
  if (cand.tongue === client.tongue) { s += 5; pos.push(`Both speak ${cand.tongue}`); }
  if (cand.religion === client.religion) s += 4;
  if ((EDU_LEVEL[cand.edu] || 0) >= (EDU_LEVEL[client.edu] || 0)) s += 3;
  if (cand.diet === client.diet) { s += 4; if (cand.diet === 'Veg') pos.push('Both vegetarian'); }
  if (cand.drink === client.drink) s += 3;
  if (cand.kids === client.kids) s += 3;
  if (candIssues.length === 0) { s += 4; pos.push('Meets their preferences too'); }
  for (const i of clientIssues) {
    if (i.sev === 'soft') s -= i.field === 'age' ? 4 * i.gap : i.field === 'height' ? 2 * i.gap : 10;
    if (i.sev === 'unknown') s -= 6;
  }
  for (const i of candIssues) if (i.sev === 'soft' || i.sev === 'unknown') s -= 5;
  return { score: Math.round(Math.max(0, Math.min(100, s))), positives: pos.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// Pair verdict: blocked (any hard issue), review (soft or unknown), clear.
// ---------------------------------------------------------------------------
export function evaluatePair(client, cand, policy = DEFAULT_POLICY) {
  const clientSide = checkPrefs(client, cand, policy).map((i) => ({ ...i, side: 'client' }));
  const candSide = policy.twoWay ? checkPrefs(cand, client, policy).map((i) => ({ ...i, side: 'candidate' })) : [];
  const issues = [...clientSide, ...candSide];
  const hard = issues.some((i) => i.sev === 'hard');
  const review = issues.some((i) => i.sev === 'soft' || i.sev === 'unknown');
  const verdict = hard ? 'blocked' : review ? 'review' : 'clear';
  const { score, positives } = fitScore(client, cand, clientSide, candSide);
  return { verdict, score, issues, positives };
}

const VERDICT_ORDER = { clear: 0, review: 1, blocked: 2 };

// Search the pool for one client: the matchmaker's 2-hour search becomes a ranked shortlist.
export function searchPool(client, pool, excludeIds = new Set(), policy = DEFAULT_POLICY) {
  const eligible = pool.filter((p) => p.id !== client.id && p.gender === client.seeking && p.seeking === client.gender);
  const fresh = eligible.filter((p) => !excludeIds.has(p.id));
  const results = fresh.map((p) => ({ p, ...evaluatePair(client, p, policy) }));
  results.sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || b.score - a.score || a.p.id.localeCompare(b.p.id));
  const passClient = results.filter((r) => !r.issues.some((i) => i.side === 'client' && i.sev === 'hard')).length;
  return {
    results,
    funnel: {
      pool: fresh.length,
      alreadyShared: eligible.length - fresh.length,
      passClient,
      passBoth: results.filter((r) => r.verdict !== 'blocked').length,
      clear: results.filter((r) => r.verdict === 'clear').length,
    },
  };
}

// ---------------------------------------------------------------------------
// Feedback parser: free-text rejection -> reason codes, bucket and next action.
// Offline keyword rules for the demo; production swaps in an LLM with the same output schema.
// ---------------------------------------------------------------------------
export const BUCKETS = {
  avoidable: { label: 'Avoidable: already in preferences', action: 'Should never have been sent. Match Guard now blocks or flags this before sending.' },
  new_pref: { label: 'New preference to learn', action: 'Propose a soft preference for the matchmaker to confirm. Never auto-hard: clients revise.' },
  taste: { label: 'Taste signal', action: 'Use as a soft ranking signal only. Clients often accept similar profiles later.' },
  presentation: { label: 'Profile presentation', action: 'Fix the profile before re-sharing: better photos, a fuller bio.' },
  timing: { label: 'Timing, not the profile', action: 'Do not learn from this. Pause and re-offer later.' },
  vague: { label: 'Vague', action: 'Ask for a reason with one-tap chips in the next email.' },
};

const CODE_RULES = [
  { code: 'SMOKING', field: 'smoke', re: /(smok|cigarette|cigar|vape|vaping)/i },
  { code: 'KIDS', field: 'kids', re: /(\bkids\b|children|child-free|childfree|child free)/i },
  { code: 'RELIGION', field: 'religion', re: /(religion|community|same faith|different faith|inter-?faith|\b(hindu|muslim|christian|sikh|jain|buddhist)\b)/i },
  { code: 'DIET', field: 'diet', re: /(vegetarian|\bveg\b|non-veg|eats meat|\bmeat\b|eggetarian)/i },
  { code: 'MARITAL', field: 'marital', re: /(divorc|widow|second marriage|previously married|never married)/i },
  { code: 'AGE', field: 'age', re: /(too old|too young|old for me|young for me|older than|younger than|age gap|\bage\b|\b(2\d|3\d|4\d) is\b|way older|slightly older|bit older)/i },
  { code: 'HEIGHT', field: 'height', re: /(height|too short|taller|shorter|short for me|\btall\b)/i },
  { code: 'LOCATION', field: 'city', re: /(relocat|long[ -]distance|different city|same city|someone (in|from) (mumbai|bengaluru|bangalore|delhi|hyderabad|pune|chennai|kolkata|ahmedabad|my city))/i },
  { code: 'EDUCATION', field: 'edu', re: /(postgrad|post-graduate|postgraduate|master'?s|\bmba\b|\bphd\b|education|degree)/i },
  { code: 'LANGUAGE', field: 'tongue', re: /(language|mother tongue|speaker\b|\b(telugu|tamil|hindi|marathi|kannada|bengali|gujarati|malayalam|punjabi) (speaker|family|speaking)\b)/i },
  { code: 'DRINKING', field: 'drink', re: /(\bdrinks?\b|alcohol|party person|partying|teetotal)/i },
  { code: 'PROFESSION', field: 'note:industry', re: /(finance|banker|banking|consulting|consultant|doctor|medicine|lawyer|\blaw\b|24x7|the hours)/i },
  { code: 'ABROAD', field: 'note:abroad', re: /(\bnri\b|abroad|overseas|outside india|stay in india|settled in (dubai|london|singapore|new york))/i },
  { code: 'FAMILY_SETUP', field: 'note:family', re: /(joint family|in-laws|lives with (his|her) parents)/i },
  { code: 'PHOTOS', bucket: 'presentation', re: /(photos? (are|is|were) (very |a bit |too )?(blurry|unclear|old|dark|grainy)|only one photo|more (pics|photos|pictures)|blurry)/i },
  { code: 'BIO', bucket: 'presentation', re: /(bio (is|was) (very |too )?(empty|thin|generic|short)|profile is (very )?thin|barely any info)/i },
  { code: 'TIMING', bucket: 'timing', re: /(talking to someone|seeing someone|\bpause\b|travell?ing|not ready|hold off|exams|after diwali|next month)/i },
  { code: 'ATTRACTION', bucket: 'taste', re: /(not my type|no spark|attract|chemistry|looks-wise|not drawn)/i },
  { code: 'PERSONALITY', bucket: 'taste', re: /(arrogant|too serious|introvert|boring|ambitious|too intense|flashy|immature)/i },
];
const VAGUE_RE = /^\s*(no|nope|pass|not for me|not feeling it|not interested|hmm+,? no|nah|no thanks|not this one)[.!\s]*$/i;

function industryFromText(t) {
  if (/(finance|banker|banking)/i.test(t)) return 'Finance';
  if (/(doctor|medicine)/i.test(t)) return 'Medicine';
  if (/(consult)/i.test(t)) return 'Consulting';
  if (/(lawyer|\blaw\b)/i.test(t)) return 'Law';
  return null;
}

export function parseFeedback(text, client, cand = null, policy = DEFAULT_POLICY) {
  const t = (text || '').trim();
  const reasons = [];
  for (const r of CODE_RULES) {
    const m = t.match(r.re);
    if (m) reasons.push({ code: r.code, field: r.field, bucket: r.bucket, evidence: m[0] });
  }
  if (!reasons.length) {
    return { reasons: [{ code: 'VAGUE', evidence: t }], primary: 'VAGUE', bucket: 'vague', covered: false, why: VAGUE_RE.test(t) ? 'No reason given' : 'No recognisable reason', suggestion: null };
  }
  const p = (client && client.prefs) || {};
  const db = new Set((client && client.dealbreakers) || []);
  const rules = client ? extractNoteRules(client.notes) : [];
  const issues = client && cand ? checkPrefs(client, cand, { ...policy, useNoteRules: true }) : null;

  // Preference reasons first: they are the actionable ones.
  const prefReasons = reasons.filter((r) => r.field);
  for (const r of prefReasons) {
    if (!r.field.startsWith('note:')) {
      const covered = p[r.field] != null || db.has(r.field);
      if (covered) {
        const violated = issues ? issues.some((i) => i.field === r.field) : true;
        if (violated) {
          return { reasons, primary: r.code, bucket: 'avoidable', covered: true, why: `${FIELD_LABELS[r.field]} is in the stated preferences${db.has(r.field) ? ' (deal-breaker)' : ''}`, suggestion: null };
        }
        return { reasons, primary: r.code, bucket: 'new_pref', covered: true, why: `${FIELD_LABELS[r.field]} is stated, but this profile met it: the preference may have shifted`, suggestion: tightenSuggestion(r.field, client, cand) };
      }
      return { reasons, primary: r.code, bucket: 'new_pref', covered: false, why: `${FIELD_LABELS[r.field]} is not in the stated preferences`, suggestion: addSuggestion(r.field, client, cand) };
    }
    const kind = r.field.slice(5);
    const ind = (cand && cand.industry) || industryFromText(t);
    const rule = rules.find((x) => (kind === 'industry' && x.type === 'industry_not' && x.values.includes(ind)) || (kind === 'abroad' && x.type === 'india_only') || (kind === 'family' && x.type === 'nuclear_only'));
    if (rule) {
      return { reasons, primary: r.code, bucket: 'avoidable', covered: true, why: `Mentioned in the call notes: "${rule.source}"`, suggestion: null };
    }
    const sug = kind === 'industry' ? `Avoid ${ind || 'this industry'} (soft)` : kind === 'abroad' ? 'Prefer partners based in India (soft)' : 'Prefer nuclear-family set-ups (soft)';
    return { reasons, primary: r.code, bucket: 'new_pref', covered: false, why: 'Not in the stated preferences or call notes', suggestion: sug };
  }
  const order = ['presentation', 'timing', 'taste'];
  const first = order.map((b) => reasons.find((r) => r.bucket === b)).find(Boolean) || reasons[0];
  const WHY = {
    presentation: 'About how the profile is presented, not who the person is',
    timing: "About the client's situation right now, not this profile",
    taste: 'An attraction or personality impression, not a stated preference',
    vague: 'No usable reason given',
  };
  const bucket = first.bucket || 'vague';
  return { reasons, primary: first.code, bucket, covered: false, why: WHY[bucket], suggestion: null };
}

function addSuggestion(field, client, cand) {
  if (field === 'height' && cand) return client.seeking === 'M' ? `Add height preference: ${cand.height + 4} cm+ (soft)` : `Add height preference: up to ${cand.height - 4} cm (soft)`;
  if (field === 'city' && client) return `Prefer partners in ${client.city} (soft)`;
  if (field === 'age' && cand) return `Add an age range that excludes ${cand.age} (soft)`;
  if (field === 'drink') return 'Prefer non-drinkers or social drinkers (soft)';
  return `Add a ${FIELD_LABELS[field].toLowerCase()} preference (soft)`;
}

function tightenSuggestion(field, client, cand) {
  if (field === 'age' && cand && client.prefs.age) {
    const [lo, hi] = client.prefs.age;
    return cand.age > (lo + hi) / 2 ? `Narrow age range to ${lo}–${cand.age - 1} (soft)` : `Narrow age range to ${cand.age + 1}–${hi} (soft)`;
  }
  return `Review the ${FIELD_LABELS[field].toLowerCase()} preference with the client`;
}

// ---------------------------------------------------------------------------
// Backtest: run the last 30 days of shares through the rules and project the impact.
// ---------------------------------------------------------------------------
export function indexProfiles(profiles) {
  const m = new Map();
  for (const p of profiles) m.set(p.id, p);
  return m;
}

function similar(a, b) {
  return Math.abs(a.age - b.age) <= 2 && Math.abs(a.height - b.height) <= 4 && a.religion === b.religion &&
    a.city === b.city && a.diet === b.diet && a.smoke === b.smoke && a.industry === b.industry;
}

export function backtest(data, policy = DEFAULT_POLICY) {
  const byId = indexProfiles(data.profiles);
  const rows = data.shares.map((s) => {
    const c = byId.get(s.client); const p = byId.get(s.cand);
    return { s, c, p, ev: evaluatePair(c, p, policy) };
  });
  const isAcc = (r) => r.s.outcome === 'accepted';
  const isContact = (r) => r.s.stage >= 2;
  const isMeet = (r) => r.s.stage >= 5;
  const count = (arr, f) => arr.reduce((n, r) => n + (f(r) ? 1 : 0), 0);

  const S = rows.length; const A = count(rows, isAcc); const K = count(rows, isContact); const M = count(rows, isMeet);
  const blocked = rows.filter((r) => r.ev.verdict === 'blocked');
  const review = rows.filter((r) => r.ev.verdict === 'review');
  const clear = rows.filter((r) => r.ev.verdict === 'clear');
  const clientHard = blocked.filter((r) => r.ev.issues.some((i) => i.side === 'client' && i.sev === 'hard'));
  const twoWayOnly = blocked.filter((r) => !r.ev.issues.some((i) => i.side === 'client' && i.sev === 'hard'));

  const aC = count(clear, isAcc) / Math.max(1, clear.length);
  const kC = count(clear, isContact) / Math.max(1, count(clear, isAcc));
  const mK = M / Math.max(1, K);
  const project = (removed) => {
    const n = removed.length;
    const acc = A - count(removed, isAcc) + n * aC;
    const con = K - count(removed, isContact) + n * aC * kC;
    return { acceptRate: acc / S, contactsPer100: (con / S) * 100, meetings: con * mK };
  };

  const avoidable = rows.filter((r) => r.s.label && r.s.label.bucket === 'avoidable');
  const avBlocked = count(avoidable, (r) => r.ev.verdict === 'blocked');
  const avReview = count(avoidable, (r) => r.ev.verdict === 'review');

  const mms = [...new Set(rows.map((r) => r.s.mm))].sort();
  const perMatchmaker = mms.map((mm) => {
    const rs = rows.filter((r) => r.s.mm === mm);
    const b = rs.filter((r) => r.ev.verdict === 'blocked');
    const acc = count(rs, isAcc); const con = count(rs, isContact);
    const accP = acc - count(b, isAcc) + b.length * aC;
    const conP = con - count(b, isContact) + b.length * aC * kC;
    return {
      mm, shares: rs.length, acceptRate: acc / rs.length,
      avoidableShare: count(rs, (r) => r.s.label && r.s.label.bucket === 'avoidable') / rs.length,
      blockedShare: b.length / rs.length,
      projectedAcceptRate: accP / rs.length,
      contactsPer100: (con / rs.length) * 100, projectedContactsPer100: (conP / rs.length) * 100,
    };
  });

  // Calibration: how often do clients accept a profile that breaks each rule?
  const calibration = RULE_KEYS.map((key) => {
    const hit = rows.filter((r) => r.ev.issues.some((i) => i.side === 'client' && i.key === key));
    const n = hit.length; const acc = count(hit, isAcc);
    const rate = n ? acc / n : null;
    const recommended = n < 10 ? 'needs data' : rate < 0.05 ? 'hard' : 'soft';
    return { key, label: RULE_LABELS[key], n, accepted: acc, rate, recommended, setting: policy.severity[key] };
  });

  // Inconsistent rejections: rejected, then a near-identical profile accepted later by the same client.
  const byClient = new Map();
  for (const r of rows) { if (!byClient.has(r.s.client)) byClient.set(r.s.client, []); byClient.get(r.s.client).push(r); }
  const flips = [];
  for (const list of byClient.values()) {
    for (const a of list.filter(isAcc)) {
      const prior = list.find((r) => !isAcc(r) && r.s.date < a.s.date && similar(r.p, a.p));
      if (prior) flips.push({ rejected: prior, accepted: a });
    }
  }
  const flipBuckets = {};
  for (const f of flips) { const b = f.rejected.s.label ? f.rejected.s.label.bucket : 'vague'; flipBuckets[b] = (flipBuckets[b] || 0) + 1; }

  return {
    totals: { shares: S, accepted: A, contacts: K, meetings: M, acceptRate: A / S, contactsPer100: (K / S) * 100 },
    blocked: {
      n: blocked.length,
      rejectedOrNoMutual: count(blocked, (r) => !isAcc(r) || !isContact(r)),
      clientHard: { n: clientHard.length, accepted: count(clientHard, isAcc) },
      twoWay: { n: twoWayOnly.length, accepted: count(twoWayOnly, isAcc), acceptedThenStalled: count(twoWayOnly, (r) => isAcc(r) && !isContact(r)) },
    },
    review: { n: review.length, accepted: count(review, isAcc) },
    clear: { n: clear.length, acceptRate: aC, contactGivenAccept: kC },
    avoidable: { n: avoidable.length, blocked: avBlocked, review: avReview, missed: avoidable.length - avBlocked - avReview },
    projection: { blockHard: project(blocked), blockHardAndReview: project([...blocked, ...review]) },
    perMatchmaker,
    calibration,
    flips: { n: flips.length, buckets: flipBuckets, examples: flips.slice(0, 3) },
  };
}

// Parser vs labels, for the evaluation line in the feedback tab.
export function parserAgreement(data) {
  const byId = indexProfiles(data.profiles);
  let n = 0; let agree = 0;
  const counts = {};
  for (const s of data.shares) {
    if (s.outcome !== 'rejected') continue;
    const out = parseFeedback(s.feedback, byId.get(s.client), byId.get(s.cand));
    n += 1; if (s.label && out.bucket === s.label.bucket) agree += 1;
    counts[out.bucket] = (counts[out.bucket] || 0) + 1;
  }
  return { n, agree, rate: agree / Math.max(1, n), counts };
}
