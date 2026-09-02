# Mobile development

## Source of truth

GitHub is the canonical source for this project. Supabase is the production runtime, not a reverse-sync source repository. Runtime downloads and historical snapshots may be used for provenance or diagnostics, but they must not replace reviewed source in GitHub.

The repository is expected to remain valid typed TypeScript. `@ts-nocheck` and reverse-synced runtime snapshots are not accepted as a normal development path.

## Verified mobile control path

```text
ChatGPT Mobile
  -> Supabase control registry
  -> Cloudflare Quick Tunnel
  -> Codespace fixed-action server
  -> deno / git / gh
  -> GitHub pull request
  -> GitHub Actions CI
```

`.devcontainer/devcontainer.json` runs `scripts/codespace-control-bootstrap.sh` after each Codespace start. The bootstrap rotates the temporary capability, starts the fixed-action server and Quick Tunnel, then registers the current generation through `codespace-control-register`. The Quick Tunnel URL itself is never committed.

The Codespace control server is fixed-action only. The supported surface is health/status, release, explicit patch application, cleanup of known untracked recovery artifacts, and commit/push/PR. Do not expose arbitrary remote shell or generic command execution.

## Restart recovery

```text
Codespace starts
  -> postStartCommand
  -> fixed-action server
  -> fresh Quick Tunnel
  -> reverse-probed registration
  -> new active generation in Supabase
```

Production credentials remain in Supabase Vault. The Jin10 bearer must never be persisted in the Codespace control bridge. Smoke tests must never invoke broker mutation tools.
