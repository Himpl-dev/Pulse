import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { TOKENS } from '../theme';

// Management-only: lists every Supabase Auth user (via api/admin-roles.js,
// which holds the service role key server-side) and lets you set their
// access tier from a dropdown instead of the SQL editor. New accounts still
// have to be created in the Supabase dashboard — this only sets the tier.
export function AdminPanel({ accessToken }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/admin-roles', { headers: { authorization: `Bearer ${accessToken}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load users');
        if (!cancelled) setUsers(data.users || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load users');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  async function setTier(userId, accessTier) {
    const prevUsers = users;
    setSavingId(userId);
    setError('');
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, accessTier } : u)));
    try {
      const res = await fetch('/api/admin-roles', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId, accessTier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role');
    } catch (err) {
      setUsers(prevUsers);
      setError(err.message || 'Failed to update role');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
      <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
        <ShieldCheck size={15} /> Access
      </h2>
      <p className="text-xs mb-3" style={{ color: TOKENS.textFaint }}>
        Everyone with a login, and whether they're Management or Operator. New accounts still need creating in the Supabase dashboard — this only sets their tier.
      </p>
      {error && <p className="text-xs mb-2" style={{ color: TOKENS.coral }}>{error}</p>}
      {loading ? (
        <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>No users found.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-3 p-2.5 rounded-lg"
              style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}
            >
              <div className="min-w-0">
                <p className="text-sm truncate" style={{ color: TOKENS.text }}>{u.email}</p>
                <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>
                  Joined {new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              <select
                value={u.accessTier}
                disabled={savingId === u.id}
                onChange={(e) => setTier(u.id, e.target.value)}
                className="rounded-lg px-2 py-1.5 text-sm flex-shrink-0 disabled:opacity-50"
                style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, color: TOKENS.text }}
              >
                <option value="operator">Operator</option>
                <option value="management">Management</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
