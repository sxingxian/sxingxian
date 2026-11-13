import { useCallback, useEffect, useState } from 'react';
import SaveButton from '../components/SaveButton';
import { api, errorText } from '../api';
import { ToggleRow, TopBar } from '../components/kit';
import Editor from '../editor/Editor';
import { useMediaPicker } from '../components/useMediaPicker';
import { useToast } from '../components/ui';
import type { DocNode, Page, PageSlug, SectionsSetting } from '../../lib/shared/types';
import { useAutosave } from '../autosave';

const CV_TEMPLATE: DocNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'sxingxian' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Your role · Singapore' }] },
    {
      type: 'columns',
      attrs: { widths: [34, 66], gap: 'l', stackOnMobile: true, dividers: false },
      content: [
        { type: 'column', content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Skills' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'TypeScript · Cloudflare · PostgreSQL' }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Education' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Degree · University · Year' }] },
        ] },
        { type: 'column', content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Experience' }] },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Role · Company · 2024 — now' }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What you owned, and the result it had' }] }] }] },
        ] },
      ],
    },
  ],
};

const para = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h2 = (text: string): DocNode => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const linkPara = (text: string, href: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }] });

// Suggested wording that matches how this site works. The "Last updated" date is shown by the page itself.
const PRIVACY_TEMPLATE: DocNode = {
  type: 'doc',
  content: [
    { type: 'callout', content: [para('Draft. Check it against how you actually run the site (and local law), then delete this note.')] },
    h2('What this site collects'),
    para('There are no reader accounts. The site sets no tracking cookies of its own; it remembers your light or dark theme choice in your browser only.'),
    para('To show which stories are read most, the site keeps a daily count of views for each story. The count holds no cookies, IP addresses or other details about you.'),
    h2('Advertising'),
    para('This site shows ads from Google AdSense. Google and its partners use cookies, web beacons and similar technologies, together with your IP address, to serve and measure ads based on your visits to this and other websites.'),
    linkPara('How Google uses information from sites that use its services', 'https://policies.google.com/technologies/partner-sites'),
    linkPara('Turn off personalised ads in Google’s Ad Settings', 'https://adssettings.google.com'),
    para('Visitors in the EEA, the UK and Switzerland are asked for consent by Google’s consent message before personalised ads are shown.'),
    h2('Sponsoring'),
    para('If you sponsor the site, you pay on Stripe’s or PayPal’s own pages; your card details never reach this site. The site keeps the amount, the date, the name and email the payment provider passes on, and any message you choose to leave. Stripe and PayPal handle your details under their own privacy policies.'),
    h2('Videos and maps from other sites'),
    para('Some pages include videos from YouTube, Vimeo or TikTok, or a map from OpenStreetMap. These load from the provider when you open the page, and the provider may set its own cookies and see your IP address.'),
    h2('Server logs'),
    para('The hosting provider (Cloudflare) processes IP addresses and request details to deliver the site and protect it from abuse.'),
    h2('Contact'),
    linkPara('Questions about this page: see the Contact page.', '/contact'),
  ],
};

const CONTACT_TEMPLATE: DocNode = {
  type: 'doc',
  content: [
    para('For questions about this site, its stories or photographs, or to ask for something to be corrected or taken down, write to:'),
    para('[YOUR EMAIL]'),
    para('I read everything and reply when I can.'),
  ],
};

const LABELS: Record<PageSlug, string> = { cv: 'CV', about: 'About', privacy: 'Privacy', contact: 'Contact' };
const STARTERS: Partial<Record<PageSlug, DocNode>> = { cv: CV_TEMPLATE, privacy: PRIVACY_TEMPLATE, contact: CONTACT_TEMPLATE };

export default function PageEditor({ slug }: { slug: PageSlug }) {
  const [page, setPage] = useState<Page | null>(null);
  const [sections, setSections] = useState<SectionsSetting | null>(null);
  const [err, setErr] = useState('');
  const { pickMedia, pickFile, pickImages, picker } = useMediaPicker();
  const [sheet, setSheet] = useState(false);
  const toast = useToast();
  // Bumped to rebuild the editor when the page's content is replaced from outside it (suggested wording).
  const [rev, setRev] = useState(0);

  useEffect(() => {
    setPage(null);
    api.get<{ page: Page }>(`/api/admin/pages/${slug}`)
      .then(({ page: p }) => {
        const empty = !p.body.content || p.body.content.length === 0;
        const starter = STARTERS[slug];
        setPage(empty && starter ? { ...p, body: starter } : p);
      })
      .catch((e) => setErr(errorText(e)));
    api.get<{ value: SectionsSetting }>('/api/admin/settings/sections').then((r) => setSections(r.value)).catch(() => {});
  }, [slug]);

  // Autosave. A starter template shown on an empty page is the baseline, so it's only saved once you edit it.
  const persist = useCallback(async (snap: string) => {
    await api.put(`/api/admin/pages/${slug}`, JSON.parse(snap) as Pick<Page, 'title' | 'body' | 'noindex'>);
  }, [slug]);
  const auto = useAutosave(page ? JSON.stringify({ title: page.title, body: page.body, noindex: page.noindex }) : null, persist);
  const { saveNow } = auto;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);


  const toggleSection = async (on: boolean) => {
    if (!sections || slug === 'privacy') return;
    const next = { ...sections, [slug]: on };
    try {
      const r = await api.put<{ value: SectionsSetting }>('/api/admin/settings/sections', next);
      setSections(r.value);
      toast(on ? `${LABELS[slug]} is on the site` : `${LABELS[slug]} hidden from the site`);
    } catch (e) {
      toast(errorText(e));
    }
  };

  // Privacy: add the suggested wording after whatever is already written, so nothing is lost.
  const addSuggested = () => {
    setPage((p) => (p ? { ...p, body: { type: 'doc', content: [...(p.body.content ?? []), ...(PRIVACY_TEMPLATE.content ?? [])] } } : p));
    setRev((n) => n + 1);
    toast('Suggested wording added at the end');
  };

  if (!page) return <div className="page"><p className={err ? 'err-text' : 'hint'}>{err || 'Loading…'}</p></div>;
  const label = LABELS[slug];

  return (
    <>
      <TopBar section={slug} actions={<>
          <span className={`status${auto.state === 'error' ? ' err' : ''}`} role="status" aria-live="polite">{auto.label}</span>
          <a className="btn" href={`/${slug}`} target="_blank" rel="noopener">Preview ↗</a>
          <button type="button" className="btn publish-btn" onClick={() => setSheet(true)} aria-expanded={sheet}>Page…</button>
          <SaveButton auto={auto} />
        </>} />
      {(err || auto.error) && <div className="page" style={{ paddingBottom: 0 }}><div className="alert err" role="alert">{err || `Couldn’t save: ${auto.error}. Retrying automatically.`}</div></div>}
      <div className="editor-layout">
        <div className="editor-main">
          <div className={`doc${slug === 'cv' ? ' sheet' : ''}`}>
            {slug !== 'cv' && (
              <input className="title-input" value={page.title} placeholder={label} aria-label="Page title" onChange={(e) => setPage({ ...page, title: e.target.value })} />
            )}
            <Editor key={`${slug}-${rev}`} content={page.body} allowH1={slug === 'cv'} pickMedia={pickMedia} pickFile={pickFile} pickImages={pickImages} onChange={(body) => setPage((p) => (p ? { ...p, body } : p))} />
          </div>
        </div>
        {sheet && <button type="button" className="sheet-back phone-only" aria-label="Close page settings" onClick={() => setSheet(false)} />}
        <aside className={`editor-side${sheet ? ' open' : ''}`} aria-label="Page settings">
          <span className="grip" aria-hidden="true" />
          <div className="side-head">
            <h2>Page</h2>
            <button type="button" className="btn small sheet-close" onClick={() => setSheet(false)}>Done</button>
          </div>
          <div className="side-toggles">
            {sections && slug !== 'privacy' && <ToggleRow label="Show on the site" hint={slug === 'contact' ? 'Adds it to the bottom of every page' : 'Adds it to the menu'} checked={sections[slug]} onChange={(v) => void toggleSection(v)} />}
            <ToggleRow label="Hide from search engines" hint={slug === 'cv' ? 'Public page: leave out phone and address.' : undefined} checked={page.noindex} onChange={(v) => { setPage({ ...page, noindex: v }); saveNow(); }} />
          </div>
          {slug === 'privacy' && (
            <>
              <button type="button" className="btn" onClick={addSuggested}>Add suggested wording</button>
              <p className="field-hint">Adds a draft covering ads, cookies, sponsoring and embedded videos at the end of the page. The “Last updated” date is shown automatically.</p>
            </>
          )}
          {slug === 'contact' && <p className="field-hint">Shown once it has content and is switched on. Give an email address readers can write to.</p>}
          {slug === 'cv' && <p className="field-hint">Type “/2 columns” or “/3 columns” in the page for layouts.</p>}
        </aside>
      </div>
      {picker}
    </>
  );
}
