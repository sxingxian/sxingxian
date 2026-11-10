// Enter at the end of a heading continues in normal text, on every device.
//
// On desktop the Enter key runs Tiptap's splitBlock, which already does this. On iPhone/iPad the
// editor lets Safari insert the new line itself (preventing it confuses the on-screen keyboard)
// and reads the result back. When the Return press arrives during predictive text it isn't seen
// as an Enter key, and Safari copies the heading onto the new line, so the heading "sticks".
//
// This plugin fixes the outcome, whatever produced it: if a change leaves the cursor in a new,
// empty heading right after the heading the cursor was at the end of, that new block becomes a
// paragraph. Splitting a heading in the middle (text moves down) is left alone, as are headings
// made on purpose (slash menu, toolbar, "## "), because those change a block instead of adding one.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

export const HeadingExit = Extension.create({
  name: 'headingExit',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingExit'),
        appendTransaction: (trs, oldState, newState) => {
          if (!trs.some((tr) => tr.docChanged)) return null;
          const before = oldState.selection;
          const after = newState.selection;
          if (!before.empty || !after.empty) return null;

          // Before: the cursor was at the end of a heading.
          const $old = before.$from;
          if ($old.parent.type.name !== 'heading' || $old.parentOffset !== $old.parent.content.size) return null;

          // After: the cursor is in an empty heading, directly after another heading.
          const $new = after.$from;
          const block = $new.parent;
          if (block.type.name !== 'heading' || block.content.size !== 0 || $new.depth < 1) return null;
          const index = $new.index($new.depth - 1);
          if (index === 0) return null;
          const prev = $new.node($new.depth - 1).child(index - 1);
          if (prev.type.name !== 'heading') return null;

          // A block was added (not just retyped) in the same container…
          const oldContainer = $old.node($old.depth - 1);
          const newContainer = $new.node($new.depth - 1);
          if (newContainer.childCount !== oldContainer.childCount + 1) return null;

          // …and the cursor moved out of the heading it was in, into the block straight after it.
          // (Rules out e.g. a trailing paragraph being appended while the cursor stays put.)
          const mapping = new Mapping();
          for (const tr of trs) mapping.appendMapping(tr.mapping);
          const oldStart = mapping.map($old.before(), -1);
          const newStart = $new.before();
          if (newStart === oldStart || newStart - prev.nodeSize !== oldStart) return null;

          const paragraph = newState.schema.nodes.paragraph;
          if (!paragraph || !newContainer.canReplaceWith(index, index + 1, paragraph)) return null;

          const pos = $new.before();
          const tr = newState.tr.setNodeMarkup(pos, paragraph);
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));
          return tr;
        },
      }),
    ];
  },
});
