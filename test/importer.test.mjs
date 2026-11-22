import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, toCSV, importCSV, datasetToCSV, PROFILE_COLUMNS } from '../src/importer.js';
import { backtest, evaluatePair, parseFeedback, DEFAULT_POLICY } from '../src/engine.js';

const mock = JSON.parse(readFileSync(new URL('../data/mock-data.json', import.meta.url)));

test('CSV parser handles quotes, commas, newlines and a BOM', () => {
  const { header, records } = parseCSV('﻿id,Call Notes\r\nC1,"Likes ""chai"", reads a lot\nsecond line"\r\n\r\nC2,plain\n');
  assert.deepEqual(header, ['id', 'call_notes']);
  assert.equal(records.length, 2);
  assert.equal(records[0].call_notes, 'Likes "chai", reads a lot\nsecond line');
  assert.equal(records[1]._line, 3);
});

test('toCSV quotes what needs quoting and round-trips', () => {
  const csv = toCSV([['a'], ['b']], [{ a: 'x, y', b: 'say "hi"' }]);
  const { records } = parseCSV(csv);
  assert.equal(records[0].a, 'x, y');
  assert.equal(records[0].b, 'say "hi"');
});

test('demo data exported to CSV and imported back gives identical results', () => {
  const csv = datasetToCSV(mock);
  const { data, ok, issues, stats } = importCSV(csv.profiles, csv.shares, { parseFeedbackFn: parseFeedback });
  assert.equal(ok, true, JSON.stringify(issues.slice(0, 3)));
  assert.equal(issues.filter((i) => i.level === 'error').length, 0);
  assert.equal(stats.profiles, mock.profiles.length);
  assert.equal(stats.shares, 1000);
  const a = backtest(mock, DEFAULT_POLICY); const b = backtest(data, DEFAULT_POLICY);
  assert.deepEqual(b.totals, a.totals);
  assert.equal(b.blocked.n, a.blocked.n);
  assert.equal(b.avoidable.n, a.avoidable.n);
  assert.equal(b.projection.blockHard.meetings, a.projection.blockHard.meetings);
  const byA = new Map(mock.profiles.map((p) => [p.id, p])); const byB = new Map(data.profiles.map((p) => [p.id, p]));
  for (const s of mock.shares.slice(0, 300)) {
    assert.equal(evaluatePair(byB.get(s.client), byB.get(s.cand)).verdict, evaluatePair(byA.get(s.client), byA.get(s.cand)).verdict, s.id);
  }
});

test('bad rows are reported by file, line and column, not silently dropped', () => {
  const head = PROFILE_COLUMNS.map(([c]) => c).join(',');
  const row = (o) => PROFILE_COLUMNS.map(([c]) => o[c] ?? '').join(',');
  const profiles = [head,
    row({ id: 'C1', name: 'Asha', role: 'client', matchmaker: 'A', gender: 'F', seeking: 'M', age: 30, smokes: 'Never', pref_age_min: 29, pref_age_max: 34 }),
    row({ id: 'P1', name: 'Ravi', role: 'candidate', gender: 'M', seeking: 'F', age: 'thirty', diet: 'Vegan' }),
    row({ id: 'C1', name: 'Dup', role: 'client', gender: 'F', seeking: 'M', age: 31 }),
  ].join('\n');
  const shares = 'date,matchmaker,client_id,candidate_id,furthest_stage,feedback\n2026-11-01,A,C1,P9,rejected,no\n2026-11-02,A,C1,P1,met,ok\n';
  const { issues, ok, data } = importCSV(profiles, shares, { parseFeedbackFn: parseFeedback });
  const has = (file, line, column) => issues.some((i) => i.file === file && i.line === line && i.column === column);
  assert.equal(ok, false);
  assert.ok(has('profiles.csv', 3, 'age'));
  assert.ok(has('profiles.csv', 3, 'diet'));
  assert.ok(has('profiles.csv', 4, 'id'));
  assert.ok(has('shares.csv', 2, 'candidate_id'));
  assert.ok(has('shares.csv', 3, 'furthest_stage'));
  assert.equal(data.profiles.find((p) => p.id === 'C1').smoke, 'No');
});

test('shares are optional; profiles alone are enough for the pre-send check', () => {
  const csv = datasetToCSV(mock);
  const { ok, data, stats } = importCSV(csv.profiles, '');
  assert.equal(ok, true);
  assert.equal(stats.shares, 0);
  assert.ok(data.matchmakers.length >= 1);
});
