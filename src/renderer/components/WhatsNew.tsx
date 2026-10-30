import { Fragment, useMemo, type ReactNode } from 'react';
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

function renderBlock(b: Block, k: number): ReactNode {
  switch (b.kind) {
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
      width={600}
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
