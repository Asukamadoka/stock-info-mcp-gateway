# Codespace Control Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically restore the fixed-action Codespace control path after every Codespace restart.

**Architecture:** Codespaces runs a repository-tracked postStart bootstrap. The bootstrap starts the fixed-action server, creates a new Cloudflare Quick Tunnel and capability, and registers the verified generation in the isolated Supabase registry. GitHub remains source truth; Supabase stores runtime discovery state only.

**Tech Stack:** GitHub Codespaces devcontainer lifecycle, Bash, Python stdlib HTTP server, cloudflared Quick Tunnel, Supabase Edge Functions/Postgres.

**Spec:** docs/MOBILE_BUILD.md

## Global Constraints
- Project ref is aneonwkxfhgqywtczmvc only.
- No arbitrary shell/exec endpoint.
- No Jin10 bearer in Codespace control state.
- Quick Tunnel capability is transient and never committed.
- GitHub is canonical source; Supabase is runtime.
- Restart smoke is required before declaring this complete.

### Task 1: Persistent bootstrap
- [x] Add postStartCommand and idempotent bootstrap.
- [x] Start fixed-action server and Quick Tunnel.
- [x] Register verified endpoint generation.

### Task 2: Registry source truth
- [x] Add migration with RLS and revoked Data API roles.
- [x] Add codespace-control-register source.

### Task 3: Contract tests and documentation
- [x] Add CI contract preventing generic exec and requiring auto-registration.
- [x] Update mobile build documentation.

### Task 4: Acceptance
- [ ] Pass full GitHub Actions CI.
- [ ] Merge PR.
- [ ] Rebuild/restart Codespace without manual tunnel commands.
- [ ] Verify a new active registry generation and health probe.
