// Vercel serverless function for the Project Manager advisor chat. Same
// user-scoped-client privilege model as api/hr-advisor.js (the caller's own
// token, not the service role key) — this only ever needs to see data the
// caller could already see. Unlike HR, this one can propose real tasks via
// Claude's tool-use, which the client renders as "Add to board" cards.
import { createClient } from '@supabase/supabase-js';

// Tool-use with a fuller context block runs noticeably slower than a plain
// chat reply — raise the default serverless timeout so a real answer isn't
// cut off mid-generation.
export const config = { maxDuration: 30 };

const MANAGEMENT_SYSTEM_PROMPT = `You are a project management advisor for an engineering/vision-systems company (Bytronic), helping a team lead think across all active projects at once. Help them: track each project's scope, decide what jobs (tasks) are missing for a project's current phase — a typical install & commission project needs coordinating dates/scope with the customer, the install itself, commissioning, a job review, ordering parts, and arranging travel, but only propose whichever of these are actually missing, never ones that already exist as a task — and recommend who's best suited for a job based on their listed skills and current open-task load (prefer a relevant skill, avoid someone already overloaded).

When you believe a specific task should be added to a specific project, call the propose_task tool for it — you can call it multiple times in one reply to propose several tasks. Always still explain your reasoning in your text reply too, not only via the tool calls. Use only the real project ids and team member ids given in the context below — never invent one, and never propose a task that's a near-duplicate of one already listed as open for that project.`;

const OPERATOR_SYSTEM_PROMPT = `You are a project management advisor for an engineering/vision-systems company (Bytronic), helping an operator understand the projects they're working on. You can discuss project scope, specification, status, what's outstanding, and general staffing/skills questions, grounded in the data below. You do NOT have the ability to create or propose tasks in this conversation — that's limited to management. If asked to add or change a task, say so plainly and suggest they raise it with their team lead, rather than implying you've done it.`;

const PROPOSE_TASK_TOOL = {
  name: 'propose_task',
  description: "Propose a specific, concrete task to add to a project's board.",
  input_schema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'Must be one of the real project ids given in context' },
      title: { type: 'string' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
      dueInDays: { type: 'number', description: 'Suggested days from today for the due date — default to 14 if unsure' },
      assigneeId: { type: 'string', description: 'A real team member id best suited by skills/workload, if determinable — omit if unclear' },
      reason: { type: 'string', description: 'One sentence on why this task is needed and (if assigned) why that person' },
    },
    required: ['projectId', 'title', 'priority', 'reason'],
  },
};

function projectContext(projects, tasks) {
  return projects.map((p) => {
    const pTasks = tasks.filter((t) => t.projectId === p.id);
    const open = pTasks.filter((t) => t.status !== 'done');
    return `- [${p.id}] ${p.name}${p.subtitle ? ` — ${p.subtitle}` : ''}${p.deadline ? `, deadline ${p.deadline}` : ''}. ${pTasks.length} total tasks, ${open.length} open: ${open.map((t) => t.title).join('; ') || '(none)'}`;
  }).join('\n');
}

function teamContext(team, tasks) {
  return team.map((m) => {
    const open = tasks.filter((t) => t.status !== 'done' && (t.assignees || []).includes(m.id)).length;
    const skills = (m.skills || []).map((s) => `${s.name} (${s.level})`).join(', ') || 'none listed';
    return `- [${m.id}] ${m.name} — ${open} open tasks. Skills: ${skills}`;
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
    const [{ data: roleRow }, { data: projects }, { data: rawTasks }, { data: team }, { data: history }] = await Promise.all([
      db.from('app_roles').select('access_tier').eq('auth_user_id', caller.id).maybeSingle(),
      db.from('projects').select('id, name, subtitle, deadline'),
      db.from('tasks').select('id, title, status, due, priority, project_id, assignees'),
      db.from('team_members').select('id, name, skills'),
      db.from('pm_messages').select('role, content').eq('auth_user_id', caller.id).order('created_at', { ascending: true }).limit(20),
    ]);

    // Task-proposal capability is management-only — gated here by only
    // offering the tool at all, not by trusting a client-side flag. An
    // operator's request to Claude simply never includes propose_task, so
    // there's no path for the model to emit one for them.
    const isManagement = roleRow?.access_tier === 'management';
    const systemPrompt = isManagement ? MANAGEMENT_SYSTEM_PROMPT : OPERATOR_SYSTEM_PROMPT;

    const tasks = (rawTasks || []).map((t) => ({ ...t, projectId: t.project_id }));
    const contextBlock = `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nProjects:\n${projectContext(projects || [], tasks)}\n\nTeam:\n${teamContext(team || [], tasks)}`;

    const newMessageId = crypto.randomUUID();
    const { error: insertUserErr } = await db.from('pm_messages').insert({
      id: newMessageId,
      auth_user_id: caller.id,
      role: 'user',
      content: prompt.trim(),
    });
    if (insertUserErr) {
      console.error('Failed to save PM message', insertUserErr);
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
        max_tokens: 4096,
        system: `${systemPrompt}\n\n${contextBlock}`,
        ...(isManagement ? { tools: [PROPOSE_TASK_TOOL] } : {}),
        messages,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic API error', errText);
      return res.status(502).json({ error: 'Advisor is unavailable right now — try again' });
    }

    const data = await aiRes.json();
    const content = data.content || [];
    const textBlocks = content.filter((b) => b.type === 'text').map((b) => b.text);
    const toolBlocks = content.filter((b) => b.type === 'tool_use' && b.name === 'propose_task');

    const reply = textBlocks.join('\n\n').trim() || (toolBlocks.length ? 'See the suggested tasks below.' : '');
    if (!reply) {
      console.error('Anthropic returned no usable content', JSON.stringify(data));
      return res.status(502).json({ error: 'Advisor came back empty — try again' });
    }

    const projectById = Object.fromEntries((projects || []).map((p) => [p.id, p.name]));
    const memberById = Object.fromEntries((team || []).map((m) => [m.id, m.name]));
    const today = new Date();
    const proposals = toolBlocks
      .filter((b) => projectById[b.input?.projectId])
      .map((b) => {
        const dueInDays = Number.isFinite(b.input.dueInDays) ? b.input.dueInDays : 14;
        const due = new Date(today.getTime() + dueInDays * 86400000).toISOString().slice(0, 10);
        const assigneeId = memberById[b.input.assigneeId] ? b.input.assigneeId : null;
        return {
          projectId: b.input.projectId,
          projectName: projectById[b.input.projectId],
          title: b.input.title,
          priority: ['high', 'medium', 'low'].includes(b.input.priority) ? b.input.priority : 'medium',
          due,
          assigneeId,
          assigneeName: assigneeId ? memberById[assigneeId] : null,
          reason: b.input.reason,
        };
      });

    const { error: insertReplyErr } = await db.from('pm_messages').insert({
      id: crypto.randomUUID(),
      auth_user_id: caller.id,
      role: 'assistant',
      content: reply,
    });
    if (insertReplyErr) {
      console.error('Failed to save PM reply', insertReplyErr);
    }

    return res.status(200).json({ reply, proposals });
  } catch (err) {
    console.error('PM advisor handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
