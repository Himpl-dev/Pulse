import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const API_BASE = 'https://api.resourceguruapp.com';
const ACCOUNT_SLUG = process.env.RESOURCE_GURU_ACCOUNT_SLUG || 'bytronicautomationltd';
const CONNECTION_ID = ACCOUNT_SLUG;
const SCOPES = [
  'accounts:read',
  'resources:read',
  'bookings:read',
  'projects:read',
  'planning:read',
].join(' ');

export function getResourceGuruConfig() {
  const required = [
    'RESOURCE_GURU_CLIENT_ID',
    'RESOURCE_GURU_CLIENT_SECRET',
    'RESOURCE_GURU_REDIRECT_URI',
    'RESOURCE_GURU_STATE_SECRET',
    'PUBLIC_APP_URL',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing server configuration: ${missing.join(', ')}`);
  }
  return {
    clientId: process.env.RESOURCE_GURU_CLIENT_ID,
    clientSecret: process.env.RESOURCE_GURU_CLIENT_SECRET,
    redirectUri: process.env.RESOURCE_GURU_REDIRECT_URI,
    stateSecret: process.env.RESOURCE_GURU_STATE_SECRET,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
  };
}

export function getAdminClient() {
  const config = getResourceGuruConfig();
  return createClient(config.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function requireManagement(req) {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!accessToken) {
    return { error: { status: 401, message: 'Missing auth token' } };
  }

  const config = getResourceGuruConfig();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: process.env.VITE_SUPABASE_ANON_KEY,
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    return { error: { status: 401, message: 'Invalid session' } };
  }

  const user = await response.json();
  const admin = getAdminClient();
  const { data: role, error } = await admin
    .from('app_roles')
    .select('access_tier')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('Failed to check Resource Guru caller role', error);
    return { error: { status: 500, message: 'Failed to verify access' } };
  }
  if (role?.access_tier !== 'management') {
    return { error: { status: 403, message: 'Management access required' } };
  }
  return { admin, user };
}

function signState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function createAuthorizationUrl(userId) {
  const config = getResourceGuruConfig();
  const state = signState({
    userId,
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString('hex'),
  }, config.stateSecret);
  const url = new URL(`${API_BASE}/oauth/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

export function verifyState(state) {
  const config = getResourceGuruConfig();
  const [encoded, suppliedSignature] = (state || '').split('.');
  if (!encoded || !suppliedSignature) throw new Error('Invalid OAuth state');
  const expectedSignature = createHmac('sha256', config.stateSecret).update(encoded).digest();
  const actualSignature = Buffer.from(suppliedSignature, 'base64url');
  if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
    throw new Error('Invalid OAuth state');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload.userId || !Number.isFinite(payload.issuedAt) || Date.now() - payload.issuedAt > 10 * 60 * 1000) {
    throw new Error('OAuth state expired');
  }
  return payload;
}

export async function exchangeAuthorizationCode(code) {
  const config = getResourceGuruConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    console.error('Resource Guru token exchange failed', response.status, data.error || data.error_description || 'Invalid token response');
    throw new Error('Resource Guru authorization failed');
  }
  return data;
}

async function refreshAccessToken(admin, connection) {
  const config = getResourceGuruConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
  });
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    console.error('Resource Guru token refresh failed', response.status, data.error || data.error_description || 'Invalid token response');
    throw new Error('Resource Guru authorization expired; reconnect the account');
  }
  const updated = {
    ...connection,
    access_token: data.access_token,
    refresh_token: data.refresh_token || connection.refresh_token,
    expires_at: new Date(Date.now() + (Number(data.expires_in) || 604800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('resource_guru_connections').upsert(updated);
  if (error) {
    console.error('Failed to save refreshed Resource Guru token', error);
    throw new Error('Failed to save Resource Guru authorization');
  }
  return updated;
}

export async function loadConnection(admin) {
  const { data, error } = await admin
    .from('resource_guru_connections')
    .select('*')
    .eq('id', CONNECTION_ID)
    .maybeSingle();
  if (error) {
    console.error('Failed to load Resource Guru connection', error);
    throw new Error('Failed to load Resource Guru connection');
  }
  return data;
}

async function resourceGuruRequest(connection, path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${connection.access_token}` },
  });
  if (!response.ok) {
    console.error('Resource Guru API request failed', response.status, path);
    const error = new Error(`Resource Guru API request failed (${response.status}) for ${path}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function saveAuthorizedConnection(admin, token, statePayload) {
  const { data: role, error: roleError } = await admin
    .from('app_roles')
    .select('access_tier')
    .eq('auth_user_id', statePayload.userId)
    .maybeSingle();
  if (roleError) {
    console.error('Failed to recheck Resource Guru callback user role', roleError);
    throw new Error('Failed to verify management access');
  }
  if (role?.access_tier !== 'management') throw new Error('Management access required');

  const accounts = await resourceGuruRequest({ access_token: token.access_token }, '/v1/accounts');
  const accountList = Array.isArray(accounts) ? accounts : accounts.accounts;
  const account = accountList?.find((item) => item.subdomain === ACCOUNT_SLUG);
  if (!account) throw new Error(`Authorized Resource Guru account "${ACCOUNT_SLUG}" was not found`);

  const record = {
    id: CONNECTION_ID,
    account_slug: ACCOUNT_SLUG,
    connected_by: statePayload.userId,
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    expires_at: new Date(Date.now() + (Number(token.expires_in) || 604800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('resource_guru_connections').upsert(record);
  if (error) {
    console.error('Failed to save Resource Guru connection', error);
    throw new Error('Failed to save Resource Guru connection');
  }
  return account;
}

async function authenticatedConnection(admin) {
  let connection = await loadConnection(admin);
  if (!connection) throw new Error('Resource Guru is not connected');
  if (!connection.refresh_token) throw new Error('Resource Guru connection has no refresh token; reconnect the account');
  if (new Date(connection.expires_at).getTime() < Date.now() + 60_000) {
    connection = await refreshAccessToken(admin, connection);
  }
  return connection;
}

async function fetchAll(connection, resource, extraParams = {}) {
  const items = [];
  const pageSize = 100;
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const params = new URLSearchParams({
      ...extraParams,
      limit: String(pageSize),
      offset: String(offset),
    });
    const result = await resourceGuruRequest(connection, `/v1/${ACCOUNT_SLUG}/${resource}?${params}`);
    if (!Array.isArray(result)) throw new Error(`Unexpected Resource Guru ${resource} response`);
    items.push(...result);
    if (result.length < pageSize) return items;
  }
  throw new Error(`Resource Guru ${resource} exceeded the safe pagination limit`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export async function syncResourceGuru(admin) {
  const connection = await authenticatedConnection(admin);
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 365);
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 180);
  let tasksUnavailable = false;
  const tasksRequest = fetchAll(connection, 'tasks').catch((error) => {
    if (error.status !== 403) throw error;
    tasksUnavailable = true;
    console.warn('Resource Guru denied access to Gantt tasks; syncing the remaining schedule data');
    return [];
  });
  const [bookings, tasks, resources, projects] = await Promise.all([
    fetchAll(connection, 'bookings', { start_date: isoDate(start), end_date: isoDate(end) }),
    tasksRequest,
    fetchAll(connection, 'resources'),
    fetchAll(connection, 'projects'),
  ]);
  const syncedAt = new Date().toISOString();
  const { error } = await admin.from('resource_guru_syncs').upsert({
    id: CONNECTION_ID,
    account_slug: ACCOUNT_SLUG,
    bookings,
    tasks,
    resources,
    projects,
    synced_at: syncedAt,
    booking_count: bookings.length,
    task_count: tasks.length,
  });
  if (error) {
    console.error('Failed to save Resource Guru schedule cache', error);
    throw new Error('Failed to save Resource Guru schedule');
  }
  return { syncedAt, bookingCount: bookings.length, taskCount: tasks.length, tasksUnavailable };
}

export async function getSyncData(admin) {
  const { data, error } = await admin
    .from('resource_guru_syncs')
    .select('account_slug, bookings, tasks, resources, projects, synced_at, booking_count, task_count')
    .eq('id', CONNECTION_ID)
    .maybeSingle();
  if (error) {
    console.error('Failed to load Resource Guru schedule cache', error);
    throw new Error('Failed to load Resource Guru schedule');
  }
  return data;
}

export async function disconnectResourceGuru(admin) {
  const { error: syncError } = await admin.from('resource_guru_syncs').delete().eq('id', CONNECTION_ID);
  if (syncError) {
    console.error('Failed to remove Resource Guru schedule cache', syncError);
    throw new Error('Failed to remove Resource Guru schedule');
  }
  const { error } = await admin.from('resource_guru_connections').delete().eq('id', CONNECTION_ID);
  if (error) {
    console.error('Failed to remove Resource Guru connection', error);
    throw new Error('Failed to remove Resource Guru connection');
  }
}
