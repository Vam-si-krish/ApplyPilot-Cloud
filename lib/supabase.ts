import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { currentUserId } from './userContext';

// Two clients, two trust levels (docs/ARCHITECTURE.md §Module boundaries):
//
//  - supabaseAdmin(): service-role key, bypasses RLS. SERVER-ONLY. Used by API
//    routes and server components. Never import this into a client component.
//  - supabaseBrowser(): anon key, safe for the browser if/when used client-side.
//
// We read env lazily inside the factories so a missing var fails at call time
// with a clear message rather than at module load (which would break the build).

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function backendUrl(): string {
  return process.env.BACKEND_URL || requireEnv('NEXT_PUBLIC_SUPABASE_URL');
}

function backendServiceKey(): string {
  return process.env.BACKEND_SERVICE_KEY || requireEnv('SUPABASE_SERVICE_ROLE_KEY');
}

// Next.js patches global fetch and caches GET responses by default. supabase-js
// issues its reads via fetch, so without opting out, a read keeps returning a
// stale cached row after a write. Force no-store on every Supabase request so
// server reads are always fresh.
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

/** Server-only client. The gateway converts the trusted user header into an RLS JWT. */
export function supabaseAdmin(explicitUserId?: string | null): SupabaseClient {
  const userId = explicitUserId === undefined ? currentUserId() : explicitUserId;
  return createClient(
    backendUrl(),
    backendServiceKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: noStoreFetch,
        ...(userId ? { headers: { 'x-jobpilot-user-id': userId } } : {}),
      },
    },
  );
}

/** Anon client (browser-safe). */
export function supabaseBrowser(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
