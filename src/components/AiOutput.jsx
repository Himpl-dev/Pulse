import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { TOKENS } from '../theme';

// `html`, when given, is written to the clipboard alongside a plain-text
// fallback so pastes into rich editors (email, Word, Slack) keep real
// formatting instead of raw "**"/"##" markdown.
export function CopyButton({ text, html, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch (err) {
        console.error('Copy failed', err);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium flex-shrink-0"
      style={{ background: TOKENS.surface2, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}
    >
      {copied ? <Check size={13} style={{ color: TOKENS.teal }} /> : <Copy size={13} />}
      {(copied || label) && (copied ? 'Copied' : label)}
    </button>
  );
}
