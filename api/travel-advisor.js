// Vercel serverless function for the Travel advisor. Single-shot generate
// (like api/documentation.js), not a chat — matches "receives dates,
// locations" from the original brief. Deliberately does NOT use a
// Claude tool-execution loop for flight search (call Claude -> run a tool ->
// call Claude again): that's a second full round trip on top of an external
// API call, which is exactly the shape that blew the 30s serverless ceiling
// for the Engineer advisor's PDFs. Instead: fetch everything external first,
// then make exactly one Claude call with all of it already in hand.
//
// Flights: Amadeus's free self-service tier (test.api.amadeus.com) — real
// API, but sandbox data, not guaranteed live/bookable production prices.
// Hotels: advisory only for now, no live search (Amadeus's hotel flow is a
// much more involved multi-step API — can be added later if flights prove
// useful first). News: NewsAPI.org free tier. Currency: frankfurter.app,
// free and keyless. Any of these that aren't configured (no env var) or
// fail are just skipped — the briefing still generates without them.
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `You are a travel advisor for Bytronic, helping arrange a work trip for an engineer/technician going to install, commission, or service equipment on site. Using the trip details and any live data given below, produce a trip briefing covering:

- **Scope of work on site** — a short outline based on what the user described.
- **Travel** — reference the flight options given, if any; if none were found or flight search wasn't available, say so and give general guidance instead of inventing prices.
- **Accommodation** — the recommended nightly spend for an engineer on site is a MAXIMUM of £150/night. Recommend accommodation options/areas within that budget for the destination; flag plainly if that budget looks unrealistic for the destination.
- **Getting around** — recommend for or against a rental car for this specific city: advise against renting in cities where traffic, parking, or public transport/taxis make it impractical or where rentals are known to be poor value, and say so plainly; recommend taxis/public transport instead where that's genuinely the better call.
- **Budget & currency** — reference the exchange rate given, if provided.
- **Local notes** — a few common local phrases (only if the destination is outside the UK), and, if news headlines are provided below, a brief note on anything currently worth being aware of.

Also call the recommend_place tool for 2-4 genuinely useful local restaurants/bars near the destination, if you're confident enough to name real ones — skip it rather than invent a place you're not sure exists.

Be honest about the limits of what you know — you don't have live, guaranteed-current data for anything not explicitly given to you below.`;

const RECOMMEND_PLACE_TOOL = {
  name: 'recommend_place',
  description: 'Recommend a specific real local restaurant or bar near the destination.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      area: { type: 'string', description: 'Neighborhood/area or city, for the maps search' },
      note: { type: 'string', description: 'One short sentence on why it\'s recommended' },
    },
    required: ['name', 'area', 'note'],
  },
};

// Node's fetch() has no default timeout — a single slow/hanging external
// service (this endpoint calls three: Amadeus, frankfurter, NewsAPI) could
// otherwise silently eat the entire 30s budget before Claude is even
// called. Every external call below goes through this instead of bare fetch.
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getAmadeusToken() {
  const clientId = process.env.AMADEUS_API_KEY;
  const clientSecret = process.env.AMADEUS_API_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetchWithTimeout('https://test.api.amadeus.com/v1/security/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch (err) {
    console.error('Amadeus auth failed', err);
    return null;
  }
}

async function searchFlights({ origin, destination, departDate, returnDate }) {
  if (!origin || !destination || !departDate) return null;
  const token = await getAmadeusToken();
  if (!token) return null;
  try {
    const params = new URLSearchParams({
      originLocationCode: origin.toUpperCase(),
      destinationLocationCode: destination.toUpperCase(),
      departureDate: departDate,
      adults: '1',
      max: '5',
    });
    if (returnDate) params.set('returnDate', returnDate);
    const res = await fetchWithTimeout(`https://test.api.amadeus.com/v2/shopping/flight-offers?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const offers = (data.data || []).slice(0, 5).map((o) => {
      const first = o.itineraries?.[0];
      const stops = (first?.segments?.length || 1) - 1;
      const carrier = first?.segments?.[0]?.carrierCode || '?';
      return `- ${o.price.total} ${o.price.currency} · ${carrier} · ${stops === 0 ? 'direct' : `${stops} stop${stops > 1 ? 's' : ''}`} · ${first?.duration || ''}`;
    });
    return offers.length ? offers.join('\n') : null;
  } catch (err) {
    console.error('Amadeus flight search failed', err);
    return null;
  }
}

async function getCurrencyRate(currency) {
  if (!currency) return null;
  const code = currency.trim().toUpperCase();
  if (code === 'GBP') return '1 GBP = 1 GBP (destination currency is GBP)';
  try {
    const res = await fetchWithTimeout(`https://api.frankfurter.app/latest?from=GBP&to=${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const rate = data.rates?.[code];
    return rate ? `1 GBP ≈ ${rate} ${code} (as of ${data.date})` : null;
  } catch (err) {
    console.error('Currency lookup failed', err);
    return null;
  }
}

async function getHeadlines(destination) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey || !destination) return null;
  try {
    const params = new URLSearchParams({ q: destination, sortBy: 'publishedAt', pageSize: '5', language: 'en' });
    const res = await fetchWithTimeout(`https://newsapi.org/v2/everything?${params}`, { headers: { 'X-Api-Key': apiKey } });
    if (!res.ok) return null;
    const data = await res.json();
    const headlines = (data.articles || []).slice(0, 5).map((a) => `- ${a.title} (${a.source?.name || 'unknown source'})`);
    return headlines.length ? headlines.join('\n') : null;
  } catch (err) {
    console.error('News lookup failed', err);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

  const { origin, destination, departDate, returnDate, scope, currency } = req.body || {};
  if (!destination || typeof destination !== 'string' || !destination.trim()) {
    return res.status(400).json({ error: 'Missing destination' });
  }
  if (!scope || typeof scope !== 'string' || !scope.trim()) {
    return res.status(400).json({ error: 'Missing scope of work' });
  }

  // A quick reminder this needs a Supabase-authenticated client even though
  // this endpoint doesn't read any app data — keeps the same auth-gate shape
  // as every other advisor, and leaves room to ground this in real project
  // data later without restructuring.
  createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });

  try {
    const [flights, rate, headlines] = await Promise.all([
      searchFlights({ origin, destination, departDate, returnDate }),
      getCurrencyRate(currency),
      getHeadlines(destination),
    ]);

    const contextBlock = [
      `Trip: ${origin ? `${origin} to ` : ''}${destination}${departDate ? `, departing ${departDate}` : ''}${returnDate ? `, returning ${returnDate}` : ''}`,
      `Scope of work: ${scope.trim()}`,
      flights ? `\nFlight options found:\n${flights}` : '\nFlight options: none found (live search not configured or no results).',
      rate ? `\nExchange rate: ${rate}` : '',
      headlines ? `\nRecent headlines mentioning ${destination}:\n${headlines}` : '',
    ].filter(Boolean).join('\n');

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2500,
        system: `${SYSTEM_PROMPT}\n\n${contextBlock}`,
        tools: [RECOMMEND_PLACE_TOOL],
        messages: [{ role: 'user', content: 'Generate the trip briefing.' }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic API error', errText);
      return res.status(502).json({ error: 'Advisor is unavailable right now — try again' });
    }

    const data = await aiRes.json();
    const content = data.content || [];
    const briefing = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim();
    if (!briefing) {
      console.error('Anthropic returned no text content', JSON.stringify(data));
      return res.status(502).json({ error: 'Advisor came back empty — try again' });
    }

    const places = content
      .filter((b) => b.type === 'tool_use' && b.name === 'recommend_place')
      .map((b) => ({
        name: b.input.name,
        note: b.input.note,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.input.name}, ${b.input.area}`)}`,
      }));

    return res.status(200).json({ briefing, places });
  } catch (err) {
    console.error('Travel advisor handler error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
