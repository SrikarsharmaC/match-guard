// Classifies labelled rejection replies with Claude (structured output via a forced tool call)
// and compares the result with the offline keyword rules and the mock labels.
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/llm-classify.mjs [--n 30] [--model claude-haiku-5-5]
//   node scripts/llm-classify.mjs --dry-run      # prints the exact request, no key needed
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFeedback, indexProfiles } from '../src/engine.js';
import { buildRequest, classifyWithClaude, LLM_DEFAULT_MODEL } from '../src/llm.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const n = Number(arg('--n', 30));
const model = arg('--model', LLM_DEFAULT_MODEL);
const key = process.env.ANTHROPIC_API_KEY;

const data = JSON.parse(readFileSync(new URL('../data/mock-data.json', import.meta.url)));
const byId = indexProfiles(data.profiles);
const rejected = data.shares.filter((s) => s.outcome === 'rejected');

// Stratified sample: a few of every label bucket, including the vague-notes cases the keyword rules miss.
const buckets = [...new Set(rejected.map((s) => s.label.bucket))];
const sample = [];
for (let i = 0; sample.length < n && i < rejected.length; i++) {
  for (const b of buckets) {
    const pool = rejected.filter((s) => s.label.bucket === b && !sample.includes(s));
    if (pool[i] && sample.length < n) sample.push(pool[i]);
  }
}

if (!key || process.argv.includes('--dry-run')) {
  const s = sample[0];
  console.log('Dry run (set ANTHROPIC_API_KEY to call Claude). Request for one reply:\n');
  console.log(JSON.stringify(buildRequest({ text: s.feedback, client: byId.get(s.client), cand: byId.get(s.cand), model }), null, 2));
  console.log('\nOffline rules on the same reply:', parseFeedback(s.feedback, byId.get(s.client), byId.get(s.cand)).bucket, '| label:', s.label.bucket);
  process.exit(0);
}

const rows = [];
for (const s of sample) {
  const client = byId.get(s.client); const cand = byId.get(s.cand);
  const offline = parseFeedback(s.feedback, client, cand);
  let llm;
  try { llm = await classifyWithClaude({ apiKey: key, model, text: s.feedback, client, cand }); } catch (e) { llm = { bucket: 'error', why: e.message }; }
  rows.push({ id: s.id, reply: s.feedback, label: s.label.bucket, offline: offline.bucket, claude: llm.bucket, claudeWhy: llm.why, suggestion: llm.suggestion || null });
  console.log(`${s.id}  label=${s.label.bucket.padEnd(12)} offline=${offline.bucket.padEnd(12)} claude=${String(llm.bucket).padEnd(12)} ${s.feedback}`);
}
const agree = (k) => rows.filter((r) => r[k] === r.label).length;
console.log(`\nAgreement with labels: offline ${agree('offline')}/${rows.length}, Claude ${agree('claude')}/${rows.length}`);
writeFileSync(new URL('../data/llm-results.json', import.meta.url), JSON.stringify({ model, rows }, null, 2));
console.log('Saved data/llm-results.json');
