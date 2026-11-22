// LLM path for rejection feedback: the production replacement for the offline keyword parser.
// Same output shape as parseFeedback(), produced by Claude through a forced tool call (structured JSON).
import { prefRows, profileText } from './engine.js';

export const LLM_CODES = [
  'SMOKING', 'KIDS', 'RELIGION', 'DIET', 'MARITAL', 'AGE', 'HEIGHT', 'LOCATION', 'EDUCATION', 'LANGUAGE', 'DRINKING',
  'PROFESSION', 'ABROAD', 'FAMILY_SETUP', 'PHOTOS', 'BIO', 'TIMING', 'ATTRACTION', 'PERSONALITY', 'VAGUE',
];
export const LLM_BUCKETS = ['avoidable', 'new_pref', 'taste', 'presentation', 'timing', 'vague'];
export const LLM_DEFAULT_MODEL = 'claude-haiku-5-5';

export const LLM_SYSTEM = [
  'You read a matchmaking client\'s reply to a profile their matchmaker shared, and turn it into structured data.',
  'List every distinct reason in the reply, each with one code and the exact words that show it. Never invent a reason the reply does not contain.',
  'Choose one bucket:',
  '- avoidable: the reason is a preference the client had ALREADY given (stated preference, deal-breaker or call notes) and the profile breaks it.',
  '- new_pref: a concrete preference the client has not stated yet, or a stated one that seems to have shifted.',
  '- presentation: the profile itself is weak (photos, bio).',
  '- timing: about the client\'s situation, not the profile (busy, travelling, seeing someone).',
  '- taste: attraction or personality impressions.',
  '- vague: no usable reason.',
  'If several apply, pick the most actionable in this order: avoidable, new_pref, presentation, timing, taste, vague.',
  'suggested_preference: only for new_pref, written as a soft preference a matchmaker can confirm with the client; otherwise an empty string.',
].join('\n');

export const LLM_TOOL = {
  name: 'record_rejection',
  description: 'Record the structured reasons behind one rejected profile.',
  input_schema: {
    type: 'object',
    properties: {
      reasons: {
        type: 'array',
        items: {
          type: 'object',
          properties: { code: { type: 'string', enum: LLM_CODES }, evidence: { type: 'string', description: 'Exact words from the reply' } },
          required: ['code', 'evidence'],
        },
      },
      primary_code: { type: 'string', enum: LLM_CODES },
      bucket: { type: 'string', enum: LLM_BUCKETS },
      covered_by_stated_preference: { type: 'boolean' },
      why: { type: 'string', description: 'One short sentence explaining the bucket' },
      suggested_preference: { type: 'string', description: 'Soft preference to propose, or an empty string' },
      confidence: { type: 'number', description: '0 to 1' },
    },
    required: ['reasons', 'primary_code', 'bucket', 'covered_by_stated_preference', 'why', 'suggested_preference', 'confidence'],
  },
};

export function buildRequest({ text, client, cand, model = LLM_DEFAULT_MODEL }) {
  const prefs = prefRows(client).map((r) => `- ${r.label}: ${r.text}${r.dealbreaker ? ' (deal-breaker)' : ''}`).join('\n') || '- none stated';
  const user = [
    'CLIENT\'S STATED PREFERENCES', prefs,
    '', 'MATCHMAKER\'S CALL NOTES', client.notes || '(none)',
    '', 'PROFILE THAT WAS SHARED', cand ? profileText(cand) : '(not provided)',
    '', 'CLIENT\'S REPLY', `"""${text}"""`,
  ].join('\n');
  return {
    model,
    max_tokens: 600,
    temperature: 0,
    system: LLM_SYSTEM,
    tools: [LLM_TOOL],
    tool_choice: { type: 'tool', name: LLM_TOOL.name },
    messages: [{ role: 'user', content: user }],
  };
}

export function normaliseLlmOutput(o) {
  return {
    reasons: (o.reasons || []).map((r) => ({ code: r.code, evidence: r.evidence })),
    primary: o.primary_code,
    bucket: o.bucket,
    covered: Boolean(o.covered_by_stated_preference),
    why: o.why || '',
    suggestion: o.suggested_preference ? o.suggested_preference : null,
    confidence: o.confidence,
    source: 'claude',
  };
}

// browser=true adds the header Anthropic requires for calls made directly from a web page.
export async function classifyWithClaude({ apiKey, model = LLM_DEFAULT_MODEL, text, client, cand, browser = false, fetchImpl = fetch }) {
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  if (browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers, body: JSON.stringify(buildRequest({ text, client, cand, model })),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || `HTTP ${res.status}`);
  const block = (json.content || []).find((b) => b.type === 'tool_use');
  if (!block) throw new Error('The model returned no structured output.');
  return normaliseLlmOutput(block.input);
}
