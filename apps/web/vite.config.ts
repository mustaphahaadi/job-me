import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, resolve(__dirname, '../../'), '');
  const webEnv = loadEnv(mode, __dirname, '');
  const merged = { ...rootEnv, ...webEnv, ...process.env };

  const supabaseUrl = merged.VITE_SUPABASE_URL || merged.SUPABASE_URL || '';
  const supabaseAnonKey =
    merged.VITE_SUPABASE_ANON_KEY || merged.SUPABASE_PUBLISHABLE_KEY || merged.SUPABASE_ANON_KEY || '';

  return {
    plugins: [react()],
    envDir: resolve(__dirname, '../../'),
    resolve: {
      alias: {
        '@job-me/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
  };
});
