# stock-info-mcp-gateway

Production-backed multi-source A-share MCP gateway.

## v0.1 integrations

- Jin10 MCP
- Tencent Finance
- HiThink / 同花顺 Financial API + MCP
- TuShare MCP
- simonlin1212/a-stock-data capability specification
- Sina ETF options
- AI涨乐 / 华泰 Skills adapter

## Edge Functions

- `supabase/functions/mcp` — stable production router
- `supabase/functions/mcp-v3` — core data gateway
- `supabase/functions/mcp-options` — ETF option contract/quote/Greeks adapter
- `supabase/functions/mcp-htsc` — AI涨乐/华泰 adapter

## Documentation

- [Architecture and mobile development path](docs/MOBILE_BUILD.md)
- [References and provider roadmap](docs/REFERENCES.md)
- [Historical production bootstrap provenance](docs/PRODUCTION_SNAPSHOT.md)

Credentials are stored in Supabase Vault only and must never be committed.

## Safety boundary

This repository belongs only to the isolated Supabase project
`stock-info-mcp-gateway` (`aneonwkxfhgqywtczmvc`).

Do not link or deploy this repository to unrelated Supabase projects.
