import { getAdminClient, syncResourceGuru } from '../lib/resourceGuru.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.CRON_SECRET) {
    console.error('Resource Guru scheduled sync requires CRON_SECRET');
    return res.status(500).json({ error: 'Scheduled sync is not configured' });
  }
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await syncResourceGuru(getAdminClient());
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('Scheduled Resource Guru sync failed', error);
    return res.status(500).json({ error: error.message || 'Scheduled sync failed' });
  }
}
