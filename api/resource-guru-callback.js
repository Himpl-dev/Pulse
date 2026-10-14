import {
  exchangeAuthorizationCode,
  getAdminClient,
  saveAuthorizedConnection,
  verifyState,
} from '../lib/resourceGuru.js';

function redirectToDashboard(res, result) {
  const baseUrl = process.env.PUBLIC_APP_URL;
  if (!baseUrl) throw new Error('Missing server configuration: PUBLIC_APP_URL');
  const target = new URL('/', baseUrl);
  target.searchParams.set('tab', 'resource-guru');
  target.searchParams.set('resourceGuru', result);
  res.writeHead(302, { location: target.toString() });
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }
  if (req.query.error) {
    console.error('Resource Guru authorization declined or failed', req.query.error);
    return redirectToDashboard(res, 'error');
  }
  try {
    const state = verifyState(req.query.state);
    if (!req.query.code) throw new Error('Authorization code missing');
    const token = await exchangeAuthorizationCode(req.query.code);
    await saveAuthorizedConnection(getAdminClient(), token, state);
    return redirectToDashboard(res, 'connected');
  } catch (error) {
    console.error('Resource Guru OAuth callback failed', error.message);
    return redirectToDashboard(res, 'error');
  }
}
