import React, { useState } from 'react';
import { Plane, Loader2, Download, MapPin } from 'lucide-react';
import { TOKENS } from '../theme';
import { CopyButton } from './AiOutput';
import { renderMarkdown, downloadTextFile } from '../markdown';

const inputStyle = { background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, color: TOKENS.text };

// Guided form + single generate, same shape as DocumentationPanel — matches
// "receives dates, locations" from the brief, and avoids needing an
// open-ended chat to collect structured trip details. See api/travel-advisor.js
// for why this is one Claude call with data pre-fetched, not a tool loop.
export function TravelPanel({ accessToken }) {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departDate, setDepartDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [currency, setCurrency] = useState('');
  const [scope, setScope] = useState('');
  const [briefing, setBriefing] = useState('');
  const [places, setPlaces] = useState([]);
  const [placeQrCodes, setPlaceQrCodes] = useState({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  async function generate(e) {
    e.preventDefault();
    if (!destination.trim() || !scope.trim() || generating) return;
    setGenerating(true);
    setError('');
    setBriefing('');
    setPlaces([]);
    setPlaceQrCodes({});
    try {
      const res = await fetch('/api/travel-advisor', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          origin: origin.trim() || null,
          destination: destination.trim(),
          departDate: departDate || null,
          returnDate: returnDate || null,
          currency: currency.trim() || null,
          scope: scope.trim(),
        }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        // A non-JSON body means the platform itself killed the request
        // (e.g. a serverless timeout) before our own code could respond.
        throw new Error('This took too long to generate — try again, maybe with less detail in the scope.');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to generate briefing');
      setBriefing(data.briefing || '');
      setPlaces(data.places || []);
      if (data.places?.length) {
        // Small library, but no reason to load it for everyone who never
        // uses Travel — only pull it in once there's something to render.
        const { default: QRCode } = await import('qrcode');
        const codes = {};
        await Promise.all(data.places.map(async (p) => {
          codes[p.mapsUrl] = await QRCode.toDataURL(p.mapsUrl, { width: 120, margin: 1 });
        }));
        setPlaceQrCodes(codes);
      }
    } catch (err) {
      setError(err.message || 'Failed to generate briefing — try again.');
    } finally {
      setGenerating(false);
    }
  }

  function download() {
    const filename = `travel-briefing-${destination.trim().toLowerCase().replace(/\s+/g, '-')}-${departDate || 'trip'}.md`;
    downloadTextFile(filename, briefing, 'text/markdown');
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
        <h2 className="font-display font-semibold text-sm mb-1 flex items-center gap-2">
          <Plane size={15} /> Travel
        </h2>
        <p className="text-xs mb-3" style={{ color: TOKENS.textFaint }}>
          Trip briefing — budget/rental-car guidance, an itinerary outline, and local notes. Flights use live search when configured; hotel search isn't live yet, just advisory guidance.
        </p>
        <form onSubmit={generate} className="flex flex-col gap-2">
          <div className="flex gap-2 flex-wrap">
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Origin airport code (e.g. LHR)" className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px]" style={inputStyle} />
            <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Destination (city or airport code)" className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px]" style={inputStyle} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <input type="date" value={departDate} onChange={(e) => setDepartDate(e.target.value)} className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px]" style={inputStyle} title="Departure date" />
            <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px]" style={inputStyle} title="Return date" />
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="Destination currency (e.g. EUR)" className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[140px]" style={inputStyle} />
          </div>
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Scope of work on site — what's being installed/commissioned/serviced, and any relevant detail."
            rows={3}
            className="rounded-lg px-3 py-2 text-sm resize-none"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={generating || !destination.trim() || !scope.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-1.5 self-start"
            style={{ background: TOKENS.blue, color: '#0B0D11' }}
          >
            {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : 'Generate briefing'}
          </button>
        </form>
        {error && <p className="text-xs mt-2" style={{ color: TOKENS.coral }}>{error}</p>}
      </div>

      {briefing && (
        <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="font-display font-semibold text-sm">Trip briefing — {destination}</h3>
            <div className="flex items-center gap-2">
              <CopyButton text={briefing} label="Copy" />
              <button
                onClick={download}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: TOKENS.surface2, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}
              >
                <Download size={13} /> Download
              </button>
            </div>
          </div>
          <div className="text-sm leading-relaxed rounded-lg p-3" style={{ color: TOKENS.text, background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}>
            {renderMarkdown(briefing)}
          </div>
        </div>
      )}

      {places.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
          <h3 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
            <MapPin size={15} /> Recommended nearby
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {places.map((p, i) => (
              <a
                key={i}
                href={p.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 p-2.5 rounded-lg"
                style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}
              >
                {placeQrCodes[p.mapsUrl] && (
                  <img src={placeQrCodes[p.mapsUrl]} alt="" width={56} height={56} style={{ borderRadius: 6, flexShrink: 0 }} />
                )}
                <div className="min-w-0">
                  <p className="text-sm truncate" style={{ color: TOKENS.text }}>{p.name}</p>
                  <p className="text-xs" style={{ color: TOKENS.textFaint }}>{p.note}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
