import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS, type Settings } from './types.js';

/**
 * Creates a typed Supabase client.
 *
 * - Frontend: pass VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (RLS grants
 *   both 'anon' and 'authenticated' roles — no login required).
 *   Session persistence is enabled in browsers so a future Supabase Auth
 *   session would survive reloads; with no login flow it is a no-op.
 * - Scraper:  pass SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (bypasses RLS for writes)
 */
export function createSupabaseClient(url: string, key: string): SupabaseClient {
  const isBrowser = typeof window !== 'undefined';
  return createClient(url, key, {
    auth: {
      persistSession: isBrowser,
    },
  });
}

/**
 * Safely fetches the settings row (id=1) from Supabase.
 * If the row is missing in the database, it automatically initializes/inserts
 * DEFAULT_SETTINGS so background pipeline runs do not crash.
 *
 * A select error is treated as fatal for this call: returning in-memory
 * defaults is safe, but writing them would overwrite the user's real settings
 * during a transient outage. Initialization uses INSERT (not UPSERT) and
 * re-reads on a race so two pipeline runs cannot clobber each other.
 */
export async function getOrInitSettings(supabase: SupabaseClient): Promise<Settings> {
  const { data: settingsData, error: selectError } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (selectError) {
    console.warn(`[settings] Could not read settings (${String(selectError.message).replace(/[\r\n]/g, ' ')}). Using in-memory defaults.`);
    return DEFAULT_SETTINGS;
  }

  if (settingsData) return settingsData as Settings;

  console.log('[settings] Settings row (id=1) not found in database. Seeding default settings...');

  const { data: inserted, error: insertError } = await supabase
    .from('settings')
    .insert(DEFAULT_SETTINGS)
    .select()
    .single();

  if (!insertError && inserted) return inserted as Settings;

  // Another process may have inserted the row between our SELECT and INSERT.
  const { data: retry, error: retryError } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (!retryError && retry) return retry as Settings;

  console.warn(`[settings] Could not auto-insert settings row (${String(insertError?.message ?? retryError?.message ?? 'unknown').replace(/[\r\n]/g, ' ')}). Falling back to in-memory defaults.`);
  return DEFAULT_SETTINGS;
}

export type { SupabaseClient };
