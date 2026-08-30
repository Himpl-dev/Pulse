import React, { useEffect, useRef, useState } from 'react';
import { Compass, Loader2, Send, Plus, Check } from 'lucide-react';
import { TOKENS, hexToRgba } from '../theme';
import { supabase } from '../supabaseClient';

const PRIORITY_COLOR = { high: TOKENS.coral, medium: TOKENS.amber, low: TOKENS.blue };

// Cross-project advisor chat. Same persistence shape as HRPanel (its own
// private pm_messages table), plus a "proposals" strip driven by Claude's
// tool-use in api/pm-advisor.js — each card creates a real task via the
// existing addTask flow (onCreateTask), reusing its optimistic-update and
// rollback-on-error behavior rather than duplicating it here.
export function PMPanel({ accessToken, onCreateTask }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState([]);
  const [addedIds, setAddedIds] = useState(new Set());
  const bottomRef = useRef(null);

  async function loadMessages() {
    const { data, error: fetchErr } = await supabase
      .from('pm_messages')
      .select('*')
      .order('created_at', { ascending: true });
    if (fetchErr) {
      console.error('Failed to load PM messages', fetchErr);
      setError('Failed to load your conversation history.');
    } else {
      setMessages(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, proposals]);

  async function send(e) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || sending) return;
    setError('');
    setInput('');
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: 'user', content: prompt, created_at: new Date().toISOString() }]);
    try {
      const res = await fetch('/api/pm-advisor', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get a response');
      setProposals(data.proposals || []);
      setAddedIds(new Set());
      await loadMessages();
    } catch (err) {
      setError(err.message || 'Failed to get a response — try again.');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  }

  function addProposal(proposal, idx) {
    onCreateTask(proposal);
    setAddedIds((prev) => new Set(prev).add(idx));
  }

  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, height: 560 }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
        <Compass size={15} style={{ color: TOKENS.teal }} />
        <div>
          <h2 className="font-display font-semibold text-sm">Project Manager</h2>
          <p className="text-xs" style={{ color: TOKENS.textFaint }}>Cross-project advice on scope, status, and staffing — management can also add proposed tasks with one click.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>
            Ask what's missing on a project, who should pick up a job, or what to prioritize across everything active right now.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[80%]"
                style={{
                  background: m.role === 'user' ? hexToRgba(TOKENS.blue, 0.15) : TOKENS.surface2,
                  color: TOKENS.text,
                  border: `1px solid ${m.role === 'user' ? hexToRgba(TOKENS.blue, 0.35) : TOKENS.border}`,
                }}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 text-sm flex items-center gap-1.5" style={{ background: TOKENS.surface2, color: TOKENS.textFaint, border: `1px solid ${TOKENS.border}` }}>
              <Loader2 size={13} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}

        {proposals.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: TOKENS.textFaint }}>Suggested tasks</p>
            {proposals.map((p, idx) => {
              const added = addedIds.has(idx);
              return (
                <div key={idx} className="rounded-lg p-2.5" style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm truncate" style={{ color: TOKENS.text }}>{p.title}</p>
                      <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>
                        {p.projectName} · <span style={{ color: PRIORITY_COLOR[p.priority] }}>{p.priority}</span> · due {p.due}{p.assigneeName ? ` · ${p.assigneeName}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => addProposal(p, idx)}
                      disabled={added}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium flex-shrink-0 disabled:opacity-60"
                      style={{ background: added ? TOKENS.surface : hexToRgba(TOKENS.teal, 0.15), color: added ? TOKENS.textMuted : TOKENS.teal }}
                    >
                      {added ? <><Check size={12} /> Added</> : <><Plus size={12} /> Add to board</>}
                    </button>
                  </div>
                  {p.reason && <p className="text-xs mt-1.5" style={{ color: TOKENS.textFaint }}>{p.reason}</p>}
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-xs px-4 pb-2" style={{ color: TOKENS.coral }}>{error}</p>}

      <form onSubmit={send} className="flex items-end gap-2 p-3" style={{ borderTop: `1px solid ${TOKENS.border}` }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
          placeholder="Ask something…"
          rows={1}
          className="flex-1 rounded-lg px-3 py-2 text-sm resize-none"
          style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, color: TOKENS.text }}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="p-2 rounded-lg disabled:opacity-40 flex-shrink-0"
          style={{ background: TOKENS.blue, color: '#0B0D11' }}
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
