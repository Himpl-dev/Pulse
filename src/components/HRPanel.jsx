import React, { useEffect, useRef, useState } from 'react';
import { LifeBuoy, Loader2, Send } from 'lucide-react';
import { TOKENS, hexToRgba } from '../theme';
import { supabase } from '../supabaseClient';

// Private HR/workplace advisor chat. Reads/writes go straight to Supabase
// (RLS already scopes hr_messages to the caller — see schema.sql block 11);
// only the AI call itself goes through api/hr-advisor.js, which independently
// determines the caller's role server-side rather than trusting a prop here.
export function HRPanel({ accessToken }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  async function loadMessages() {
    const { data, error: fetchErr } = await supabase
      .from('hr_messages')
      .select('*')
      .order('created_at', { ascending: true });
    if (fetchErr) {
      console.error('Failed to load HR messages', fetchErr);
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
  }, [messages, sending]);

  async function send(e) {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || sending) return;
    setError('');
    setInput('');
    setSending(true);
    // Optimistic local bubble — replaced by the real, persisted rows (both
    // this message and the reply) once the request completes.
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: 'user', content: prompt, created_at: new Date().toISOString() }]);
    try {
      const res = await fetch('/api/hr-advisor', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get a response');
      await loadMessages();
    } catch (err) {
      setError(err.message || 'Failed to get a response — try again.');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, height: 560 }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
        <LifeBuoy size={15} style={{ color: TOKENS.violet }} />
        <div>
          <h2 className="font-display font-semibold text-sm">HR Advisor</h2>
          <p className="text-xs" style={{ color: TOKENS.textFaint }}>Private to you — nobody else, including management, can see this conversation.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>
            Ask about workload, a difficult situation, or when to escalate a decision — this stays between you and the advisor.
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
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-xs px-4 pb-2" style={{ color: TOKENS.coral }}>{error}</p>}

      <form onSubmit={send} className="flex items-end gap-2 p-3" style={{ borderTop: `1px solid ${TOKENS.border}` }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }}
          placeholder={sending ? 'Waiting for a reply — this can take up to 30s…' : 'Ask something…'}
          disabled={sending}
          rows={1}
          className="flex-1 rounded-lg px-3 py-2 text-sm resize-none disabled:opacity-60"
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
