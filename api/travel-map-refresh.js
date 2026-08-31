// Vercel serverless function that (re)builds the World Map's travel_entries
// cache by having Claude infer likely site visits from two sources: existing
// project/task data (indirect — has to read location clues out of free
// text), and Site Reports (direct — the Documentation agent's "site-report"
// template captures a real site name, date, and exactly who was on site as
// structured fields, see api/documentation.js). Same safe shape as every
// other advisor here: fetch everything first, one single Claude call, no
// tool-execution loop. Deliberately scoped to projects+tasks+site_reports
// only, not logs/user_notes (both private/restricted), so this produces the
// same result for whoever triggers it regardless of their access tier.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

// Customers aren't a database table — duplicated from src/App.jsx's
// CUSTOMERS, same as sales-advisor.js/documentation.js already do.
const CUSTOMERS = {
  bytronic: 'Bytronic', cognex: 'Cognex', flir: 'Teledyne FLIR', zebra: 'Zebra', sick: 'SICK', keyence: 'Keyence',
};

const LOG_TRAVEL_TOOL = {
  name: 'log_travel',
  description: 'Record one inferred instance of a team member likely travelling to a specific real-world location.',
  input_schema: {
    type: 'object',
    properties: {
      memberId: { type: 'string', description: 'Must be one of the real team member ids given in context' },
      country: { type: 'string', description: 'A real country name' },
      city: { type: 'string', description: 'City/town, if determinable — omit if not' },
      projectId: { type: 'string', description: 'One of the real project ids given in context, if this ties to a specific project — omit if not (e.g. a site report with no project attached)' },
      startDate: { type: 'string', description: 'YYYY-MM-DD, approximate start of the visit if determinable — omit if not' },
      endDate: { type: 'string', description: 'YYYY-MM-DD, approximate end of the visit if determinable — omit if not' },
      reason: { type: 'string', description: 'One short sentence on why this was inferred' },
    },
    required: ['memberId', 'country', 'reason'],
  },
};

const SYSTEM_PROMPT = `You maintain a "who's travelled where" map for an engineering company, drawing on two sources below — there is no single explicit travel log.

1. PROJECTS — indirect. Look at each project's name, subtitle, and customer for a real-world location that is actually mentioned or strongly implied (e.g. "Kelloggs Egypt" implies Egypt; "Amazon WRO6, Poland" implies Poland). Skip any project where you cannot identify a genuine, specific location — do not guess a country just because a customer has an office somewhere. For a project where you're confident of a real location, call log_travel once per team member who has tasks assigned on that project, using the given task due-date range to estimate roughly when the work happened. Only log people you're reasonably confident actually needed to be on-site (not remote/office work).

2. SITE REPORTS — direct and far more reliable: each one already states exactly who was on site and when (a human filled this in after visiting). Your only job for these is identifying the real country (and city, if evident) from the site name text — skip a report only if the site name gives no usable location clue at all. When it does, call log_travel once for each engineer listed on that report, using the report's date for both startDate and endDate (a site report is normally a single day), and its project id if one is attached.

Read between the lines carefully and conservatively for projects; trust site reports at face value for who/when, and only judge the location. It's fine, and expected, to call log_travel zero times for a source that gives you nothing solid.

Use only the real project ids and team member ids given in the context below — never invent one.`;

function buildProjectContext(projects, tasks, team) {
  return (projects || []).map((p) => {
    const pTasks = (tasks || []).filter((t) => t.project_id === p.id);
    const assigneeIds = [...new Set(pTasks.flatMap((t) => t.assignees || []))];
    const assignees = assigneeIds.map((id) => team.find((m) => m.id === id)).filter(Boolean);
    const dueDates = pTasks.map((t) => t.due).filter(Boolean).sort();
    const dateRange = dueDates.length ? `${dueDates[0]} to ${dueDates[dueDates.length - 1]}` : 'unknown';
    return `- [${p.id}] ${p.name}${p.subtitle ? ` — ${p.subtitle}` : ''}, customer: ${CUSTOMERS[p.customer_id] || 'unknown'}${p.deadline ? `, deadline ${p.deadline}` : ''}. Task date range: ${dateRange}. Assigned: ${assignees.map((m) => `[${m.id}] ${m.name}`).join(', ') || 'nobody'}`;
  }).join('\n') || '(none)';
}

function buildSiteReportContext(siteReports, team) {
  return (siteReports || []).map((r) => {
    const engineers = (r.engineer_ids || []).map((id) => team.find((m) => m.id === id)).filter(Boolean);
    return `- [${r.id}] Site: "${r.site_name}"${r.project_id ? `, project [${r.project_id}]` : ''}${r.report_date ? `, date ${r.report_date}` : ', date unknown'}. On site: ${engineers.map((m) => `[${m.id}] ${m.name}`).join(', ') || 'unknown'}`;
  }).join('\n') || '(none)';
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

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const db = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const [{ data: projects }, { data: tasks }, { data: team }, { data: siteReports }] = await Promise.all([
      db.from('projects').select('id, name, subtitle, deadline, customer_id'),
      db.from('tasks').select('id, due, project_id, assignees'),
      db.from('team_members').select('id, name'),
      db.from('site_reports').select('id, site_name, report_date, project_id, engineer_ids'),
    ]);

    const contextBlock = `PROJECTS:\n${buildProjectContext(projects, tasks, team || [])}\n\nSITE REPORTS:\n${buildSiteReportContext(siteReports, team || [])}`;

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
        messages: [{ role: 'user', content: 'Infer travel from the projects and site reports above and log it.' }],
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
      .filter((b) => teamById[b.input?.memberId] && b.input?.country)
      .map((b) => {
        const project = b.input.projectId ? projectById[b.input.projectId] : null;
        return {
          id: crypto.randomUUID(),
          member_id: b.input.memberId,
          country: b.input.country,
          city: b.input.city || null,
          customer_id: project?.customer_id || null,
          project_id: project?.id || null,
          start_date: b.input.startDate || null,
          end_date: b.input.endDate || null,
          note: b.input.reason || null,
        };
      });

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
