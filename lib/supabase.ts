import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

let _admin: SupabaseClient | null = null;

/** Server-only client using the service-role key. */
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _admin;
}

/** Anon client (browser-safe). */
export function supabaseBrowser(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}
