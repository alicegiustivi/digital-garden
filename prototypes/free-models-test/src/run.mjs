// PROTOTYPE (issue 12), throwaway. Runs the owner's test Sources and photos through free OpenRouter models
// as the Archivist and the Researcher would, and saves every raw answer to out/results.json.
// The key is read from ~/.config/garden/openrouter-key and never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname) + '/..';
const KEY = fs.readFileSync(path.join(os.homedir(), '.config/garden/openrouter-key'), 'utf8').trim();
const API = 'https://openrouter.ai/api/v1';

const MODELS = [
  { id: 'google/gemma-4-31b-it:free', vision: true, json: true },
  { id: 'nvidia/nemotron-3.5-super-vl:free', vision: true, json: true },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', vision: false, json: false },
  { id: 'xingchen-agi/xing4.0-29b-a4b:free', vision: false, json: true },
  // The owner asked to try the free router too. It only routes to free models; the spend check below proves it.
  { id: 'openrouter/free', vision: true, json: true },
];

// The free-only gate: nothing else may ever be called.
function assertFree(id) {
  if (!(id.endsWith(':free') || id === 'openrouter/free')) throw new Error(`Refusing non-free model ${id}`);
}
MODELS.forEach(m => assertFree(m.id));

async function keyInfo() {
  const r = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${KEY}` } });
  const d = (await r.json()).data;
  return { usage: d.usage, freeUsed: d.free_model_daily_requests?.used, freeRemaining: d.free_model_daily_requests?.remaining };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;

async function chat(model, messages, { json }) {
  assertFree(model.id);
  const body = { model: model.id, messages, max_tokens: Number(process.env.MAXTOK || 6000), temperature: 0.3 };
  if (json && model.json) body.response_format = { type: 'json_object' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    calls++;
    const t0 = Date.now();
    try {
      const r = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Digital Garden prototype' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240_000),
      });
      const d = await r.json();
      const ms = Date.now() - t0;
      if (!r.ok || d.error) {
        const err = d.error?.message || `HTTP ${r.status}`;
        console.log(`  ${model.id} attempt ${attempt}: ${err.slice(0, 120)}`);
        if (attempt < 3 && (r.status === 429 || r.status >= 500 || /rate|overload|timeout|upstream/i.test(err))) { await sleep(Number(process.env.BACKOFF || 15_000) * attempt); continue; }
        return { ok: false, error: err, ms, attempts: attempt };
      }
      const answered = d.model || model.id;
      if (!answered.endsWith(':free') && model.id !== 'openrouter/free') throw new Error(`Answered by non-free model ${answered}`);
      return { ok: true, text: d.choices?.[0]?.message?.content ?? '', answeredBy: answered, ms, attempts: attempt, usage: d.usage };
    } catch (e) {
      if (/non-free/.test(e.message)) throw e;
      console.log(`  ${model.id} attempt ${attempt}: ${e.message}`);
      if (attempt < 3) { await sleep(10_000); continue; }
      return { ok: false, error: e.message, ms: Date.now() - t0, attempts: attempt };
    }
  }
}

function parseJson(text) {
  if (!text) return { parsed: null, how: 'empty' };
  try { return { parsed: JSON.parse(text), how: 'clean' }; } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return { parsed: JSON.parse(fenced[1]), how: 'fenced' }; } catch {}
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s >= 0 && e > s) try { return { parsed: JSON.parse(text.slice(s, e + 1)), how: 'dug out' }; } catch {}
  return { parsed: null, how: 'broken' };
}

const KINDS = ['related', 'supports', 'contradicts', 'builds on', 'inspired by', 'mentions', 'authored by'];

const sources = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, ...JSON.parse(fs.readFileSync(`${HERE}/text/${i + 1}.json`, 'utf8')) }));
const card = s => `#${s.n} [Source] ${s.title} — ${s.text.slice(0, 280).replace(/\s+/g, ' ')}…`;

const ARCHIVIST_SYSTEM = `You are the Archivist of a personal knowledge app called the Garden. The owner captured a Source (content from outside, Origin: Source). You do light organizing work only. You never write opinions or conclusions as the owner's. Write in English.
Reply with ONE JSON object and nothing else, with exactly these keys:
{
 "object_type": one of "Source","Concept","Thought","Person" (this is captured content, so normally "Source"),
 "title": short clean title,
 "facts": {"authors": [names], "date": "YYYY-MM-DD or null", "format": "article|study|report|news|essay|other", "publisher": string or null},
 "summary": an AI Note of at most 80 words saying what the Source argues or finds,
 "tags": 3-6 short lowercase labels,
 "concepts": 2-5 areas of ideas this Source feeds (broader than tags, e.g. "authenticity in luxury"),
 "connections": up to 4 suggestions to OTHER Objects in the Garden listed below, each {"to": number, "kind": one of ${KINDS.map(k => `"${k}"`).join(', ')}, "why": one sentence}. Only suggest a connection you can justify from the text; "contradicts" only for a real disagreement.
}`;

const RESEARCHER_SYSTEM = `You are the Researcher of a personal knowledge app called the Garden. The owner asked you to look across these Sources (Origin: Source, written by others, not by the owner). Work only from what is given. Never say "you think" or "you wrote". Write in English.
Reply with ONE JSON object and nothing else:
{
 "themes": 3-5 items {"theme": short name, "sources": [numbers], "note": one or two sentences},
 "contradictions": 0-4 items {"between": [two numbers], "claim_a": what one says, "claim_b": what the other says, "why_it_matters": one sentence}. Only real disagreements between claims; say none if there are none,
 "questions": 3 questions worth exploring further, each one sentence
}`;

const IMAGE_SYSTEM = `You are the Archivist of a personal knowledge app called the Garden. The owner captured this image as a Source. Write in English.
Reply with ONE JSON object and nothing else:
{"title": short title, "description": 2-3 sentences on what the image shows, "text_in_image": all readable text, transcribed exactly (empty string if none), "people_or_works": named people, artworks or styles you can identify with confidence, "tags": 3-6 lowercase labels}`;

const outFile = `${HERE}/out/results.json`;
fs.mkdirSync(`${HERE}/out`, { recursive: true });
const results = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { archivist: {}, researcher: {}, images: {} };
const save = () => fs.writeFileSync(outFile, JSON.stringify(results, null, 1));

async function record(bucket, key, model, messages) {
  results[bucket][key] ??= {};
  if (results[bucket][key][model.id]?.parsed) return; // resume: skip what already worked
  if (process.env.SKIP && results[bucket][key][model.id] && process.env.SKIP.split(',').includes(model.id)) return; // keep the router's first roll
  const r = await chat(model, messages, { json: true });
  if (r.ok) Object.assign(r, parseJson(r.text));
  results[bucket][key][model.id] = r;
  save();
  console.log(`${bucket} ${key} ${model.id}: ${r.ok ? `${r.how} json, ${Math.round(r.ms / 1000)}s, by ${r.answeredBy}` : 'FAILED ' + r.error.slice(0, 80)}`);
  const now = await keyInfo(); // stop at once if anything ever costs money
  if (now.usage !== before.usage) { console.log('STOP: account usage changed.'); process.exit(2); }
  await sleep(3500); // stay well under 20 requests a minute
}

let before;
before = await keyInfo();
console.log('before:', before);
if (before.usage !== 0) console.log('note: account usage is not 0 before the run; checking that it does not grow.');

for (const s of sources) {
  const others = sources.filter(o => o.n !== s.n).map(card).join('\n');
  const user = `OTHER OBJECTS IN THE GARDEN (index cards):\n${others}\n\nTHE NEW SOURCE #${s.n} (Origin: Source)\nURL: ${s.url}\nTitle on page: ${s.title}\n\n${s.text.slice(0, 40000)}`;
  for (const m of MODELS) await record('archivist', String(s.n), m, [{ role: 'system', content: ARCHIVIST_SYSTEM }, { role: 'user', content: user }]);
}

const digest = sources.map(s => `### Source #${s.n}: ${s.title}\n${s.text.slice(0, 7000)}`).join('\n\n');
for (const m of MODELS) await record('researcher', 'all', m, [{ role: 'system', content: RESEARCHER_SYSTEM }, { role: 'user', content: digest }]);

for (const f of fs.readdirSync(`${HERE}/photos`).sort()) {
  const b64 = fs.readFileSync(`${HERE}/photos/${f}`).toString('base64');
  for (const m of MODELS.filter(m => m.vision)) await record('images', f, m, [
    { role: 'system', content: IMAGE_SYSTEM },
    { role: 'user', content: [{ type: 'text', text: 'Describe this captured image.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] },
  ]);
}

const after = await keyInfo();
console.log('after:', after, 'calls this run:', calls);
results.meta = { ...results.meta, retry: { before, after, calls }, firstRun: results.meta?.firstRun ?? results.meta };
if (0) results.meta = { before, after, calls, models: MODELS.map(m => m.id), ranAt: new Date().toISOString() };
save();
if (after.usage !== before.usage) { console.log('WARNING: account usage changed — something cost money.'); process.exit(2); }
console.log('Spend check OK: account usage unchanged.');
