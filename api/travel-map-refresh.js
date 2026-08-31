// Vercel serverless function that (re)builds the World Map's travel_entries
// cache by having Claude infer likely site visits from existing project and
// task data — there's no explicit travel log anywhere in the app, so this
// reads between the lines instead. Same safe shape as every other advisor
// here: fetch everything first, one single Claude call, no tool-execution
// loop. Deliberately scoped to projects+tasks only, not logs/user_notes
// (both private/restricted), so this produces the same result for whoever
// triggers it regardless of their access tier.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

// Customers aren't a database table — duplicated from src/App.jsx's
// CUSTOMERS, same as sales-advisor.js/documentation.js already do.
const CUSTOMERS = {
  bytronic: 'Bytronic', cognex: 'Cognex', flir: 'Teledyne FLIR', zebra: 'Zebra', sick: 'SICK', keyence: 'Keyence',
};

const LOG_TRAVEL_TOOL = {
  name: 'log_travel',
  description: 'Record one inferred instance of a team member likely travelling to a specific real-world location for a project.',
  input_schema: {
    type: 'object',
    properties: {
      memberId: { type: 'string', description: 'Must be one of the real team member ids given in context' },
      country: { type: 'string', description: 'A real country name' },
      city: { type: 'string', description: 'City/town, if determinable — omit if not' },
      projectId: { type: 'string', description: 'Must be one of the real project ids given in context' },
      startDate: { type: 'string', description: 'YYYY-MM-DD, approximate start of the visit if determinable from task dates — omit if not' },
      endDate: { type: 'string', description: 'YYYY-MM-DD, approximate end of the visit if determinable — omit if not' },
      reason: { type: 'string', description: 'One short sentence on why this was inferred' },
    },
    required: ['memberId', 'country', 'projectId', 'reason'],
  },
};

const SYSTEM_PROMPT = `You maintain a "who's travelled where" map for an engineering company by inferring on-site travel from project and task data — there is no explicit travel log anywhere, so you have to read between the lines carefully and conservatively.

For each project below, look at its name, subtitle, and customer for a real-world location that is actually mentioned or strongly implied (e.g. "Kelloggs Egypt" implies Egypt; "Amazon WRO6, Poland" implies Poland). Skip any project where you cannot identify a genuine, specific geographic location — do not guess a country just because a customer has an office somewhere, and do not invent a location that isn't actually indicated.

For a project where you're confident of a real location, call the log_travel tool once per team member who has tasks assigned on that project — use the given task due-date range to estimate roughly when the work happened. Only log people you're reasonably confident actually needed to be on-site (not remote/office work). It's fine, and expected, to call this zero times if nothing in the data indicates real travel.

Use only the real project ids and team member ids given in the context below — never invent one.`;

function buildContext(projects, tasks, team) {
  return (projects || []).map((p) => {
    const pTasks = (tasks || []).filter((t) => t.project_id === p.id);
    const assigneeIds = [...new Set(pTasks.flatMap((t) => t.assignees || []))];
    const assignees = assigneeIds.map((id) => team.find((m) => m.id === id)).filter(Boolean);
    const dueDates = pTasks.map((t) => t.due).filter(Boolean).sort();
    const dateRange = dueDates.length ? `${dueDates[0]} to ${dueDates[dueDates.length - 1]}` : 'unknown';
    return `- [${p.id}] ${p.name}${p.subtitle ? ` — ${p.subtitle}` : ''}, customer: ${CUSTOMERS[p.customer_id] || 'unknown'}${p.deadline ? `, deadline ${p.deadline}` : ''}. Task date range: ${dateRange}. Assigned: ${assignees.map((m) => `[${m.id}] ${m.name}`).join(', ') || 'nobody'}`;
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

  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const [{ data: projects }, { data: tasks }, { data: team }] = await Promise.all([
      db.from('projects').select('id, name, subtitle, deadline, customer_id'),
      db.from('tasks').select('id, due, project_id, assignees'),
      db.from('team_members').select('id, name'),
    ]);

    const contextBlock = `Projects:\n${buildContext(projects, tasks, team || [])}`;

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
        system: `${SYSTEM_PROMPT}\n\n${contextBlock}`,
        tools: [LOG_TRAVEL_TOOL],
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: 'Infer travel from the project data above and log it.' }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic API error', errText);
      return res.status(502).json({ error: 'Refresh is unavailable right now — try again' });
    }

    const data = await aiRes.json();
    const projectById = Object.fromEntries((projects || []).map((p) => [p.id, p]));
    const teamById = Object.fromEntries((team || []).map((m) => [m.id, m]));

    const entries = (data.content || [])
      .filter((b) => b.type === 'tool_use' && b.name === 'log_travel')
      .filter((b) => projectById[b.input?.projectId] && teamById[b.input?.memberId] && b.input?.country)
      .map((b) => ({
        id: crypto.randomUUID(),
        member_id: b.input.memberId,
        country: b.input.country,
        city: b.input.city || null,
        customer_id: projectById[b.input.projectId].customer_id || null,
        project_id: b.input.projectId,
        start_date: b.input.startDate || null,
        end_date: b.input.endDate || null,
        note: b.input.reason || null,
      }));

    // Replace-all: this cache reflects the current inference, not a growing
    // history — re-running should give a clean, current picture rather than
    // accumulating stale/duplicate entries from earlier runs.
    const { error: deleteErr } = await db.from('travel_entries').delete().not('id', 'is', null);
    if (deleteErr) {
      console.error('Failed to clear old travel entries', deleteErr);
      return res.status(500).json({ error: 'Failed to refresh' });
    }

    if (entries.length > 0) {
      const { error: insertErr } = await db.from('travel_entries').insert(entries);
      if (insertErr) {
        console.error('Failed to save travel entries', insertErr);
        return res.status(500).json({ error: 'Failed to save the refreshed map' });
      }
    }

    return res.status(200).json({ count: entries.length });
  } catch (err) {
    console.error('Travel map refresh handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
