import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS, type Settings } from './types.js';

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

/**
 * Safely fetches the settings row (id=1) from Supabase.
 * If the row is missing in the database, it automatically initializes/inserts
 * DEFAULT_SETTINGS so background pipeline runs do not crash.
 */
export async function getOrInitSettings(supabase: SupabaseClient): Promise<Settings> {
  const { data: settingsData } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (settingsData) return settingsData as Settings;

  console.log('[settings] Settings row (id=1) not found in database. Seeding default settings...');

  const { data: inserted, error } = await supabase
    .from('settings')
    .upsert(DEFAULT_SETTINGS)
    .select()
    .single();

  if (error || !inserted) {
    console.warn(`[settings] Could not auto-insert settings row (${String(error?.message ?? 'unknown').replace(/[\r\n]/g, ' ')}). Falling back to in-memory defaults.`);
    return DEFAULT_SETTINGS;
  }

  return inserted as Settings;
}

export type { SupabaseClient };
