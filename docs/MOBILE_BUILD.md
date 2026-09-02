# Mobile development

## Source of truth

GitHub is the canonical source for this project. Supabase is the production
runtime, not a reverse-sync source repository. Runtime downloads and historical
snapshots may be used for provenance or diagnostics, but they must not replace
reviewed source in GitHub.

The repository is expected to remain valid typed TypeScript. `@ts-nocheck` and
reverse-synced runtime snapshots are not accepted as a normal development path.

## Verified mobile control path

The verified development path is:

```text
ChatGPT Mobile
  -> Cloudflare Quick Tunnel
  -> Codespace fixed-action server
  -> deno / git / gh
  -> GitHub pull request
  -> GitHub Actions CI
```

When the ChatGPT runtime cannot directly reach the temporary Quick Tunnel URL,
the isolated Supabase project may relay the HTTP request with `pg_net`. This is
transport only: the Quick Tunnel capability URL is temporary and must not be
committed, logged into source, or treated as a durable secret.

The Codespace control server is fixed-action only. The supported development
surface is intentionally narrow: health/release checks, applying an explicit
patch, and committing/pushing a reviewed branch to a pull request. Do not expose
an arbitrary remote shell or generic command-execution endpoint.

## Release gate

Before creating or updating a pull request, the Codespace release action must
pass:

```bash
git diff --check
deno check supabase/functions/mcp/index.ts
deno check supabase/functions/mcp-v3/index.ts
deno check supabase/functions/mcp-options/index.ts
deno check supabase/functions/mcp-htsc/index.ts
deno test --allow-read=.
```

The release path also performs a tracked-source credential scan. GitHub Actions
remains the final repository gate; local success is necessary but not sufficient
to declare a change complete.

## Write path

The ChatGPT GitHub connector is useful for repository and Actions inspection but
must not be relied on for source writes. Source mutation is performed inside the
Codespace with its own `git`/`gh` authentication:

```text
main
  -> automation/* branch
  -> commit
  -> push
  -> pull request
  -> GitHub Actions
  -> merge
```

Production deployment or smoke validation is a separate step after merge. A
feature is not production-complete until fresh production evidence exists.

## Secrets and safety

Production credentials belong in Supabase Vault. In particular, the Jin10 bearer
must not be persisted in the Codespace control bridge. Temporary Cloudflare
capabilities must be rotated when the tunnel is recreated.

Smoke tests must never invoke broker mutation tools, including:

- `ht_submit_order`
- `ht_cancel_order`
- `ht_cancel_all_pending_orders`
- `ht_add_watchlist`
