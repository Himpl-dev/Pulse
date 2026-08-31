import React, { useEffect, useMemo, useState } from 'react';
import { Globe2, Loader2, RefreshCw, Trophy } from 'lucide-react';
import { TOKENS, hexToRgba } from '../theme';
import { supabase } from '../supabaseClient';

// A handful of spots where Claude's free-text country name won't match
// Natural Earth's name in the topojson verbatim. Not exhaustive — just the
// common ones — anything else still displays fine in the leaderboard, it
// just won't shade a map country until an alias is added here.
const NAME_ALIASES = {
  usa: 'united states of america',
  'united states': 'united states of america',
  'u.s.a.': 'united states of america',
  'u.s.': 'united states of america',
  uk: 'united kingdom',
  england: 'united kingdom',
  scotland: 'united kingdom',
  wales: 'united kingdom',
  uae: 'united arab emirates',
  'south korea': 'korea, rep.',
  'north korea': 'korea, dem. rep.',
  czechia: 'czech republic',
};

function normalizeCountryName(name) {
  const lower = (name || '').trim().toLowerCase();
  return NAME_ALIASES[lower] || lower;
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const diff = Math.round((new Date(end) - new Date(start)) / 86400000);
  return diff > 0 ? diff + 1 : 0;
}

function formatRange(start, end) {
  if (start && end) return `${start} → ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return 'date unknown';
}

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

// The one place in the app deliberately visible to everyone regardless of
// role — the whole point is team-wide bragging rights, not privacy. Reads a
// cached table (travel_entries) that api/travel-map-refresh.js rebuilds by
// having Claude infer likely site visits from projects+tasks — nothing here
// touches logs or user_notes, both of which stay private/restricted.
// react-simple-maps + the world-atlas topojson are both a few hundred KB
// combined, so — same pattern as pdfjs-dist/zxing elsewhere — they're
// dynamically imported here rather than adding weight to every visitor's
// initial bundle.
export function WorldMapPanel({ accessToken, team, customers }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [mapLibs, setMapLibs] = useState(null);
  const [hovered, setHovered] = useState(null); // { name, x, y }

  const memberById = useMemo(() => Object.fromEntries((team || []).map((m) => [m.id, m])), [team]);
  const customerById = useMemo(() => Object.fromEntries((customers || []).map((c) => [c.id, c])), [customers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fetchErr } = await supabase.from('travel_entries').select('*');
      if (cancelled) return;
      if (fetchErr) {
        setError('Failed to load the map data.');
      } else {
        setEntries(data || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rsm, topoModule] = await Promise.all([
        import('react-simple-maps'),
        import('world-atlas/countries-110m.json'),
      ]);
      if (cancelled) return;
      setMapLibs({
        ComposableMap: rsm.ComposableMap,
        Geographies: rsm.Geographies,
        Geography: rsm.Geography,
        topo: topoModule.default || topoModule,
      });
    })();
    return () => { cancelled = true; };
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetch('/api/travel-map-refresh', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error('This took too long to refresh — try again.');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to refresh the map');
      const { data: fresh, error: fetchErr } = await supabase.from('travel_entries').select('*');
      if (fetchErr) throw new Error('Refreshed, but failed to reload the map — try reloading the page.');
      setEntries(fresh || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  const countryStats = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      if (!e.country) continue;
      const key = normalizeCountryName(e.country);
      if (!map.has(key)) map.set(key, { displayName: e.country, entries: [] });
      map.get(key).entries.push(e);
    }
    return map;
  }, [entries]);

  const maxCount = Math.max(1, ...[...countryStats.values()].map((c) => c.entries.length), 0);

  const memberStats = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      if (!map.has(e.member_id)) map.set(e.member_id, { memberId: e.member_id, countries: new Set(), trips: 0, days: 0 });
      const s = map.get(e.member_id);
      s.countries.add(e.country);
      s.trips += 1;
      s.days += daysBetween(e.start_date, e.end_date);
    }
    return [...map.values()].sort(
      (a, b) => b.countries.size - a.countries.size || b.trips - a.trips || b.days - a.days
    );
  }, [entries]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display font-semibold text-lg flex items-center gap-2">
            <Globe2 size={18} /> World Map
          </h2>
          <p className="text-xs mt-0.5" style={{ color: TOKENS.textFaint }}>
            Where the team's actually been — inferred from project and task data. Bragging rights only, refresh any time.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 flex items-center gap-1.5"
          style={{ background: TOKENS.blue, color: '#0B0D11' }}
        >
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {refreshing ? 'Refreshing…' : 'Refresh from projects'}
        </button>
      </div>

      {error && (
        <p className="text-xs rounded-lg px-3 py-2" style={{ background: hexToRgba(TOKENS.coral, 0.12), color: TOKENS.coral }}>
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="lg:col-span-2 rounded-xl p-3 relative"
          style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}
        >
          {(loading || !mapLibs) ? (
            <div className="flex items-center justify-center gap-2 text-sm py-24" style={{ color: TOKENS.textFaint }}>
              <Loader2 size={16} className="animate-spin" /> Loading map…
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 text-sm py-24 text-center px-6" style={{ color: TOKENS.textFaint }}>
              <Globe2 size={24} />
              Nothing to show yet — hit "Refresh from projects" to have it inferred from current project and task data.
            </div>
          ) : (
            <mapLibs.ComposableMap projectionConfig={{ scale: 148 }} style={{ width: '100%', height: 'auto' }}>
              <mapLibs.Geographies geography={mapLibs.topo}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const key = (geo.properties?.name || '').toLowerCase();
                    const stat = countryStats.get(key);
                    const count = stat?.entries.length || 0;
                    const fill = count > 0
                      ? hexToRgba(TOKENS.teal, 0.25 + 0.6 * (count / maxCount))
                      : 'var(--token-surface2)';
                    return (
                      <mapLibs.Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onMouseEnter={(evt) => {
                          if (stat) setHovered({ key, x: evt.clientX, y: evt.clientY });
                        }}
                        onMouseMove={(evt) => {
                          if (stat) setHovered({ key, x: evt.clientX, y: evt.clientY });
                        }}
                        onMouseLeave={() => setHovered(null)}
                        style={{
                          default: { fill, stroke: 'var(--token-border)', strokeWidth: 0.5, outline: 'none' },
                          hover: { fill: stat ? TOKENS.teal : fill, stroke: 'var(--token-border)', strokeWidth: 0.5, outline: 'none', cursor: stat ? 'pointer' : 'default' },
                          pressed: { fill: TOKENS.teal, outline: 'none' },
                        }}
                      />
                    );
                  })
                }
              </mapLibs.Geographies>
            </mapLibs.ComposableMap>
          )}

          {hovered && countryStats.get(hovered.key) && (
            <div
              className="fixed z-50 rounded-lg p-3 text-xs pointer-events-none max-w-xs"
              style={{
                left: hovered.x + 14,
                top: hovered.y + 14,
                background: TOKENS.surface2,
                border: `1px solid ${TOKENS.border}`,
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              }}
            >
              <p className="font-semibold mb-1" style={{ color: TOKENS.text }}>
                {countryStats.get(hovered.key).displayName}
              </p>
              <div className="space-y-1">
                {countryStats.get(hovered.key).entries.slice(0, 5).map((e, i) => (
                  <p key={i} style={{ color: TOKENS.textMuted }}>
                    <span style={{ color: TOKENS.text }}>{memberById[e.member_id]?.name || 'Someone'}</span>
                    {e.city ? ` — ${e.city}` : ''}
                    {e.customer_id && customerById[e.customer_id] ? ` · ${customerById[e.customer_id].name}` : ''}
                    {' · '}{formatRange(e.start_date, e.end_date)}
                  </p>
                ))}
                {countryStats.get(hovered.key).entries.length > 5 && (
                  <p style={{ color: TOKENS.textFaint }}>+{countryStats.get(hovered.key).entries.length - 5} more</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
          <h3 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
            <Trophy size={15} style={{ color: TOKENS.amber }} /> Leaderboard
          </h3>
          {memberStats.length === 0 ? (
            <p className="text-xs" style={{ color: TOKENS.textFaint }}>No travel logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {memberStats.map((s, i) => (
                <div key={s.memberId} className="flex items-start gap-2.5">
                  <span className="text-sm w-5 shrink-0 text-center" style={{ color: TOKENS.textFaint }}>
                    {RANK_MEDAL[i] || i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: TOKENS.text }}>
                      {memberById[s.memberId]?.name || 'Unknown'}
                    </p>
                    <p className="text-xs" style={{ color: TOKENS.textFaint }}>
                      {s.countries.size} {s.countries.size === 1 ? 'country' : 'countries'} · {s.trips} {s.trips === 1 ? 'trip' : 'trips'}
                      {s.days > 0 ? ` · ~${s.days}d` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
