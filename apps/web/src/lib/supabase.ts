import { createSupabaseClient } from '@job-me/shared';

const SUPABASE_URL =
  (import.meta.env['VITE_SUPABASE_URL'] as string | undefined) ||
  (import.meta.env['SUPABASE_URL'] as string | undefined) ||
  'https://placeholder.supabase.co';

const SUPABASE_ANON_KEY =
  (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined) ||
  (import.meta.env['SUPABASE_PUBLISHABLE_KEY'] as string | undefined) ||
  (import.meta.env['SUPABASE_ANON_KEY'] as string | undefined) ||
  'placeholder-anon-key';

if (
  (!import.meta.env['VITE_SUPABASE_URL'] && !import.meta.env['SUPABASE_URL']) ||
  (!import.meta.env['VITE_SUPABASE_ANON_KEY'] && !import.meta.env['SUPABASE_PUBLISHABLE_KEY'] && !import.meta.env['SUPABASE_ANON_KEY'])
) {
  console.warn(
    '[job-me] Missing Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local or root .env'
  );
}

export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
