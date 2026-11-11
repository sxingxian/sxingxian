import { useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/**
 * A textarea that is always exactly as tall as its text: when it first shows saved text,
 * as you type, when the width changes (rotating a phone, opening the side panel) and once
 * the web fonts have loaded (their line heights differ from the fallback font's).
 */
export default function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, []);

  useLayoutEffect(fit, [fit, props.value]);

  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    let width = t.clientWidth;
    const ro = new ResizeObserver(() => { if (t.clientWidth !== width) { width = t.clientWidth; fit(); } });
    ro.observe(t);
    let live = true;
    document.fonts?.ready.then(() => { if (live) fit(); }).catch(() => {});
    return () => { live = false; ro.disconnect(); };
  }, [fit]);

  return <textarea rows={1} {...props} ref={ref} />;
}
