import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { TOKENS } from '../theme';

export function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed', err);
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
