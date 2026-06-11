// External Supabase client with explicit (non-env) credentials.
// Used by all app services/lib/auth code in place of the auto-generated client.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = 'https://fkvuhfsqcmujywzgczmc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_DdCgAiRh38fdKxHiQZe6eA_Da53VSJi';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
