// Writes CSV templates (two example rows) and the full demo data as CSV into templates/.
// The same files the "Use your data" page downloads.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { datasetToCSV, toCSV, profileToRow, shareToRow, PROFILE_COLUMNS, SHARE_COLUMNS } from '../src/importer.js';

const data = JSON.parse(readFileSync(new URL('../data/mock-data.json', import.meta.url)));
const dir = new URL('../templates/', import.meta.url);
mkdirSync(dir, { recursive: true });
const client = data.profiles.find((p) => p.client);
const share = data.shares.find((s) => s.client === client.id);
const cand = data.profiles.find((p) => p.id === share.cand);
writeFileSync(new URL('profiles-template.csv', dir), toCSV(PROFILE_COLUMNS, [client, cand].map(profileToRow)));
writeFileSync(new URL('shares-template.csv', dir), toCSV(SHARE_COLUMNS, [shareToRow(share)]));
const all = datasetToCSV(data);
writeFileSync(new URL('demo-profiles.csv', dir), all.profiles);
writeFileSync(new URL('demo-shares.csv', dir), all.shares);
console.log('templates/ written: profiles-template.csv, shares-template.csv, demo-profiles.csv, demo-shares.csv');
