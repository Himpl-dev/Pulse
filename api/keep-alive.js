// Pinged daily by Vercel Cron (see vercel.json) purely to keep the Supabase
// Free-tier project from auto-pausing after ~7 days of no API activity —
// see the memory note on this. A lightweight, unauthenticated REST query is
// enough: RLS blocks the rows, but the query still runs against Postgres,
// which is what resets Supabase's inactivity clock.
export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  // Vercel sends this header on cron-triggered invocations when CRON_SECRET
  // is set; skip the check if it isn't configured yet so this works out of
  // the box, but set CRON_SECRET in Vercel's env vars to stop this URL being
  // publicly triggerable by anyone who finds it.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

  try {
    const pingRes = await fetch(`${supabaseUrl}/rest/v1/projects?select=id&limit=1`, {
      headers: { apikey: supabaseAnonKey },
    });
    console.log(`Supabase keep-alive ping: ${pingRes.status}`);
    return res.status(200).json({ ok: true, supabaseStatus: pingRes.status });
  } catch (err) {
    // A failed ping shouldn't look like a broken deploy — just log it so
    // it's visible in Vercel's cron logs if Supabase is ever actually down.
    console.error('Supabase keep-alive ping failed', err);
    return res.status(200).json({ ok: false });
  }
}
