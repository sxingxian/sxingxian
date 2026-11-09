// "/" command menu, Notion style.
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { columnsContent, type FileKind, type PickedFile, type PickedMedia } from './nodes';

interface Item {
  group: string;
  title: string;
  hint: string;
  icon: string;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
}

function pickMedia(editor: Editor): Promise<PickedMedia | null> {
  const fn = (editor.storage as unknown as { sx?: { pickMedia: (() => Promise<PickedMedia | null>) | null } }).sx?.pickMedia;
  return fn ? fn() : Promise.resolve(null);
}

function pickFile(editor: Editor, kind: FileKind): Promise<PickedFile | null> {
  const fn = (editor.storage as unknown as { sx?: { pickFile: ((k: FileKind) => Promise<PickedFile | null>) | null } }).sx?.pickFile;
  return fn ? fn(kind) : Promise.resolve(null);
}

const ITEMS: Item[] = [
  { group: 'Basic', title: 'Text', hint: 'Plain paragraph', icon: '¶', keywords: 'paragraph text', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { group: 'Basic', title: 'Heading', hint: 'Section heading', icon: 'H2', keywords: 'h2 heading title', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { group: 'Basic', title: 'Subheading', hint: 'Smaller heading', icon: 'H3', keywords: 'h3 subheading', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { group: 'Basic', title: 'Bulleted list', hint: 'Simple list', icon: '•', keywords: 'bullet unordered list ul', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { group: 'Basic', title: 'Numbered list', hint: 'Ordered list', icon: '1.', keywords: 'numbered ordered list ol', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { group: 'Basic', title: 'Quote', hint: 'Pull quote', icon: '“', keywords: 'quote blockquote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { group: 'Basic', title: 'Callout', hint: 'Highlighted note', icon: '!', keywords: 'callout note info', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'callout', content: [{ type: 'paragraph' }] }).run() },
  { group: 'Basic', title: 'Code', hint: 'Code block', icon: '</>', keywords: 'code pre snippet', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { group: 'Basic', title: 'Divider', hint: 'Horizontal line', icon: '—', keywords: 'divider hr line rule', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  {
    group: 'Media', title: 'Image', hint: 'Upload or choose', icon: '▣', keywords: 'image photo picture upload media',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      void pickMedia(e).then((m) => {
        if (m) e.chain().focus().insertContent({ type: 'figure', attrs: { mediaId: m.id, alt: m.alt } }).run();
      });
    },
  },
  { group: 'Media', title: 'Video', hint: 'YouTube or Vimeo', icon: '▶', keywords: 'video youtube vimeo embed film', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'embed' }).run() },
  { group: 'Media', title: 'YouTube Short', hint: 'Vertical video', icon: '▯', keywords: 'shorts youtube short vertical reel', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'embed', attrs: { portrait: true } }).run() },
  { group: 'Media', title: 'TikTok', hint: 'TikTok video', icon: '♪', keywords: 'tiktok tik tok vertical reel', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'embed', attrs: { portrait: true } }).run() },
  { group: 'Media', title: 'Map', hint: 'Place or coordinates', icon: '⌖', keywords: 'map location place address pin osm google', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'map' }).run() },
  {
    group: 'Files', title: 'PDF preview', hint: 'Pages readable on the page', icon: 'PDF', keywords: 'pdf file document preview pages viewer',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      void pickFile(e, 'pdf').then((f) => {
        if (f) e.chain().focus().insertContent({ type: 'pdf', attrs: { mediaId: f.id, name: f.name, bytes: f.bytes, download: false } }).run();
      });
    },
  },
  {
    group: 'Files', title: 'File attachment', hint: 'Doc, sheet, text, calendar…', icon: '⎙', keywords: 'file attachment download document doc docx xlsx pptx txt md markdown csv ics calendar pdf',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      void pickFile(e, 'file').then((f) => {
        if (f) e.chain().focus().insertContent({ type: 'file', attrs: { mediaId: f.id, name: f.name, mime: f.mime, bytes: f.bytes } }).run();
      });
    },
  },
  {
    group: 'Files', title: 'File link in text', hint: 'Inside the sentence', icon: '↓', keywords: 'file link inline download attachment',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      void pickFile(e, 'file').then((f) => {
        if (f) e.chain().focus().insertContent([{ type: 'fileLink', attrs: { mediaId: f.id, name: f.name, mime: f.mime, bytes: f.bytes } }, { type: 'text', text: ' ' }]).run();
      });
    },
  },
  { group: 'Layout', title: '2 columns', hint: 'Resizable', icon: '▥', keywords: 'columns two 2 layout grid', run: (e, r) => e.chain().focus().deleteRange(r).insertContent(columnsContent(2)).run() },
  { group: 'Layout', title: '3 columns', hint: 'Resizable', icon: '▦', keywords: 'columns three 3 layout grid', run: (e, r) => e.chain().focus().deleteRange(r).insertContent(columnsContent(3)).run() },
];

interface MenuRef {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const Menu = forwardRef<MenuRef, SuggestionProps<Item>>(function Menu(props, ref) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [props.items]);
  useEffect(() => {
    document.querySelector('.menu [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const choose = (i: number) => {
    const item = props.items[i];
    if (item) props.command(item);
  };
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') { setIndex((i) => (i + 1) % Math.max(props.items.length, 1)); return true; }
      if (event.key === 'ArrowUp') { setIndex((i) => (i - 1 + props.items.length) % Math.max(props.items.length, 1)); return true; }
      if (event.key === 'Enter') { choose(index); return true; }
      return false;
    },
  }));
  if (props.items.length === 0) return <div className="menu"><div className="group">No matches</div></div>;
  let lastGroup = '';
  return (
    <div className="menu" role="listbox" aria-label="Insert block">
      {props.items.map((item, i) => {
        const header = item.group !== lastGroup ? <div className="group" key={`g-${item.group}`}>{item.group}</div> : null;
        lastGroup = item.group;
        return (
          <div key={item.title}>
            {header}
            <button type="button" role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => { e.preventDefault(); choose(i); }}>
              <span className="ico" aria-hidden="true">{item.icon}</span>
              <span><span className="t">{item.title}</span><br /><span className="d">{item.hint}</span></span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

function place(el: HTMLElement, rect: (() => DOMRect | null) | null | undefined) {
  const r = rect?.();
  if (!r) return;
  el.style.position = 'fixed';
  el.style.zIndex = '1000';
  el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 316))}px`;
  const below = r.bottom + 6;
  el.style.top = below + 340 > window.innerHeight ? `${Math.max(8, r.top - 346)}px` : `${below}px`;
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<Item, Item>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return $from.parent.type.name !== 'codeBlock';
        },
        items: ({ query }) => {
          const q = query.toLowerCase().trim();
          return q ? ITEMS.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.includes(q)) : ITEMS;
        },
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let comp: ReactRenderer<MenuRef, SuggestionProps<Item>> | null = null;
          return {
            onStart: (props) => {
              comp = new ReactRenderer(Menu, { props, editor: props.editor });
              document.body.appendChild(comp.element);
              place(comp.element as HTMLElement, props.clientRect);
            },
            onUpdate: (props) => {
              comp?.updateProps(props);
              if (comp) place(comp.element as HTMLElement, props.clientRect);
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                comp?.element.remove();
                return true;
              }
              return comp?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              comp?.element.remove();
              comp?.destroy();
              comp = null;
            },
          };
        },
      }),
    ];
  },
});
