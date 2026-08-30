// Vercel serverless function for the Sales advisor chat. Same user-scoped-
// client model as api/hr-advisor.js and api/pm-advisor.js — the caller's own
// token, not the service role key.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

// Customers aren't a database table — they're a small static list defined in
// src/App.jsx (CUSTOMERS) that `projects.customer_id` references. Duplicated
// here rather than sharing a module across the Vite app and Vercel functions
// build; keep this in sync if a customer is ever added/renamed there.
const CUSTOMERS = [
  { id: 'bytronic', name: 'Bytronic' },
  { id: 'cognex', name: 'Cognex' },
  { id: 'flir', name: 'Teledyne FLIR' },
  { id: 'zebra', name: 'Zebra' },
  { id: 'sick', name: 'SICK' },
  { id: 'keyence', name: 'Keyence' },
];

const SYSTEM_PROMPT = `You are a sales advisor for Bytronic, a machine-vision systems integrator. Bytronic works with hardware from major machine-vision/auto-ID suppliers — Cognex, Zebra, SICK, Keyence, and Teledyne FLIR — and Bytronic's customers (listed below, with their current/past projects) evaluate and trial vision camera and reader solutions built on that hardware.

You're talking to a Bytronic team member, not a customer. Help them by: explaining a supplier's product capabilities relevant to what's being discussed (read rates, resolution, environmental rating, decode/lighting options, integration effort, typical use cases), and recommending concrete next steps when a customer is evaluating or trialling something — grounded in the customer/project context below where it's relevant.

You won't always have the exact current spec sheet for every model in a fast-moving product line — say so plainly rather than inventing a precise figure you're not confident in, and suggest checking the vendor's current datasheet or a rep for exact numbers. This is an internal conversation to help them prepare, not something being sent to the customer directly.`;

function customerContext(customers, projects, tasks) {
  return customers.map((c) => {
    const cProjects = projects.filter((p) => p.customer_id === c.id);
    if (cProjects.length === 0) return `- ${c.name}: no projects on file`;
    const lines = cProjects.map((p) => {
      const pTasks = tasks.filter((t) => t.project_id === p.id);
      const open = pTasks.filter((t) => t.status !== 'done').length;
      return `${p.name}${p.subtitle ? ` (${p.subtitle})` : ''}${p.deadline ? `, deadline ${p.deadline}` : ''} — ${open} open of ${pTasks.length} tasks`;
    });
    return `- ${c.name}: ${lines.join('; ')}`;
  }).join('\n');
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

  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const [{ data: projects }, { data: tasks }, { data: history }] = await Promise.all([
      db.from('projects').select('id, name, subtitle, deadline, customer_id'),
      db.from('tasks').select('id, status, project_id'),
      db.from('sales_messages').select('role, content').eq('auth_user_id', caller.id).order('created_at', { ascending: true }).limit(12),
    ]);

    const contextBlock = `Customers and their projects:\n${customerContext(CUSTOMERS, projects || [], tasks || [])}`;

    const newMessageId = crypto.randomUUID();
    const { error: insertUserErr } = await db.from('sales_messages').insert({
      id: newMessageId,
      auth_user_id: caller.id,
      role: 'user',
      content: prompt.trim(),
    });
    if (insertUserErr) {
      console.error('Failed to save sales message', insertUserErr);
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
        system: `${SYSTEM_PROMPT}\n\n${contextBlock}`,
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

    const { error: insertReplyErr } = await db.from('sales_messages').insert({
      id: crypto.randomUUID(),
      auth_user_id: caller.id,
      role: 'assistant',
      content: reply,
    });
    if (insertReplyErr) {
      console.error('Failed to save sales reply', insertReplyErr);
    }

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Sales advisor handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
