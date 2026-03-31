import { createClient } from '@supabase/supabase-js';

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const publicAppUrl = String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim();

export const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

function normalizeAppUrl(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

export function getSupabaseAuthRedirectBaseUrl(): string | undefined {
  if (publicAppUrl) return normalizeAppUrl(publicAppUrl);
  if (typeof window === 'undefined') return undefined;
  return normalizeAppUrl(`${window.location.origin}${window.location.pathname}`);
}

export function getSupabasePasswordResetRedirectUrl(): string | undefined {
  const baseUrl = getSupabaseAuthRedirectBaseUrl();
  if (!baseUrl) return undefined;
  return `${baseUrl}?mode=reset-password`;
}

export function isSupabasePasswordRecoveryMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'reset-password';
}

export const SUPABASE_CARDS_BUCKET = 'cards';
