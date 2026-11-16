import { createClient } from '@supabase/supabase-js';

// Veřejný publishable klíč je určený pro prohlížeč; přístup chrání Auth + RLS.
export const cloud = createClient('https://envjyisfgzvtqdjoihtn.supabase.co', 'sb_publishable_c4u2dW4FjQDN4w0YjKQk3w_98dbWpcO', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(15000) }) },
});
