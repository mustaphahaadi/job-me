import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a typed Supabase client.
 *
 * - Frontend: pass VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (respects RLS)
 * - Scraper:  pass SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (bypasses RLS for writes)
 */
export function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: {
      persistSession: false,
    },
  });
}

export type { SupabaseClient };
