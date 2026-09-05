# 2026-09-05 建立回归点与变更日志机制

**回归点**：`RP-2026-09-05-01`
**提交者**：claude

## 1. 改了什么

- 新增 `ops/README.md` —— 回归点与变更日志的定义、适用时机、建立流程
- 新增 `ops/restore-points/RP-2026-09-05-01.json` —— 清理前的完整生产状态快照
- 新增 `docs/CHANGELOG.md` —— 变更总索引，含历史补登
- 新增 `docs/changes/` —— 单次变更详情目录

未触碰任何 Edge Function、migration 或测试。

## 2. 为什么改

两个具体原因，不是流程洁癖。

**第一，git 看不到生产运行时。** 本项目的状态跨 GitHub 与 Supabase 两个系统，
而已部署的 Edge Function、已应用的 migration、Vault secret 都不在 git 里。
回滚代码不会回滚运行时，因此需要一份显式的基础设施清单。

**第二，Supabase 不保留已删除函数的历史。** 即将删除的约 36 个函数一旦删除，
源码就永久消失。删除是不可逆操作，必须先有回归点。

另外，本项目同时由 Claude、ChatGPT 移动端、Codespace 自动化三条链路提交。
跨模型工作的前提是另一方能看懂你改了什么、为什么改、怎么退。

## 3. 改前是什么样

- 无回归点机制。仓库 **0 个 git tag**（`git tag` 输出为空）
- 无变更日志。变更意图只存在于 PR 标题与 commit message
- PR #20 产生了 **12 个标题完全相同**的 commit（`feat: persist decision handoffs` ×12），
  无法从历史分辨每次提交实际做了什么
- Supabase 部署 54 个 Edge Function，仓库内仅 7 个

## 4. 改后是什么样

- `RP-2026-09-05-01` 已记录：9 个 migration、7 张表（含行数与 RLS 状态）、
  54 个 Edge Function 分类清单、2 个 secret 名称、生产入口与路由规则、
  main HEAD `bc62340`、5 步回滚指令
- 变更日志含 2 条未发布条目与 5 条历史补登

## 5. 怎么退

本变更仅新增文档，不影响运行时。回退即删除新增文件。

它本身就是下一次变更（Edge Function 清理）的回退依据。

## 附：删除安全性核验

删除前已验证移动端定时任务不受影响：

1. `cron.job` 不存在，`pg_cron` 未安装 —— 定时任务不在数据库内，
   而是 ChatGPT 移动端通过 HTTP 调用
2. `supabase/functions/mcp/index.ts` 是纯前缀路由，只转发到
   `mcp-v3` / `mcp-options` / `mcp-htsc` / `mcp-handoff` 四个模块
3. 待删函数无一位于该路径上

因此：**删除不会影响移动端工作链。**
