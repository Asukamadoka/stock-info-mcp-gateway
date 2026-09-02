# Codespace control persistence implementation plan

## Goal

Make the existing fixed-action ChatGPT Mobile -> Quick Tunnel -> Codespace control path reproducible after every Codespace restart without persisting a Quick Tunnel URL or production bearer.

## Design

1. `.devcontainer/devcontainer.json` runs `scripts/codespace-control-bootstrap.sh` on every Codespace start.
2. Bootstrap rotates a capability, starts the fixed-action server, starts a fresh Cloudflare Quick Tunnel, then registers the new generation in Supabase.
3. `codespace-control-register` reverse-probes the capability `/health` endpoint and only accepts the expected repo/service identity.
4. `codespace_control_registry` stores the current endpoint with TTL. It is service-role-only; RLS is enabled and Data API roles are revoked.
5. The control server has only fixed actions: health/status, release, apply-patch, cleanup-known-artifact, commit-pr. It exposes no generic shell/exec API.
6. JIN10 remains in Supabase Vault and is never copied into the Codespace control bridge.

## Acceptance

- CI passes all existing checks plus the control persistence contract.
- A fresh Codespace start creates a new registered generation automatically.
- Registered health reports the current main HEAD.
- Old generations are inactive and the new generation has a finite TTL.
- Release passes before source-writing PR actions are used.
- No HTSC mutation tool is invoked by smoke or test.
