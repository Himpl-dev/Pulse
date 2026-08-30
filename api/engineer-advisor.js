// Vercel serverless function for the Engineer/Technician advisor chat. Same
// user-scoped-client model as the other advisors. Unique to this one: an
// optional attached drawing/photo, already uploaded by the client straight
// to Supabase Storage (RLS-scoped to the caller's own folder — see
// schema.sql block 14) before this endpoint is even called. This endpoint
// only receives the storage path, downloads the bytes itself (still via the
// user-scoped client, so it can only ever read what the caller could read),
// and sends them to Claude as an image content block.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `You are a troubleshooting advisor for Bytronic field engineers and technicians working on machine-vision installations. Help them think through fault diagnosis and problem solving step by step — ask a clarifying question if you genuinely need one, but default to giving concrete next diagnostic steps. When a drawing or photo is attached, read it carefully and reference specific details from it (labels, connections, part numbers visible) rather than speaking generically. Also help them judge when a problem is beyond what should be handled solo on site and needs escalating — say so plainly when that's the case, and suggest what to capture (photos, error codes, readings) before escalating.`;

const MEDIA_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf',
};

// PDFs go in as a "document" content block, everything else as "image" —
// same base64 source shape either way.
function attachmentKindFor(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) return null;
  return { mediaType, blockType: ext === 'pdf' ? 'document' : 'image' };
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

  const { prompt, attachmentPath, attachmentName } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const { data: history } = await db
      .from('eng_messages')
      .select('role, content, attachment_name')
      .eq('auth_user_id', caller.id)
      .order('created_at', { ascending: true })
      .limit(12);

    const newMessageId = crypto.randomUUID();
    const { error: insertUserErr } = await db.from('eng_messages').insert({
      id: newMessageId,
      auth_user_id: caller.id,
      role: 'user',
      content: prompt.trim(),
      attachment_path: attachmentPath || null,
      attachment_name: attachmentName || null,
    });
    if (insertUserErr) {
      console.error('Failed to save engineer message', insertUserErr);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    // Replay history as text only (including a note when a past message had
    // an attachment) — re-sending old file bytes every turn isn't worth the
    // token/latency cost for a chat that can run to many turns.
    const pastMessages = (history || []).map((m) => ({
      role: m.role,
      content: m.attachment_name ? `${m.content}\n[Attached file: ${m.attachment_name}]` : m.content,
    }));

    let newUserContent = prompt.trim();
    if (attachmentPath) {
      const kind = attachmentKindFor(attachmentName);
      if (kind) {
        const { data: fileBlob, error: downloadErr } = await db.storage.from('eng_drawings').download(attachmentPath);
        if (downloadErr) {
          console.error('Failed to download attachment', downloadErr);
        } else {
          const base64 = Buffer.from(await fileBlob.arrayBuffer()).toString('base64');
          newUserContent = [
            { type: kind.blockType, source: { type: 'base64', media_type: kind.mediaType, data: base64 } },
            { type: 'text', text: prompt.trim() },
          ];
        }
      }
    }

    const messages = [...pastMessages, { role: 'user', content: newUserContent }];

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // Harmless if PDF support has since graduated to general
        // availability — an unrecognized beta flag is just ignored — but
        // protects against it still being gated.
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
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
    const reply = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    if (!reply) {
      console.error('Anthropic returned no text content', JSON.stringify(data));
      return res.status(502).json({ error: 'Advisor came back empty — try again' });
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
