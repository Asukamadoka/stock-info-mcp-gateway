# Mobile development

## GitHub Codespaces

Codespaces is the full mobile/browser development environment for this project.

The production bootstrap uses the Supabase CLI to download the exact currently
deployed Edge Function runtime snapshot into the repository.

Because Supabase's ESZip reverse-sync may remove original TypeScript annotations,
the initial snapshots are marked with `@ts-nocheck`. Deno is therefore used here
to validate syntax, imports, dependencies, and the module graph rather than to
claim full canonical TypeScript type safety.

## Runtime snapshot validation

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
