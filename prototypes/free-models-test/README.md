# PROTOTYPE: free AI models on real Garden content (issue 12)

Throwaway. Answers [issue 12](https://github.com/alicegiustivi/digital-garden/issues/12): are OpenRouter's free models good enough for the Archivist and the Researcher? Run on 2026-11-02 with the owner's own 8 articles (AI, creativity, fashion and marketing) and 3 photos (a printed quote, an art-history poster, an interior).

**Verdict (the owner's, judged blind):** `nvidia/nemotron-3.5-super-vl:free` for the Archivist, the Researcher and photos; `nvidia/nemotron-3-ultra-550b-a55b:free` as text fallback; then queue and retry. No `openrouter/free`, no Gemma, no Xing for now.

## What is here

- `src/extract.mjs`: Readability extraction of a saved page (how the Garden would read a link on the Mac).
- `src/frombrowser.py`: saves text read through a browser, for the 3 sites that serve bot checks to plain downloads.
- `src/run.mjs`: the test. A free-only gate (`:free` ids, plus `openrouter/free` at the owner's request), account usage checked after every call, resumable. One Archivist call per Source per model (type, facts, Tags, Concepts, AI Note summary, Connection Suggestions against index cards of the other Sources), one Researcher call over all 8, one photo call per vision model.
- `src/build.mjs`: builds `out/compare.html`, the blind side-by-side page with 1–5 scoring.
- `out/results.json`: every raw model answer, timing and which model answered. `out/run1.log`, `out/run2.log`: the two runs, including every refusal.

Not included: the article texts and the photos (other people's work and the owner's). To rerun, put Source JSON in `text/1..8.json`, JPEGs in `photos/`, the key in `~/.config/garden/openrouter-key`, then `npm i @mozilla/readability jsdom && node src/run.mjs && node src/build.mjs`.

## Findings

| Model | Answered | Clean JSON | Notes |
|---|---|---|---|
| Nemotron 3.5 Super VL | 12/12 | 12/12 | Long hidden reasoning: the Researcher answer was cut off at 6,000 tokens; fine at 16,000 |
| Nemotron 3 Ultra | 9/9 (text only) | 9/9 | First try every time |
| Xing 4.0 (ZDR host) | 5/9 | 5/9 | Its free pool refused the rest |
| `openrouter/free` | 12/12 replies | 10/12 | Picked 6 different models, including a coding model; 2 empty or broken |
| Gemma 4 31B | 0/12 | — | Google's shared free pool refused all ~30 tries (upstream 429) |

- Total cost $0 (account usage 0 before and after). 33 of 1,000 daily free requests used for ~120 calls: refused requests do not count.
- Typical time 10–30 s per call, fine for background work.
