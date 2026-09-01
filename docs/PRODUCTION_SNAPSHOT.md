# Production snapshot provenance

The initial v0.1 repository bootstrap was reverse-synced from the currently
deployed Supabase Edge Functions.

Functions captured:

- `mcp`
- `mcp-v3`
- `mcp-options`
- `mcp-htsc`

## Important

Supabase `functions download` reconstructs deployed ESZip runtime source.
During this reverse-sync, TypeScript annotations may be absent from the
reconstructed source even when the original deployed source contained them.

For that reason the initial reverse-synced files are explicitly marked as
production runtime snapshots.

They are not treated as proof that the original canonical TypeScript source
contained implicit `any` values.

The next source-normalization step will replace these runtime snapshots with
canonical typed TypeScript while preserving production behavior.

## Security

No provider API keys, GitHub tokens, broker credentials or plaintext Vault
secrets belong in this repository.
