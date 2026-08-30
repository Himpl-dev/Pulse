import React from 'react';
import { TOKENS } from './theme';

export function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Lightweight, dependency-free renderer for the small subset of markdown the
// AI features (digest/summarize/documentation) actually produce: #/##/###
// headings, **bold**, and (possibly nested) "- " bullet lists.
function renderMarkdownInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
  );
}

export function renderMarkdown(text) {
  const lines = text.split('\n');
  const elements = [];
  let key = 0;
  let i = 0;

  function renderList(minIndent) {
    const items = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') { i++; continue; }
      const indent = line.match(/^(\s*)/)[1].length;
      const bulletMatch = line.trim().match(/^[-*]\s+(.*)$/);
      if (!bulletMatch || indent < minIndent) break;
      if (indent > minIndent) {
        const nested = renderList(indent);
        if (items.length > 0) items[items.length - 1].children = nested;
        continue;
      }
      items.push({ text: bulletMatch[1] });
      i++;
    }
    const listKey = key++;
    return (
      <ul key={`ul-${listKey}`} className="list-disc pl-5 space-y-1">
        {items.map((item, idx) => (
          <li key={idx}>
            {renderMarkdownInline(item.text, `li-${listKey}-${idx}`)}
            {item.children}
          </li>
        ))}
      </ul>
    );
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') { i++; continue; }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level === 1 ? 'text-base font-display font-semibold mt-3 mb-1.5' : 'text-sm font-display font-semibold mt-3 mb-1';
      elements.push(<p key={`h-${key}`} className={cls} style={{ color: TOKENS.text }}>{renderMarkdownInline(headingMatch[2], `h-${key++}`)}</p>);
      i++;
      continue;
    }

    const indent = line.match(/^(\s*)/)[1].length;
    if (trimmed.match(/^[-*]\s+/)) {
      elements.push(renderList(indent));
      continue;
    }

    elements.push(<p key={`p-${key}`} className="mb-1.5">{renderMarkdownInline(trimmed, `p-${key++}`)}</p>);
    i++;
  }

  return elements;
}
