# Resource Guru integration setup

The management-only Resource Guru panel uses OAuth 2.0 to read bookings from the past year through six months ahead, and active Gantt tasks, from the `bytronicautomationltd` account. Resource Guru data is not written back. Vercel runs a scheduled sync daily at 07:00 UTC; management can trigger a manual sync.

## One-time setup

1. Run [`../supabase/resource-guru.sql`](../supabase/resource-guru.sql) in the Supabase SQL Editor. The connection table contains OAuth credentials and has row-level security enabled with no browser-accessible policies. Server functions use the Supabase service-role key.
2. Configure these Vercel environment variables:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the existing Pulse/Supabase settings).
   - `RESOURCE_GURU_CLIENT_ID` and `RESOURCE_GURU_CLIENT_SECRET` (from the confidential app in Resource Guru's Developer Center).
   - `RESOURCE_GURU_REDIRECT_URI` set to the exact deployed callback, e.g. `https://your-dashboard.example.com/api/resource-guru-callback`.
   - `RESOURCE_GURU_STATE_SECRET` set to a unique random secret for signing OAuth state.
   - `PUBLIC_APP_URL` set to the deployed dashboard origin, e.g. `https://your-dashboard.example.com`.
   - `CRON_SECRET` set to a strong random secret. Vercel cron requests use it to authenticate the scheduled sync.
   - `RESOURCE_GURU_ACCOUNT_SLUG` is optional and defaults to `bytronicautomationltd`.
3. In Resource Guru's Developer Center, update the app website URL and Redirect URI to the deployed dashboard and callback. Replace the old `http://localhost/oauth`; the redirect URI must match exactly.
4. Deploy the application, sign in as a Pulse management user, open **Resource Guru**, and select **Connect Resource Guru**. Approve the read-only scopes, then run the initial sync.

Keep the Resource Guru client secret and Supabase service-role key in server-side environment settings. Never prefix them with `VITE_`, put them in browser code, commit them, or share them in chat. The SQL migration must be applied before the first connection. For local integration testing, run `vercel dev` from the project root and register a matching local callback URI. Plain `npm run dev` starts only Vite and does not serve the `/api` functions this integration needs.

The configured Vercel cron runs daily at 07:00 UTC. More frequent polling depends on the Vercel plan; a Resource Guru webhook could later make booking updates more immediate, while tasks are not included in the webhook event list from the supplied API documentation.

## Troubleshooting sync errors

If a manual sync reports `Resource Guru API request failed (403)`, Resource Guru denied access to the endpoint shown in the error (bookings, tasks, resources, or projects). Check that the connected Resource Guru user can access that data and that the confidential app has the corresponding read permission enabled. If the app's OAuth permissions changed after connecting, disconnect and reconnect Resource Guru to grant a token with the updated permissions.
