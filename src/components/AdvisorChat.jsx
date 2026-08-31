import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { TOKENS, hexToRgba } from '../theme';
import { supabase } from '../supabaseClient';

// Shared shell for the private, per-user advisor chats (HR, PM, Sales, and
// whatever comes next) — load/send/optimistic-update/rollback logic and the
// bubble thread are identical across all of them; only the table/endpoint,
// header copy, and (optionally) extra content after a reply (e.g. PM's
// task-proposal cards) differ per agent.
export function AdvisorChat({
  table, endpoint, accessToken, icon: Icon, iconColor, title, description, emptyHint, onResponse, extra,
  // Optional, purely additive — every existing consumer omits these and gets
  // identical behavior to before. buildRequestBody lets a caller (e.g. the
  // Engineer advisor) upload a file first and merge extra fields into the
  // POST body; formAccessory renders inside the input row (e.g. an attach
  // button); renderAttachment renders extra content in a message bubble.
  buildRequestBody, formAccessory, renderAttachment,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  async function loadMessages() {
    const { data, error: fetchErr } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: true });
    if (fetchErr) {
      console.error(`Failed to load ${table}`, fetchErr);
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
    // Optimistic local bubble — kept as-is on success (see below for why the
    // reply is also shown locally rather than via a re-fetch), removed again
    // on failure.
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: 'user', content: prompt, created_at: new Date().toISOString() }]);
    try {
      const body = buildRequestBody ? await buildRequestBody(prompt) : { prompt };
      // Merge any extra fields the body carries (e.g. Engineer's
      // `attachments`) into the optimistic bubble, so it renders the same
      // way a persisted row would — renderAttachment reads from the message
      // object, not from `body` directly.
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, ...body } : m)));
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        // A non-JSON body means the platform itself killed the request
        // (e.g. a serverless timeout) before our own code could respond —
        // give a clear message instead of a raw JSON-parse error.
        throw new Error(res.status === 504 || !res.ok ? 'The advisor took too long to respond — try again, maybe with a shorter question.' : 'Failed to get a response');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to get a response');
      onResponse?.(data);
      // Show the reply straight from the response rather than depending on
      // re-fetching it from the DB — if the server-side write of the reply
      // happens to fail after it was already generated, the user still sees
      // the real answer instead of the whole exchange silently vanishing
      // with no error (which is worse than a slightly-stale id/timestamp).
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: 'assistant', content: data.reply || '', created_at: new Date().toISOString() },
      ]);
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
        <Icon size={15} style={{ color: iconColor }} />
        <div>
          <h2 className="font-display font-semibold text-sm">{title}</h2>
          <p className="text-xs" style={{ color: TOKENS.textFaint }}>{description}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>{emptyHint}</p>
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
                {renderAttachment?.(m)}
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
        {extra}
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
        {formAccessory}
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
