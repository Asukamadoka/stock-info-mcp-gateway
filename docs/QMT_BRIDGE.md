# Windows QMT Bridge

This is the read-only Windows bridge contract for the production gateway. It does not change the QMT/qmt-mcp security model. The qmt-mcp launcher stays bound to **127.0.0.1:18765** and the broker login remains an interactive Windows/QMT concern.

## Production topology

Windows QMT/MiniQMT -> xtquant -> qmt-mcp on 127.0.0.1:18765 -> authenticated reverse tunnel -> stable HTTPS hostname -> Supabase mcp-v3.

The preferred production exposure is a **Cloudflare Named Tunnel** (or an equivalent stable authenticated reverse proxy) whose origin is http://127.0.0.1:18765. Do not change qmt-mcp to listen on all interfaces just to make remote access easier. A **Cloudflare Quick Tunnel** is diagnostic-only because its hostname rotates; the validation script rejects it unless the diagnostic switch is explicitly supplied.

## Secret boundaries

- QMT/broker username, password, MFA and login confirmation stay inside the interactive QMT session.
- qmt-mcp bearer stays on the Windows host and in Supabase Vault only. Do not put it in Git, Codespaces, chat, PowerShell command history, tunnel hostname, or query strings.
- The Windows validation script reads QMT_MCP_TOKEN from the process/user environment and never prints it.
- QMT_PUBLIC_URL is the stable HTTPS MCP endpoint; it contains no credential.
- Supabase production uses Vault entries qmt_mcp_url and qmt_mcp_token. Until both are deliberately configured and the upstream capability probe succeeds, qmt_status must remain **unavailable** with confidence 0.

## One-time Windows preparation

1. Install the upstream qmt-mcp Windows launcher from its official release. Point it at the broker QMT executable, the matching xtquant import root and userdata_mini. Complete broker login interactively.
2. Confirm the launcher reports market data ready. Keep its MCP listener at 127.0.0.1:18765.
3. Provision a stable reverse tunnel hostname. For Cloudflare Named Tunnel, configure the public hostname to proxy to http://127.0.0.1:18765. Keep the tunnel credential in the Windows cloudflared service configuration; do not commit it.
4. Store QMT_MCP_TOKEN and QMT_PUBLIC_URL as Windows user/process environment values or an equivalent local secret mechanism. Avoid putting the bearer directly in command arguments.
5. Run scripts/windows-qmt-bridge.ps1. It performs the same read-only qmt_capabilities call against loopback and the public HTTPS path. A successful report contains booleans/status only, not the endpoint or bearer.
6. Only after the Windows probe is green, set Supabase Vault qmt_mcp_url and qmt_mcp_token through a trusted administrative path. Do not relay those values through ChatGPT or the Codespace control bridge.

## Acceptance gates

A Windows bridge is usable only when all of the following are true: qmt-mcp is running; qmt_capabilities succeeds locally; the stable HTTPS endpoint succeeds with the same bearer; broker/SDK entitlement reports the required capability; and returned market data passes source timestamp/freshness checks in the gateway. Installation alone is never evidence of Level-2, options, or other entitled data.

The first real production smoke after a Windows host is connected is deliberately read-only: qmt_status, qmt_quote for a liquid A-share/ETF, then qmt_option_chain for 510050.SH. If any layer is missing or stale, the gateway must degrade to unavailable/permission/unsupported rather than fabricate data.

## Current status

The Supabase gateway side is deployed and truthfully reports unavailable because no Windows bridge is currently configured. This document and validation script prepare the host side, but they are not evidence that a real QMT installation, entitlement, public tunnel, or fresh QMT data exists.
