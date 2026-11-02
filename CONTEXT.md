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
The kind an Object belongs to (Source, Concept, Thought, Person, …), which decides what fields it has.
_Avoid_: Category, class, template

### Core Object Types

**Source**:
An Object for something the owner reads, watches, listens to or looks at, such as a book, article, video, podcast, web page, post, image or document.
_Avoid_: Reference, resource, bookmark

**Concept**:
An Object for an area of ideas that the owner deliberately creates once enough material has gathered to explore it, with many Sources and Thoughts connected to it.
_Avoid_: Topic, theme, idea

**Thought**:
An Object for the owner's own reflection, insight, question or observation. A Thought is always the owner's words, never the AI's.
_Avoid_: Note, idea, journal entry

**Person**:
An Object for an individual who matters to the owner's Garden, either personally or through their work.
_Avoid_: Contact, author, people

**Tag**:
A light, global label any Object can carry, costing nothing to add. It means whatever the owner wants it to, a status such as "to do" included; the Garden gives no Tag special behaviour. A Tag can later be turned into a Concept.
_Avoid_: Topic, label, category, keyword

**Connection**:
A link between two Objects in the Garden, of one Connection Kind, visible from both Objects. Two Objects have at most one Connection between them. A Tag on an Object is not a Connection.
_Avoid_: Relationship, relation, edge, backlink

**Connection Kind**:
How two connected Objects relate, chosen from a fixed list: related (the default), supports, contradicts, builds on, inspired by, mentions, authored by. Directed kinds read differently from each end (supports / supported by).
_Avoid_: Link type, relation type, predicate

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

### AI

**Archivist**:
The AI role that works automatically in the background to give newly captured Objects a type, extracted information and Suggestions.
_Avoid_: Auto-tagger, organizer bot

**Researcher**:
The AI role the owner starts on purpose to explore, question and analyze what is in the Garden.
_Avoid_: Chatbot, assistant, copilot

**AI Contribution**:
Anything with AI Origin. It takes one of three forms: applied directly but marked and undone in one click (Tags, and extracted facts about a Source such as its title, authors' names, date and format); a Suggestion; or an AI Note. Whatever touches structure or a Thought is always a Suggestion.
_Avoid_: AI output, AI content, generated content

**Suggestion**:
An AI Contribution that only takes effect once the owner approves it, such as a Connection, a change of Object Type, a new Object, or a title for a Thought. Anything rejected, including a removed AI Tag, is remembered and not proposed again unless the owner asks.
_Avoid_: Recommendation, auto-link

**Approve**:
The owner accepting a Suggestion as it is. It takes effect and joins the Garden's structure, but keeps its AI Origin and never becomes the owner's words or opinion. Editing a short value, such as a title, field or Tag name, is different: the edited value becomes the owner's.
_Avoid_: Endorse, accept, confirm

**Private**:
Marks an Object that no AI role may ever read, and whose content the Garden itself never sends to any outside service. Content the owner sends into the Garden through an outside route, such as a message to the phone Capture bot, has already passed through that route; Private protects it from the moment it arrives. The AI does not learn a Private Object exists, even where another Object mentions it. Private belongs to one Object only and is never inherited through Connections. The owner's own search and linking still work on Private Objects.
_Avoid_: Hidden, locked, secret

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
