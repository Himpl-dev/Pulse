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

  // Renders a single line of body text, honouring inline **bold** runs by
  // laying words out one at a time and wrapping manually (jsPDF has no rich
  // text). Headings still go through writeWrapped since they're wholly bold.
  function writeRich(text, x, width, size) {
    doc.setFontSize(size);
    const segments = [];
    text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      const bold = part.startsWith('**') && part.endsWith('**');
      const clean = bold ? part.slice(2, -2) : part;
      clean.split(/(\s+)/).forEach((word) => {
        if (word !== '') segments.push({ word, bold });
      });
    });
    let lineX = x;
    ensureSpace(lineHeight);
    for (const seg of segments) {
      doc.setFont('helvetica', seg.bold ? 'bold' : 'normal');
      const w = doc.getTextWidth(seg.word);
      if (lineX + w > x + width && lineX > x) {
        y += lineHeight;
        ensureSpace(lineHeight);
        lineX = x;
        if (/^\s+$/.test(seg.word)) continue;
      }
      doc.text(seg.word, lineX, y);
      lineX += w;
    }
    y += lineHeight;
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
    if (bullet) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      ensureSpace(lineHeight);
      doc.text('•', margin, y);
      writeRich(bullet[1], margin + 14, maxWidth - 14, 11);
    } else {
      writeRich(line, margin, maxWidth, 11);
    }
  }

  doc.save(filename);
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => HTML_ESCAPES[c]);
const inlineToHtml = (s) => escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
const stripInline = (s) => s.replace(/\*\*([^*]+)\*\*/g, '$1');

// Converts the same markdown subset renderMarkdown() handles into an HTML
// string — used for "copy" so the clipboard carries formatted text (real
// bold, real bullets) instead of raw "**" / "##" markup.
export function markdownToHtml(text) {
  const lines = text.split('\n');
  let html = '';
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
    return `<ul>${items.map((it) => `<li>${inlineToHtml(it.text)}${it.children || ''}</li>`).join('')}</ul>`;
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') { i++; continue; }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html += `<h${level}>${inlineToHtml(headingMatch[2])}</h${level}>`;
      i++;
      continue;
    }

    const indent = line.match(/^(\s*)/)[1].length;
    if (trimmed.match(/^[-*]\s+/)) {
      html += renderList(indent);
      continue;
    }

    html += `<p>${inlineToHtml(trimmed)}</p>`;
    i++;
  }

  return html;
}

// Plain-text form of the same subset: drops "#" and "**" markers and turns
// "- " bullets into "• " so a plain-text paste still reads cleanly.
export function markdownToPlainText(text) {
  return text
    .split('\n')
    .map((raw) => {
      const line = raw.replace(/\s+$/, '');
      const heading = line.trim().match(/^(#{1,3})\s+(.*)$/);
      if (heading) return stripInline(heading[2]);
      const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (bullet) return `${bullet[1]}• ${stripInline(bullet[2])}`;
      return stripInline(line);
    })
    .join('\n');
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
