// One way for editors to ask for media: a photo, a PDF/file, or several photos for a gallery.
// Returns the three ask-functions (each resolves to null if the dialog is closed) and the dialog to render.
import { useCallback, useState } from 'react';
import MediaPicker, { type PickerAccept } from './MediaPicker';
import type { MediaItem } from '../../lib/shared/types';
import type { PickedFile, PickedImage, PickedMedia, FileKind } from '../editor/nodes';

interface Open {
  accept: PickerAccept;
  multiple?: number;
  resolve: (items: MediaItem[] | null) => void;
}

export function useMediaPicker() {
  const [open, setOpen] = useState<Open | null>(null);

  const ask = useCallback(
    (accept: PickerAccept, multiple?: number) =>
      new Promise<MediaItem[] | null>((resolve) => setOpen({ accept, multiple, resolve })),
    [],
  );

  const pickMedia = useCallback(async (): Promise<PickedMedia | null> => {
    const m = (await ask('images'))?.[0];
    return m ? { id: m.id, alt: m.alt } : null;
  }, [ask]);

  const pickFile = useCallback(async (kind: FileKind): Promise<PickedFile | null> => {
    const m = (await ask(kind === 'pdf' ? 'pdf' : 'files'))?.[0];
    return m ? { id: m.id, name: m.filename, mime: m.mime, bytes: Number(m.bytes) || 0 } : null;
  }, [ask]);

  const pickImages = useCallback(async (max: number): Promise<PickedImage[] | null> => {
    if (max < 1) return [];
    const list = await ask('images', max);
    return list
      ? list.map((m) => ({ id: m.id, alt: m.alt, w: Number(m.width) || 0, h: Number(m.height) || 0 }))
      : null;
  }, [ask]);

  const finish = (items: MediaItem[] | null) => {
    open?.resolve(items);
    setOpen(null);
  };

  const picker = open ? (
    <MediaPicker
      accept={open.accept}
      multiple={open.multiple}
      onPick={(m) => finish([m])}
      onPickMany={open.multiple ? (ms) => finish(ms) : undefined}
      onClose={() => finish(null)}
    />
  ) : null;

  return { pickMedia, pickFile, pickImages, picker };
}
