# 变更日志

倒序。每条一行，详情在 `docs/changes/`。
回归点定义与流程见 [`ops/README.md`](../ops/README.md)。

## 未发布

- **2026-09-05** — 建立回归点与变更日志机制，采集 `RP-2026-09-05-01` 作为清理前基线 — [详情](changes/2026-09-05-ops-restore-points.md)
- **2026-09-05** — 存档约 36 个一次性自动化 Edge Function 源码，删除前留档（PR #21） — [存档](archive/retired-edge-functions.md)

## 历史（机制建立前，根据 PR 记录补登）

- **2026-09-04** — PR #20 新增 `mcp-handoff` 决策交接存储（09:29 / 11:25 / 14:45 三段）
- **2026-09-03** — PR #19 为 option 快照表启用 RLS
- **2026-09-03** — PR #18 新增 Windows QMT bridge 部署契约文档
- **2026-09-02** — PR #17 接入只读 QMT gateway 工具与 provider adapter
- **2026-09-02** — PR #5 修复新浪期权 batch URL 逗号被编码为 `%2C` 的 bug
