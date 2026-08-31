// Vercel serverless function for the Documentation assistant. Same
// user-scoped-client model as the other advisors — the caller's own token,
// not the service role key. Unlike the chat-style agents, this is a single
// generate-on-demand call (no conversation history to persist), so there's
// no messages table for this one.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

// Customers aren't a database table (see the same note in api/sales-advisor.js)
// — duplicated here from src/App.jsx's CUSTOMERS, just for resolving a
// selected project's customer name into the generated document.
const CUSTOMERS = {
  bytronic: 'Bytronic',
  cognex: 'Cognex',
  flir: 'Teledyne FLIR',
  zebra: 'Zebra',
  sick: 'SICK',
  keyence: 'Keyence',
};

// Each template's standard section structure — this is the "standard
// company template" the document should follow every time. Keep `id`s in
// sync with DOCUMENT_TEMPLATES in src/components/DocumentationPanel.jsx.
const TEMPLATES = {
  'job-completion': {
    label: 'Job Completion / Commissioning Report',
    sections: 'Project & Customer; Date Completed; Scope of Work; Work Carried Out; Outcome / Status; Issues & Resolutions; Follow-up Actions; Engineer.',
  },
  'site-survey': {
    label: 'Site Survey Report',
    sections: 'Site / Customer; Date of Visit; Purpose of Survey; Site Conditions & Access; Existing Equipment / Infrastructure; Constraints & Risks Noted; Recommendations; Next Steps; Surveyor.',
  },
  'trial-summary': {
    label: 'Customer Trial Summary',
    sections: 'Customer & Contact; Hardware / Solution Trialled; Trial Period; Trial Objectives; Results & Observations; Customer Feedback; Recommended Next Step; Prepared By.',
  },
  'service-visit': {
    label: 'Service Visit Report',
    sections: 'Customer / Site; Date & Time on Site; Reported Issue; Diagnosis; Work Carried Out; Parts Used; Resolution Status; Follow-up Required; Engineer.',
  },
  'site-report': {
    label: 'Site Report',
    sections: '1. Site Details (Site Name; Date; Arrival Time; Departure Time; Engineers on Site); 2. Work Carried Out; 3. Issues / Observations; 4. Time Lost (if applicable); 5. Outstanding Actions; 6. Summary.',
    // Stricter than the other templates — this one has an explicit house
    // style (concise, bullet-only, no narrative) rather than free-form
    // prose sections, per the rules given for this document type.
    extraRules: `- Under "Work Carried Out": list only what was physically done — no assumptions, no narrative.
- Under "Issues / Observations": list any faults, delays, or risks identified.
- Under "Time Lost": clearly state the cause, and estimate duration only if one was given. Omit this section entirely if nothing was lost.
- Under "Outstanding Actions": list what still needs to be completed, and who's responsible if known.
- "Summary" is 1–2 sentences maximum, high-level status only — not a recap of the other sections.
- Keep everything concise and factual — every section except Summary is bullet points only, never paragraphs.
- Always include a clear "Site Name" line — it's how this report can later be matched to a location.`,
  },
  'panel-route-card': {
    label: 'Electrical Panel Build Route Card',
    sections: 'Panel / Job Reference; Project; Component List; Build Sequence (numbered steps); Wiring Checks; Tested By & Date; Notes / Deviations.',
  },
  'pre-site-checks': {
    label: 'Pre-Site Checks',
    sections: 'Site / Customer; Date of Visit; Site Access Confirmed; PPE Required; Permits / Inductions Needed; Tools & Equipment to Bring; Customer Contact Confirmed; RAMS Reviewed (yes/no); Notes.',
  },
  rams: {
    label: 'RAMS (Risk Assessment & Method Statement)',
    sections: 'Task / Job Description; Location; Date; Prepared By; Hazards Identified (a markdown table: Hazard | Who\'s at Risk | Likelihood | Severity | Risk Rating); Control Measures; PPE Required; Method Statement (numbered step-by-step safe working procedure); Emergency Procedures; Sign-off.',
    safetyCritical: true,
  },
};

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

  const { templateId, projectId, date, details } = req.body || {};
  const template = TEMPLATES[templateId];
  if (!template) {
    return res.status(400).json({ error: 'Unknown template' });
  }
  if (!details || typeof details !== 'string' || !details.trim()) {
    return res.status(400).json({ error: 'Missing details' });
  }

  const db = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    let projectContext = '(no specific project selected)';
    if (projectId) {
      const { data: project } = await db.from('projects').select('name, subtitle, deadline, customer_id').eq('id', projectId).maybeSingle();
      if (project) {
        projectContext = `${project.name}${project.subtitle ? ` — ${project.subtitle}` : ''}, customer: ${CUSTOMERS[project.customer_id] || 'unknown'}${project.deadline ? `, deadline ${project.deadline}` : ''}`;
      }
    }

    const safetyNote = template.safetyCritical
      ? '\n\nThis is a safety-critical document. End the output with a clearly marked notice that this is an AI-generated draft and must be reviewed and formally approved by a competent, qualified person before being used on site.'
      : '';
    const extraRulesNote = template.extraRules ? `\n\nAdditional rules for this document type:\n${template.extraRules}` : '';

    const systemPrompt = `You are a documentation assistant for Bytronic, a machine-vision systems integrator. Produce a "${template.label}" following Bytronic's standard structure for this document type, using only the details given below — do not invent specifics (names, dates, part numbers, results) that weren't provided; use a placeholder like "[TBC]" for anything missing rather than making something up.

Standard sections for a ${template.label}: ${template.sections}

Format the output as clean markdown with ## headings for each section.${safetyNote}${extraRulesNote}

Date: ${date || new Date().toISOString().slice(0, 10)}
Project: ${projectContext}

Details provided:
${details.trim()}`;

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
        messages: [{ role: 'user', content: systemPrompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic API error', errText);
      return res.status(502).json({ error: 'Document generation failed — try again' });
    }

    const data = await aiRes.json();
    const document = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    if (!document) {
      console.error('Anthropic returned no text content', JSON.stringify(data));
      return res.status(502).json({ error: 'Document came back empty — try again' });
    }

    return res.status(200).json({ document });
  } catch (err) {
    console.error('Documentation handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
