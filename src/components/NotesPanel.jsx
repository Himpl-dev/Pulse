import React, { useEffect, useRef, useState } from 'react';
import { StickyNote, Trash2, Plus, Mic, Square } from 'lucide-react';
import { TOKENS } from '../theme';
import { supabase } from '../supabaseClient';

const inputStyle = { background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, color: TOKENS.text };

// Chrome/Edge only — Firefox has no implementation, Safari's is
// inconsistent. Feature-detected once; the mic button just doesn't render
// when it's missing, rather than showing something that'll error.
const SpeechRecognitionApi = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

function formatTimestamp(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Private scratchpad, optionally tagged to a project — no AI call involved
// (pure Supabase CRUD, RLS-scoped to the caller via schema.sql block 16), so
// no serverless-timeout concerns here unlike the other agents. The point is
// feeding into Documentation later (see the "Insert my notes" button there),
// not generating anything itself.
export function NotesPanel({ userId, projects }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);

  async function loadNotes() {
    const { data, error: fetchErr } = await supabase.from('user_notes').select('*').order('created_at', { ascending: false });
    if (fetchErr) {
      console.error('Failed to load notes', fetchErr);
      setError('Failed to load your notes.');
    } else {
      setNotes(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadNotes();
    // Stop any in-progress dictation if the panel unmounts (e.g. switching
    // tabs mid-recording) rather than leaving the mic listening in the
    // background.
    return () => recognitionRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleListening() {
    if (!SpeechRecognitionApi) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionApi();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) transcript += e.results[i][0].transcript;
      }
      if (transcript.trim()) {
        setContent((prev) => (prev.trim() ? `${prev.trim()} ${transcript.trim()}` : transcript.trim()));
      }
    };
    recognition.onerror = (e) => {
      console.error('Speech recognition error', e.error);
      if (e.error !== 'no-speech') setError('Voice input failed — try again.');
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function addNote(e) {
    e.preventDefault();
    if (!content.trim()) return;
    setError('');
    const id = crypto.randomUUID();
    const savedContent = content.trim();
    const savedProjectId = projectId || null;
    setNotes((prev) => [{ id, auth_user_id: userId, project_id: savedProjectId, content: savedContent, created_at: new Date().toISOString() }, ...prev]);
    setContent('');
    const { error: insertErr } = await supabase.from('user_notes').insert({ id, auth_user_id: userId, project_id: savedProjectId, content: savedContent });
    if (insertErr) {
      console.error('Failed to save note', insertErr);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setError('Failed to save note — try again.');
    }
  }

  async function deleteNote(id) {
    const prevNotes = notes;
    setNotes((n) => n.filter((x) => x.id !== id));
    const { error: deleteErr } = await supabase.from('user_notes').delete().eq('id', id);
    if (deleteErr) {
      console.error('Failed to delete note', deleteErr);
      setNotes(prevNotes);
      setError('Failed to delete note — try again.');
    }
  }

  function projectName(id) {
    return projects.find((p) => p.id === id)?.name;
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
        <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
          <StickyNote size={15} /> Notes
        </h2>
        <p className="text-xs mb-3" style={{ color: TOKENS.textFaint }}>
          Private scratchpad — jot things down as you go, tag them to a project, and pull them into a Documentation report later.
        </p>
        <form onSubmit={addNote} className="flex flex-col gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
            <option value="">No specific project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Quick note…"
              rows={3}
              className="rounded-lg px-3 py-2 text-sm resize-y w-full"
              style={{ ...inputStyle, minHeight: 70, paddingRight: SpeechRecognitionApi ? 40 : undefined }}
            />
            {SpeechRecognitionApi && (
              <button
                type="button"
                onClick={toggleListening}
                aria-label={listening ? 'Stop voice note' : 'Start voice note'}
                title={listening ? 'Stop voice note' : 'Start voice note'}
                className={listening ? 'animate-pulse' : ''}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  background: listening ? TOKENS.coral : TOKENS.surface,
                  color: listening ? TOKENS.bg : TOKENS.textMuted,
                  borderRadius: '9999px', width: 26, height: 26,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {listening ? <Square size={12} /> : <Mic size={13} />}
              </button>
            )}
          </div>
          {listening && <p className="text-xs" style={{ color: TOKENS.coral }}>Listening…</p>}
          <button
            type="submit"
            disabled={!content.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 flex items-center gap-1.5 self-start"
            style={{ background: TOKENS.blue, color: '#0B0D11' }}
          >
            <Plus size={14} /> Add note
          </button>
        </form>
        {error && <p className="text-xs mt-2" style={{ color: TOKENS.coral }}>{error}</p>}
      </div>

      <div className="space-y-2">
        {loading ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="rounded-lg p-3" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 text-xs" style={{ color: TOKENS.textFaint }}>
                  <span>{formatTimestamp(n.created_at)}</span>
                  {n.project_id && projectName(n.project_id) && (
                    <span className="px-1.5 py-0.5 rounded-full" style={{ background: TOKENS.surface2, color: TOKENS.textMuted }}>{projectName(n.project_id)}</span>
                  )}
                </div>
                <button onClick={() => deleteNote(n.id)} aria-label="Delete note" style={{ color: TOKENS.textMuted }}>
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: TOKENS.text }}>{n.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
