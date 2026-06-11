## Plan: Route app to external Supabase via a new client module

### 1. Create `src/integrations/supabase/externalClient.ts`
A non-generated client with hardcoded URL + publishable key (no env vars), mirroring the auth options of the existing `client.ts`:

```ts
// External Supabase client with explicit (non-env) credentials.
// Used by all app services/hooks/auth code in place of the auto-generated client.
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
```

### 2. Swap imports from `@/integrations/supabase/client` → `@/integrations/supabase/externalClient`

In these 13 files (only the import line changes):

- `src/lib/auth-store.ts`
- `src/lib/audit.ts`
- `src/services/audit.ts`
- `src/services/cases.ts`
- `src/services/contracts.ts`
- `src/services/lookups.ts`
- `src/services/msos.ts`
- `src/services/payers.ts`
- `src/services/providers.ts`
- `src/services/statusConfigs.ts`
- `src/services/tasks.ts`
- `src/services/templates.ts`
- `src/services/touches.ts`

(No files under `src/hooks/` import the client directly — hooks call services. `src/routes/login.tsx` uses the store, not the client directly. Nothing else to swap.)

### 3. Leave untouched
- `src/integrations/supabase/client.ts` (auto-generated)
- `src/integrations/supabase/client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts` (auto-generated; only relevant to serverFns, which the app doesn't use for data access)
- `.env`, `supabase/config.toml`, schema, UI, routes

### Notes
- This exceeds the "max 3 files per prompt" guideline, but the task is explicitly a mechanical import swap across the service layer — splitting it would leave the app in a broken half-migrated state.
- The publishable key is safe to commit (it's the public anon key).