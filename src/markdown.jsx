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

// Turns the same small markdown subset renderMarkdown() understands
// (#/##/### headings, **bold**, "- " bullets) into a real downloadable PDF —
// reusable by any panel with generated markdown output (Travel, and
// Documentation if it wants this too later). jsPDF is only ever loaded here,
// dynamically, so nobody pays for it unless this function actually runs.
export async function downloadMarkdownAsPdf(filename, title, markdownText) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 15;
  let y = margin;

  function ensureSpace(needed) {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function writeWrapped(text, x, width, size, bold) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.splitTextToSize(text, width).forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, x, y);
      y += lineHeight;
    });
  }

  if (title) {
    writeWrapped(title, margin, maxWidth, 16, true);
    y += 10;
  }

  for (const raw of markdownText.split('\n')) {
    const line = raw.trim();
    if (!line) {
      y += lineHeight * 0.6;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      y += 6;
      writeWrapped(heading[2].replace(/\*\*/g, ''), margin, maxWidth, heading[1].length === 1 ? 14 : 12, true);
      y += 4;
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const text = (bullet ? bullet[1] : line).replace(/\*\*(.*?)\*\*/g, '$1');
    writeWrapped(bullet ? `•  ${text}` : text, margin + (bullet ? 14 : 0), maxWidth - (bullet ? 14 : 0), 11, false);
  }

  doc.save(filename);
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
