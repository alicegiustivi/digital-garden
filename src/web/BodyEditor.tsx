import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

const toDoc = (paragraphs: string[]) => ({
  type: "doc",
  content: (paragraphs.length ? paragraphs : [""]).map((t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] })),
});

/**
 * The owner's body. Plain paragraphs for now (Mentions and Quotes come in later builds);
 * everything typed here is saved with Origin "owner".
 */
export function BodyEditor({ paragraphs, placeholder, autofocus, onSave }: { paragraphs: string[]; placeholder: string; autofocus?: boolean; onSave: (p: string[]) => void }) {
  const timer = useRef<number>(undefined);
  const pending = useRef<string[] | null>(null);
  const save = useRef(onSave);
  save.current = onSave;

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current) { save.current(pending.current); pending.current = null; }
  };

  const editor = useEditor({
    extensions: [
      // Only paragraphs: that's all the Garden stores in a body in this build.
      StarterKit.configure({
        heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false,
        codeBlock: false, code: false, bold: false, italic: false, strike: false, underline: false, link: false,
        horizontalRule: false, hardBreak: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: toDoc(paragraphs),
    autofocus: autofocus ? "end" : false,
    editorProps: { attributes: { "aria-label": "Your words", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      const next: string[] = [];
      editor.state.doc.forEach((node) => next.push(node.textContent));
      pending.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
    onBlur: flush,
  });

  useEffect(() => () => flush(), []);
  return <EditorContent editor={editor} className="body-editor" />;
}
