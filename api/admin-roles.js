// Vercel serverless function. Lists every Supabase Auth user and their
// access tier, and lets a management caller promote/demote one. Needs the
// service role key (never exposed to the browser — see SUPABASE_SERVICE_ROLE_KEY
// in .env.example) since listing auth.users and writing another person's
// app_roles row are both outside what RLS + the anon key allow.
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
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
  const caller = await userRes.json();

  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

  // The one check everything below depends on: bypasses RLS (service role),
  // so this has to enforce management-only itself.
  const { data: callerRole, error: callerRoleErr } = await admin
    .from('app_roles')
    .select('access_tier')
    .eq('auth_user_id', caller.id)
    .maybeSingle();
  if (callerRoleErr) {
    console.error('Failed to check caller role', callerRoleErr);
    return res.status(500).json({ error: 'Internal error' });
  }
  if (callerRole?.access_tier !== 'management') {
    return res.status(403).json({ error: 'Management access required' });
  }

  if (req.method === 'GET') {
    const { data: userList, error: listErr } = await admin.auth.admin.listUsers();
    if (listErr) {
      console.error('Failed to list users', listErr);
      return res.status(500).json({ error: 'Failed to list users' });
    }
    const { data: roles, error: rolesErr } = await admin.from('app_roles').select('auth_user_id, access_tier');
    if (rolesErr) {
      console.error('Failed to load roles', rolesErr);
      return res.status(500).json({ error: 'Failed to load roles' });
    }
    const roleByUserId = Object.fromEntries((roles || []).map((r) => [r.auth_user_id, r.access_tier]));
    const users = userList.users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      accessTier: roleByUserId[u.id] || 'operator',
    }));
    return res.status(200).json({ users });
  }

  // POST — promote/demote one user.
  const { userId, accessTier } = req.body || {};
  if (!userId || (accessTier !== 'management' && accessTier !== 'operator')) {
    return res.status(400).json({ error: 'Missing or invalid userId/accessTier' });
  }
  const { error: upsertErr } = await admin
    .from('app_roles')
    .upsert({ auth_user_id: userId, access_tier: accessTier });
  if (upsertErr) {
    console.error('Failed to update role', upsertErr);
    return res.status(500).json({ error: 'Failed to update role' });
  }
  return res.status(200).json({ ok: true });
}
