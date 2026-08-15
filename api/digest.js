// Vercel serverless function. Same shape as summarize.js — auth-gated,
// keeps ANTHROPIC_API_KEY server-side — but produces a team-wide weekly
// digest instead of a single person's log summary.
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

  const { overdue, dueSoon, comments, logs, members } = req.body || {};
  if (!Array.isArray(overdue) || !Array.isArray(dueSoon) || !Array.isArray(comments) || !Array.isArray(logs) || !Array.isArray(members)) {
    return res.status(400).json({ error: 'Missing digest data' });
  }

  const section = (title, lines) => `${title}:\n${lines.length ? lines.join('\n') : '(none)'}`;

  const prompt = `You are helping a team lead prepare a short weekly digest for their team, covering an engineering/vision-systems dashboard. Using only the data below, write a concise digest organized under these headings: "Overdue", "Due this week", "Recent activity", and "Team load". Keep it factual and skimmable (short bullet points), call out anything that looks at risk, and do not invent information that isn't in the data.

${section('Overdue tasks', overdue)}

${section('Due this week', dueSoon)}

${section('Recent comments (last 7 days)', comments)}

${section('Recent behaviour/progress logs (last 7 days)', logs)}

${section('Per-member load', members)}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic API error', errText);
      return res.status(502).json({ error: 'Digest generation failed' });
    }

    const data = await aiRes.json();
    const digest = data.content?.[0]?.text || '';
    return res.status(200).json({ digest });
  } catch (err) {
    console.error('Digest handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
