# Mobile development

## GitHub Codespaces

Codespaces is the full mobile/browser development environment for this project.

The production bootstrap uses the Supabase CLI to download the exact currently
deployed Edge Function source into the repository, then Deno type-checks it.

## Compile check

```bash
deno check supabase/functions/mcp/index.ts
deno check supabase/functions/mcp-v3/index.ts
deno check supabase/functions/mcp-options/index.ts
deno check supabase/functions/mcp-htsc/index.ts
```

## Deployment policy

Do not enable unattended production deployment until the first reverse-synced
snapshot has passed CI and has been reviewed against the running production
functions.

After that verification, GitHub becomes the source of truth and the existing
Supabase GitHub integration becomes the normal deployment path.
