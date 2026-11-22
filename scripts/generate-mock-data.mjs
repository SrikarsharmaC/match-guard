// Generates mock data calibrated to the assessment brief:
//   1,000 profiles shared in 30 days -> 310 accepted -> 210 contacts -> 150 conversations
//   -> 75 meetings fixed -> 42 completed; 35% of the 690 rejections (242) cite a reason
//   already in the client's preferences; Matchmaker A accepts 44%, Matchmaker B 21%.
// Everything else (field mix, matchmakers C and D, feedback wording) is an illustrative assumption.
// Every planted category is verified against the engine, so the data and the rules agree.
//
// Usage: node scripts/generate-mock-data.mjs  ->  data/mock-data.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { evaluatePair, checkPrefs, DEFAULT_POLICY, extractNoteRules, ABROAD, EDU_LEVEL } from '../src/engine.js';

// ---------- seeded randomness ----------
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = mulberry32(20261122);
const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
const wpick = (pairs) => { const tot = pairs.reduce((s, x) => s + x[1], 0); let v = rng() * tot; for (const x of pairs) { v -= x[1]; if (v < 0) return x[0]; } return pairs[pairs.length - 1][0]; };
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const normal = (m, s) => { const u = Math.max(1e-9, rng()); const v = rng(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const uniq = (arr) => [...new Set(arr)];

// ---------- vocabularies ----------
const RELIGIONS = [['Hindu', 70], ['Muslim', 8], ['Christian', 7], ['Sikh', 6], ['Jain', 5], ['Buddhist', 2], ['No religion', 2]];
const TONGUES = [['Hindi', 24], ['Telugu', 13], ['Tamil', 11], ['Marathi', 10], ['Kannada', 8], ['Bengali', 8], ['Gujarati', 8], ['Malayalam', 7], ['Punjabi', 7], ['English', 4]];
const CITIES_IN = ['Mumbai', 'Bengaluru', 'Delhi NCR', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Ahmedabad'];
const CITIES = [['Mumbai', 20], ['Bengaluru', 20], ['Delhi NCR', 17], ['Hyderabad', 12], ['Pune', 9], ['Chennai', 8], ['Kolkata', 4], ['Ahmedabad', 3], ['Dubai', 3], ['London', 2], ['Singapore', 1], ['New York', 1]];
const INDUSTRIES = [['Tech', 30], ['Finance', 14], ['Consulting', 9], ['Medicine', 9], ['Law', 5], ['Business owner', 9], ['Design & media', 8], ['Academia', 5], ['Government', 4], ['Marketing', 7]];
const PROFS = {
  Tech: ['Software Engineer', 'Product Manager', 'Data Scientist'], Finance: ['Investment Banker', 'Chartered Accountant'],
  Consulting: ['Management Consultant'], Medicine: ['Doctor', 'Dentist'], Law: ['Lawyer'], 'Business owner': ['Founder', 'Runs family business'],
  'Design & media': ['Architect', 'Designer', 'Journalist'], Academia: ['Professor'], Government: ['Civil Servant'], Marketing: ['Brand Manager'],
};
const KEYWORD_PROF = { Finance: 'Investment Banker', Medicine: 'Doctor', Consulting: 'Management Consultant', Law: 'Lawyer' };
const NAMES = {
  F: ['Ananya', 'Priya', 'Kavya', 'Meera', 'Sneha', 'Aditi', 'Ishita', 'Riya', 'Nikita', 'Pooja', 'Shruti', 'Divya', 'Tanvi', 'Neha', 'Aishwarya', 'Radhika', 'Lavanya', 'Harini', 'Anjali', 'Nandini', 'Pallavi', 'Swathi', 'Keerthi', 'Bhavya', 'Tara', 'Maya', 'Ira', 'Shreya', 'Rhea', 'Diya', 'Kriti', 'Naina', 'Avni', 'Gauri', 'Ritika', 'Mansi', 'Esha', 'Sakshi', 'Vidya', 'Anushka'],
  M: ['Arjun', 'Rohan', 'Karthik', 'Vikram', 'Aditya', 'Rahul', 'Siddharth', 'Nikhil', 'Varun', 'Akash', 'Rohit', 'Pranav', 'Abhishek', 'Harsh', 'Kunal', 'Manish', 'Rajat', 'Sameer', 'Vivek', 'Sai', 'Teja', 'Naveen', 'Suresh', 'Aman', 'Dev', 'Kabir', 'Ishaan', 'Yash', 'Neel', 'Kartik', 'Rishi', 'Tarun', 'Vishal', 'Anirudh', 'Gaurav', 'Mohit', 'Ankit', 'Parth', 'Uday', 'Samar'],
  MuslimF: ['Ayesha', 'Zoya', 'Sana', 'Fatima', 'Alina', 'Mehreen'], MuslimM: ['Imran', 'Faisal', 'Arman', 'Rehan', 'Zaid', 'Ayaan'],
  SikhF: ['Simran', 'Jasleen', 'Mehak', 'Harleen', 'Navneet'], SikhM: ['Gurpreet', 'Harpreet', 'Jaskaran', 'Manveer', 'Arjan'],
  ChristianF: ['Sarah', 'Maria', 'Anita', 'Rebecca', 'Tanya'], ChristianM: ['Joseph', 'Thomas', 'Aaron', 'Daniel', 'Kevin'],
};
const INITIALS = 'ABCDGHIJKMNPRSTV';
function makeName(g, religion) {
  const pool = (['Muslim', 'Sikh', 'Christian'].includes(religion) && NAMES[religion + g]) || NAMES[g];
  return `${pick(pool)} ${pick(INITIALS.split(''))}.`;
}

const DIET_OK = { Veg: ['Veg'], VegEgg: ['Veg', 'Eggetarian'] };
const SMOKE_OK = { No: ['No'], Occasionally: ['No', 'Occasionally'] };
const DRINK_OK = { No: ['No'], Socially: ['No', 'Socially'] };
const KIDS_OK = { Yes: ['Yes', 'Open'], No: ['No', 'Open'] };
const POLICY = { ...DEFAULT_POLICY, useNoteRules: true, twoWay: true };

// ---------- people ----------
let pid = 1001;
function makePrefs(x) {
  const p = {};
  if (x.gender === 'F') p.age = [Math.max(24, x.age - ri(0, 2)), x.age + ri(4, 6)];
  else p.age = [Math.max(22, x.age - ri(5, 7)), x.age + ri(0, 1)];
  p.height = chance(0.75) ? (x.gender === 'F' ? [x.height + ri(5, 11), 200] : [140, x.height - ri(0, 4)]) : null;
  if (x.religion === 'No religion') p.religion = null;
  else p.religion = chance(0.62) ? [x.religion] : chance(0.3) ? uniq([x.religion, wpick(RELIGIONS.filter((r) => r[0] !== x.religion && r[0] !== 'No religion'))]) : null;
  p.tongue = chance(0.22) ? [x.tongue] : null;
  p.city = ABROAD.includes(x.city) ? (chance(0.5) ? [x.city] : null) : chance(0.33) ? [x.city] : chance(0.45) ? uniq([x.city, pick(CITIES_IN), pick(CITIES_IN)]) : null;
  p.edu = chance(0.38) ? 'Postgraduate' : null;
  p.marital = x.marital === 'Never married' && chance(0.72) ? ['Never married'] : null;
  p.diet = x.diet === 'Veg' ? (chance(0.72) ? 'Veg' : chance(0.5) ? 'VegEgg' : null) : x.diet === 'Eggetarian' && chance(0.3) ? 'VegEgg' : null;
  p.smoke = x.smoke === 'No' ? (chance(0.78) ? 'No' : chance(0.6) ? 'Occasionally' : null) : x.smoke === 'Occasionally' && chance(0.4) ? 'Occasionally' : null;
  p.drink = x.drink === 'No' ? (chance(0.5) ? 'No' : chance(0.6) ? 'Socially' : null) : x.drink === 'Socially' && chance(0.45) ? 'Socially' : null;
  p.kids = x.kids === 'Open' ? null : x.kids;
  return p;
}
function makeDealbreakers(x) {
  return ['smoke', 'kids', 'diet', 'religion', 'marital'].filter((f) => x.prefs[f] != null && chance(0.55));
}
function makePerson(g, o = {}) {
  const religion = o.religion || wpick(RELIGIONS);
  const industry = o.industry || wpick(INDUSTRIES);
  const x = {
    id: `P${pid++}`, name: makeName(g, religion), gender: g, seeking: g === 'F' ? 'M' : 'F',
    age: o.age ?? (g === 'F' ? ri(25, 36) : ri(27, 39)),
    height: o.height ?? Math.round(g === 'F' ? clamp(normal(161, 6), 147, 180) : clamp(normal(174, 6.5), 158, 194)),
    religion, tongue: o.tongue || wpick(TONGUES), city: o.city || wpick(CITIES), relocate: o.relocate ?? chance(0.35),
    edu: o.edu || wpick([['Graduate', 35], ['Postgraduate', 55], ['Doctorate', 10]]),
    industry, profession: pick(PROFS[industry]),
    marital: wpick([['Never married', 90], ['Divorced', 8], ['Widowed', 2]]),
    diet: religion === 'Jain' ? 'Veg' : wpick([['Veg', 28], ['Eggetarian', 10], ['Non-veg', 62]]),
    smoke: wpick([['No', 82], ['Occasionally', 12], ['Yes', 6]]),
    drink: wpick([['No', 38], ['Socially', 52], ['Regularly', 10]]),
    kids: wpick([['Yes', 72], ['Open', 20], ['No', 8]]),
    family: wpick([['Nuclear', 70], ['Joint', 30]]),
  };
  x.prefs = makePrefs(x);
  x.dealbreakers = makeDealbreakers(x);
  return x;
}

// Repair X's preferences so that C passes all of them (keeps two-way clean).
function repairToAccept(x, c) {
  const p = x.prefs;
  if (p.age && (c.age < p.age[0] || c.age > p.age[1])) p.age = [Math.min(p.age[0], c.age), Math.max(p.age[1], c.age)];
  if (p.height && (c.height < p.height[0] || c.height > p.height[1])) p.height = [Math.min(p.height[0], c.height), Math.max(p.height[1], c.height)];
  if (p.religion && !p.religion.includes(c.religion)) p.religion = null;
  if (p.tongue && !p.tongue.includes(c.tongue)) p.tongue = null;
  if (p.city && !p.city.includes(c.city) && !c.relocate) p.city = null;
  if (p.edu && EDU_LEVEL[c.edu] < EDU_LEVEL[p.edu]) p.edu = null;
  if (p.marital && !p.marital.includes(c.marital)) p.marital = null;
  if (p.diet && !DIET_OK[p.diet].includes(c.diet)) p.diet = null;
  if (p.smoke && !SMOKE_OK[p.smoke].includes(c.smoke)) p.smoke = null;
  if (p.drink && !DRINK_OK[p.drink].includes(c.drink)) p.drink = null;
  if (p.kids && !KIDS_OK[p.kids].includes(c.kids)) p.kids = null;
  x.dealbreakers = x.dealbreakers.filter((f) => p[f] != null);
}

// ---------- clients ----------
const FILLER = {
  F: ['Close to her parents; very family-oriented.', 'Loves trekking and her two dogs.', 'Looking for someone ambitious but grounded.', 'Reads a lot; weekend runner.', 'Values humour and kindness above all.', 'Wants someone who enjoys travel.'],
  M: ['Close to his parents; very family-oriented.', 'Plays cricket every Sunday.', 'Looking for someone independent and warm.', 'Foodie; cooks on weekends.', 'Values humour and kindness above all.', 'Wants someone who enjoys travel.'],
};
const NOTE_RULE_TEXT = {
  Finance: 'Not keen on someone in finance or banking; the hours are brutal.',
  Medicine: 'Would rather not marry a doctor; wants evenings together.',
  Consulting: 'Not keen on consulting; too much travel.',
  Law: 'Would rather not marry a lawyer.',
  india_only: 'Wants to stay in India; not open to NRIs.',
  nuclear_only: "Doesn't want to live in a joint family.",
  vague: 'Wants a partner with a 9-to-5, not a 24x7 job.',
};

const MATCHMAKERS = ['A', 'B', 'C', 'D'];
const clients = [];
const genders = shuffle([...Array(22).fill('F'), ...Array(18).fill('M')]);
const clientFirstNames = { F: shuffle([...NAMES.F]), M: shuffle([...NAMES.M]) };
let cidx = 0;
for (const mm of MATCHMAKERS) {
  for (let k = 0; k < 10; k++) {
    const g = genders[cidx];
    const c = makePerson(g, { city: pick(CITIES_IN) });
    c.id = `C${String(cidx + 1).padStart(2, '0')}`;
    if (!['Muslim', 'Sikh', 'Christian'].includes(c.religion)) c.name = `${clientFirstNames[g].pop()} ${pick(INITIALS.split(''))}.`;
    c.client = true; c.mm = mm;
    c.truthRules = [];
    const notes = [pick(FILLER[g])];
    // Note rules: explicit ones the extractor can read, plus a few vague ones it cannot.
    const slot = k % 10;
    if (slot === 0 || slot === 3 || slot === 6) { const ind = pick(['Finance', 'Medicine', 'Consulting', 'Law']); notes.push(NOTE_RULE_TEXT[ind]); c.truthRules.push({ type: 'industry_not', values: [ind] }); }
    if (slot === 1 || slot === 7) { notes.push(NOTE_RULE_TEXT.india_only); c.truthRules.push({ type: 'india_only' }); }
    if (slot === 2 || slot === 8) { notes.push(NOTE_RULE_TEXT.nuclear_only); c.truthRules.push({ type: 'nuclear_only' }); }
    if (slot === 9 && (mm === 'B' || mm === 'D')) { notes.push(NOTE_RULE_TEXT.vague); c.truthRules.push({ type: 'industry_not', values: ['Medicine', 'Finance'], vague: true }); }
    if (chance(0.5)) notes.push(pick(FILLER[g].filter((s) => !notes.includes(s))));
    c.notes = notes.join(' ');
    clients.push(c);
    cidx += 1;
  }
}

// Force preference coverage so every matchmaker has clients able to host every violation type.
const FORCE = {
  smoke: (c) => { c.smoke = 'No'; c.prefs.smoke = 'No'; },
  kids: (c) => { if (c.kids === 'Open') c.kids = 'Yes'; c.prefs.kids = c.kids; },
  religion: (c) => { if (c.religion === 'No religion') c.religion = 'Hindu'; c.prefs.religion = [c.religion]; },
  diet: (c) => { c.diet = 'Veg'; c.prefs.diet = 'Veg'; },
  marital: (c) => { c.marital = 'Never married'; c.prefs.marital = ['Never married']; },
  height: (c) => { c.prefs.height = c.gender === 'F' ? [c.height + 6, 200] : [140, c.height - 2]; },
  city: (c) => { c.prefs.city = [c.city]; },
  edu: (c) => { c.prefs.edu = 'Postgraduate'; if (c.edu === 'Graduate') c.edu = 'Postgraduate'; },
  tongue: (c) => { c.prefs.tongue = [c.tongue]; },
  drink: (c) => { if (c.drink === 'Regularly') c.drink = 'Socially'; c.prefs.drink = c.drink === 'No' ? 'No' : 'Socially'; },
};
for (const mm of MATCHMAKERS) {
  const mine = clients.filter((c) => c.mm === mm);
  for (const [field, fn] of Object.entries(FORCE)) {
    const have = mine.filter((c) => c.prefs[field] != null).length;
    const need = Math.max(0, 4 - have);
    shuffle(mine.filter((c) => c.prefs[field] == null)).slice(0, need).forEach(fn);
  }
  // Leave some clients with no city or height preference so "new preference" feedback is possible.
  const noCity = mine.filter((c) => c.prefs.city == null).length;
  if (noCity < 2) shuffle(mine.filter((c) => c.prefs.city != null)).slice(0, 2 - noCity).forEach((c) => { c.prefs.city = null; });
  const noHeight = mine.filter((c) => c.prefs.height == null).length;
  if (noHeight < 2) shuffle(mine.filter((c) => c.prefs.height != null)).slice(0, 2 - noHeight).forEach((c) => { c.prefs.height = null; });
}
// Unique, religion-appropriate client names (clients are the ones a matchmaker picks from a list).
const usedFirst = new Set();
for (const c of clients) {
  const pools = [NAMES[c.religion + c.gender], NAMES[c.gender]].filter(Boolean);
  let first = null;
  for (const pool of pools) { const free = pool.filter((nm) => !usedFirst.has(nm)); if (free.length) { first = pick(free); break; } }
  usedFirst.add(first);
  c.name = `${first} ${pick(INITIALS.split(''))}.`;
}
for (const c of clients) {
  c.dealbreakers = uniq([...c.dealbreakers.filter((f) => c.prefs[f] != null), ...(c.prefs.smoke === 'No' && chance(0.6) ? ['smoke'] : []), ...(c.prefs.kids && chance(0.6) ? ['kids'] : [])]);
}
// Sanity: the extractor reads every explicit rule and misses the vague ones.
for (const c of clients) {
  const got = extractNoteRules(c.notes);
  const explicit = c.truthRules.filter((r) => !r.vague);
  if (got.length !== explicit.length) throw new Error(`note extraction mismatch for ${c.id}: ${c.notes}`);
}

// ---------- candidates ----------
function truthClean(c, x) {
  for (const r of c.truthRules) {
    if (r.type === 'industry_not' && r.values.includes(x.industry)) return false;
    if (r.type === 'india_only' && ABROAD.includes(x.city)) return false;
    if (r.type === 'nuclear_only' && x.family === 'Joint') return false;
  }
  return true;
}
function applyTruth(c, x) {
  for (const r of c.truthRules) {
    if (r.type === 'industry_not' && r.values.includes(x.industry)) { x.industry = pick(['Tech', 'Design & media', 'Marketing', 'Business owner']); x.profession = pick(PROFS[x.industry]); }
    if (r.type === 'india_only' && ABROAD.includes(x.city)) x.city = pick(CITIES_IN);
    if (r.type === 'nuclear_only') x.family = 'Nuclear';
  }
}
function cleanFor(c) {
  const p = c.prefs;
  for (let t = 0; t < 400; t++) {
    const o = {};
    if (p.religion) o.religion = pick(p.religion);
    if (p.age) o.age = ri(p.age[0], p.age[1]);
    if (p.height) { const lo = Math.max(p.height[0], c.seeking === 'F' ? 150 : 162); const hi = Math.min(p.height[1], c.seeking === 'F' ? 176 : 190); if (lo <= hi) o.height = ri(lo, hi); }
    if (p.tongue) o.tongue = pick(p.tongue);
    if (p.city) { o.city = pick(p.city); }
    if (p.edu) o.edu = chance(0.85) ? 'Postgraduate' : 'Doctorate';
    const x = makePerson(c.seeking, o);
    if (p.marital && !p.marital.includes(x.marital)) x.marital = 'Never married';
    if (p.diet && !DIET_OK[p.diet].includes(x.diet)) x.diet = 'Veg';
    if (p.smoke && !SMOKE_OK[p.smoke].includes(x.smoke)) x.smoke = 'No';
    if (p.drink && !DRINK_OK[p.drink].includes(x.drink)) x.drink = p.drink === 'No' ? 'No' : 'Socially';
    if (p.kids && !KIDS_OK[p.kids].includes(x.kids)) x.kids = p.kids;
    applyTruth(c, x);
    x.prefs = makePrefs(x); x.dealbreakers = makeDealbreakers(x);
    repairToAccept(x, c);
    if (evaluatePair(c, x, POLICY).issues.length === 0 && truthClean(c, x)) return x;
  }
  throw new Error(`no clean candidate for ${c.id}`);
}

const CAN_VIOLATE = {
  smoke: (c) => c.prefs.smoke != null, kids: (c) => c.prefs.kids != null, religion: (c) => c.prefs.religion != null,
  diet: (c) => c.prefs.diet != null, marital: (c) => c.prefs.marital != null,
  'age:far': () => true, 'age:near': () => true,
  'height:far': (c) => c.prefs.height != null, 'height:near': (c) => c.prefs.height != null,
  city: (c) => c.prefs.city != null, edu: (c) => c.prefs.edu != null, tongue: (c) => c.prefs.tongue != null, drink: (c) => c.prefs.drink != null,
  'note:industry': (c) => c.truthRules.some((r) => r.type === 'industry_not' && !r.vague),
  'note:abroad': (c) => c.truthRules.some((r) => r.type === 'india_only') && c.prefs.city == null,
  'note:family': (c) => c.truthRules.some((r) => r.type === 'nuclear_only'),
  'note:vague': (c) => c.truthRules.some((r) => r.vague),
};

function mutate(c, x, kind) {
  const p = c.prefs;
  switch (kind) {
    case 'smoke': x.smoke = p.smoke === 'No' ? pick(['Occasionally', 'Occasionally', 'Yes']) : 'Yes'; break;
    case 'kids': x.kids = p.kids === 'Yes' ? 'No' : 'Yes'; break;
    case 'religion': x.religion = wpick(RELIGIONS.filter((r) => !p.religion.includes(r[0]) && r[0] !== 'No religion')); x.name = makeName(x.gender, x.religion); break;
    case 'diet': x.diet = p.diet === 'Veg' ? pick(['Non-veg', 'Non-veg', 'Eggetarian']) : 'Non-veg'; break;
    case 'marital': x.marital = pick(['Divorced', 'Divorced', 'Widowed']); break;
    case 'age:far': case 'age:near': {
      const d = kind === 'age:far' ? ri(3, 6) : ri(1, 2);
      x.age = chance(0.7) || p.age[0] - d < 23 ? p.age[1] + d : p.age[0] - d; break;
    }
    case 'height:far': case 'height:near': {
      const d = kind === 'height:far' ? ri(6, 11) : ri(1, 5);
      x.height = p.height[0] > 140 ? p.height[0] - d : p.height[1] + d; break;
    }
    case 'city': x.city = pick(CITIES_IN.filter((ct) => !p.city.includes(ct))); x.relocate = false; break;
    case 'edu': x.edu = 'Graduate'; break;
    case 'tongue': x.tongue = wpick(TONGUES.filter((t) => !p.tongue.includes(t[0]))); break;
    case 'drink': x.drink = p.drink === 'No' ? 'Socially' : 'Regularly'; break;
    case 'note:industry': case 'note:vague': {
      const r = c.truthRules.find((q) => q.type === 'industry_not' && (kind === 'note:vague' ? q.vague : !q.vague));
      x.industry = pick(r.values); x.profession = KEYWORD_PROF[x.industry]; break;
    }
    case 'note:abroad': x.city = pick(ABROAD); x.relocate = false; break;
    case 'note:family': x.family = 'Joint'; break;
    default: throw new Error(kind);
  }
  x.prefs = makePrefs(x); x.dealbreakers = makeDealbreakers(x);
  repairToAccept(x, c);
}

const EXPECT_KEY = { 'note:industry': 'note', 'note:abroad': 'note', 'note:family': 'note', 'note:vague': null };
function violatingFor(c, kind) {
  for (let t = 0; t < 200; t++) {
    const x = cleanFor(c);
    mutate(c, x, kind);
    const ev = evaluatePair(c, x, POLICY);
    const cs = ev.issues.filter((i) => i.side === 'client');
    const ks = ev.issues.filter((i) => i.side === 'candidate');
    const want = kind in EXPECT_KEY ? EXPECT_KEY[kind] : kind;
    const ok = ks.length === 0 && (want === null ? cs.length === 0 : cs.length === 1 && cs[0].key === want);
    if (ok) return x;
  }
  throw new Error(`cannot make ${kind} violation for ${c.id}`);
}

// Two-way break: the candidate's own stated preferences rule the client out (hard).
function twoWayFor(c) {
  for (let t = 0; t < 200; t++) {
    const x = cleanFor(c);
    const opts = ['age', 'age'];
    if (c.smoke !== 'No') opts.push('smoke', 'smoke');
    if (c.marital !== 'Never married') opts.push('marital', 'marital');
    if (c.diet !== 'Veg' && !c.prefs.diet) opts.push('diet');
    if (c.religion !== x.religion && x.religion !== 'No religion') opts.push('religion', 'religion');
    const f = pick(opts);
    if (f === 'age') {
      const d = ri(3, 6);
      const base = x.prefs.age || [x.age - 5, x.age + 3];
      x.prefs.age = c.age > x.age ? [Math.min(base[0], c.age - d - 4), c.age - d] : [c.age + d, Math.max(base[1], c.age + d + 4)];
    } else if (f === 'smoke') { x.prefs.smoke = 'No'; x.dealbreakers = uniq([...x.dealbreakers, 'smoke']); }
    else if (f === 'marital') { x.prefs.marital = ['Never married']; }
    else if (f === 'diet') { x.diet = 'Veg'; x.prefs.diet = 'Veg'; }
    else if (f === 'religion') { x.prefs.religion = [x.religion]; x.dealbreakers = uniq([...x.dealbreakers, 'religion']); }
    const ev = evaluatePair(c, x, POLICY);
    const cs = ev.issues.filter((i) => i.side === 'client');
    const kh = ev.issues.filter((i) => i.side === 'candidate' && i.sev === 'hard');
    if (cs.length === 0 && kh.length >= 1 && truthClean(c, x)) return x;
  }
  throw new Error(`cannot make two-way break for ${c.id}`);
}

// ---------- feedback wording ----------
const HE = (x) => (x.gender === 'M' ? 'He' : 'She');
const he = (x) => HE(x).toLowerCase();
const his = (x) => (x.gender === 'M' ? 'his' : 'her');
const him = (x) => (x.gender === 'M' ? 'him' : 'her');
const T = {
  smoke: [(x) => `${HE(x)} smokes. I'd clearly said no smokers.`, () => 'Saw a cigarette in one of the photos, that is a no for me.', () => 'Smoker, sorry. Deal breaker.', () => 'Not okay with smoking, I mentioned this on our first call.', (x) => `Profile says ${he(x)} smokes. Not for me.`],
  kids: [(x, c) => (c.kids === 'No' ? `${HE(x)} wants kids, I don't. Won't work.` : `${HE(x)} doesn't want kids, that's non-negotiable for me.`), () => 'We want different things on children.', (x, c) => (c.kids === 'No' ? `I'm child-free by choice and ${he(x)} clearly wants children.` : "Child-free isn't for me, I want a family.")],
  religion: [() => "Different religion, my family won't be okay with it.", () => "I'm looking within my community, as I said.", () => "Inter-faith won't work for us, sorry.", (x, c) => `${HE(x)} is ${x.religion}, I'd asked for ${c.prefs.religion.join(' or ')} only.`],
  diet: [() => "I'm strictly vegetarian and need a vegetarian partner.", (x) => `${HE(x)} eats meat, we're pure veg at home.`, () => 'Non-veg, not compatible with my family.'],
  marital: [(x) => (x.marital === 'Divorced' ? `${HE(x)}'s divorced, I'd said never married only.` : `${HE(x)} was married before, I'd asked for never married.`), () => 'Not open to someone previously married.', () => "Second marriage, not what I'm looking for."],
  'age:far': [(x, c) => (x.age > c.prefs.age[1] ? `${HE(x)}'s ${x.age}, way older than what I asked for.` : `${HE(x)}'s only ${x.age}, too young for me.`), (x, c) => (x.age > c.prefs.age[1] ? `Too old for me, I said up to ${c.prefs.age[1]}.` : 'Too young for me.'), () => 'Age gap is too big.'],
  'age:near': [(x, c) => (x.age > c.prefs.age[1] ? 'Slightly older than I wanted.' : 'A little young for me.'), (x, c) => (x.age > c.prefs.age[1] ? `${x.age} is a bit much, I'd asked up to ${c.prefs.age[1]}.` : 'Bit too young for me, I think.')],
  height: [(x, c) => (c.seeking === 'M' ? `Too short for me, I'd asked for ${c.prefs.height[0]} cm plus.` : `${HE(x)}'s taller than I'm comfortable with.`), () => 'Height is an issue.', (x, c) => (c.seeking === 'M' ? 'I wanted someone taller.' : 'I wanted someone shorter.')],
  city: [(x) => `Lives in ${x.city} and won't relocate. Long distance won't work.`, (x, c) => `I need someone in ${c.city}.`, (x) => `Different city, and ${he(x)} isn't open to moving.`],
  edu: [() => "I'd prefer someone with a postgraduate degree, as I mentioned.", () => "Education level doesn't match what I asked for."],
  tongue: [(x, c) => `Would really prefer a ${c.tongue} speaker, my parents don't speak much English.`, () => 'Language would be a barrier with my family.'],
  drink: [() => 'Drinks regularly, not my thing.', () => 'Too much of a party person for me.', () => "I don't drink and want someone who doesn't either."],
  'note:industry': [(x) => `${HE(x)}'s in ${x.industry.toLowerCase()}, I told you I'm not keen on that.`, (x) => `${x.profession}, the hours won't work for me. I'd mentioned this.`],
  'note:abroad': [(x) => `${HE(x)}'s settled in ${x.city}, I want to stay in India.`, () => 'NRI, not for me as I said.'],
  'note:family': [() => "Joint family set-up, I'd said I don't want that.", (x) => `${HE(x)} lives with ${his(x)} parents in a joint family, not for me.`],
  'note:vague': [(x) => `${HE(x)}'s a ${x.profession.toLowerCase()}, that's a 24x7 job. I'd mentioned this on the call.`],
  'new:industry': [(x) => `Not keen on someone in ${x.industry.toLowerCase()}, the hours are crazy.`, (x) => `I'd rather not marry a ${x.profession.toLowerCase()}.`],
  'new:family': [() => "Joint family isn't for me.", (x) => `${HE(x)} lives with ${his(x)} parents in a big joint family, not sure about that.`],
  'new:abroad': [(x) => `${HE(x)}'s settled in ${x.city}, I don't want to move abroad.`],
  'new:city': [(x, c) => `I'd really prefer someone in ${c.city}.`, () => "Long distance won't work for me."],
  'new:height': [(x, c) => (c.seeking === 'M' ? 'Would like someone a bit taller.' : 'Would prefer someone a bit shorter.'), () => 'Height matters to me more than I thought.'],
  attraction: [() => 'Not my type.', () => "Didn't feel any attraction from the photos.", () => 'No spark, sorry.', (x) => `Not drawn to ${his(x)} profile.`, () => 'Looks-wise not for me.'],
  personality: [() => 'Seems a bit arrogant from the bio.', () => 'Comes across as too serious.', () => "Feels very introverted, I'm quite outgoing.", () => 'Seems a bit flashy.', () => 'Not ambitious enough for me.'],
  photos: [() => 'Photos are blurry, can you get better ones?', () => "Only one photo and it's old.", () => 'Can you share more pics? Hard to decide.', () => "The photos are very dark, I can't tell."],
  bio: [(x) => `The bio is empty, I can't tell anything about ${him(x)}.`, () => 'Profile is very thin, barely any info.', () => 'Bio was too generic.'],
  timing: [() => "I'm talking to someone right now, can we pause for two weeks?", () => 'Travelling this month, please hold off.', () => 'Not ready this week, work is crazy.', () => 'Can we revisit after Diwali?', () => 'Busy with a work launch, send me profiles next month.'],
  vague: [() => 'No.', () => 'Not for me.', () => 'Not feeling it.', () => 'Pass.', () => 'Hmm, no.', () => 'Not interested.', () => 'Nope.', () => 'Not this one.'],
};
const say = (kind, x, c) => pick(T[kind.startsWith('height') ? 'height' : kind])(x, c);
const LABEL = {
  smoke: ['avoidable', 'SMOKING'], kids: ['avoidable', 'KIDS'], religion: ['avoidable', 'RELIGION'], diet: ['avoidable', 'DIET'], marital: ['avoidable', 'MARITAL'],
  'age:far': ['avoidable', 'AGE'], 'age:near': ['avoidable', 'AGE'], 'height:far': ['avoidable', 'HEIGHT'], 'height:near': ['avoidable', 'HEIGHT'],
  city: ['avoidable', 'LOCATION'], edu: ['avoidable', 'EDUCATION'], tongue: ['avoidable', 'LANGUAGE'], drink: ['avoidable', 'DRINKING'],
  'note:industry': ['avoidable', 'PROFESSION'], 'note:abroad': ['avoidable', 'ABROAD'], 'note:family': ['avoidable', 'FAMILY_SETUP'], 'note:vague': ['avoidable', 'PROFESSION'],
  'new:industry': ['new_pref', 'PROFESSION'], 'new:family': ['new_pref', 'FAMILY_SETUP'], 'new:abroad': ['new_pref', 'ABROAD'], 'new:city': ['new_pref', 'LOCATION'], 'new:height': ['new_pref', 'HEIGHT'],
  attraction: ['taste', 'ATTRACTION'], personality: ['taste', 'PERSONALITY'], photos: ['presentation', 'PHOTOS'], bio: ['presentation', 'BIO'], timing: ['timing', 'TIMING'], vague: ['vague', 'VAGUE'],
};

// ---------- the 30-day share log ----------
const PLAN = {
  A: { shares: 220, accepted: 97, avoidable: 25, softAcc: 8, hardAcc: 0, twoWayAcc: 14, twoWayRej: 15 },
  B: { shares: 300, accepted: 63, avoidable: 120, softAcc: 5, hardAcc: 0, twoWayAcc: 9, twoWayRej: 18 },
  C: { shares: 250, accepted: 80, avoidable: 50, softAcc: 6, hardAcc: 1, twoWayAcc: 12, twoWayRej: 19 },
  D: { shares: 230, accepted: 70, avoidable: 47, softAcc: 5, hardAcc: 1, twoWayAcc: 10, twoWayRej: 18 },
};
const expand = (spec) => Object.entries(spec).flatMap(([k, n]) => Array(n).fill(k));
const AVOIDABLE_KINDS = shuffle(expand({
  smoke: 32, kids: 24, religion: 28, diet: 22, marital: 14, 'age:far': 16, 'height:far': 10,
  'age:near': 14, 'height:near': 14, city: 19, edu: 10, tongue: 10, drink: 9,
  'note:industry': 6, 'note:abroad': 5, 'note:family': 4, 'note:vague': 5,
}));
const SOFT_ACC_KINDS = shuffle(expand({ 'age:near': 6, 'height:near': 6, city: 6, edu: 3, tongue: 2, drink: 1 }));
const HARD_ACC_KINDS = ['smoke', 'religion'];
const OTHER_KINDS = shuffle(expand({
  'new:industry': 30, 'new:family': 14, 'new:abroad': 10, 'new:city': 12, 'new:height': 12,
  attraction: 80, personality: 70, photos: 30, bio: 15, timing: 75, vague: 100,
}));
const CAN_OTHER = {
  'new:industry': (c) => !c.truthRules.some((r) => r.type === 'industry_not'),
  'new:family': (c) => !c.truthRules.some((r) => r.type === 'nuclear_only'),
  'new:abroad': (c) => c.prefs.city == null && !c.truthRules.some((r) => r.type === 'india_only'),
  'new:city': (c) => c.prefs.city == null,
  'new:height': (c) => c.prefs.height == null,
};

// Assign avoidable kinds to matchmakers, respecting which clients can host each kind.
const avoidableByMM = { A: [], B: [], C: [], D: [] };
const sortedKinds = [...AVOIDABLE_KINDS].sort((a, b) => (a === 'note:vague' ? -1 : b === 'note:vague' ? 1 : 0));
for (const kind of sortedKinds) {
  const feasible = MATCHMAKERS.filter((m) => avoidableByMM[m].length < PLAN[m].avoidable && clients.some((c) => c.mm === m && CAN_VIOLATE[kind](c)));
  if (!feasible.length) throw new Error(`no matchmaker can host ${kind}`);
  const m = wpick(feasible.map((mm) => [mm, PLAN[mm].avoidable - avoidableByMM[mm].length]));
  avoidableByMM[m].push(kind);
}

const shareCount = new Map(clients.map((c) => [c.id, 0]));
function chooseClient(mm, ok = () => true) {
  const mine = clients.filter((c) => c.mm === mm && ok(c));
  if (!mine.length) return null;
  mine.sort((a, b) => shareCount.get(a.id) - shareCount.get(b.id) || (rng() - 0.5));
  const c = mine[Math.floor(rng() * Math.min(3, mine.length))];
  shareCount.set(c.id, shareCount.get(c.id) + 1);
  return c;
}

const candidates = [];
const shares = [];
const DAY0 = Date.parse('2026-10-23');
const day = () => new Date(DAY0 + ri(0, 29) * 864e5).toISOString().slice(0, 10);
function addShare(mm, c, x, outcome, label, feedback) {
  candidates.push(x);
  shares.push({ id: '', date: day(), mm, client: c.id, cand: x.id, outcome, stage: outcome === 'accepted' ? 1 : 0, feedback: feedback || '', label: label ? { bucket: label[0], code: label[1] } : null, group: '' });
  return shares[shares.length - 1];
}

let otherPtr = 0;
for (const mm of MATCHMAKERS) {
  const plan = PLAN[mm];
  // accepted: soft violations, hard violations, two-way breaks, clean
  for (let i = 0; i < plan.softAcc; i++) { const kind = SOFT_ACC_KINDS.pop(); const c = chooseClient(mm, CAN_VIOLATE[kind]); addShare(mm, c, violatingFor(c, kind), 'accepted').group = 'A2'; }
  for (let i = 0; i < plan.hardAcc; i++) {
    const kind = HARD_ACC_KINDS.pop();
    let c = chooseClient(mm, (q) => CAN_VIOLATE[kind](q) && !q.dealbreakers.includes(kind));
    if (!c) { c = chooseClient(mm, CAN_VIOLATE[kind]); c.dealbreakers = c.dealbreakers.filter((f) => f !== kind); }
    addShare(mm, c, violatingFor(c, kind), 'accepted').group = 'A3';
  }
  for (let i = 0; i < plan.twoWayAcc; i++) { const c = chooseClient(mm); addShare(mm, c, twoWayFor(c), 'accepted').group = 'A4'; }
  const clean = plan.accepted - plan.softAcc - plan.hardAcc - plan.twoWayAcc;
  for (let i = 0; i < clean; i++) { const c = chooseClient(mm); addShare(mm, c, cleanFor(c), 'accepted').group = 'A1'; }
  // rejected: avoidable (stated preference broken)
  for (const kind of avoidableByMM[mm]) {
    const c = chooseClient(mm, CAN_VIOLATE[kind]);
    const x = violatingFor(c, kind);
    addShare(mm, c, x, 'rejected', LABEL[kind], say(kind, x, c)).group = kind.startsWith('note:') ? 'R2' : 'R1';
  }
  // rejected: other reasons, some with a two-way break underneath
  const others = plan.shares - plan.accepted - plan.avoidable;
  for (let i = 0; i < others; i++) {
    let kind = OTHER_KINDS[otherPtr];
    let c = chooseClient(mm, CAN_OTHER[kind] || (() => true));
    if (!c) { // swap with a later kind this matchmaker can host
      const j = OTHER_KINDS.findIndex((k, idx) => idx > otherPtr && !CAN_OTHER[k]);
      [OTHER_KINDS[otherPtr], OTHER_KINDS[j]] = [OTHER_KINDS[j], OTHER_KINDS[otherPtr]];
      kind = OTHER_KINDS[otherPtr];
      c = chooseClient(mm);
    }
    otherPtr += 1;
    const twoWay = i < plan.twoWayRej;
    const x = twoWay ? twoWayFor(c) : cleanFor(c);
    if (kind === 'new:industry') { x.industry = pick(['Finance', 'Medicine', 'Consulting', 'Law']); x.profession = KEYWORD_PROF[x.industry]; }
    if (kind === 'new:family') x.family = 'Joint';
    if (kind === 'new:abroad') { x.city = pick(ABROAD); x.relocate = false; }
    if (kind === 'new:city') { x.city = pick(CITIES_IN.filter((ct) => ct !== c.city)); x.relocate = false; }
    if (kind === 'new:height') { x.height = c.seeking === 'M' ? Math.min(x.height, c.height + 1) : Math.max(x.height, c.height); }
    if (!twoWay) repairToAccept(x, c);
    const ev = evaluatePair(c, x, POLICY);
    if (ev.issues.some((q) => q.side === 'client')) throw new Error(`other-reason share broke a client rule: ${kind} ${c.id}`);
    if (!twoWay && ev.issues.length) throw new Error(`clean other-reason share has issues: ${kind}`);
    if (twoWay && !ev.issues.some((q) => q.side === 'candidate' && q.sev === 'hard')) throw new Error('two-way break lost');
    addShare(mm, c, x, 'rejected', LABEL[kind], say(kind, x, c)).group = twoWay ? 'R3' : 'R4';
  }
}

// ---------- downstream stages to match 210 / 150 / 75 / 42 ----------
const acc = shares.filter((s) => s.outcome === 'accepted');
const byGroup = (g) => shuffle(acc.filter((s) => s.group === g));
const contactSet = [...byGroup('A4').slice(0, 5), ...byGroup('A1').slice(0, 187), ...byGroup('A2').slice(0, 17), ...byGroup('A3').slice(0, 1)];
for (const s of contactSet) s.stage = 2;
const conv = shuffle([...contactSet]).slice(0, 150); for (const s of conv) s.stage = 3;
const fixed = shuffle([...conv]).slice(0, 75); for (const s of fixed) s.stage = 4;
const done = shuffle([...fixed]).slice(0, 42); for (const s of done) s.stage = 5;

// ---------- plant "rejected, then accepted a near-identical profile" cases ----------
let planted = 0;
for (const a of shuffle(acc.filter((s) => s.group === 'A1'))) {
  if (planted >= 22) break;
  const prior = shares.find((r) => r.client === a.client && r.group === 'R4' && ['timing', 'vague', 'taste'].includes(r.label.bucket) && !r.usedForFlip);
  if (!prior) continue;
  const c = clients.find((q) => q.id === a.client);
  const src = candidates.find((q) => q.id === prior.cand);
  let made = null;
  for (const d of [[1, 2], [-1, -2], [0, 1], [0, 0]]) {
    const x = JSON.parse(JSON.stringify(src));
    x.id = `P${pid++}`; x.name = makeName(x.gender, x.religion); x.age += d[0]; x.height += d[1];
    x.profession = pick(PROFS[x.industry]);
    x.prefs = makePrefs(x); x.dealbreakers = makeDealbreakers(x); repairToAccept(x, c);
    if (evaluatePair(c, x, POLICY).issues.length === 0 && truthClean(c, x)) { made = x; break; }
  }
  if (!made) continue;
  candidates.push(made);
  a.cand = made.id;
  prior.usedForFlip = true;
  if (a.date <= prior.date) { const later = new Date(Date.parse(prior.date) + ri(4, 18) * 864e5); a.date = later > new Date('2026-11-21') ? '2026-11-21' : later.toISOString().slice(0, 10); if (a.date <= prior.date) { prior.date = new Date(Date.parse(a.date) - 3 * 864e5).toISOString().slice(0, 10); } }
  planted += 1;
}

// ---------- the rest of the pool: fresh profiles never shared ----------
const fresh = [];
for (let i = 0; i < 320; i++) {
  const x = makePerson(chance(0.5) ? 'F' : 'M');
  if (chance(0.08)) x.smoke = null; // unknowns: "not recorded" must never read as OK
  if (chance(0.05)) x.drink = null;
  fresh.push(x);
}

// ---------- finalise ----------
shares.sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client));
shares.forEach((s, i) => { s.id = `S${String(i + 1).padStart(4, '0')}`; delete s.usedForFlip; });
const strip = (x) => { const y = { ...x }; delete y.truthRules; return y; };
const used = new Set(shares.map((s) => s.cand));
const profiles = [...clients.map(strip), ...candidates.filter((x) => used.has(x.id)), ...fresh];

// ---------- verify against the brief ----------
const n = (f) => shares.filter(f).length;
const check = (name, got, want) => { if (got !== want) throw new Error(`${name}: got ${got}, want ${want}`); };
check('shares', shares.length, 1000);
check('accepted', n((s) => s.outcome === 'accepted'), 310);
check('contacts', n((s) => s.stage >= 2), 210);
check('conversations', n((s) => s.stage >= 3), 150);
check('meetings fixed', n((s) => s.stage >= 4), 75);
check('meetings completed', n((s) => s.stage >= 5), 42);
check('avoidable', n((s) => s.label && s.label.bucket === 'avoidable'), 242);
for (const mm of MATCHMAKERS) {
  check(`${mm} shares`, n((s) => s.mm === mm), PLAN[mm].shares);
  check(`${mm} accepted`, n((s) => s.mm === mm && s.outcome === 'accepted'), PLAN[mm].accepted);
}
const data = {
  meta: {
    title: 'Match Guard mock data',
    window: ['2026-10-23', '2026-11-21'],
    seed: 20261122,
    note: 'Synthetic. Calibrated to the brief: 1,000 shares, 310 accepted, 210 contacts, 150 conversations, 75 meetings fixed, 42 completed, 35% of rejections citing a stated preference, Matchmaker A 44% and B 21% acceptance. Matchmakers C and D, field mix and wording are assumptions.',
  },
  matchmakers: MATCHMAKERS.map((id) => ({ id, name: `Matchmaker ${id}` })),
  profiles,
  shares: shares.map(({ group, ...s }) => ({ ...s, group })),
};
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/mock-data.json', import.meta.url), JSON.stringify(data));
console.log(`Wrote ${profiles.length} profiles, ${shares.length} shares, ${planted} planted reject-then-accept pairs.`);
const mmRates = MATCHMAKERS.map((mm) => `${mm} ${(100 * n((s) => s.mm === mm && s.outcome === 'accepted') / PLAN[mm].shares).toFixed(1)}%`).join(', ');
console.log(`Acceptance by matchmaker: ${mmRates}`);
