// Vercel serverless function for the private HR advisor chat. Unlike
// api/admin-roles.js, this never needs to act as anyone but the caller, so it
// uses a user-scoped Supabase client (anon key + the caller's own bearer
// token forwarded) rather than the service role key — every query it makes
// is subject to the same RLS the browser would get. That's what keeps
// operators from ever seeing log content here: the logs query below just
// comes back empty for them, enforced by Postgres, not by an if-check.
import { createClient } from '@supabase/supabase-js';

// Same reasoning as pm-advisor.js — give it more room than the default
// serverless timeout before Claude's reply is cut off.
export const config = { maxDuration: 30 };

const MANAGEMENT_SYSTEM_PROMPT = `You are a private HR/people-management advisor for a team lead at an engineering/vision-systems company (Bytronic). You're speaking one-on-one and confidentially with a manager. Help them think through: allocation of manpower and workload balancing, and corrective steps for poor behaviour or underperformance. Ground your advice in the team data provided below where it's relevant — be specific rather than generic when the data supports it. Be practical, fair, and even-handed; don't assume the worst about anyone. This conversation is private to this one manager and is never seen by anyone else, including the person being discussed.`;

const OPERATOR_SYSTEM_PROMPT = `You are a private workplace advisor for an operator/individual contributor at an engineering/vision-systems company (Bytronic). You're speaking one-on-one and confidentially with them. Help them think through: managing their own workload, handling difficult situations with colleagues or customers, and knowing when and how to escalate a decision to their manager. Ground advice in their current task load where relevant. Do not assume they have access to anything management-only (personnel logs, other people's performance notes) — you don't have access to that either for this conversation, so don't reference or speculate about it.`;

function taskSummary(tasks, team) {
  const open = tasks.filter((t) => t.status !== 'done');
  if (open.length === 0) return '(no open tasks)';
  const overdue = open.filter((t) => t.due && new Date(t.due) < new Date()).length;
  const byMember = team.map((m) => {
    const mine = open.filter((t) => (t.assignees || []).includes(m.id));
    return `${m.name}: ${mine.length} open`;
  }).join(', ');
  return `${open.length} open tasks (${overdue} overdue). Workload — ${byMember || 'no one assigned'}.`;
}

function logSummary(logs) {
  if (!logs || logs.length === 0) return '(none)';
  return logs.map((l) => `- ${l.tag ? `[${l.tag}] ` : ''}${l.note}`).join('\n');
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

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // Acts as the caller — every query below is subject to their own RLS.
  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const [{ data: roleRow }, { data: tasks }, { data: team }, { data: recentLogs }, { data: history }] = await Promise.all([
      db.from('app_roles').select('access_tier').eq('auth_user_id', caller.id).maybeSingle(),
      db.from('tasks').select('id, status, due, assignees'),
      db.from('team_members').select('id, name'),
      db.from('logs').select('note, tag, created_at').order('created_at', { ascending: false }).limit(40),
      db.from('hr_messages').select('role, content').eq('auth_user_id', caller.id).order('created_at', { ascending: true }).limit(12),
    ]);

    const isManagement = roleRow?.access_tier === 'management';
    const systemPrompt = isManagement ? MANAGEMENT_SYSTEM_PROMPT : OPERATOR_SYSTEM_PROMPT;

    let contextBlock = `Current team workload:\n${taskSummary(tasks || [], team || [])}`;
    if (isManagement) {
      contextBlock += `\n\nRecent behaviour/progress log entries (last 40):\n${logSummary(recentLogs)}`;
    }

    const newMessageId = crypto.randomUUID();
    const { error: insertUserErr } = await db.from('hr_messages').insert({
      id: newMessageId,
      auth_user_id: caller.id,
      role: 'user',
      content: prompt.trim(),
    });
    if (insertUserErr) {
      console.error('Failed to save HR message', insertUserErr);
      return res.status(500).json({ error: 'Failed to save message' });
    }

    const messages = [
      ...(history || []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: prompt.trim() },
    ];

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        system: `${systemPrompt}\n\n${contextBlock}`,
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

    const { error: insertReplyErr } = await db.from('hr_messages').insert({
      id: crypto.randomUUID(),
      auth_user_id: caller.id,
      role: 'assistant',
      content: reply,
    });
    if (insertReplyErr) {
      console.error('Failed to save HR reply', insertReplyErr);
      // Not fatal — the reply still made it to the AI call, just return it
      // even though it won't persist in history.
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('HR advisor handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
