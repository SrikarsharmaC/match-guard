// Runs the last 30 days of shares through Match Guard and prints the numbers quoted in the write-up.
// Usage: node scripts/backtest.mjs [--no-two-way] [--no-notes]
import { readFileSync } from 'node:fs';
import { backtest, parserAgreement, clonePolicy } from '../src/engine.js';

const data = JSON.parse(readFileSync(new URL('../data/mock-data.json', import.meta.url)));
const policy = clonePolicy();
if (process.argv.includes('--no-two-way')) policy.twoWay = false;
if (process.argv.includes('--no-notes')) policy.useNoteRules = false;

const r = backtest(data, policy);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const t = r.totals;
console.log(`Shares ${t.shares} | accepted ${t.accepted} (${pct(t.acceptRate)}) | contacts ${t.contacts} | meetings ${t.meetings}`);
console.log(`Blocked ${r.blocked.n}: rejected or no mutual consent ${r.blocked.rejectedOrNoMutual} (${pct(r.blocked.rejectedOrNoMutual / r.blocked.n)})`);
console.log(`  client-side hard ${r.blocked.clientHard.n} (accepted anyway ${r.blocked.clientHard.accepted})`);
console.log(`  two-way only ${r.blocked.twoWay.n} (client accepted ${r.blocked.twoWay.accepted}, then stalled before contact ${r.blocked.twoWay.acceptedThenStalled})`);
console.log(`Review ${r.review.n} (accepted ${r.review.accepted}) | Clear ${r.clear.n} (acceptance ${pct(r.clear.acceptRate)}, contact|accept ${pct(r.clear.contactGivenAccept)})`);
console.log(`Avoidable ${r.avoidable.n}: blocked ${r.avoidable.blocked}, flagged ${r.avoidable.review}, missed ${r.avoidable.missed}`);
for (const [name, p] of Object.entries(r.projection)) {
  console.log(`Projection ${name}: acceptance ${pct(p.acceptRate)}, contacts/100 ${p.contactsPer100.toFixed(1)}, meetings ${p.meetings.toFixed(1)}`);
}
console.log('Per matchmaker:');
for (const m of r.perMatchmaker) {
  console.log(`  ${m.mm}: shares ${m.shares}, accept ${pct(m.acceptRate)} -> ${pct(m.projectedAcceptRate)}, avoidable ${pct(m.avoidableShare)} of shares, blocked ${pct(m.blockedShare)}, contacts/100 ${m.contactsPer100.toFixed(1)} -> ${m.projectedContactsPer100.toFixed(1)}`);
}
console.log('Calibration (acceptance when the rule is broken):');
for (const c of r.calibration) {
  console.log(`  ${c.label.padEnd(40)} n=${String(c.n).padStart(3)} accepted=${String(c.accepted).padStart(2)} rate=${c.rate == null ? '  -  ' : pct(c.rate).padStart(6)} recommend=${c.recommended.padEnd(10)} setting=${c.setting}`);
}
console.log(`Reject-then-accept pairs: ${r.flips.n}`, r.flips.buckets);
const pa = parserAgreement(data);
console.log(`Feedback parser vs labels: ${pa.agree}/${pa.n} (${pct(pa.rate)})`, pa.counts);
