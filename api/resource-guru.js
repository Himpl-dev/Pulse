import {
  createAuthorizationUrl,
  disconnectResourceGuru,
  getSyncData,
  loadConnection,
  requireManagement,
  syncResourceGuru,
} from '../lib/resourceGuru.js';

export default async function handler(req, res) {
  try {
    const action = req.query.action;
    if (req.method === 'GET' && !['connect', 'status'].includes(action)) {
      return res.status(400).json({ error: 'Unknown action' });
    }
    if (req.method === 'POST' && !['sync', 'disconnect'].includes(action)) {
      return res.status(400).json({ error: 'Unknown action' });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await requireManagement(req);
    if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message });

    if (req.method === 'GET' && action === 'connect') {
      return res.status(200).json({ authorizationUrl: createAuthorizationUrl(auth.user.id) });
    }
    if (req.method === 'GET' && action === 'status') {
      const [connection, sync] = await Promise.all([
        loadConnection(auth.admin),
        getSyncData(auth.admin),
      ]);
      return res.status(200).json({
        connected: Boolean(connection),
        accountSlug: connection?.account_slug || null,
        connectedAt: connection?.updated_at || null,
        sync,
      });
    }
    if (action === 'sync') {
      const result = await syncResourceGuru(auth.admin);
      return res.status(200).json(result);
    }
    await disconnectResourceGuru(auth.admin);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Resource Guru API error', error);
    return res.status(500).json({ error: error.message || 'Resource Guru request failed' });
  }
}
