# Free AI models on OpenRouter for the Garden

Research for issue #2 (part of map #1). **Checked: 2026-10-31.**

> **Read this first: these facts change often.** OpenRouter's own docs warn that "free model availability changes frequently". Two free models in the list below expire on the day this was written. Re-check the live list before you build, and design the app so the model names live in one config setting, not in code.

## Short answer

- **Yes, it's possible at $0, but the AI budget is small:** **50 free-model requests per day** and 20 per minute, shared across all free models. That works out to roughly **15–25 Captures a day**. One-time purchases totalling at least 10 credits raise this to 1,000 per day, but that breaks the $0 rule.
- **Several free models can do all five jobs on paper**, including image description: Gemma 4 31B, Nemotron 3.5 Super VL and Inkling. **Nobody has measured their quality on Garden tasks yet.** That needs a small hands-on test (see "Open questions").
- **Treat almost every free provider as "may read and train on what you send".** Google, NVIDIA and Thinking Machines all say so in their own terms. The only free text model with an OpenRouter Zero Data Retention (ZDR) endpoint is Xing4.0 (hosted by Phala). It is text-only and new.
- **So the per-Object private flag has to mean "never sent to any AI".** The app must enforce it before any request leaves. Choosing a "private" provider can't replace it.
- **Prefer a fixed short list of `:free` models over `openrouter/free`.** The router picks a model at random. You can't predict its quality, its JSON reliability or whose privacy terms apply.

## 1. What free models exist right now

Source: the live OpenRouter models API (`GET https://openrouter.ai/api/v1/models`), filtered to `:free` ids, plus each model's `/endpoints` call. Fetched 2026-10-31. "JSON" means the model lists `response_format` / `structured_outputs` support. This matters for the reliable extraction of Concepts and Connections.

| Model id | Context | Inputs | JSON | Free provider | Notes |
|---|---|---|---|---|---|
| `google/gemma-4-31b-it:free` | 262K | text, image, video | yes | Google AI Studio | Dense 31B; Apache 2.0; released 2026-04-02 |
| `google/gemma-4-26b-a4b-it:free` | 262K | text, image, video | yes | Google AI Studio | Smaller and faster sibling |
| `nvidia/nemotron-3.5-super-vl:free` | 1M | text, image, video | yes | NVIDIA | 120B MoE, 12B active; documents and screenshots |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | text | no (tools only) | NVIDIA | Largest free model (550B MoE); reasoning |
| `nvidia/nemotron-3.5-lightning:free` | 1M | text | no | NVIDIA | Small/fast (30B MoE, 3B active) |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256K | text, image, audio, video | no | NVIDIA | Small "perception" model |
| `thinkingmachines/inkling:free` | 1M | text, image, audio | no | Thinking Machines | 975B MoE; endpoint status degraded (uptime 70%) at check time |
| `thinkingmachines/inkling-small:free` | 1M | text, image, audio | no | Thinking Machines | Same caveat |
| `dots-studio/dots-3-note-preview:free` | 512K | text, image | yes | AtlasCloud | **Expires 2026-12-31** |
| `xingchen-agi/xing4.0-29b-a4b:free` | 262K | text | yes | Phala | **Only free text LLM with a ZDR endpoint**; released 2026-10-16 |
| `liquid/lfm-2.5-2.6b:free` | 65K | text | yes | Liquid | Tiny; extraction/RAG-oriented |
| `recursive/flint-v1.0:free` | 262K | text | yes | Recursive | Coding-agent model; endpoint down at check time |
| `cohere/north-mini-code:free` | 256K | text | no | Cohere | Coding model; not a fit |
| `poolside/laguna-s-2.1:free`, `laguna-xs-2.1:free` | 262K | text | no | Poolside | Coding models; **expire 2026-10-31** |
| `nvidia/nemotron-3.5-content-safety:free` | 128K | text, image | no | NVIDIA | Moderation model; not a fit |
| `openrouter/free` (router) | 200K | text, image | yes | varies | Picks a free model at random, see §3 |

### Fit for the five Garden jobs (on paper, not tested)

| Job | Best candidates | Why |
|---|---|---|
| Summarize a Source | Gemma 4 31B, Nemotron 3 Ultra, Nemotron 3.5 Super VL | General-purpose, with long context. Long web articles fit easily. |
| Extract Concepts (structured list) | Gemma 4 31B, Nemotron 3.5 Super VL, Dots3-Note | They support JSON output (`response_format`), so the app gets a parseable list. |
| Suggest Connections between Objects | Nemotron 3 Ultra, Gemma 4 31B | These need reasoning across several Objects. The 1M context of Ultra helps if many Objects are sent at once. |
| Spot contradictions | Nemotron 3 Ultra (reasoning), Gemma 4 31B | This is the hardest task and the most likely to produce false positives. Must be tested. |
| Describe an image | Gemma 4 31B, Nemotron 3.5 Super VL, Inkling | These take image input. Super VL is pitched at documents and screenshots. |

**Quality is uncertain.** OpenRouter publishes no quality scores for these specific tasks, and this research did not call the models: no API key was used. The model choices above rest on model size, stated capabilities and JSON support only.

## 2. Rate limits and the realistic daily ceiling

Source: [OpenRouter API limits](https://openrouter.ai/docs/api/reference/limits).

| Credits purchased (all time) | Requests / minute | Requests / day |
|---|---|---|
| Less than 10 | 20 | **50** |
| At least 10 | 20 | 1000 |

- The limits apply to "a free model variant (with an ID ending in `:free`)". The daily counter is one per account per **UTC day**. The `GET /api/v1/key` response reports it as `free_model_daily_requests {used, limit, remaining}`. The Garden can show it to the owner as an "AI calls left today" gauge.
- **A negative credit balance blocks free models too**, per the same page. At $0 the balance never goes negative, as long as the app never calls a paid model.
- **A fallback to a paid model is billed** ([Free Variant docs](https://openrouter.ai/docs/guides/routing/model-variants/free.md)). If the app uses a `models` fallback list, it must list **only** `:free` models. `openrouter/free` on its own also "falls back only to other free models".
- **Uncertain:** the docs don't say whether failed or 429'd requests count toward the 50. They also don't say outright that `openrouter/free` draws on the same counter, though it routes to `:free` models, so assume it does.

**What 50 a day means for one person.** Suppose a Capture takes about 2–3 calls (summarize plus extract Concepts in one call, suggest Connections in another, one more if an image is described). Then 50 calls cover about **15–25 Captures a day**, with nothing left over for Distill features such as contradiction checks or questions answered from the Garden. A heavy reading day could hit the cap. The spec should therefore:

1. Combine jobs into as few calls as possible. For example, one JSON call returns the summary, Concepts and candidate Connections.
2. Make AI work **queueable**. The Capture saves immediately and AI suggestions arrive later, or the next day, when the quota resets.
3. Run batch jobs like contradiction checks rarely and on demand, not on every Capture.

## 3. `openrouter/free` vs picking models

Source: [Free Models Router docs](https://openrouter.ai/docs/guides/routing/routers/free-router.md).

- The router "automatically selects a free model at random". It first filters for the features the request needs (vision, tool calling, structured outputs). The response's `model` field says which model answered, and the Garden should store it with each AI contribution, which fits the "AI origin" rule on the map.
- The docs list its downsides: you "cannot control which specific model is selected", availability varies, and latency is higher at peak times.
- **For the Garden this is a real cost.** Quality and privacy terms change from call to call, at random. A request could land on a small coding model or a Thinking Machines endpoint that trains on prompts.
- **Recommendation:** call a short ordered list of specific `:free` models through the `models` fallback array. Keep `openrouter/free` as the last resort, or drop it entirely.

## 4. Privacy: who logs, keeps or trains on prompts

### OpenRouter itself

[Data Collection docs](https://openrouter.ai/docs/guides/privacy/data-collection.md):

- OpenRouter "does not store your prompts or responses" unless you opt in to logging or to "OpenRouter use of inputs/outputs". Both are off by default. The one exception is content flagged as potential CSAM.
- It stores **metadata** (token counts, latency) for each request.
- It samples a small number of prompts for anonymous categorization, done "by model with a zero-data-retention policy".

### The free providers (they see the actual text)

[Provider Logging docs](https://openrouter.ai/docs/guides/privacy/provider-logging.md): each provider has its own policy. OpenRouter "does not have routing rules that change based on data retention policies of providers". You can opt out of training providers in account settings, and there are "separate settings for paid and free models". OpenRouter calls its data-policy tags "not a definitive source of third party data policies".

| Provider (free models) | What its own terms say | Source |
|---|---|---|
| **Google AI Studio** (Gemma 4) | Google uses submitted content and responses to "provide, improve, and develop" products, and "human reviewers may read, annotate, and process your API input and output". "Do not submit sensitive, confidential, or personal information to the Unpaid Services." Last modified 2026-04-28. | [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms) |
| **NVIDIA** (all Nemotron) | The free endpoint logs use for security and "to improve NVIDIA products and services". It warns against uploading confidential or personal data. No retention period is given. | NVIDIA notice on the OpenRouter provider page; [NVIDIA API Trial Terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) |
| **Thinking Machines** (Inkling) | "We may use Prompts and Outputs to improve our services, including by training, fine-tuning". Data is kept "as long as reasonably necessary" and processed in the US. Notice dated 2026-08-20. | [TML Free Research API Tier Privacy Notice](https://thinkingmachines.ai/legal/tml-free-research-api-tier-privacy-notice.pdf) |
| **Phala** (Xing4.0) | Listed by OpenRouter as a **Zero Data Retention** endpoint (`GET /api/v1/endpoints/zdr`) | OpenRouter API, 2026-10-31 |
| AtlasCloud (Dots3-Note), Liquid, Recursive, Cohere, Poolside | **Not verified.** Policy links are in `GET /api/v1/providers`; not read for this ticket. | — |

### What this means for the per-Object private flag

- Assume **any non-private Object may be read by provider staff and used for training**, especially the Gemma, Nemotron and Inkling models, which are the main candidates.
- The private flag must be a **hard filter inside the app**. A private Object, and its text inside other Objects' prompts (for example as a Connection candidate), is never included in any AI request. Provider settings can't stand in for it.
- An optional extra is to send requests with `provider: { data_collection: "deny" }` or `zdr: true` ([Provider selection docs](https://openrouter.ai/docs/guides/routing/provider-selection.md)). Today that would likely shrink the free pool to Xing4.0, which is text-only and untested. **Uncertain:** this was not tested with a live key.
- In plain words for the owner: **"Private" means the AI never sees it. Everything else should be treated as something a stranger at Google or NVIDIA might read.** It might help to show this as a one-line notice in the app.

## Open questions and suggestions for the map

1. **Prototype/eval ticket.** Run 5–10 sample Sources and a few images through the 3–4 top candidates for each job, using the owner's real kind of content. Score the results on the five jobs and on JSON reliability. This is the only way to settle quality.
2. **AI budget UX.** With 50 calls a day, how does the Capture flow behave when the quota runs out (queue, retry tomorrow, show a gauge)? This belongs in the "Capture flow" section of the map.
3. **Is a one-time purchase of 10 credits ever acceptable?** It raises the cap 20× (to 1,000 a day). This is an owner decision against the $0 rule.
4. **Is "private = never sent" enough, or should non-private sensitive content also be routed only to ZDR endpoints?** This is an owner decision.
5. **Image Capture privacy.** Photos may contain faces or personal data, and NVIDIA's notice specifically warns about this.
6. **Re-check cadence.** Free models come and go. Two Poolside models expire 2026-10-31 and Dots3-Note expires 2026-12-31. The app needs the model list in config, and someone needs to re-check it every few months.

## Sources (all checked 2026-10-31)

- OpenRouter models API: <https://openrouter.ai/api/v1/models>, per-model `/api/v1/models/{id}/endpoints`, `/api/v1/endpoints/zdr`, `/api/v1/providers`
- OpenRouter API limits: <https://openrouter.ai/docs/api/reference/limits>
- Free Models Router: <https://openrouter.ai/docs/guides/routing/routers/free-router>
- Free Variant: <https://openrouter.ai/docs/guides/routing/model-variants/free>
- Data Collection: <https://openrouter.ai/docs/guides/privacy/data-collection>
- Provider Logging: <https://openrouter.ai/docs/guides/privacy/provider-logging>
- Provider selection (`data_collection`, `zdr`): <https://openrouter.ai/docs/guides/routing/provider-selection>
- Gemini API Additional Terms (Unpaid Services): <https://ai.google.dev/gemini-api/terms>
- NVIDIA free endpoint notice: <https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free/providers>
- Thinking Machines Free Research API Tier Privacy Notice: <https://thinkingmachines.ai/legal/tml-free-research-api-tier-privacy-notice.pdf>
