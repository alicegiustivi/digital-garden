// PROTOTYPE (issue 12), throwaway. Turns out/results.json into one self-contained page, out/compare.html,
// where the owner judges the models blind (letters A–E) and copies their scores back.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname) + '/..';
const R = JSON.parse(fs.readFileSync(`${HERE}/out/results.json`, 'utf8'));
// Gemma never answered (Google's free pool refused all ~30 tries), so it is left off the page.
const models = (R.meta?.models ?? Object.keys(Object.values(R.archivist)[0] ?? {})).filter(m => !m.startsWith('google/gemma'));
// Fixed shuffle so letters stay stable between rebuilds.
const order = [3, 0, 4, 1, 2].filter(i => i < models.length);
const letters = Object.fromEntries(order.map((mi, k) => [models[mi], 'ABCDE'[k]]));
const sources = Array.from({ length: 8 }, (_, i) => {
  const d = JSON.parse(fs.readFileSync(`${HERE}/text/${i + 1}.json`, 'utf8'));
  return { n: i + 1, title: d.title, url: d.url };
});
const photos = fs.readdirSync(`${HERE}/photos`).sort().map(f => ({ f, src: `data:image/jpeg;base64,${fs.readFileSync(`${HERE}/photos/${f}`).toString('base64')}` }));

// Strip raw text from clean answers to keep the page light; keep it where parsing failed.
const slim = bucket => Object.fromEntries(Object.entries(bucket).map(([k, byModel]) => [k, Object.fromEntries(Object.entries(byModel).filter(([m]) => letters[m]).map(([m, r]) =>
  [letters[m], { ok: r.ok, how: r.how, s: Math.round((r.ms || 0) / 1000), by: r.answeredBy, error: r.error, parsed: r.parsed, raw: r.parsed ? undefined : (r.text || '').slice(0, 3000) }]))]));
const DATA = { letters, sources, photos, archivist: slim(R.archivist), researcher: slim(R.researcher), images: slim(R.images) };

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Free models, side by side</title>
<style>
:root{--bg:#f7f5f2;--card:#fff;--ink:#1d1d1f;--mute:#6e6e73;--line:#e6e2dc;--accent:#7a5cc9;--ok:#2f7d4f;--warn:#b26b00;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--card:#222;--ink:#f2f2f2;--mute:#a1a1a6;--line:#333;--accent:#b49cff;--ok:#6cc58f;--warn:#f0b35a;--bad:#ff8a80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
header{padding:28px 20px 8px;max-width:1400px;margin:auto}h1{font:600 28px/1.2 -apple-system,"SF Pro Display",system-ui;margin:0 0 6px}
header p{color:var(--mute);margin:0 0 14px;max-width:760px}
nav{display:flex;gap:6px;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);padding:10px 20px;z-index:2;max-width:1400px;margin:auto;border-bottom:1px solid var(--line)}
nav button,.pill{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:6px 14px;font:inherit;cursor:pointer}
nav button[aria-pressed=true],.pill[aria-pressed=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
main{max-width:1400px;margin:auto;padding:16px 20px 60px}
.row{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.card h3{margin:0 0 4px;font-size:20px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.meta{color:var(--mute);font-size:12.5px}.badge{font-size:12px;border-radius:999px;padding:2px 8px;border:1px solid currentColor;white-space:nowrap}
.clean{color:var(--ok)}.fenced,.dug{color:var(--warn)}.broken,.failed{color:var(--bad)}
h4{margin:12px 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
ul{margin:0;padding-left:18px}li{margin:2px 0}.chip{display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:1px 8px;margin:2px 4px 2px 0;font-size:13px}
.kind{font-weight:600;color:var(--accent)}pre{white-space:pre-wrap;font-size:12px;background:var(--bg);padding:8px;border-radius:8px;max-height:240px;overflow:auto}
.srchead{margin:0 0 12px}.srchead a{color:var(--accent)}img.photo{width:100%;max-height:420px;object-fit:contain;border-radius:12px;background:var(--card);border:1px solid var(--line)}
table{border-collapse:collapse;width:100%;background:var(--card);border-radius:16px;overflow:hidden}td,th{border-bottom:1px solid var(--line);padding:10px;text-align:left;vertical-align:top}
select{font:inherit;padding:4px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.who{display:none;color:var(--accent);font-size:12px;font-weight:500}.revealed .who{display:inline}
.help{color:var(--mute);font-size:13.5px;max-width:760px}
</style></head><body>
<header><h1>Free models, side by side</h1>
<p>The same 8 Sources and 3 photos went to each free model. (Gemma 4 31B is not here: Google's free pool refused all of its roughly 30 tries, so it never answered.) Models are hidden behind letters so their names don't sway you. Look through the tabs, then give each letter 1–5 under <b>Your scores</b>. The badge on each answer says whether its structured output came back clean (<span class="clean">clean</span>), needed fixing (<span class="fenced">fenced / dug out</span>) or was unusable (<span class="broken">broken / failed</span>).</p></header>
<nav id="tabs"></nav><main id="main"></main>
<script>
const D=${JSON.stringify(DATA)};
const L=Object.values(D.letters).sort(), NAME=Object.fromEntries(Object.entries(D.letters).map(([m,l])=>[l,m]));
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const st={tab:'sources',src:'1'};
function load(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
const scores=load('g12-scores',{}); if(load('g12-reveal',false))document.body.classList.add('revealed');
const srcTitle=n=>{const s=D.sources.find(s=>s.n==n);return s?'#'+n+' '+s.title:'#'+n};
function head(l,r){const how=r?(r.ok?(r.how||'broken'):'failed'):'missing';const cls=how.split(' ')[0];
 return '<h3><span>'+l+' <span class="who">'+esc(NAME[l])+'</span></span><span class="badge '+cls+'">'+how+'</span></h3><div class="meta">'+(r&&r.ok?r.s+'s'+(NAME[l]==='openrouter/free'?' · routed to '+esc(r.by):''):esc(r?.error||''))+'</div>'}
const list=a=>Array.isArray(a)&&a.length?a.map(x=>'<span class="chip">'+esc(typeof x==='object'?JSON.stringify(x):x)+'</span>').join(''):'<span class="meta">none</span>';
const raw=r=>r&&r.raw?'<h4>What came back</h4><pre>'+esc(r.raw)+'</pre>':'';
function archCard(l,r){const p=r?.parsed;if(!p)return '<div class="card">'+head(l,r)+raw(r)+'</div>';const f=p.facts||{};
 return '<div class="card">'+head(l,r)+'<h4>Title · type</h4>'+esc(p.title)+' · '+esc(p.object_type)
 +'<h4>Facts</h4><div class="meta">'+esc([(f.authors||[]).join(', '),f.date,f.format,f.publisher].filter(Boolean).join(' · '))+'</div>'
 +'<h4>Summary (AI Note)</h4>'+esc(p.summary)+'<h4>Tags</h4>'+list(p.tags)+'<h4>Concepts</h4>'+list(p.concepts)
 +'<h4>Suggested Connections</h4>'+(Array.isArray(p.connections)&&p.connections.length?'<ul>'+p.connections.map(c=>'<li><span class="kind">'+esc(c.kind)+'</span> '+esc(srcTitle(c.to))+'<br><span class="meta">'+esc(c.why)+'</span></li>').join('')+'</ul>':'<span class="meta">none</span>')+'</div>'}
function resCard(l,r){const p=r?.parsed;if(!p)return '<div class="card">'+head(l,r)+raw(r)+'</div>';
 return '<div class="card">'+head(l,r)+'<h4>Themes</h4><ul>'+(p.themes||[]).map(t=>'<li><b>'+esc(t.theme)+'</b> <span class="meta">('+esc((t.sources||[]).join(', '))+')</span><br>'+esc(t.note)+'</li>').join('')+'</ul>'
 +'<h4>Contradictions</h4>'+((p.contradictions||[]).length?'<ul>'+p.contradictions.map(c=>'<li><b>'+esc((c.between||[]).map(srcTitle).join(' vs '))+'</b><br>A: '+esc(c.claim_a)+'<br>B: '+esc(c.claim_b)+'<br><span class="meta">'+esc(c.why_it_matters)+'</span></li>').join('')+'</ul>':'<span class="meta">none found</span>')
 +'<h4>Questions</h4><ul>'+(p.questions||[]).map(q=>'<li>'+esc(q)+'</li>').join('')+'</ul></div>'}
function imgCard(l,r){const p=r?.parsed;if(!p)return '<div class="card">'+head(l,r)+raw(r)+'</div>';
 return '<div class="card">'+head(l,r)+'<h4>Title</h4>'+esc(p.title)+'<h4>Description</h4>'+esc(p.description)+'<h4>Text in image</h4><pre>'+esc(p.text_in_image||'—')+'</pre><h4>People or works</h4>'+list(p.people_or_works)+'<h4>Tags</h4>'+list(p.tags)+'</div>'}
const JOBS=[['summary','Summary of each Source'],['concepts','Tags and Concepts'],['connections','Suggested Connections'],['researcher','Themes, contradictions, questions'],['images','Photo descriptions (only letters that saw photos)'],['overall','Overall: would you trust it in your Garden?']];
function stats(){return L.map(l=>{let n=0,clean=0,fail=0,s=0;for(const b of ['archivist','researcher','images'])for(const k in D[b]){const r=D[b][k][l];if(!r)continue;n++;if(!r.ok||!r.parsed)fail++;else if(r.how==='clean')clean++;s+=r.s||0}
 return '<tr><th>'+l+' <span class="who">'+esc(NAME[l])+'</span></th><td>'+n+'</td><td>'+clean+'</td><td>'+(n-clean-fail)+'</td><td>'+fail+'</td><td>'+(n?Math.round(s/n):0)+'s</td></tr>'}).join('')}
const views={
 sources:()=>'<div class="row">'+D.sources.map(s=>'<button class="pill" aria-pressed="'+(st.src==s.n)+'" data-src="'+s.n+'">#'+s.n+'</button>').join('')+'</div>'
  +(s=>'<div class="srchead"><b>'+esc(srcTitle(s.n))+'</b> · <a href="'+esc(s.url)+'" target="_blank" rel="noopener">open the original</a></div>')(D.sources.find(s=>s.n==st.src))
  +'<div class="grid">'+L.map(l=>archCard(l,D.archivist[st.src]?.[l])).join('')+'</div>',
 researcher:()=>'<p class="help">Each model read all 8 Sources at once and was asked for themes, real contradictions between Sources, and questions worth exploring.</p><div class="grid">'+L.map(l=>resCard(l,D.researcher.all?.[l])).join('')+'</div>',
 photos:()=>D.photos.map(p=>'<div style="margin-bottom:28px"><div class="grid"><div><img class="photo" src="'+p.src+'" alt="'+esc(p.f)+'"></div>'+L.filter(l=>D.images[p.f]?.[l]).map(l=>imgCard(l,D.images[p.f][l])).join('')+'</div></div>').join(''),
 scores:()=>'<p class="help">1 = useless, 3 = fine with corrections, 5 = I would keep it as is. Leave a box empty if a letter didn\\'t do that job. Your scores stay in this browser.</p><table><tr><th>Job</th>'+L.map(l=>'<th>'+l+' <span class="who">'+esc(NAME[l])+'</span></th>').join('')+'</tr>'
  +JOBS.map(([k,t])=>'<tr><td>'+t+'</td>'+L.map(l=>'<td><select data-k="'+k+'" data-l="'+l+'"><option></option>'+[1,2,3,4,5].map(v=>'<option'+(scores[k+l]==v?' selected':'')+'>'+v+'</option>').join('')+'</select></td>').join('')+'</tr>').join('')+'</table>'
  +'<div class="row" style="margin-top:16px"><button class="pill" id="copy">Copy my scores</button><button class="pill" id="reveal">'+(document.body.classList.contains('revealed')?'Hide names':'Reveal model names')+'</button><span class="meta" id="msg"></span></div>'
  +'<h4>Reliability, counted automatically</h4><table><tr><th>Letter</th><th>Answers</th><th>Clean JSON</th><th>Needed fixing</th><th>Failed / unusable</th><th>Avg time</th></tr>'+stats()+'</table>'};
const TABS=[['sources','Sources (Archivist)'],['researcher','Researcher'],['photos','Photos'],['scores','Your scores']];
function render(){document.getElementById('tabs').innerHTML=TABS.map(([k,t])=>'<button aria-pressed="'+(st.tab===k)+'" data-tab="'+k+'">'+t+'</button>').join('');document.getElementById('main').innerHTML=views[st.tab]()}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.tab){st.tab=b.dataset.tab;render();scrollTo(0,0)}else if(b.dataset.src){st.src=b.dataset.src;render()}
 else if(b.id==='reveal'){const on=document.body.classList.toggle('revealed');store('g12-reveal',on);render()}
 else if(b.id==='copy'){const lines=JOBS.map(([k,t])=>t+': '+L.map(l=>l+'='+(scores[k+l]||'-')).join(' '));lines.push('Letters: '+L.map(l=>l+'='+NAME[l]).join(', '));
  const txt=lines.join('\\n');(navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject()).then(()=>document.getElementById('msg').textContent='Copied. Paste it into the chat.',()=>{document.getElementById('msg').innerHTML='<pre>'+esc(txt)+'</pre>'})}});
document.addEventListener('change',e=>{const s=e.target;if(s.dataset.k){scores[s.dataset.k+s.dataset.l]=s.value;store('g12-scores',scores)}});
render();
</script></body></html>`;
fs.writeFileSync(`${HERE}/out/compare.html`, html);
console.log('wrote out/compare.html', Math.round(html.length / 1024), 'KB; letters:', letters);
