import { createClient } from '@supabase/supabase-js';

// keepalive lets writes (e.g. drag-and-drop status updates) finish even if the
// user navigates away or refreshes right after triggering them — otherwise the
// browser cancels the in-flight request and the change is silently lost.
function keepaliveFetch(input, init) {
  return fetch(input, { ...init, keepalive: true });
}

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: keepaliveFetch } }
);
