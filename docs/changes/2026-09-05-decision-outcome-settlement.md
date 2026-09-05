# 2026-09-05 决策结算（次日校验）

**回归点**：`RP-2026-09-05-01`
**提交者**：claude

## 1. 改了什么

- 新增 `supabase/functions/mcp-outcomes/`：`outcome_record` / `outcome_get` / `outcome_scorecard`
- 新增 `supabase/functions/mcp-outcomes/lib/settlement.ts` —— 纯函数结算逻辑，13 个单元测试
- 新增 `supabase/migrations/20260905010000_decision_outcomes.sql`
- 新增 `tests/outcome_settlement_contract_test.ts` —— 9 个契约测试
- 修改 `supabase/functions/mcp/index.ts` —— 新增 `outcome_` 前缀路由；
  `tools/list` 由 `Promise.all` 改为逐模块容错
- 修改 `.github/workflows/ci.yml` —— 新增两道闸门

## 2. 为什么改

`mcp-handoff` 记录了系统的判断，**但从来没有任何东西检查这个判断对不对**。
系统能算出「某股 82 分」，但无人知道 82 分是否跑赢过 40 分。
这是「数据管道」与「决策系统」的分界线。

另：用户于 9/4 描述的「历史校验」与已规划的验证回路是同一件事，合并为一个模块，不建两次。

### 三条设计原则

**不可成交的信号不算赢。** 看对方向但一字涨停买不进去，实际收益为零。
因此看涨遇开盘涨停、看跌遇开盘跌停、停牌、数据缺失，均记为 `unmeasurable`，
**而不是记为收益**。这条规则同时写进了表约束，不依赖代码自觉。

**样本不够时拒绝给出数字。** `outcome_scorecard` 在已结算样本不足 30 时
返回 `insufficient_sample`，胜率、均值收益、rank IC 全部为 `null`。
六个样本算出来的胜率是噪声套了一件数字的外衣，而数字的说服力远超它应得。

**已结算的记录永不覆写。** 重算追加 `revision`，契约测试明令禁止 `on conflict`。
否则可以静静地重跑到数字好看为止。

### 一个顺手修掉的潜伏 bug

路由器原本用 `Promise.all` 并发拉四个模块的工具表。
**任一模块异常，整个 `tools/list` 就 500**，移动端会直接看不到任何工具。
现改为逐模块容错，单个模块挂掉只丢它自己那几个工具。

## 3. 改前是什么样

- `decision_handoffs` 表：**0 行**，建立后从未写入
- 无任何结算机制；无表、无工具、无测试
- 路由器 `tools/list` 使用 `Promise.all`，单点故障会拖垮全部
- 仓库测试数：96 个 `Deno.test`

## 4. 改后是什么样

- 新增 22 个 `Deno.test`（13 单元 + 9 契约），预期总数 118
- CI 新增 2 道闸门：结算契约校验、交易能力拒绝扫描
- 路由器支持五个模块且单模块故障不再拖垮 `tools/list`

**证据待补**：本容器出站策略拦截 `deno.land`，无法本地安装 Deno，
因此测试未在本地跑过。**评判以 GitHub Actions 的实际结果为准**，
CI 结果出来前不得宣称本改动完成（硬约束 #16）。

## 5. 怎么退

1. 代码：回退至 `rp/RP-2026-09-05-01`（main `bc62340`）。
   路由器会一并退回四模块版本。
2. migration：`drop table if exists public.decision_outcomes;`
   该表为新增，无上游外键，删除不影响 `decision_handoffs`。
3. Edge Function：`mcp-outcomes` 为新增，未部署则无需处理。
4. 验证：`GET /functions/v1/mcp` 返回 200；
   `tools/list` 仍能合并返回 core-v3 / options / htsc / handoff 的工具。

## 待办

- 部署 `mcp-outcomes` 并应用 migration（CI 绿后）
- 接入自动结算作业：当前 `outcome_record` 由调用方传入行情，
  故意不内置行情获取，以免新增一个上游故障点
- `predicted_stance` / `predicted_score` 需从 handoff payload 中提取，
  这要求 handoff payload 先有稳定 schema（当前为自由 jsonb）
