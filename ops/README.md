# 变更保障：回归点与变更日志

每一次重大改动前建立**回归点**，每一次改动后写入**变更日志**。
两者缺一不可：回归点告诉你能退到哪里，变更日志告诉你为什么要退。

## 为什么不能只靠 git

本项目的状态跨两个系统：

- **GitHub** —— 源码。git 已经管好了。
- **Supabase** —— 已部署的 Edge Function、已应用的 migration、Vault secret。
  **git 完全看不到这一层。**

回滚代码到某个 commit，并不会把生产运行时一起回滚。
所以一个回归点 = **git tag + 基础设施清单**。

## 回归点

### 何时建立

以下任一情况，动手前先建：

- 删除或重部署任何 Edge Function
- 应用 migration
- 轮换凭证
- 修改生产 MCP 工具的入参 / 出参契约
- 仓库改名、迁移、发版

普通代码改动不需要——git 已经够了。

### 构成

| 部件 | 形式 |
|---|---|
| 代码快照 | GitHub tag `rp/<id>`（通过 release 创建） |
| 基础设施清单 | `ops/restore-points/<id>.json` |
| 回滚步骤 | 清单内 `rollback` 字段，写清楚具体怎么退 |

编号格式：`RP-YYYY-MM-DD-NN`

### 清单里记什么

- `git.head` —— 当时的 main commit
- `migrations` —— 已应用的全部 migration version
- `tables` —— 表名、RLS 状态、行数
- `edge_functions` —— 全部 slug 与 version。**version 是关键**：
  Supabase 不保留已删函数的历史，所以删除前源码必须先存入仓库
- `secrets` —— **只记 secret 名称，永不记值**
- `production_surface` —— 对外入口与路由规则，用于回滚后验证
- `rollback` —— 逐步回退指令

### 建立流程

1. 采集当前 Supabase 状态（migration / 表 / Edge Function / secret 名）
2. 写入 `ops/restore-points/<id>.json`，包含 `rollback` 字段
3. 提交并合入 main
4. 在该 commit 上创建 tag `rp/<id>`
5. 在变更日志里引用这个回归点

**先建回归点，再动手。** 顺序反了等于没建。

## 变更日志

- `docs/CHANGELOG.md` —— 总索引，倒序，一行一条
- `docs/changes/YYYY-MM-DD-<slug>.md` —— 单次变更详情

每条详情必须回答五个问题：

1. **改了什么** —— 具体到文件、函数、表
2. **为什么改** —— 触发原因，不是「优化」这种空话
3. **改前是什么样** —— 可核验的证据，不是描述
4. **改后是什么样** —— 同上
5. **怎么退** —— 回归点编号 + 具体步骤

第 3 和 4 要的是**证据**：行数、版本号、HTTP 状态码、测试通过数。
写「已修复」不算证据——这对应硬约束 #16：
**不宣称「完成」除非有新的实际测试证据。**

## 适用范围

两套机制对所有提交者生效：Claude、ChatGPT 移动端、Codespace 自动化、手工操作。
跨模型工作的前提是另一方能看懂你改了什么、为什么改、怎么退。
