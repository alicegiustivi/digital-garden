# Free retrieval for the AI Researcher

Research for issue #11 (part of map #1). Checked **2026-10-31** against OpenRouter's live model API and docs, and Cloudflare / Supabase docs.

> **Volatile facts.** OpenRouter's free model list changes month to month (every free embedding model below was added in 2026), and free-tier numbers move. Each fact carries its source; recheck before building. Items marked **(volatile)** are the most likely to change.

## Question

How can the right Objects reach a free model with a limited context window, at $0, for one person's Garden (thousands of Objects over years)? Compare free embeddings + vector search, plain full-text search, and sending the whole Garden (or a summary). Cover quality, limits, ease of building for agents, and reliable exclusion of private Objects. Recommend a v1 approach.

## Sizing assumption

A few thousand Objects after a few years, most short (a Thought or Concept is a few hundred tokens; a Source with notes maybe 1-2k). Roughly **1-5 million tokens of text in total** over years, and **~30 tokens per Object** for a compact "index card" (title + type + key topics, which the Archivist already extracts).

## The constraint that matters most: 50 free requests a day

| Fact | Source |
|---|---|
| Free model variants (`:free`): **20 requests/minute; 50 requests/day** if less than 10 credits ever purchased, 1,000/day after buying at least 10 credits | [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits) |

At $0 the whole app shares **50 requests per day** across the Archivist (automatic) and the Researcher (on demand). Any retrieval design that spends OpenRouter requests on retrieval itself (for example, embedding through OpenRouter) eats into that same budget. A Researcher question should cost **1-3 requests**, and retrieval should cost **zero**.

## Option A: free embeddings + vector search

### Embedding models

**On OpenRouter** (from the live list at [`/api/v1/embeddings/models`](https://openrouter.ai/api/v1/embeddings/models), 38 embedding models, 5 free) **(volatile)**:

| Model | Context | Notes |
|---|---|---|
| `nvidia/nemotron-3-embed-1b:free` | 32,768 | text, retrieval-oriented; added July 2026 |
| `nvidia/nemotron-3.5-embed-1b:free` / `-8b:free` | 32,768 | text + image, multilingual; added Oct 2026 |
| `nvidia/llama-nemotron-embed-vl-1b-v2:free` | 131,072 | text + image |
| `liquid/lfm-2.5-embedding-350m:free` | 512 | 1,024 dims; its listing says requests "may be retained and used to train" |

- The embeddings endpoint is `POST /embeddings` with `model` and `input`; `input` may be an **array of strings**, so many Objects can be embedded in one request ([OpenRouter embeddings API](https://openrouter.ai/docs/api-reference/embeddings)). The maximum batch size is not documented. **(uncertain)**
- Free variants fall under the same 50/day limit as above. Every newly captured Object and **every Researcher question** (the question must be embedded too) costs a request.
- Training/retention: OpenRouter has "separate settings for paid and free models" for allowing providers that may train on your data ([provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging)). Whether each free embedding endpoint trains is not stated per model, except the Liquid one above. **(uncertain)**
- Risk: free embedding models can disappear. If the model changes, **every stored vector must be regenerated** (vectors from different models are not comparable).

**Cloudflare Workers AI** (not OpenRouter, but free and no-training):

| Fact | Source |
|---|---|
| Workers Free includes **10,000 Neurons/day**, reset 00:00 UTC | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| `@cf/baai/bge-m3` (multilingual): 1,075 Neurons per M input tokens, so about **9 M tokens/day free**; 60k token context | [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [bge-m3](https://developers.cloudflare.com/workers-ai/models/bge-m3/) |
| `@cf/qwen/qwen3-embedding-0.6b`: 1,075 Neurons/M; `@cf/baai/bge-small-en-v1.5` (English, 384 dims): 1,841 Neurons/M | [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| "Cloudflare does not use Customer Content processed by Workers AI to train AI models." | [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) |

That free allowance would embed the whole Garden several times a day, without touching the OpenRouter budget. **But it is a second AI provider, which the map currently rules out ("AI only via OpenRouter").** Using it needs the owner's approval.

### Vector databases

**Cloudflare Vectorize** (fits the recommended Cloudflare stack from #3):

| Fact | Source |
|---|---|
| Free: **5 M stored vector dimensions**, 30 M queried dimensions/month, 100 indexes | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Max 1,536 dims, 10 KiB metadata/vector, topK 50 (with metadata), metadata filters `$eq $ne $in $nin $lt...` | [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/), [metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/) |
| Metadata indexes must be created **before** inserting vectors, or vectors must be re-upserted | [metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/) |

What 5 M stored dimensions means: at 1,024 dims (bge-m3, qwen3-0.6b) **about 4,900 vectors**; at 384 dims (bge-small) about 13,000. One vector per Object is fine for a few thousand Objects, but **chunking long Objects or passing ~5,000 Objects hits the free cap**. This is the tightest limit in option A.

**Postgres + pgvector** (if the stack is Supabase or Neon instead): pgvector is enabled with `create extension vector` ([Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)); vectors live in the same database as the Objects, so a private filter is an ordinary `WHERE`. The docs page does not state plan availability explicitly, though it is a standard extension. Vectors count against the 500 MB / 1 GB free database (1,024 float32 dims is about 4 KB per Object, so ~20 MB for 5,000 Objects; fine).

### Assessment

- **Quality:** best for fuzzy, meaning-based questions ("what have I thought about trust?") where the words differ. Weaker for exact names and rare terms.
- **Build effort for agents:** moderate. Embed on capture (as a retryable background step, like the Archivist), keep vectors in sync on edit/delete/private-toggle, embed each question, query, then fetch the Objects. More moving parts and a second store to keep consistent.
- **Main risks:** the free embedding model disappearing (re-embed everything), the 50/day budget if done through OpenRouter, and Vectorize's ~4,900-vector free cap.

## Option B: plain full-text search

| Fact | Source |
|---|---|
| D1 supports the SQLite **FTS5** module (and `fts5vocab`) | [D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/) |
| "Export is not supported for virtual tables, including databases with virtual tables." Workaround: drop virtual tables, export, recreate | [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) |

(Postgres has built-in full-text search with `tsvector` if the stack is Supabase/Neon.)

- **Quality:** good for names, titles, quoted phrases, rare words; ranks with BM25. Misses synonyms and paraphrases. This gap shrinks if the model is used to **rewrite the question into search keywords** (in the same request that will answer, or one extra request) and because the Archivist already attaches **key topics and Concepts** to each Object, which are indexed too.
- **Limits:** none that matter; it runs inside the database at no AI cost and within D1's 5 M rows read/day.
- **Build effort:** lowest. One extra table plus triggers; no second store; nothing to re-generate if a model changes.
- **Caveat:** the D1 `wrangler d1 export` limitation means the FTS table must be dropped and rebuilt around a raw database dump. The app's own full export (from the base tables) is unaffected.

## Option C: send the whole Garden, or a summary of it

Free chat models on OpenRouter today (live list from [`/api/v1/models`](https://openrouter.ai/api/v1/models), 17 free) include several with **1 M token contexts** (for example `nvidia/nemotron-3.5-lightning:free`, `thinkingmachines/inkling:free`) and many with 256k; the `openrouter/free` router reports **200,000** **(volatile)**. The [`openrouter/free` page](https://openrouter.ai/openrouter/free) does not document which models it routes to.

- **Whole Garden, full text:** fits only while the Garden is small (under ~150k tokens for the router, ~1M for the largest free models). It grows past that within the first year or two, and depends on a specific large-context free model staying free. Very large prompts are also slower and more likely to be rejected or rate limited. **Fine as a fallback for a young Garden, not a design.**
- **Whole Garden as index cards:** title + type + key topics + date per non-private Object, about 30 tokens each. 3,000 Objects is about 90k tokens, which fits the 200k router context with room for the answer; 6,000 is ~180k and starts to press it. This is good for **themes and patterns across the whole Garden**, which keyword or vector top-k retrieval is bad at, because it shows the model everything at a glance.
- **Two-step "map then read":** request 1 sends the index cards and the question, and the model names the Objects it wants; request 2 sends those Objects in full. Costs 2 of the 50 daily requests; needs no embeddings.

## Keeping private Objects out (all options)

The rule is the same whichever option is chosen, and is easiest to enforce in one place:

1. **One gate.** All Researcher and Archivist context is assembled by a single server-side function (for example `objectsForAI(ids)`) that loads Objects with `WHERE private = 0` and refuses anything else. Nothing else in the code may build AI prompts. Write tests that put a private Object in the Garden and assert it never appears in any request body.
2. **Never index private Objects for AI.** Do not embed them at all (so their text never goes to an embedding provider). When an Object is marked private, delete its vector in the same operation; when made public again, re-embed. For FTS, either keep one index and always join to `private = 0`, or keep private Objects out of the AI search index.
3. **Do not rely on a vector-store metadata filter alone.** It is a second copy of the flag that can drift; it also must be created before insert in Vectorize. Filter in the database of record, then re-check in the gate.
4. **Connections and quotes leak too.** Exclude private Objects from index cards, Connection lists and backlinks passed to the AI, not just from Object bodies.

Option B and C need only steps 1, 3 and 4 (no second store). Option A adds a sync job that has to be correct.

## Comparison

| | A: embeddings + vectors | B: full-text search | C: index cards (+ read) |
|---|---|---|---|
| Fuzzy/meaning questions | best | fair (better with keyword rewrite + Archivist topics) | good |
| Names, exact terms | fair | best | fair |
| Whole-Garden themes, contradictions | poor (top-k only) | poor (top-k only) | **best** |
| OpenRouter requests per question | +1 via OpenRouter, 0 via Workers AI | 0 (or +1 for rewrite) | 1-2 |
| Scales to years | yes, but Vectorize free cap ~4,900 vectors at 1,024 dims | yes | to ~5,000 Objects in 200k context, then needs filtering |
| Agent build effort | moderate (sync, re-embed) | low | low |
| Private exclusion | hardest (second store) | easy | easy |
| New provider/approval needed | Workers AI: yes | no | no |

## Recommendation for v1

**Use full-text search plus index cards; leave embeddings out of v1, behind a seam.**

1. **FTS5 in D1** (or Postgres full-text if the stack changes) over title, body, and the Archivist's topics and Concepts, non-private only. This also powers the owner's own search box (shared work with the open "Retrieval" item on the map).
2. **Researcher flow:** for a focused question, search with FTS (optionally let the model rewrite the question into keywords), send the top Objects in full. For "themes / contradictions / what am I circling around", send **index cards of the whole non-private Garden** (or of a filtered slice: a type, a date range, a topic), let the model pick Objects to read in full in a second request.
3. **One private gate** as described above, with tests.
4. **Later (v1.1), if answers miss too much:** add semantic search with Workers AI `bge-m3` + Vectorize (free, no-training, no OpenRouter requests), which needs the owner to accept Cloudflare as a second AI provider for embeddings only. Embedding through OpenRouter's free models is the fallback if that is refused, at the cost of the shared 50/day budget and model-churn risk.

Why: it costs zero OpenRouter requests for retrieval, has no second store to keep in sync (so private exclusion stays simple), survives free models coming and going, and the index-card view handles the Researcher's whole-Garden tasks better than top-k vector search would.

## Implications for the map

- **The 50 requests/day free limit is shared by the Archivist and the Researcher.** The spec needs a budget rule (for example, reserve some requests for on-demand Researcher use; the Archivist batches or defers). This affects the Capture flow item.
- **Decision for the owner:** may embeddings (only for non-private Objects) go to Cloudflare Workers AI instead of OpenRouter? Not needed for v1 under this recommendation, but it decides the v1.1 path.
- The Archivist's extracted **title, key topics and Concepts double as retrieval data** (index cards and FTS terms), so they should be stored as plain fields, not only as prose.
- The "Retrieval" item (search, browsing) can share the FTS index with the Researcher.
- If D1 is chosen, the export spec should note the FTS virtual-table caveat (export from base tables; rebuild the index after import).
