# Mobile development

## Source of truth
GitHub is the canonical source for this project. Supabase is the production runtime, not a reverse-sync source repository. Runtime downloads and historical snapshots may be used for provenance or diagnostics, but they must not replace reviewed source in GitHub. The repository is expected to remain valid typed TypeScript; @ts-nocheck and reverse-synced runtime snapshots are not accepted as a normal development path.

## Verified mobile control path
ChatGPT Mobile -> Supabase control registry (discovery) -> Cloudflare Quick Tunnel -> Codespace fixed-action server -> deno/git/gh -> GitHub pull request -> GitHub Actions CI.

The Quick Tunnel URL is deliberately ephemeral. A Codespace postStartCommand runs scripts/codespace-control-bootstrap.sh on every start. It rotates the capability, starts the fixed-action server, creates a new Quick Tunnel, verifies local health, and registers the new generation with codespace-control-register. Runtime state lives under .codespace-control/ and is gitignored. Named Tunnel is intentionally deferred.

The Codespace control server is fixed-action only: health/status, release, apply-patch, cleanup of explicitly named known artifacts, and commit-pr. Do not expose arbitrary remote shell or generic command execution.

## Release gate
Before a pull request, release must pass git diff --check, four deno checks, deno test --allow-read=., and the tracked-source credential scan. GitHub Actions remains the final repository gate.

## Secrets and safety
Production credentials belong in Supabase Vault. The Jin10 bearer must not be persisted in the Codespace bridge. Temporary Cloudflare capabilities rotate on restart. Smoke tests must never invoke ht_submit_order, ht_cancel_order, ht_cancel_all_pending_orders, or ht_add_watchlist.
