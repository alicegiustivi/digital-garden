# The Archivist describes People and Concepts from the Garden's own Sources

The Archivist now fills in a **Person** (description, years lived, links) and a **Concept** (its definition, the lead field shown under the title). It is the same kind of AI Contribution as a Source's title or authors: applied directly, marked ✦ with role, model and date, undone in one click (ADR 0001, 0003).

**Only from the Garden.** The model is shown the passages of the connected Sources' extracts that mention the subject (its name, surname parts or aliases; for a Source the Person wrote, its opening) and is told it knows nothing else. A year must appear in those passages and a link must appear word for word, or code drops it. This keeps the Garden-only rule for the AI (a question that needs outside facts stays a gap) and means a Person with no Source text yet is simply not described. Private Sources and Objects are never read; Thoughts are not used as evidence, so the description is never built on the owner's own opinions.

**Never the owner's words.** An owner-written value is never touched. An earlier AI value is replaced by a newer one, so a description can grow as Sources are connected, and Undo restores what was there before.

**When.** One request, when a Person or Concept is made by approving a Suggestion (including a Concept suggested from a recurring Tag, ADR 0005), when the owner turns a Tag into a Concept, or when the owner presses "Ask the Archivist" on it. No request is made when every field is already the owner's or no connected Source has words about it.

**Fix (regression):** the first version sent a Person or Concept only to the description step, so they stopped getting Tags and Connections. They now get the full treatment: the description request also returns 2–4 specific Tags; a Source that lists the Person among its authors is connected "authored by" with no request (a plain name match); and a second request judges Connections against what the candidates say. For a Person or Concept the candidates start with the Sources whose own text names it (found on this Mac, even when not yet connected), each shown as the passage that names it rather than its opening.
