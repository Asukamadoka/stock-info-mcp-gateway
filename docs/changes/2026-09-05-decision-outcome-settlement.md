# 2026-09-05 决策结算（次日校验）

**回归点**：`RP-2026-09-05-01`
**提交者**：claude
**PR**：#23

## 1. 改了什么

- 新增 `supabase/functions/mcp-outcomes/`：`outcome_record` / `outcome_get` / `outcome_scorecard`
- 新增 `supabase/functions/mcp-outcomes/lib/settlement.ts` —— 纯函数结算逻辑
- 新增 `supabase/migrations/20260905010000_decision_outcomes.sql`
- 新增 `tests/outcome_settlement_contract_test.ts`
- 修改 `supabase/functions/mcp/index.ts` —— 新增 `outcome_` 路由；`tools/list` 改为容错扇出
- 修改 `tests/handoff_router_contract_test.ts` —— 见下「修改他人测试的说明」
- 修改 `.github/workflows/ci.yml` —— 新增两道闸门

## 2. 为什么改

`mcp-handoff` 记录了系统的判断，**但从来没有任何东西检查这个判断对不对**。
系统能算出「某股 82 分」，但无人知道 82 分是否跑赢过 40 分。
这是「数据管道」与「决策系统」的分界线。

用户于 9/4 描述的「历史校验」与已规划的验证回路是同一件事，合并为一个模块，不建两次。

### 三条设计原则

**不可成交的信号不算赢。** 看对方向但一字涨停买不进去，实际收益为零。
看涨遇开盘涨停、看跌遇开盘跌停、停牌、数据缺失，均记为 `unmeasurable`，
**而不是记为收益**。这条规则同时写进了表约束，不依赖代码自觉。

**样本不够时拒绝给出数字。** 已结算样本不足 30 时，`outcome_scorecard`
返回 `insufficient_sample`，胜率、均值收益、rank IC 全部为 `null`。
六个样本算出来的胜率是噪声套了一件数字的外衣，而数字的说服力远超它应得。

**已结算的记录永不覆写。** 重算追加 `revision`，契约测试明令禁止 `on conflict`。
否则可以静静地重跑到数字好看为止。

### 一个顺手修掉的潜伏 bug

路由器原本用 `Promise.all` 并发拉四个模块的工具表，再对每个调 `.json()`。
**任一模块异常，整个 `tools/list` 就 500**，移动端会直接看不到任何工具。
现改为 `Promise.allSettled` + 逐模块 try/catch，单个模块挂掉只丢它自己那几个工具。

### 修改他人测试的说明

`tests/handoff_router_contract_test.ts`（PR #20）断言路由器源码必须包含字面量
`f(HANDOFF,mk(),body)`。该断言钉的是**一个调用表达式的写法**，而不是行为；
重构 `tools/list` 后行为未变、写法变了，于是它在一个它本不该拦的改动上失败。

已改为断言真实契约：模块常量存在、`handoff_` 路由到它、它参与 `tools/list` 扇出
（不论扇出怎么写）。同时为 `OUTCOMES` 加了同样的检查，并新增一条
「单模块故障不得清空工具表」的断言。**覆盖面变大，不是变小。**

## 3. 改前是什么样

- `decision_handoffs` 表：**0 行**，建立后从未写入
- 无任何结算机制；无表、无工具、无测试
- 路由器 `tools/list` 使用 `Promise.all`，单点故障拖垮全部
- 仓库测试数：96 个 `Deno.test`

## 4. 改后是什么样

**CI 结果：`success`**

| 运行 | 事件 | commit | 结果 |
|---|---|---|---|
| [33966383748](https://github.com/Asukamadoka/stock-info-mcp-gateway/actions/runs/33966383748) | push | `88008a9b` | success |
| [33966385548](https://github.com/Asukamadoka/stock-info-mcp-gateway/actions/runs/33966385548) | pull_request | `88008a9b` | success |

全部门禁通过：快照标记拒绝、严格类型检查（含 `mcp-outcomes`）、
全量测试、四项 migration 契约、交易能力拒绝扫描、凭证扫描。

### 中间的两次失败（保留记录）

第一次：我自己写的契约测试断言了 `allSettled`，而实现用的是 `Promise.all`
加 try/catch。两者都容错，但只有一个写进了契约。已改为 `allSettled`，
让保证出现在测试真正读的那段代码里。

第二次：上述 `f(HANDOFF,mk(),body)` 字面量断言。

两次都是 RED 应该抓到的东西，记在这里以免下次重踩。

## 5. 怎么退

1. 代码：回退至 `rp/RP-2026-09-05-01`（main `bc62340`）。路由器会一并退回四模块版本。
2. migration：`drop table if exists public.decision_outcomes;`
   新增表，无上游外键，删除不影响 `decision_handoffs`。
3. Edge Function：`mcp-outcomes` 为新增，未部署则无需处理。
4. 验证：`GET /functions/v1/mcp` 返回 200；`tools/list` 仍能合并返回
   core-v3 / options / htsc / handoff 的工具。

## 待办

- 部署 `mcp-outcomes` 并应用 migration（merge 后）
- 接入自动结算作业：`outcome_record` 由调用方传入行情，故意不内置行情获取，
  以免新增一个上游故障点
- `predicted_stance` / `predicted_score` 需从 handoff payload 提取，
  这要求 handoff payload 先有稳定 schema（当前为自由 jsonb）
