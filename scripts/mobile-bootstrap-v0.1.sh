#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="aneonwkxfhgqywtczmvc"
BRANCH="integration/multi-source-v5"
FUNCTIONS=(mcp mcp-v3 mcp-options mcp-htsc)

echo "== stock-info-mcp-gateway v0.1 mobile bootstrap =="
echo "Project: ${PROJECT_REF}"
echo "Branch : ${BRANCH}"
echo

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "ERROR: Please run inside the stock-info-mcp-gateway Codespace."
  exit 1
}

echo "== Sync main and create/switch branch =="
git fetch origin main
git switch main
git pull --ff-only origin main

if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git switch "${BRANCH}"
else
  git switch -c "${BRANCH}"
fi

echo
echo "== Supabase CLI =="
npx --yes supabase@latest --version

echo
echo "== Login to Supabase =="
npx --yes supabase@latest login

echo
echo "== Verify target project/functions before modifying local files =="
npx --yes supabase@latest functions list --project-ref "${PROJECT_REF}"

if [ ! -f supabase/config.toml ]; then
  echo
  echo "== Initialize local Supabase directory =="
  npx --yes supabase@latest init
fi

echo
echo "== Download exact currently deployed Edge Functions =="
for fn in "${FUNCTIONS[@]}"; do
  echo "-- downloading ${fn}"
  rm -rf "supabase/functions/${fn}"
  npx --yes supabase@latest functions download "${fn}" \
    --project-ref "${PROJECT_REF}"
done

echo
echo "== Restore deno.json files (Supabase download does not restore them) =="
for fn in "${FUNCTIONS[@]}"; do
  cat > "supabase/functions/${fn}/deno.json" <<'JSON'
{"compilerOptions":{"strict":true}}
JSON
done

echo
echo "== Ensure verify_jwt config matches current deployed functions =="
python3 - <<'PY'
from pathlib import Path

p = Path("supabase/config.toml")
text = p.read_text() if p.exists() else ""

for fn in ("mcp", "mcp-v3", "mcp-options", "mcp-htsc"):
    marker = f"[functions.{fn}]"
    if marker not in text:
        if text and not text.endswith("\n"):
            text += "\n"
        text += f"\n{marker}\nverify_jwt = false\n"

p.write_text(text)
PY

cat > .gitignore <<'EOF'
.env
.env.*
!.env.example
node_modules/
.supabase/
.DS_Store
*.log
EOF

mkdir -p docs .github/workflows

cat > README.md <<'EOF'
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

Credentials are stored in Supabase Vault only and must never be committed.

## Safety boundary

This repository belongs only to the isolated Supabase project
`stock-info-mcp-gateway` (`aneonwkxfhgqywtczmvc`).

Do not link or deploy this repository to unrelated Supabase projects.
EOF

cat > docs/MOBILE_BUILD.md <<'EOF'
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
EOF

cat > .github/workflows/ci.yml <<'EOF'
name: Edge Function Compile Check

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deno-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - name: Type-check Edge Functions
        run: |
          deno check supabase/functions/mcp/index.ts
          deno check supabase/functions/mcp-v3/index.ts
          deno check supabase/functions/mcp-options/index.ts
          deno check supabase/functions/mcp-htsc/index.ts
EOF

echo
echo "== Install Deno if missing =="
if ! command -v deno >/dev/null 2>&1; then
  curl -fsSL https://deno.land/install.sh | sh
  export DENO_INSTALL="${HOME}/.deno"
  export PATH="${DENO_INSTALL}/bin:${PATH}"
fi

deno --version

echo
echo "== Type-check downloaded production source =="
for fn in "${FUNCTIONS[@]}"; do
  echo "-- deno check ${fn}"
  deno check "supabase/functions/${fn}/index.ts"
done

echo
echo "== Credential leak guard =="
if grep -RInE \
  '(github_pat_[A-Za-z0-9_]{20,}|ht_[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{30,})' \
  supabase/functions README.md docs .github 2>/dev/null; then
  echo "ERROR: possible literal credential detected; refusing to commit."
  exit 2
fi

echo
echo "== Files ready for commit =="
git status --short

git add .gitignore README.md docs .github/workflows supabase
git commit -m "chore: bootstrap production gateway v0.1" || true

echo
echo "== Push branch =="
git push -u origin "${BRANCH}"

echo
echo "== Create PR when GitHub CLI is available =="
if command -v gh >/dev/null 2>&1; then
  EXISTING="$(gh pr view "${BRANCH}" --json url -q .url 2>/dev/null || true)"
  if [ -n "${EXISTING}" ]; then
    echo "PR already exists: ${EXISTING}"
  else
    gh pr create \
      --base main \
      --head "${BRANCH}" \
      --title "v0.1: bootstrap production stock-info-mcp-gateway" \
      --body "Reverse-syncs the currently deployed Supabase Edge Functions into GitHub and adds mobile development documentation plus a Deno compile CI gate."
  fi
else
  echo "gh CLI unavailable; branch push succeeded. Create the PR in GitHub UI."
fi

echo
echo "DONE."
echo "Branch: ${BRANCH}"
echo "Do not merge until CI is green."
