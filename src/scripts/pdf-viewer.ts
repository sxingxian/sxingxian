// Loader for PDF previews: does nothing unless the page has a PDF block, then pulls in the viewer
// (PDF.js) on demand. Kept tiny so pages without PDFs pay nothing.
const figs = document.querySelectorAll<HTMLElement>('figure.pdf[data-pdf]');
if (figs.length) {
  void import('./pdf-viewer-core').then(({ mountAll }) => mountAll(figs)).catch(() => {
    figs.forEach((f) => {
      const note = f.querySelector('.pdf-note');
      if (note) note.textContent = 'The preview couldn’t load.';
    });
  });
}
