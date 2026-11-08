// The Notion-style block editor used for posts, work, galleries, films, CV and About.
import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor as TEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import DragHandle from '@tiptap/extension-drag-handle-react';
import { Callout, Column, Columns, Embed, Figure, MapBlock, SxStorage, type PickedMedia } from './nodes';
import { SlashCommand } from './slash';
import { isSafeHref } from '../../lib/shared/safe';
import { useDialog } from '../components/dialog';
import type { DocNode } from '../../lib/shared/types';

interface Props {
  content: DocNode;
  onChange: (doc: DocNode) => void;
  pickMedia: () => Promise<PickedMedia | null>;
  allowH1?: boolean;
}

async function setLink(editor: TEditor, dialog: ReturnType<typeof useDialog>) {
  const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
  const url = await dialog.prompt({
    title: prev ? 'Edit link' : 'Add link',
    defaultValue: prev,
    placeholder: 'https://…  ·  /cv  ·  mailto:',
    inputMode: 'url',
    confirmLabel: 'Apply',
    validate: (v) => (v.trim() === '' || isSafeHref(v.trim()) ? null : 'Use https://, a page like /cv, or mailto:'),
  });
  if (url === null) return void editor.chain().focus().run();
  if (url.trim() === '') return void editor.chain().focus().extendMarkRange('link').unsetLink().run();
  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
}

export default function Editor({ content, onChange, pickMedia, allowH1 = false }: Props) {
  const dialog = useDialog();
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: allowH1 ? [1, 2, 3, 4] : [2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          isAllowedUri: (url) => isSafeHref(url),
          shouldAutoLink: (url) => /^https:\/\//.test(url),
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : "Type '/' for blocks"),
      }),
      SxStorage,
      Figure,
      Embed,
      MapBlock,
      Callout,
      Column,
      Columns,
      SlashCommand,
    ],
    content: content && content.type === 'doc' ? content : { type: 'doc', content: [] },
    onUpdate: ({ editor }) => changeRef.current(editor.getJSON() as DocNode),
  });

  useEffect(() => {
    if (editor) (editor.storage as unknown as { sx: { pickMedia: Props['pickMedia'] } }).sx.pickMedia = pickMedia;
  }, [editor, pickMedia]);

  if (!editor) return <div className="tiptap" aria-busy="true" />;

  return (
    <div className="editor-wrap">
      <DragHandle editor={editor}>
        <div className="drag-grip" title="Drag to move · click to select" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" /></svg>
        </div>
      </DragHandle>
      <BubbleMenu
        editor={editor}
        shouldShow={({ state }) => !state.selection.empty && !(state.selection instanceof NodeSelection)}
      >
        <div className="bubble" role="toolbar" aria-label="Formatting">
          <button type="button" aria-pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button type="button" aria-pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button type="button" aria-pressed={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
          <button type="button" aria-pressed={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
          <button type="button" aria-pressed={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>{'</>'}</button>
          <button type="button" aria-pressed={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <button type="button" aria-pressed={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
          <button type="button" aria-pressed={editor.isActive('link')} onClick={() => void setLink(editor, dialog)}>Link</button>
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
