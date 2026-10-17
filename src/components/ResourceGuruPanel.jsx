import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ExternalLink, Link2, RefreshCw, Unlink } from 'lucide-react';
import { TOKENS } from '../theme';

function formatDate(value) {
  if (!value) return 'No date';
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatStartTime(value, timezone) {
  if (!Number.isFinite(value)) return '';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return ` · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${timezone ? ` ${timezone}` : ''}`;
}

function bookingLabel(booking) {
  return booking.details || booking.name || booking.project?.name || `Booking #${booking.id}`;
}

export function ResourceGuruPanel({ accessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const request = useCallback(async (action, options = {}) => {
    const response = await fetch(`/api/resource-guru?action=${action}`, {
      ...options,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(
        "Resource Guru's API returned an invalid response. For local development, run `vercel dev` instead of `npm run dev`; plain Vite does not serve the /api functions."
      );
    }
    if (!response.ok) throw new Error(result.error || 'Resource Guru request failed');
    return result;
  }, [accessToken]);

  const loadStatus = useCallback(async () => {
    try {
      setData(await request('status'));
    } catch (err) {
      setError(err.message || 'Could not load Resource Guru status');
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('resourceGuru');
    if (result === 'connected') setNotice('Resource Guru connected. Run a sync to load the latest schedule.');
    if (result === 'error') setError('Resource Guru authorization did not complete. Check the app settings and try again.');
    if (result) {
      params.delete('resourceGuru');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    loadStatus();
  }, [loadStatus]);

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const result = await request('connect');
      window.location.assign(result.authorizationUrl);
    } catch (err) {
      setError(err.message || 'Could not start Resource Guru authorization');
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request('sync', { method: 'POST' });
      setNotice(`Synced ${result.bookingCount} bookings and ${result.taskCount} tasks.`);
      await loadStatus();
    } catch (err) {
      setError(err.message || 'Resource Guru sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Resource Guru from Pulse? The cached schedule will also be removed.')) return;
    setBusy(true);
    setError('');
    try {
      await request('disconnect', { method: 'POST' });
      setData({ connected: false, sync: null });
      setNotice('Resource Guru disconnected.');
    } catch (err) {
      setError(err.message || 'Could not disconnect Resource Guru');
    } finally {
      setBusy(false);
    }
  }

  const cardStyle = {
    background: TOKENS.surface,
    border: `1px solid ${TOKENS.border}`,
    borderRadius: 12,
    padding: 16,
  };
  const buttonStyle = {
    background: TOKENS.violet,
    color: '#fff',
    borderRadius: 8,
    padding: '8px 12px',
  };
  const bookings = data?.sync?.bookings || [];
  const tasks = data?.sync?.tasks || [];
  const resources = data?.sync?.resources || [];
  const projects = data?.sync?.projects || [];
  const projectName = (id) => projects.find((project) => String(project.id) === String(id))?.name;
  const resourceNamesForIds = (ids) => {
    return ids
      .map((id) => resources.find((resource) => String(resource.id) === String(id))?.name)
      .filter(Boolean)
      .join(', ');
  };
  const resourceNames = (booking) => resourceNamesForIds(
    booking.resource_ids || (booking.resource_id ? [booking.resource_id] : [])
  );

  return (
    <div className="space-y-4">
      <section style={cardStyle}>
        <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: TOKENS.text }}>
          <CalendarClock size={16} /> Resource Guru
        </h2>
        <p className="mt-2 text-xs" style={{ color: TOKENS.textMuted }}>
          Read-only sync for bookings from the past year through the next six months, and active Gantt tasks. Schedule data refreshes daily.
        </p>
        {error && <p role="alert" className="mt-3 text-sm" style={{ color: TOKENS.coral }}>{error}</p>}
        {notice && <p role="status" className="mt-3 text-sm" style={{ color: TOKENS.teal }}>{notice}</p>}
        {loading ? (
          <p className="mt-3 text-sm" style={{ color: TOKENS.textFaint }}>Checking connection…</p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-2 text-xs" style={{ color: TOKENS.textMuted }}>
              {data?.connected ? `Connected · ${data.accountSlug}` : 'Not connected'}
              {data?.sync?.synced_at ? ` · Last sync ${new Date(data.sync.synced_at).toLocaleString()}` : ''}
            </span>
            {data?.connected ? (
              <>
                <button type="button" disabled={busy} onClick={sync} className="flex items-center gap-2 text-sm disabled:opacity-50" style={buttonStyle}>
                  <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Sync now
                </button>
                <button type="button" disabled={busy} onClick={disconnect} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50" style={{ color: TOKENS.coral, border: `1px solid ${TOKENS.border}` }}>
                  <Unlink size={14} /> Disconnect
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={connect} className="flex items-center gap-2 text-sm disabled:opacity-50" style={buttonStyle}>
                <Link2 size={14} /> Connect Resource Guru
              </button>
            )}
            <a className="flex items-center gap-1 text-xs" style={{ color: TOKENS.violet }} href="https://app.resourceguruapp.com/developers" target="_blank" rel="noreferrer">
              Developer Center <ExternalLink size={12} />
            </a>
          </div>
        )}
      </section>

      {data?.connected && data?.sync && (
        <div className="grid gap-4 xl:grid-cols-2">
          <section style={cardStyle}>
            <h3 className="mb-3 text-sm font-semibold" style={{ color: TOKENS.text }}>
              Bookings <span style={{ color: TOKENS.textFaint }}>({data.sync.booking_count})</span>
            </h3>
            {bookings.length === 0 ? (
              <p className="text-sm" style={{ color: TOKENS.textFaint }}>No bookings in the synced date range.</p>
            ) : (
              <div className="max-h-[32rem] space-y-2 overflow-y-auto">
                {bookings.map((booking) => (
                  <article key={booking.id} className="rounded-lg p-3" style={{ background: TOKENS.surface2 }}>
                    <p className="text-sm font-medium" style={{ color: TOKENS.text }}>{bookingLabel(booking)}</p>
                    <p className="mt-1 text-xs" style={{ color: TOKENS.textMuted }}>
                      {formatDate(booking.start_date)}{formatStartTime(booking.start_time, booking.timezone)}{booking.end_date && booking.end_date !== booking.start_date ? ` – ${formatDate(booking.end_date)}` : ''}
                      {booking.approval_state?.status ? ` · ${booking.approval_state.status}` : ''}
                    </p>
                    {(projectName(booking.project_id) || resourceNames(booking)) && (
                      <p className="mt-1 text-xs" style={{ color: TOKENS.textFaint }}>
                        {[projectName(booking.project_id), resourceNames(booking)].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <h3 className="mb-3 text-sm font-semibold" style={{ color: TOKENS.text }}>
              Gantt tasks <span style={{ color: TOKENS.textFaint }}>({data.sync.task_count})</span>
            </h3>
            {tasks.length === 0 ? (
              <p className="text-sm" style={{ color: TOKENS.textFaint }}>No active Gantt tasks found.</p>
            ) : (
              <div className="max-h-[32rem] space-y-2 overflow-y-auto">
                {tasks.map((task) => (
                  <article key={task.id} className="rounded-lg p-3" style={{ background: TOKENS.surface2 }}>
                    <p className="text-sm font-medium" style={{ color: TOKENS.text }}>{task.name || `Task #${task.id}`}</p>
                    <p className="mt-1 text-xs" style={{ color: TOKENS.textMuted }}>
                      {formatDate(task.start_date)}{task.end_date && task.end_date !== task.start_date ? ` – ${formatDate(task.end_date)}` : ''}
                    </p>
                    {projectName(task.project_id) && (
                      <p className="mt-1 text-xs" style={{ color: TOKENS.textFaint }}>{projectName(task.project_id)}</p>
                    )}
                    {resourceNamesForIds(task.assignee_ids || []) && (
                      <p className="mt-1 text-xs" style={{ color: TOKENS.textFaint }}>
                        Assigned to {resourceNamesForIds(task.assignee_ids)}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
