# How existing tools model typed objects and connections

Research for issue #5 (part of the map, #1). Question: how do Capacities, Tana, Anytype and Obsidian (with properties) model typed Objects, their fields, user-defined types and links between Objects? What do users praise and complain about? Which patterns matter for a Garden with four core Object Types (Source, Concept, Thought, Person) that should grow toward user-defined types, with Connections that may carry a kind and an AI origin?

Sources were read on 2026-10-31. Official docs are the primary source for every model claim. User sentiment comes from specific forum and feedback threads, which are cited one by one. Where a doc page did not state something, this note says so instead of guessing.

## Summary

- Three of the four tools (Capacities, Anytype, Tana) treat the **Object Type as a template of fields** that the user can create and edit. Obsidian has no Object Types at all, only per-note properties whose *value type* is fixed vault-wide.
- **One type per Object** is the norm (Capacities, Anytype). Tana is the exception: a node can carry several supertags and a supertag can extend another.
- Links come in **two flavours everywhere**: untyped inline links in text, which produce backlinks, and **typed field links** ("Object property", "Options from supertag", Capacities' object-select property) that point at Objects of a given type.
- **None of the four lets an inline link carry a kind, and none records who made a link** (owner or AI). The most-voted related complaint in each community is that links can't carry meaning (Obsidian) or aren't automatically two-way (Anytype).
- Implication for the Garden: model a **Connection as its own record** (from, to, kind, origin, endorsement) rather than as a field on an Object. This is the one place the Garden needs to go beyond what these tools do.

## Tool by tool

### Capacities

- **Object Types.** "Every object in Capacities has a type", and objects are always an instance of one of the object types. There are built-in "basic" types and user-created custom types. A custom type's settings define its properties, layout, dashboard and how its cards and links look. [Content types](https://docs.capacities.io/reference/content-types)
- **Changing type.** An object can be converted to another type. Capacities compares the two types' properties during conversion, so data with no place in the new type can be lost. Basic types (PDF, image, audio and so on) can't be converted. [Content types](https://docs.capacities.io/reference/content-types), [Custom content types tutorial](https://docs.capacities.io/tutorials/custom-content-types)
- **Typed links.** An "object property" links a field to **one** Object Type through a dropdown, with single or multiple selection. The property is **one-way by default**. Two-way sync is an opt-in setting ("Enable two-way linking") and works only between two *custom* types. [Object properties](https://docs.capacities.io/reference/object-properties)
- **Linking to several types.** A single object property can't target more than one type. The docs' workaround is a text property with `@` or `[[ ]]` links. [FAQ: link to multiple object types](https://docs.capacities.io/faq/editing/link-to-multiple-object-types)
- **Merging.** Merging two objects of the same type redirects links to the surviving object. [Content types](https://docs.capacities.io/reference/content-types)
- **Sentiment.** Capacities' typed objects are the feature Obsidian users ask for. One Obsidian forum request (Sept 2026) cites Capacities as the model: editing a type's template should update every note of that type. [Obsidian forum: Strong Object Typing](https://forum.obsidian.md/t/strong-object-typing/117966). I found no Capacities-specific complaint thread about the type model itself. The documented limits (one type per object, one target type per object property, two-way only between custom types) are the likely friction points, but that is my inference, not a cited complaint.

### Tana

- **Supertags as Object Types.** "Supertags turn a node into a typed object with a template of fields." Each supertag is backed by a definition node that stores its name, template and commands. [Supertags](https://outliner.tana.inc/learn/features/supertags)
- **Inheritance.** A supertag can *extend* another. The parent's template is projected onto the child, which can add fields and change defaults but can't remove inherited ones. [Supertags](https://outliner.tana.inc/learn/features/supertags)
- **Several types per node.** The docs imply a node can carry more than one supertag ("When viewing nodes from multiple supertags, all pinned fields from all represented supertags will show"). [Supertags](https://outliner.tana.inc/learn/features/supertags)
- **Fields.** There are nine field types, including "Options from supertag" (formerly "Instance"), which is the typed link to nodes of a given supertag. Fields are **shared definitions**: reusing a field reuses its settings, and "Used in" counts the supertags that use it. The fields page does not say whether field links are bidirectional. [Fields](https://outliner.tana.inc/learn/features/fields)
- **Other connections.** Plain references, search nodes (for example a Project showing its Tasks) and "related content" panels. There is no formal relation entity. [Supertags](https://outliner.tana.inc/learn/features/supertags)
- **Praise.** Users call supertags powerful once learned. A Tana ambassador argues the core supertag + field + search pattern is simple and complex setups are just combinations of it. [Product Hunt: "My favorite Tana Lego block"](https://www.producthunt.com/p/tana/my-favorite-tana-lego-block)
- **Complaints.** Configuring advanced supertags "creates a steep learning curve" for less technical users. [Tana ideas #563](https://ideas.tana.inc/posts/563-supertag-configuration-with-flows-in-the-style-of-node-red). Picking a node in an "Options from supertag" field doesn't scale: you scroll an unordered list with no type-to-filter, which makes relationship-based workflows impractical. [Tana ideas #786](https://ideas.tana.inc/posts/786-selecting-a-node-in-a-options-from-supertag-field-doesnt-scale-beyond-a-few-supertag-instances)

### Anytype

- **Types.** "If an Object is a cookie, then the Type is the cookie cutter." "Every Object has one Type, which you apply on creation and can change at any time." Each Type has Properties, Views and Templates. Users can create custom Types. [Anytype docs: Types](https://doc.anytype.io/anytype/organize/types)
- **Changing type is safe.** "When changing Types, the Properties are retained on the Object", so switching back and forth loses nothing. [Types](https://doc.anytype.io/anytype/organize/types)
- **Properties (formerly "Relations") are independent of Types.** A Type is "a group of Properties that all get applied to an Object at the same time". One Property can be reused across Types (Genre on Books and Movies), and an Object can carry a Property its Type doesn't have. [Anytype docs: Properties](https://doc.anytype.io/anytype/organize/properties)
- **Typed links.** The "Object" property format is a "Reference to another object". The docs list "Connect Objects" as one of the two jobs of Properties (for example Assigned To → a Person Object). [Properties](https://doc.anytype.io/anytype/organize/properties)
- **Inline links and backlinks.** `@` mentions and `/link` blocks create links. A Backlinks property in the Object header lists incoming links. The graph draws an edge for an editor link, an Object property or a backlink. [Anytype docs: Links](https://doc.anytype.io/anytype/create/links) (also in the docs' [full export](https://doc.anytype.io/anytype/llms-full.txt))
- **Advice from the vendor.** "Creating too many Types usually leads to a complex system that becomes overwhelming. Start with the built-in Types." [Types](https://doc.anytype.io/anytype/organize/types)
- **Complaints.** The long-running top request is **automatic two-way relations**. Users must enter each parent/child or sibling link twice. [Community: Automatic Bi-directional linking + Rollups](https://community.anytype.io/t/automatic-bi-directional-linking-rollups/1600), [How do you set up bi-directional linking?](https://community.anytype.io/t/how-do-you-set-up-bi-directional-linking/9770). Users list it as a dealbreaker alongside missing rollups and formulas. [What is your dealbreaker with Anytype? (post by Macondo, 2023-06-23)](https://community.anytype.io/t/what-is-your-dealbreaker-with-anytype/9406/50)

### Obsidian (with properties)

- **No Object Types.** A note has properties (YAML frontmatter). Each property has a type: Text, List, Number, Checkbox, Date, Date & time or Tags. The type belongs to the **property name, vault-wide**: once set, "all properties with that name across your vault will use the same type". Nothing groups properties into a per-type schema. [Obsidian help: Properties](https://obsidian.md/help/properties)
- **Links.** Text and list properties can hold `[[links]]`, which is the closest thing to a typed field link: the property name acts as the "kind". Body links are untyped. Nested properties and Markdown in values are not supported. [Properties](https://obsidian.md/help/properties)
- **Bases.** This core plugin gives database views where "each row is a file, and each column is a property". It is a view layer, not a schema: the docs describe no type definitions or validation. [Obsidian help: Bases](https://obsidian.md/help/bases)
- **Praise.** Flexibility and plain files. Capacities' own migration docs contrast Obsidian's loose structure with Capacities' "explicit object typing". [Capacities: Switching from Obsidian](https://docs.capacities.io/migration/switching-from-obsidian)
- **Complaints.**
  - **Links can't carry meaning.** The request "Add support for link types, link info, link metadata" has been open since July 2020. Users want named relationships (parent/child, supports/contradicts), labels on graph edges, filtering by link type and inverse links inferred from rules. Commenters also warn about ambiguous direction and an explosion of link types. [Obsidian forum #6994](https://forum.obsidian.md/t/add-support-for-link-types-link-info-link-metadata/6994), [How to best discern between different types of links?](https://forum.obsidian.md/t/how-to-best-discern-between-different-types-of-links/8906)
  - **No strong types.** Templates only shape new notes, so adding a field to "all books" means editing every note by hand. [Strong Object Typing](https://forum.obsidian.md/t/strong-object-typing/117966)

## Comparison

| | Capacities | Tana | Anytype | Obsidian |
|---|---|---|---|---|
| Object Type = template of fields | yes | yes (supertag) | yes | no (properties only) |
| User-defined types | yes | yes | yes | n/a |
| Types per Object | exactly one | several | exactly one | none |
| Type inheritance | no (not documented) | yes (extend) | no (not documented) | no |
| Fields shared across types | tags only, per docs | yes (field definitions) | yes (Properties are global) | yes (name → type is vault-wide) |
| Change type safely | converts; may drop data | add/remove tags | keeps all Properties | n/a |
| Typed link field | object property, one target type | Options from supertag | Object property | `[[link]]` inside a property |
| Two-way typed links | opt-in, custom types only | not documented | no (top request) | no |
| Inline links → backlinks | yes | yes (references) | yes | yes |
| Kind on a link | only via the field name | only via the field name | only via the property name | only via the property name |
| Origin/authorship on a link | no | no | no | no |

## Patterns for the Garden

In the Garden's vocabulary:

1. **An Object Type is a named set of fields.** The four core Object Types (Source, Concept, Thought, Person) should be stored as *data* (type records with field definitions), not hard-coded tables per type. That is the shape every tool that supports user-defined types converged on. It costs little now and is what makes "grow toward user-defined types" possible later.
2. **Fields should be defined once and reused across Object Types**, as Anytype and Tana do (an "author" field could serve Source and future types). Changing an Object's type should **keep** field values that don't fit, as Anytype does, never drop them, as Capacities may.
3. **Start with one Object Type per Object.** Capacities and Anytype both do this and it is easy to explain. Tana's multiple tags and inheritance are powerful, but they are the main source of its "steep learning curve" complaints. Leave them out of v1.
4. **Make a Connection a first-class record**, not a field on an Object: `from Object`, `to Object`, `kind` (optional), `origin` (owner / AI), `endorsed` (by owner, when). This is where the Garden must go beyond every tool reviewed. None of them can attach a kind to a free link or record that a link came from AI, and "links should carry meaning" is Obsidian's oldest open request. It also satisfies the map's rule that AI-suggested items keep their AI origin after endorsement.
5. **Connections are two-way when read.** Store one record and show it from both ends with the kind's inverse label (for example "supports" / "supported by"). This avoids Anytype's top complaint (entering links twice) and Capacities' opt-in two-way setting.
6. **Keep the set of Connection kinds small and fixed in v1** (for example a handful such as "supports", "contradicts", "is about", "by"), with untyped "related" as the default. Obsidian's forum warns about kind explosion and unclear direction. A fixed list also makes AI suggestions easier to check.
7. **Linking must be searchable by name and filterable by Object Type**, because Tana users report that picking a target from a long list breaks down. Capacities' `@` / `[[ ]]` search with a type filter is the model.
8. **Inline mentions in text should also produce Connections** (kind "mentions", origin owner), so backlinks work as in every tool reviewed. Field-style links such as Source → author (Person) can be Connections with a specific kind, not a separate mechanism.

## Gaps and confidence

- Tana's docs don't say whether "Options from supertag" links show up as backreferences on the target. Treat that as unknown.
- I didn't find an official Anytype roadmap answer on two-way relations. The complaint threads are user posts.
- I found no first-hand Capacities complaint thread about its type model. The limits listed above come from its docs.
- Product Hunt and review-site quotes are lower trust than forum and feedback-board threads. They are used only for Tana praise.
