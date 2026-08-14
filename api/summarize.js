// Vercel serverless function. Keeps ANTHROPIC_API_KEY server-side and only
// serves requests from a signed-in Supabase user, so the key and the AI
// spend it can trigger stay private to this dashboard.
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

  const { person, entries } = req.body || {};
  if (!person || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'Missing person or log entries' });
  }

  const logText = entries
    .map((e) => `[${(e.created_at || '').slice(0, 10)}]${e.tag ? ` (${e.tag})` : ''} ${e.note}`)
    .join('\n');

  const prompt = `You are helping a manager summarize their private notes about a team member's behaviour and progress. Write a concise, fair, well-organized summary (short paragraphs or bullet points) of the dated log entries below about ${person}. Call out patterns, notable wins, and recurring concerns where present. Only use information present in the notes — do not invent anything.\n\nLog entries:\n${logText}`;

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
      return res.status(502).json({ error: 'Summary generation failed' });
    }

    const data = await aiRes.json();
    const summary = data.content?.[0]?.text || '';
    return res.status(200).json({ summary });
  } catch (err) {
    console.error('Summarize handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
