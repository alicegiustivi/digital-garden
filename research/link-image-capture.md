# Research: Capturing web links and images for free

Ticket: #4 (part of map #1). Researched 2026-10-31. Every limit below is a vendor's free tier. Free tiers change often, so re-check the linked page before relying on a number. Facts that are uncertain or fast-changing are marked **(verify)**.

## Short answer

- **Links:** fetch the page on our own server, then run two libraries over it: **Mozilla Readability** for the clean article text, and **metascraper** for metadata (title, author, date, image, site). Both are free and open source. Keep **Jina Reader** (`r.jina.ai`) as a free fallback for JavaScript-heavy pages where Readability finds nothing. If both fail, still save the link with whatever metadata exists and mark the text "not extracted". Never block a capture on extraction.
- **Images:** shrink them **in the browser before upload**, to about 2048 px on the long edge plus a ~400 px thumbnail. Upload straight to storage, not through a server function. A heavy user then needs about **1.5–2 GB a year**, which outgrows Supabase Storage's 1 GB free quota in under a year but fits Cloudflare R2's 10 GB free quota for about 5 years.

## 1. Turning a URL into clean text and metadata

### Option A: in-app libraries (recommended default)

**Mozilla Readability** ([github.com/mozilla/readability](https://github.com/mozilla/readability), Apache-2.0). This is the engine behind Firefox Reader View.
- `parse()` returns `title`, `content` (HTML), `textContent`, `length`, `excerpt`, `byline` (author), `dir`, `siteName`, `lang`, `publishedTime`.
- It needs a DOM. On Node, the README uses **jsdom**. Keep jsdom's script execution and resource loading switched off, which is the default, and pass the page URL so relative links resolve.
- `isProbablyReaderable()` is a quick pre-check with defaults `minContentLength` 140 and `minScore` 20. The README says it can be wrong in either direction.
- **Security:** Readability does **not** sanitize its output. Run the HTML through **DOMPurify** before storing or showing it. The README also recommends a Content Security Policy.
- `parse()` changes the document it is given. Pass it a clone if the original is needed again.

**metascraper** ([github.com/microlinkhq/metascraper](https://github.com/microlinkhq/metascraper), MIT).
- It takes the page HTML plus its URL and returns `title`, `author`, `date`, `description`, `publisher`, `image`, `logo`, `lang`, `url`, and optionally audio and video.
- It reads Open Graph, Twitter Cards, JSON-LD, Microdata, RDFa and plain meta tags. Rules run in priority order and the first match wins.
- This is better than Readability for the **image** (the preview image) and the **date** on many sites. Use metascraper for metadata and Readability for the body text, with Readability's `byline` and `publishedTime` as fallbacks.

**Where it runs.** The fetch has to happen on a server, because browsers block most cross-site page reads (CORS).
- **Vercel Functions (Hobby, free)** ([limits](https://vercel.com/docs/functions/limitations)): full Node.js, 2 GB memory, 300 s max duration, 4.5 MB request and response body limit. jsdom and Readability run here without changes. This is the simplest fit. Vercel Hobby is for non-commercial use, which a personal garden is **(verify the terms)**.
- **Cloudflare Workers (free)** ([limits](https://developers.cloudflare.com/workers/platform/limits/)): 100,000 requests per day, **10 ms CPU per request**, 128 MB memory, 50 subrequests. jsdom does not run in Workers. People substitute **linkedom**, which lacks `getComputedStyle` and stylesheets, so some Readability paths can fail. Parsing a long article may also go over 10 ms of CPU. **(verify by testing; not a primary source)** This is a weaker fit than Node for extraction.
- **Supabase Edge Functions** (Deno, 500,000 invocations a month free, per [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase)) could also work, but jsdom on Deno has not been checked here. **(verify)**

### Option B: free reader APIs (fallback)

| Service | Free allowance | Renders JavaScript? | Notes |
|---|---|---|---|
| **Jina Reader** `r.jina.ai/<url>` ([jina.ai/reader](https://jina.ai/reader/)) | No key: **20 requests/min**. Free key: 10M tokens. The page gives two figures for the free-key rate limit (100 RPM in the FAQ, 500 in the table) **(verify)** | **Yes**, a headless browser by default. The `direct` engine skips it | Returns Markdown, or JSON with title, content and URL. Caches 5 min. Send `DNT: 1` so a request is not cached or logged. Jina says it does not train on requests. Does **not** bypass paywalls or log in for you. |
| **Microlink API** ([microlink.io/pricing](https://microlink.io/pricing)) | **25 requests/day** with a free key, no card | Optional | Metadata only. This is the hosted version of metascraper, so self-hosting metascraper is strictly better. |
| **Cloudflare Browser Rendering** ([limits](https://developers.cloudflare.com/browser-rendering/limits/), [pricing](https://developers.cloudflare.com/browser-rendering/pricing/)) | **10 browser-minutes/day**. Quick Actions limited to 1 request per 10 s | Yes | Has a `/content` endpoint that returns rendered HTML, which we could then pass to Readability. A last resort for JavaScript-only pages. |

A single user saving a few dozen links a day stays far inside the Jina and Cloudflare free limits. Jina sees every URL sent to it, so **Objects marked private should not go through Jina**. This ties to the per-Object private flag in the map.

### Failure cases and how to handle them

| Case | What happens | Handling |
|---|---|---|
| **Paywalls / login walls** | We get the teaser or the login page. No free tool gets around this, and Jina says so explicitly. | Save the link plus metadata. Mark the text "partial". Let the owner paste the text by hand. |
| **JavaScript-only pages** (SPAs, some newsletters) | Plain fetch returns an empty shell, and Readability returns null or very short text | Retry through Jina, which renders JavaScript. |
| **Bot blocking** (Cloudflare challenges, 403s, rate limits) | Error page or challenge HTML | Detect via status code or a tiny text length. Fall back to Jina, then to metadata only. Never try to solve CAPTCHAs. |
| **Non-article pages** (YouTube, X/Twitter, Instagram, product pages, home pages) | Readability returns junk or nothing | Treat as a "bookmark": keep Open Graph metadata only. Use the `isProbablyReaderable()` pre-check. |
| **PDF links** | Not HTML | PDF capture is out of scope in the map. Store as a bookmark only. |
| **Malicious HTML** | XSS if shown raw | Sanitize with DOMPurify and never execute page scripts. |
| **Server-side request forgery** | Someone makes our fetcher hit internal addresses | Single user, so low risk. Still allow only http(s) and block private IP ranges. |
| **Link rot** | Page disappears later | Store the extracted text when capturing (this is our snapshot). Optionally store a copy of the preview image (see below). |

Rule for the Capture flow: **save first, extract after**. Capture writes the URL right away, and extraction fills in text and metadata asynchronously. That way a failed extraction never loses a capture.

## 2. Images

### Formats
- **iPhone photos are HEIC.** Safari transcodes HEIC to JPEG depending on the file input's `accept` attribute, and the behavior has changed across Safari versions. One open WebKit bug (Dec 2025) reports `accept="image/*"` *converting PNG/JPEG into HEIC* on recent Safari ([WebKit bug 303803](https://bugs.webkit.org/show_bug.cgi?id=303803), [WebKit bug 293886](https://bugs.webkit.org/show_bug.cgi?id=293886), [Apple forum thread](https://developer.apple.com/forums/thread/743049)). **(fast-changing; verify on the owner's actual phone)** A safe approach is an explicit `accept="image/jpeg,image/png,image/webp,image/gif"` list, which makes Safari hand over JPEG, plus decoding through the browser before re-encoding (below).
- **Output format:** re-encode to **JPEG at quality ~0.8** (universal) or **WebP** where the browser can encode it. `canvas.toBlob()` silently falls back to PNG when a type is not supported, so check `blob.type` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob)). Safari's WebP encoding support is uncertain **(verify)**, so JPEG is the safe default.
- Keep GIFs and small PNG screenshots as they are if they are already small.

### Resizing and thumbnails
- **Do it in the browser before upload.** It is free, saves storage, and avoids server limits: Vercel function bodies max out at **4.5 MB**, and a phone photo can be bigger.
- Produce two files per image: a **display** version at ~2048 px long edge (~300–600 KB as JPEG) and a **thumbnail** at ~400 px (~20–40 KB).
- Server-side transforms on free tiers: **Supabase image transformations are not on the Free plan** ([pricing](https://supabase.com/pricing)). Vercel's Image Optimization also has a capped Hobby quota. So we cannot rely on the server to make thumbnails for free, which is another reason to make them in the browser.
- Upload directly from the browser to storage with a signed upload URL. Do not route the file through a function.
- Whether to keep **originals** is an open decision. They are 3–5 MB each, which multiplies storage about 8×. Recommendation: don't keep them in v1.

### Link preview images
Preview images on other sites can vanish (link rot) or block hotlinking. Optionally download each link's `og:image` once, shrink it to ~800 px (~50–100 KB) and store it.

### Storage estimate for a heavy personal user (one year)

Assumptions: 10 images a day plus 5 saved links a day.

| Item | Count/year | Size each | Total |
|---|---|---|---|
| Display images (2048 px) | 3,650 | ~450 KB | ~1.6 GB |
| Thumbnails (400 px) | 3,650 | ~30 KB | ~0.1 GB |
| Stored link preview images (800 px) | 1,825 | ~80 KB | ~0.15 GB |
| **Files total** | | | **~1.9 GB/yr** |
| Keeping originals as well | 3,650 | ~4 MB | +~14 GB/yr |
| Article text in the database | 1,825 | ~30–50 KB | ~55–90 MB/yr (database, not file storage) |

At a lighter, more realistic 2–3 images a day, files come to ~0.5 GB a year.

### Free storage options

| Provider | Free storage | Other limits | Fit |
|---|---|---|---|
| **Supabase Storage** ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [pricing](https://supabase.com/pricing), [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)) | **1 GB** | 5 GB egress a month; 50 MB per file; database **500 MB**; **project pauses after 7 days of inactivity**; no automatic backups on Free | Simple if Supabase is the database too, but a heavy user fills 1 GB in about 6 months. |
| **Cloudflare R2** ([pricing](https://developers.cloudflare.com/r2/pricing/)) | **10 GB-month** | 1M writes and 10M reads a month; **egress is free** | Best headroom: about 5 years for a heavy user without originals. Needs a Cloudflare account. **Signing up may require a payment card on file (verify)**; going over the quota is billed, not blocked. |

Supabase's **500 MB database** is the other ceiling to watch. Article text plus everything else should last a few years, but the export (#1 Notes) is also the safety net.

## What this means for the map

1. **Capture of links should be "save now, extract later"**: an asynchronous step with a visible status (extracted / partial / bookmark only). This belongs in the Capture-flow spec.
2. **The private flag also matters for extraction**: private Objects must not be sent to third-party reader APIs such as Jina, only processed by our own server.
3. **Storage choice is tied to hosting**: Supabase alone (1 GB) is fine for light use, while R2 is the safer choice for images if the owner captures many photos. The hosting and database ticket should weigh this.
4. **Supabase free projects pause after a week of inactivity** and have no automatic backups. Relevant to the hosting choice and to export.
5. **Server runtime matters**: extraction wants a full Node runtime (Vercel Functions or similar), not a 10 ms-CPU edge worker.

## Sources
- Mozilla Readability README: https://github.com/mozilla/readability
- metascraper README: https://github.com/microlinkhq/metascraper
- Jina Reader: https://jina.ai/reader/
- Microlink pricing: https://microlink.io/pricing
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Browser Rendering limits: https://developers.cloudflare.com/browser-rendering/limits/ and pricing: https://developers.cloudflare.com/browser-rendering/pricing/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Supabase billing: https://supabase.com/docs/guides/platform/billing-on-supabase, pricing: https://supabase.com/pricing, file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- MDN `canvas.toBlob`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- WebKit HEIC behavior: https://bugs.webkit.org/show_bug.cgi?id=303803, https://bugs.webkit.org/show_bug.cgi?id=293886, https://developer.apple.com/forums/thread/743049
- Secondary (not primary; used only for the Workers + linkedom caveat): search results on Readability with linkedom in Cloudflare Workers (Defuddle issue, cheer-reader README)
