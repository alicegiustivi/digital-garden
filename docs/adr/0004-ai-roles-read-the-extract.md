# The Archivist and the Researcher read the extract, not just titles

Both roles now read a Source's extract (the words pulled from the page, stored in its `captured` field) in full, instead of a short first part, and work in more than one step. The owner asked for this because the AI was "only reading the Garden's titles" and adding no real value; the Garden is meant to become a second brain that helps the owner think.

**Archivist** (two requests per capture, up to `AI_CONFIG.readChars` = 24,000 characters of extract, start and end kept):
1. *Read*: facts about the item, a 3–5 sentence summary, the 3–6 main claims each marked *Reported* or *Interpretation (name)*, 2–4 specific Tags, people. The summary and claims are one AI Note.
2. *Connect*: the candidates are shown with what they say (owner's words, start of their extract, Tags), not only titles. `related` Connections are applied directly (ADR 0003). `supports`, `contradicts`, `builds on` and `inspired by` stay Suggestions and now carry the reason the AI gave, including the kind of disagreement for `contradicts`.
If the second request fails, what the first saved stays; "Ask the Archivist" runs it again.

**Tags**: the same few Tags were being repeated because the prompt offered the most-used Tags first and said to reuse them. Now known Tags are listed with counts and only when exactly right, format and vague words are dropped (`VAGUE_TAGS`), and a Tag already on at least `broadTagMin` Objects and more than a quarter of the Garden is never added again by the AI. These are checked in code, not only asked of the model.

**Researcher**: index cards show the start of the extract (260 characters) and the author; the Objects it reads get up to 70,000 characters between them, the Object being asked about counting double, with the extract taking the largest share and the short facts and Connections placed first so a long extract never crowds them out. Answers follow the owner's learning order (big picture, the thread, tension, what the Garden does not establish, a question to take further) and challenge a view the owner states.

Consequences: an Archivist capture costs 2 free calls instead of 1 (budget `dailyCalls.archivist` is 300 a day), and prompts are much longer, so a busy free model may take longer. The Researcher stays Garden-only (ADR 0002): it flags gaps instead of looking things up. Nothing here changes Origin, Private or the rule that the AI never writes the owner's words.

**Later (ADR 0009):** "The Researcher stays Garden-only" has one exception: the owner can switch on "look on the web" for a single Inquiry (off by default), and the answer then keeps From your Garden and From the web apart.
