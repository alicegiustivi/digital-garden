# Research behind the Garden's decisions

Written before the build, to settle questions. They are history, not instructions: where a note disagrees with `CONTEXT.md` or an ADR, the ADR wins.

| Note | Question | What came of it |
|---|---|---|
| [free-hosting.md](free-hosting.md) | Could the Garden be hosted free online? | Recommended Cloudflare; the owner chose to stay local instead (ADR 0002). |
| [free-ai-models.md](free-ai-models.md) | Which free models on OpenRouter can do the Archivist's and Researcher's work? | Basis for the AI setup (`src/server/ai-config.ts`, ADR 0004). |
| [free-retrieval.md](free-retrieval.md) | How can the Researcher find the right Objects without paid search? | Basis for the Researcher's reading and index-card steps. |
| [link-image-capture.md](link-image-capture.md) | How to read a web link and keep an image, for free? | Basis for `src/server/extract.ts` and image capture. |
| [typed-object-models.md](typed-object-models.md) | How do other tools model typed objects and connections? | Basis for Object Types and Connection Kinds in `CONTEXT.md`. |

The experiment behind the free-model choice (scripts and results) is kept on the branch `prototype/free-models-test`.
