// Mentions in a body (issue #7). Typing @ or [[ searches Objects by name. A Mention is stored in the text as [[o:<id>]]
// and drawn as a quiet link inside a paragraph, or as an Object Card when it stands on a line of its own.
// The card is only displayed: nothing about kinds, notes or counts is ever written into the text.
import { createContext, useContext } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Suggestion, { exitSuggestion } from "@tiptap/suggestion";
import type { MentionInfo } from "./api";
import { Icon, TagPill, typeVar } from "./ui";

export type MentionCtx = { info: Record<string, MentionInfo>; typeLabel: (type: string) => string; open: (id: string, beside: boolean) => void };
export const MentionContext = createContext<MentionCtx>({ info: {}, typeLabel: (t) => t, open: () => {} });

/** What the picker hands back to the extension. */
export type Controller = {
  start: (p: any, close: () => void) => void;
  update: (p: any) => void;
  key: (event: KeyboardEvent) => boolean;
  exit: () => void;
};

function MentionView({ node }: NodeViewProps) {
  const { info, typeLabel, open } = useContext(MentionContext);
  const id = node.attrs.id as string;
  const m = info[id];
  if (!m) return <NodeViewWrapper as="span" className="mention-wrap"><span className="mention loading">…</span></NodeViewWrapper>;
  if (m.missing)
    return (
      <NodeViewWrapper as="span" className="mention-wrap">
        <span className="mention missing" title={m.inBin ? "Deleted for now. Restore it from the Bin (under More) and this reads normally again." : "This Object was deleted for good"}>{m.inBin ? "in the Bin" : "missing Object"}</span>
      </NodeViewWrapper>
    );
  const go = (e: React.MouseEvent) => { e.preventDefault(); open(id, e.altKey); };
  const count = m.connectionCount ?? 0;
  return (
    <NodeViewWrapper as="span" className="mention-wrap" style={typeVar(m.type!)}>
      <a className="mention" href={`#/o/${id}`} onClick={go} title={`${typeLabel(m.type!)}. ⌥-click opens it beside this one.`}>
        <Icon name={m.type!} />{m.title}
      </a>
      <a className="object-card" href={`#/o/${id}`} onClick={go} contentEditable={false}>
        <span className="oc-kind"><Icon name={m.type!} /> {typeLabel(m.type!)}{m.private && <> · <Icon name="lock" /> Private</>}</span>
        <span className="oc-title">{m.title}</span>
        {!!m.tags?.length && <span className="oc-tags">{m.tags.map((t) => <TagPill key={t.id} tag={t} />)}</span>}
        <span className="oc-meta">{m.label ? `${m.label} · ` : ""}{count} {count === 1 ? "Connection" : "Connections"}</span>
      </a>
    </NodeViewWrapper>
  );
}

const aloneKey = new PluginKey("mention-alone");

export const MentionNode = Node.create<{ controller: () => Controller | null }>({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() { return { controller: () => null }; },
  addAttributes() { return { id: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-mention]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes({ "data-mention": "" }, { "data-id": HTMLAttributes.id })]; },
  addNodeView() { return ReactNodeViewRenderer(MentionView, { as: "span" }); },

  addProseMirrorPlugins() {
    const get = this.options.controller;
    const ctl = { get current() { return get(); } };
    const suggest = (char: string, key: string, prefixes: string[] | null) => {
      const pluginKey = new PluginKey(key);
      return Suggestion({
        editor: this.editor,
        char,
        pluginKey,
        allowSpaces: true,
        allowedPrefixes: prefixes,
        items: () => [],
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { id: props.id } }, { type: "text", text: " " }]).run();
        },
        render: () => ({
          onStart: (p) => ctl.current?.start(p, () => exitSuggestion(this.editor.view, pluginKey)),
          onUpdate: (p) => ctl.current?.update(p),
          onKeyDown: ({ event }) => ctl.current?.key(event) ?? false,
          onExit: () => ctl.current?.exit(),
        }),
      });
    };
    // A paragraph holding only one Mention (and spaces) is a line of its own: it shows as an Object Card.
    const alone = new Plugin({
      key: aloneKey,
      props: {
        decorations: (state) => {
          const decos: Decoration[] = [];
          state.doc.forEach((node, offset) => {
            if (node.type.name !== "paragraph") return;
            let mentions = 0, other = false;
            node.forEach((c) => { if (c.type.name === "mention") mentions++; else if (!(c.isText && !c.text!.trim())) other = true; });
            if (mentions === 1 && !other) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "card-line" }));
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    });
    return [suggest("@", "mention-at", [" "]), suggest("[[", "mention-brackets", null), alone];
  },
});

export { exitSuggestion };
