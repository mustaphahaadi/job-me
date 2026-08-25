import { createSupabaseClient } from '@job-me/shared';

const SUPABASE_URL = import.meta.env['VITE_SUPABASE_URL'] as string;
const SUPABASE_ANON_KEY = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[job-me] Missing Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local'
  );
}

export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
