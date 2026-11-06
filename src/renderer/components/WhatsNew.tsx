import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Modal } from '../ui';
import { inAppBlocks, parseMarkdown, type Block, type Inline, type ReleaseNotes } from '../../shared/releaseNotes';
import { Sparkles } from './Icons';

/** Renders parsed Markdown as React elements (never as HTML). Links open in the browser. */
function renderInline(items: Inline[]): ReactNode {
  return items.map((i, k) => {
    switch (i.kind) {
      case 'text':
        return <Fragment key={k}>{i.text}</Fragment>;
      case 'bold':
        return <strong key={k}>{renderInline(i.children)}</strong>;
      case 'italic':
        return <em key={k}>{renderInline(i.children)}</em>;
      case 'code':
        return <code key={k}>{i.text}</code>;
      case 'link':
        return (
          <a
            key={k}
            href={i.href}
            onClick={(e) => {
              e.preventDefault();
              void api.openExternalLink(i.href);
            }}
          >
            {renderInline(i.children)}
          </a>
        );
    }
  });
}

/** A screenshot from the release text (GitHub only, see releaseImageAllowed). Click = full size in the browser;
 *  if it can't load (offline), its description is shown instead. */
function ReleaseImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return alt ? <p className="release-image-missing">Image: {alt}</p> : null;
  return (
    <a
      className="release-image"
      href={src}
      title="Open full size"
      onClick={(e) => {
        e.preventDefault();
        void api.openExternalLink(src);
      }}
    >
      <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    </a>
  );
}

function renderBlock(b: Block, k: number): ReactNode {
  switch (b.kind) {
    case 'image':
      return <ReleaseImage key={k} src={b.src} alt={b.alt} />;
    case 'heading':
      // Release texts use ## / ### for their sections; they all look like section titles here.
      return b.level <= 3 ? <h3 key={k}>{renderInline(b.content)}</h3> : <h4 key={k}>{renderInline(b.content)}</h4>;
    case 'paragraph':
      return <p key={k}>{renderInline(b.content)}</p>;
    case 'list': {
      const items = b.items.map((it, j) => (
        <li key={j}>
          {renderInline(it.content)}
          {it.sub && renderBlock(it.sub, 0)}
        </li>
      ));
      return b.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>;
    }
  }
}

/** "What's new in <version>": the release text, shown once after an update (and from Settings → Updates). */
export function WhatsNewDialog({ notes, close }: { notes: ReleaseNotes; close: () => void }) {
  const blocks = useMemo(() => inAppBlocks(parseMarkdown(notes.notes), notes.version), [notes]);
  return (
    <Modal
      title={
        <span className="whats-new-title">
          <span className="whats-new-icon">
            <Sparkles size={18} />
          </span>
          What's new in {notes.version}
        </span>
      }
      onClose={close}
      // Wider when there are screenshots, so they stay readable.
      width={blocks.some((b) => b.kind === 'image') ? 760 : 600}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => void api.openExternalLink(notes.url.replace(/\/tag\/[^/]*$/, ''))}>
            All releases on GitHub
          </button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={close} autoFocus>
            Got it
          </button>
        </>
      }
    >
      <div className="release-notes">
        {blocks.length ? blocks.map(renderBlock) : <p className="muted">This version has no release notes.</p>}
      </div>
    </Modal>
  );
}
