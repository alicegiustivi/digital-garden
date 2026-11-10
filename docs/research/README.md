# Research behind the Garden's decisions

Written before the build, to settle questions. They are history, not instructions: where a note disagrees with `CONTEXT.md` or an ADR, the ADR wins.

| Note | Question | What came of it |
|---|---|---|
| [free-hosting.md](free-hosting.md) | Could the Garden be hosted free online? | Recommended Cloudflare; the owner chose to stay local instead (ADR 0002). |
| [free-ai-models.md](free-ai-models.md) | Which free models on OpenRouter can do the Archivist's and Researcher's work? | Fed the choice of AI models. |
| [free-retrieval.md](free-retrieval.md) | How can the Researcher find the right Objects without paid search? | Fed the design of how the Researcher finds Objects. |
| [link-image-capture.md](link-image-capture.md) | How to read a web link and keep an image, for free? | Fed link and image Capture. |
| [typed-object-models.md](typed-object-models.md) | How do other tools model typed objects and connections? | Fed Object Types and Connection Kinds. |

The experiment behind the free-model choice (scripts and results) is kept on the branch `prototype/free-models-test`.
