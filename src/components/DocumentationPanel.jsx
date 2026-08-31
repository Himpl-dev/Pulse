import React, { useState } from 'react';
import { FileText, Loader2, Download, StickyNote } from 'lucide-react';
import { TOKENS } from '../theme';
import { CopyButton } from './AiOutput';
import { renderMarkdown, downloadTextFile } from '../markdown';
import { supabase } from '../supabaseClient';

// Keep ids in sync with the TEMPLATES map in api/documentation.js — each id
// there defines the actual section structure for that document type.
const DOCUMENT_TEMPLATES = [
  { id: 'job-completion', label: 'Job Completion / Commissioning Report' },
  { id: 'site-survey', label: 'Site Survey Report' },
  { id: 'trial-summary', label: 'Customer Trial Summary' },
  { id: 'service-visit', label: 'Service Visit Report' },
  { id: 'site-report', label: 'Site Report' },
  { id: 'panel-route-card', label: 'Electrical Panel Build Route Card' },
  { id: 'pre-site-checks', label: 'Pre-Site Checks' },
  { id: 'rams', label: "RAMS (Risk Assessment & Method Statement)" },
];

const inputStyle = { background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, color: TOKENS.text };

// Guided template picker rather than a chat — "standard company templates"
// means consistent structure every time, so a form + a fixed section list
// per template (server-side) fits better than free-form conversation. No
// conversation history to persist here (single generate-on-demand call),
// unlike the HR/PM/Sales advisors.
export function DocumentationPanel({ accessToken, projects }) {
  const [templateId, setTemplateId] = useState(DOCUMENT_TEMPLATES[0].id);
  const [projectId, setProjectId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [details, setDetails] = useState('');
  const [generatedDoc, setGeneratedDoc] = useState('');
  const [generating, setGenerating] = useState(false);
  const [insertingNotes, setInsertingNotes] = useState(false);
  const [error, setError] = useState('');

  const template = DOCUMENT_TEMPLATES.find((t) => t.id === templateId);

  async function generate(e) {
    e.preventDefault();
    if (!details.trim() || generating) return;
    setGenerating(true);
    setError('');
    setGeneratedDoc('');
    try {
      const res = await fetch('/api/documentation', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ templateId, projectId: projectId || null, date, details: details.trim() }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        // A non-JSON body means the platform itself killed the request
        // (e.g. a serverless timeout) before our own code could respond.
        throw new Error('This took too long to generate — try again, maybe with less detail.');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to generate document');
      setGeneratedDoc(data.document || '');
    } catch (err) {
      setError(err.message || 'Failed to generate document — try again.');
    } finally {
      setGenerating(false);
    }
  }

  function download() {
    const filename = `${template.label.replace(/[^\w]+/g, '-').toLowerCase()}-${date}.md`;
    downloadTextFile(filename, generatedDoc, 'text/markdown');
  }

  // Pulls in this project's notes from the Notes tab — RLS already scopes
  // this to the caller's own notes, same as reading user_notes anywhere else.
  async function insertNotes() {
    if (!projectId) return;
    setInsertingNotes(true);
    setError('');
    try {
      const { data, error: fetchErr } = await supabase
        .from('user_notes')
        .select('content, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (fetchErr) throw fetchErr;
      if (!data?.length) {
        setError('No notes found for this project.');
        return;
      }
      const notesBlock = data.map((n) => `- ${n.content}`).join('\n');
      setDetails((prev) => (prev.trim() ? `${prev.trim()}\n\n${notesBlock}` : notesBlock));
    } catch (err) {
      console.error('Failed to insert notes', err);
      setError('Failed to load notes — try again.');
    } finally {
      setInsertingNotes(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
        <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
          <FileText size={15} /> Documentation
        </h2>
        <p className="text-xs mb-3" style={{ color: TOKENS.textFaint }}>
          Pick a standard template, fill in the details, and generate a first draft — always review before sending it on or using it on site.
        </p>
        <form onSubmit={generate} className="flex flex-col gap-2">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
            {DOCUMENT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="flex gap-2 flex-wrap">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[160px]" style={inputStyle}>
              <option value="">No specific project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: TOKENS.textFaint }}>Details</span>
            <button
              type="button"
              onClick={insertNotes}
              disabled={!projectId || insertingNotes}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs disabled:opacity-40"
              style={{ color: TOKENS.textMuted }}
              title={projectId ? 'Insert your notes for this project' : 'Select a project first'}
            >
              {insertingNotes ? <Loader2 size={12} className="animate-spin" /> : <StickyNote size={12} />} Insert my notes
            </button>
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Describe what happened / what's needed — as much detail as you have, the draft will only use what you give it."
            rows={4}
            className="rounded-lg px-3 py-2 text-sm resize-y"
            style={{ ...inputStyle, minHeight: 90 }}
          />
          <button
            type="submit"
            disabled={generating || !details.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5 self-start"
            style={{ background: TOKENS.blue, color: '#0B0D11' }}
          >
            {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : 'Generate'}
          </button>
        </form>
        {error && <p className="text-xs mt-2" style={{ color: TOKENS.coral }}>{error}</p>}
      </div>

      {generatedDoc && (
        <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="font-display font-semibold text-sm">{template.label}</h3>
            <div className="flex items-center gap-2">
              <CopyButton text={generatedDoc} label="Copy" />
              <button
                onClick={download}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: TOKENS.surface2, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}
              >
                <Download size={13} /> Download
              </button>
            </div>
          </div>
          <div className="text-sm leading-relaxed rounded-lg p-3" style={{ color: TOKENS.text, background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}>
            {renderMarkdown(generatedDoc)}
          </div>
        </div>
      )}
    </div>
  );
}
