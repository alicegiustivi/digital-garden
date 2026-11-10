# The Archivist suggests a Concept when a Tag keeps coming back

When the Archivist has just looked at an Object and one of its Tags is on at least `AI_CONFIG.conceptMinObjects` (3) Objects, and no Concept has that name, it offers a Suggestion: "Make a Concept, *name*". This is the Garden's version of the Obsidian vault's Topic threshold (three related pages are a reason to evaluate a Topic page).

It is a plain check on this Mac with no AI call, so it costs nothing. Private Objects and the Bin are never counted or connected. At most one is offered per run and it is shown on one Object only, not on every Object carrying the Tag.

Nothing is made until the owner approves. Approving creates the Concept with a title that keeps AI Origin (✧, approved, as for a suggested Person), connects every Object that carries the Tag to it as `related`, and **leaves the Tag in place**. The Concept's body stays empty: it is the owner's current view of the area, in the owner's words (CONTEXT.md: Concept), so the AI writes none of it. Turn into Concept (issue #34) remains the owner's own way and still removes the Tag by default. A rejection is remembered for that name on every Object (`concept:<name>`).

Because it only runs when the Archivist looks at an Object, a Garden captured before this change gets the suggestions as its Objects are looked at again ("Ask the Archivist").
