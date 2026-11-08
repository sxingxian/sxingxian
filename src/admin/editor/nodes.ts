// Custom block nodes for the Notion-style editor. The public renderer
// (src/lib/server/render.ts) understands exactly these node names and attrs.
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FigureView, EmbedView, ColumnsView, MapView } from './views';

export interface PickedMedia {
  id: string;
  alt: string;
}

/** Shared editor storage: lets slash commands open the media picker. */
export const SxStorage = Extension.create({
  name: 'sx',
  addStorage() {
    return { pickMedia: null as null | (() => Promise<PickedMedia | null>) };
  },
});

export const Figure = Node.create({
  name: 'figure',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      mediaId: { default: null },
      alt: { default: '' },
      caption: { default: '' },
      size: { default: 'normal' },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-type="figure"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-type': 'figure' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FigureView);
  },
});

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      provider: { default: null },
      videoId: { default: '' },
      portrait: { default: false },
      caption: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});

// A location on an OpenStreetMap map (no API key). The public page links to the full map.
export const MapBlock = Node.create({
  name: 'map',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      lat: { default: null },
      lon: { default: null },
      zoom: { default: 15 },
      label: { default: '' },
      caption: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="map"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'map' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MapView);
  },
});

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['aside', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'callout' }), 0];
  },
});

// A column holds normal blocks but never another column layout.
export const Column = Node.create({
  name: 'column',
  content: '(paragraph | heading | bulletList | orderedList | blockquote | codeBlock | horizontalRule | figure | embed | map | callout)+',
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'col-node' }), 0];
  },
});

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  defining: true,
  draggable: true,
  addAttributes() {
    return {
      widths: {
        default: [50, 50],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-widths') ?? '[50,50]');
          } catch {
            return [50, 50];
          }
        },
        renderHTML: (attrs) => ({ 'data-widths': JSON.stringify(attrs.widths) }),
      },
      gap: { default: 'm' },
      stackOnMobile: { default: true },
      dividers: { default: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'columns' }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView);
  },
});

export function columnsContent(count: 2 | 3) {
  const widths = count === 2 ? [50, 50] : [33, 34, 33];
  return {
    type: 'columns',
    attrs: { widths },
    content: Array.from({ length: count }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })),
  };
}
