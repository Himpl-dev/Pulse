// Vercel serverless function for the Engineer/Technician advisor chat. Same
// user-scoped-client model as the other advisors. Attachments — drawings,
// photos, or PDF pages already converted to images client-side (see
// src/pdfToImages.js — PDF rendering happens in the browser specifically so
// this function never has to do slow document processing itself) — are
// already uploaded to Supabase Storage (RLS-scoped to the caller's own
// folder) before this endpoint is called. It only receives the storage
// paths, downloads the bytes itself (still via the user-scoped client, so it
// can only ever read what the caller could read), and sends them to Claude
// as image content blocks.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `You are a troubleshooting advisor for Bytronic field engineers and technicians working on machine-vision installations. Help them think through fault diagnosis and problem solving step by step — ask a clarifying question if you genuinely need one, but default to giving concrete next diagnostic steps. When a drawing or photo is attached (including pages converted from a PDF), read it carefully and reference specific details from it (labels, connections, part numbers visible) rather than speaking generically. Also help them judge when a problem is beyond what should be handled solo on site and needs escalating — say so plainly when that's the case, and suggest what to capture (photos, error codes, readings) before escalating.

This runs under a strict response-time limit — keep answers focused: lead with the 3-5 most useful, concrete points rather than an exhaustive breakdown of everything visible. It's fine to say there's more detail available and let them ask a follow-up, rather than trying to cover everything in one reply.`;

const MEDIA_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

function mediaTypeFor(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  return MEDIA_TYPES[ext] || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseAnonKey, authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  const caller = await userRes.json();

  const { prompt, attachments } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  const attachmentList = Array.isArray(attachments) ? attachments.slice(0, 5) : [];

  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const { data: history } = await db
      .from('eng_messages')
      .select('role, content, attachment_name, attachments')
      .eq('auth_user_id', caller.id)
      .order('created_at', { ascending: true })
      .limit(12);

    const newMessageId = crypto.randomUUID();
    const { error: insertUserErr } = await db.from('eng_messages').insert({
      id: newMessageId,
      auth_user_id: caller.id,
      role: 'user',
      content: prompt.trim(),
      attachments: attachmentList.length ? attachmentList : null,
    });
    if (insertUserErr) {
      console.error('Failed to save engineer message', insertUserErr);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    // Replay history as text only (including a note when a past message had
    // attachment(s)) — re-sending old image bytes every turn isn't worth the
    // token/latency cost for a chat that can run to many turns. Handles both
    // the new `attachments` array and the older single `attachment_name`
    // column from before multi-attachment support existed.
    const pastMessages = (history || []).map((m) => {
      const names = m.attachments?.length ? m.attachments.map((a) => a.name).join(', ') : m.attachment_name;
      return { role: m.role, content: names ? `${m.content}\n[Attached: ${names}]` : m.content };
    });

    let newUserContent = prompt.trim();
    if (attachmentList.length > 0) {
      const downloads = await Promise.all(attachmentList.map(async (a) => {
        const mediaType = mediaTypeFor(a.name);
        if (!mediaType) return null;
        const { data: fileBlob, error: downloadErr } = await db.storage.from('eng_drawings').download(a.path);
        if (downloadErr) {
          console.error('Failed to download attachment', a.path, downloadErr);
          return null;
        }
        const base64 = Buffer.from(await fileBlob.arrayBuffer()).toString('base64');
        return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
      }));
      const imageBlocks = downloads.filter(Boolean);
      if (imageBlocks.length > 0) {
        newUserContent = [...imageBlocks, { type: 'text', text: prompt.trim() }];
      }
    }

    const messages = [...pastMessages, { role: 'user', content: newUserContent }];

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic API error', errText);
      return res.status(502).json({ error: 'Advisor is unavailable right now — try again' });
    }

    const data = await aiRes.json();
    let reply = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    if (!reply) {
      console.error('Anthropic returned no text content', JSON.stringify(data));
      return res.status(502).json({ error: 'Advisor came back empty — try again' });
    }
    // Some text made it out, but got cut off mid-generation rather than
    // reaching a natural stopping point — say so rather than silently
    // ending mid-sentence with no explanation.
    if (data.stop_reason === 'max_tokens') {
      reply += '\n\n*(cut short — ask a follow-up for more detail)*';
    }

    const { error: insertReplyErr } = await db.from('eng_messages').insert({
      id: crypto.randomUUID(),
      auth_user_id: caller.id,
      role: 'assistant',
      content: reply,
    });
    if (insertReplyErr) {
      console.error('Failed to save engineer reply', insertReplyErr);
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Engineer advisor handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
