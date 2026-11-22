import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluatePair, extractNoteRules, parseFeedback, backtest, DEFAULT_POLICY } from '../src/engine.js';

const base = (o = {}) => ({
  id: 'X', name: 'Test P.', gender: 'F', seeking: 'M', age: 30, height: 162, religion: 'Hindu', tongue: 'Telugu',
  city: 'Hyderabad', relocate: false, edu: 'Postgraduate', industry: 'Tech', profession: 'Product Manager',
  marital: 'Never married', diet: 'Non-veg', smoke: 'No', drink: 'Socially', kids: 'Yes', family: 'Nuclear',
  prefs: {}, dealbreakers: [], ...o,
});
const client = base({ id: 'C', prefs: { age: [29, 34], smoke: 'No', kids: 'Yes', religion: ['Hindu'] }, dealbreakers: ['kids'] });
const cand = (o) => base({ id: 'P', gender: 'M', seeking: 'F', age: 32, height: 176, ...o });

test('a clean profile is ready to send', () => {
  assert.equal(evaluatePair(client, cand()).verdict, 'clear');
});
test('breaking a stated deal-breaker blocks', () => {
  const r = evaluatePair(client, cand({ kids: 'No' }));
  assert.equal(r.verdict, 'blocked');
  assert.ok(r.issues.some((i) => i.field === 'kids' && i.dealbreaker));
});
test('age just outside the range warns; far outside blocks', () => {
  assert.equal(evaluatePair(client, cand({ age: 36 })).verdict, 'review');
  assert.equal(evaluatePair(client, cand({ age: 39 })).verdict, 'blocked');
});
test('an unknown value is never treated as OK', () => {
  const r = evaluatePair(client, cand({ smoke: null }));
  assert.equal(r.verdict, 'review');
  assert.ok(r.issues.some((i) => i.sev === 'unknown'));
});
test('two-way: the other person\'s preferences can block', () => {
  const r = evaluatePair(client, cand({ prefs: { age: [24, 27] } }));
  assert.equal(r.verdict, 'blocked');
  assert.ok(r.issues.some((i) => i.side === 'candidate'));
  assert.equal(evaluatePair(client, cand({ prefs: { age: [24, 27] } }), { ...DEFAULT_POLICY, twoWay: false }).verdict, 'clear');
});
test('call notes: explicit rules are read, vague ones are not', () => {
  assert.deepEqual(extractNoteRules('Would rather not marry a doctor; wants evenings together.').map((r) => r.values), [['Medicine']]);
  assert.equal(extractNoteRules('Wants a partner with a 9-to-5, not a 24x7 job.').length, 0);
});
test('feedback is sorted into the right bucket', () => {
  assert.equal(parseFeedback("He smokes. I'd clearly said no smokers.", client, cand({ smoke: 'Yes' })).bucket, 'avoidable');
  assert.equal(parseFeedback('Travelling this month, please hold off.', client).bucket, 'timing');
  assert.equal(parseFeedback('Not my type.', client).bucket, 'taste');
  assert.equal(parseFeedback('Pass.', client).bucket, 'vague');
  assert.equal(parseFeedback('Would like someone a bit taller.', client, cand()).bucket, 'new_pref');
});
test('mock data reproduces the brief and the backtest holds together', () => {
  const data = JSON.parse(readFileSync(new URL('../data/mock-data.json', import.meta.url)));
  const r = backtest(data);
  assert.equal(r.totals.shares, 1000);
  assert.equal(r.totals.accepted, 310);
  assert.equal(r.totals.contacts, 210);
  assert.equal(r.totals.meetings, 42);
  assert.equal(r.avoidable.n, 242);
  const cal = Object.fromEntries(r.calibration.map((c) => [c.key, c.recommended]));
  assert.equal(cal.smoke, 'hard');
  assert.equal(cal['age:near'], 'soft');
  assert.ok(r.projection.blockHard.meetings > r.totals.meetings);
});
