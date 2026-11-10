# Digital Garden

A personal space where one person captures information, connects it, reflects on it, and turns it into their own knowledge and work.

## Language

**Garden**:
One person's whole body of collected and developed knowledge, along with the space they work in it.
_Avoid_: Vault, workspace, knowledge base, database

**Object**:
A single item in the Garden with its own identity and an Object Type, such as a particular book or one reflection.
_Avoid_: Note, entry, record, card, page

**Object Type**:
The kind an Object belongs to (Source, Concept, Thought, Person, or one the owner made), which decides what fields it has. The owner can make their own Object Types (a Book, a Place) with a name, a colour from the Garden's palette, an icon and properties of short text, long text or a choice, and can change the colour of any type. A type the owner made is a plain Object type: title, body, Tags, Connections and its own properties, none of the Core types' special rules. Only the owner makes or changes a type; the AI never does and never moves an Object into one. A type that still has Objects, the Bin included, can't be removed until they are moved.
_Avoid_: Category, class, template

### Core Object Types

The four Core Object Types keep every special behaviour described below. The owner can change their colour, nothing else; a type the owner makes has none of these behaviours.

**Source**:
An Object for something the owner reads, watches, listens to or looks at, such as a book, article, video, podcast, web page, post, image or document.
_Avoid_: Reference, resource, bookmark

**Concept**:
An Object for an area of ideas that the owner deliberately creates once enough material has gathered to explore it, with many Sources and Thoughts connected to it. The Objects in a Concept are those connected straight to it. Its body is the owner's current view of that area, always in the owner's words, and earlier versions of that view are kept by date.
_Avoid_: Topic, theme, idea

**Thought**:
An Object for the owner's own reflection, insight, question or observation. A Thought is always the owner's words, never the AI's.
_Avoid_: Note, idea, journal entry

**Open Question**:
A Thought the owner has marked as a question they mean to keep returning to. Only the owner can mark one; a question the AI suggests stays an AI Note until the owner starts a Thought from it in their own words. The owner can mark it "settled for now", optionally pointing to the Thought that settled it, and can reopen it. It is never a task: it has no due date and is never overdue.
_Avoid_: Task, to-do, prompt, research question

**Person**:
An Object for an individual who matters to the owner's Garden, either personally or through their work.
_Avoid_: Contact, author, people

**Tag**:
A light, global label any Object can carry, costing nothing to add. It means whatever the owner wants it to, a status such as "to do" included; the Garden gives no Tag special behaviour. A Tag can later be turned into a Concept.
_Avoid_: Topic, label, category, keyword

**Connection**:
A link between two Objects in the Garden, of one Connection Kind, visible from both Objects. Two Objects have at most one Connection between them. A Tag on an Object is not a Connection. The owner makes Connections; the Archivist also adds Connections of kind related and authored by on its own, marked ✦ and undone in one click (see AI Contribution). Every other kind, and a change of kind, is the owner's or a Suggestion.
_Avoid_: Relationship, relation, edge, backlink

**Connection Kind**:
How two connected Objects relate, chosen from a fixed list: related (the default), supports, contradicts, builds on, inspired by, mentions, authored by. Directed kinds read differently from each end (supports / supported by).
_Avoid_: Link type, relation type, predicate

**Map**:
The Garden drawn as a graph: either the whole Garden clustered by Concept, with filters that fade what doesn't match, or a full-size graph around one Object that reaches one, two or three Connections out. It only shows; it changes nothing. Objects are labelled and coloured by Object Type, Connection Kinds and AI Origin (✦ ✧) are visible, Private Objects carry a lock (the owner sees them; no AI does), and Objects in the Bin are left out.
_Avoid_: Graph view, network, web

**Mention**:
A reference to another Object written inside an Object's body. It creates a Connection of kind "mentions", which lasts only as long as the reference stays in the text, unless the owner gives that Connection another kind. Inside a paragraph it reads as a quiet link; on a line of its own it shows as an Object Card.
_Avoid_: Inline link, wikilink, @-link

**Object Card**:
A compact view of an Object shown where a Mention stands on its own line: its title, Object Type, Tags, the kind of Connection that links it to the Object being read, and how many Connections it has.
_Avoid_: Embed, preview, block link

**Quote**:
A passage from a Source placed inside an Object's body, carrying a Mention of that Source and keeping Source Origin. It is never read as the owner's words.
_Avoid_: Excerpt, citation, highlight

### Authorship

**Origin**:
Who put a piece of content into the Garden: **Source** (it came from outside, such as captured text, page metadata or an image), **AI** (the Archivist or the Researcher produced it), or **Owner** (the owner wrote or chose it). Every field value, Tag, Connection and block of text has one. The owner's words are shown plain; Source and AI content are always marked.
_Avoid_: Author, provenance, source (for the Origin, as opposed to the Object Type)

**AI Note**:
A piece of AI-written text, such as a summary, interpretation, suggested question or Researcher answer, kept beside an Object's body and never inside it. A Researcher answer stays in its Inquiry until the owner keeps it on one or more Objects. It always keeps AI Origin, can be deleted, and cannot be edited into the owner's words; the owner can only start a Thought from it.
_Avoid_: AI summary, AI comment, annotation

**Inquiry**:
A question the owner puts to the Researcher, together with its follow-up questions and the answers. It is never an Object, and the Researcher never treats an earlier Inquiry as evidence.
_Avoid_: Chat, conversation, session, query

### Capture

**Daily Inbox**:
One page per day listing, in time order, everything the owner sent from the phone that day: the Objects each message created, and the owner's comment on them as plain text in the owner's words. A comment stays in the Daily Inbox (shown on its Sources too) until the owner turns it into a Thought. A Daily Inbox is never an Object, and captures typed on the Mac don't appear in it.
_Avoid_: Daily note, journal, inbox note

**Unreviewed**:
The state of an Object that came in through Capture, on the Mac or the phone, and that the owner hasn't looked at yet. Objects the owner makes on purpose inside the Garden, such as a Concept from a Tag or a Thought started from an AI Note, are never Unreviewed. All Unreviewed Objects form one Garden-wide list, the only inbox.
_Avoid_: Inbox item, new, unprocessed, to do

**Reviewed**:
The owner's tick that they have looked at an Unreviewed Object. It approves and rejects nothing: pending Suggestions stay on the Object. An Object never becomes Unreviewed again.
_Avoid_: Processed, done, organized, approved

**Bin**:
Where a deleted Object or Inquiry waits for 30 days before it is gone for good. While it is in the Bin it is hidden from every view and from the AI, its Connections are kept but hidden, and restoring it brings everything back as it was.
_Avoid_: Trash, archive, recycle bin

### AI

**Archivist**:
The AI role that works automatically in the background to give newly captured Objects a type, extracted information and Suggestions, and that describes a Person or Concept (description, years, links, definition) from what the Garden's Sources say. For an Object the owner put in a type of their own it adds Tags and Connections and fills that type's properties from the Object's own text, marked and undoable like any AI Contribution.
_Avoid_: Auto-tagger, organizer bot

**Researcher**:
The AI role the owner starts on purpose to explore, question and analyze what is in the Garden.
_Avoid_: Chatbot, assistant, copilot

**AI Contribution**:
Anything with AI Origin. It takes one of three forms: applied directly but marked and undone in one click (Tags, extracted facts about a Source such as its title, authors' names, date and format, and the Archivist's Connections of kind related and authored by, up to about 10 per Object); a Suggestion; or an AI Note. A new Object, a change of Object Type, a specific Connection Kind (supports, contradicts, builds on, inspired by), a change of kind on an existing Connection, a Connection found in a Researcher answer, and anything that touches a Thought are always Suggestions.
_Avoid_: AI output, AI content, generated content

**Suggestion**:
An AI Contribution that only takes effect once the owner approves it, such as a specific kind of Connection, a Connection from a Researcher answer, a change of Object Type, a new Object (including a Concept offered when a Tag is on three or more Objects), or a title for a Thought. Anything rejected, including a removed AI Tag or an undone AI Connection, is remembered and not proposed again unless the owner asks.
_Avoid_: Recommendation, auto-link

**Approve**:
The owner accepting a Suggestion as it is. It takes effect and joins the Garden's structure, but keeps its AI Origin and never becomes the owner's words or opinion. Editing a short value, such as a title, field or Tag name, is different: the edited value becomes the owner's.
_Avoid_: Endorse, accept, confirm

**Private**:
Marks an Object that no AI role may ever read, and whose content the Garden itself never sends to any outside service. Content the owner sends into the Garden through an outside route, such as a message to the phone Capture bot, has already passed through that route; Private protects it from the moment it arrives. The AI does not learn a Private Object exists, even where another Object mentions it. Private belongs to one Object only and is never inherited through Connections. The owner's own search and linking still work on Private Objects.
_Avoid_: Hidden, locked, secret

### Keeping the Garden

**Backup**:
An automatic, encrypted copy of the Garden kept so the Garden itself can be put back exactly as it was. Only the Garden can read it. Restoring is always done from a Backup, never from an Export.
_Avoid_: Export, snapshot, sync

**Export**:
A complete copy of the Garden, made when the owner asks, that can be read without the Garden: readable files for people plus one complete data file. It keeps every Origin and everything the Garden remembers, includes Private Objects unless the owner leaves them out, and is not encrypted. It is never used to restore the Garden.
_Avoid_: Backup, dump, download

### CODE stages

**Capture**:
Getting something into the Garden, with no requirement to organize it at that moment.
_Avoid_: Import, add

**Organize**:
Giving captured Objects structure: their type, their fields, and their links to other Objects.
_Avoid_: Classify, file

**Distill**:
Actively reflecting on Objects: comparing them, finding recurring themes and contradictions, and forming one's own views.
_Avoid_: Summarize, process

**Express**:
Using the Garden to produce new work, such as writing, projects or other output.
_Avoid_: Publish, create
