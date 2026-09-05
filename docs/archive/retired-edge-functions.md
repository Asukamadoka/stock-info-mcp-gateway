# 一次性自动化 Edge Function 存档

调查日期：2026-09-03 / 2026-09-05
项目：`aneonwkxfhgqywtczmvc`

这些函数由 ChatGPT 移动端自动化链在开发期间创建，**从未进入本仓库**，
违反硬约束 #8（GitHub 是唯一源码真值）。本文件在删除前留档，
既补上真值缺口，也作为该阶段工作方式的历史记录。

## 为什么必须删除

全部为 `verify_jwt: false`，且函数体**不检查请求的任何部分**——
多数 `Deno.serve` 回调连 request 参数都不接收。它们从 Vault 取出
`github_pat_stock_info_gateway` 后直接对仓库执行写操作。

任何人知道或猜到 URL，发一个空 GET 即可触发。

## 四种模板

### 模板 A —— 无条件合并 PR

以 `merge-pr-16-once` 为例（`merge-pr-{5,9,11,12,13,14,15,16,17}-once` 同构，仅 PR 号与 SHA 不同）：

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:1});
async function secret(name:string){
  const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  const v=String(r?.[0]?.decrypted_secret||"");
  if(!v)throw new Error(`missing secret ${name}`);
  return v;
}
Deno.serve(async()=>{                                    // 不接收 request
  const token=await secret("github_pat_"+"stock_info_gateway");
  const res=await fetch(
    "https://api.github.com/repos/Asukamadoka/stock-info-mcp-gateway/pulls/16/merge",
    {method:"PUT", headers:{authorization:`Bearer ${token}`, /* ... */},
     body:JSON.stringify({merge_method:"merge",sha:"6a46444b1f6158ddedcdca0bc133b304b304a7a8"})}
  );
  return new Response(await res.text(),{status:res.status});
});
```

### 模板 B —— 无条件创建 PR

`open-{wake,deno-bootstrap,qmt-client,qmt-gateway}-pr-once`、`create-codespace-persistence-pr-once`、
`qmt-windows-bridge-pr-once`。结构同模板 A，改为 `POST /pulls`，标题与 body 硬编码在函数里。

### 模板 C —— Codespace 生命周期操作

最危险的一类。`recreate-automation-codespace-once` 会**先删除后重建**：

```ts
Deno.serve(async()=>{                                    // 不接收 request
  const list=await gh(`/user/codespaces?per_page=100`);
  const existing=(list.codespaces||[]).filter((c)=>
    c?.repository?.full_name===`${OWNER}/${REPO}` && c?.display_name===DISPLAY);
  for(const c of existing){
    await gh(`/user/codespaces/${encodeURIComponent(c.name)}`,{method:"DELETE"});  // ← 无条件删除
  }
  const c=await gh(`/repos/${OWNER}/${REPO}/codespaces`,{method:"POST", /* ... */});
});
```

同类：`ensure-automation-codespace-once`（创建）、`stop-stock-gateway-codespace-once`、
`stop-dedicated-automation-once`（停止，有 identity 校验）、`resolve-stock-gateway-codespace-once`（查询并写 registry）。

### 模板 D —— 直接向仓库写文件

`update-quick-tunnel-readiness-once`、`qmt-gateway-{red,green}-once`、`fix-qmt-gateway-test-once`、
`revert-qmt-version-bump-once`、`fix-mobile-build-once`、`codespace-rebuild-main-once`。

把要写入的文件内容以 base64 或模板字符串内嵌在函数里，然后 `PUT /contents/{path}`。
`bootstrap-codespace-persistence` 更进一步——从 `private.codespace_bootstrap_files` 表批量读取文件内容写入仓库并自动开 PR。

这是当时绕过 ChatGPT GitHub connector 403 的手段：
connector 只读 → 把写操作搬进 Supabase Edge Function → 用 Vault 里的 PAT 执行。
方向是对的，问题在于这些端点建完之后没有加鉴权，也没有在用完后删除。

## 完整清单

| 函数 | 模板 | 状态 |
|---|---|---|
| `merge-pr-5` | A | 待删除 |
| `merge-pr-9-once` | A | 待删除 |
| `merge-pr-11-once` | A | 待删除 |
| `merge-pr-12-once` | A | 待删除 |
| `merge-pr-13-once` | A | 待删除 |
| `merge-pr-14-once` | A | 待删除 |
| `merge-pr-15-once` | A | 待删除 |
| `merge-pr-16-once` | A | 待删除（已取证） |
| `merge-pr-17-once` | A | 待删除（已取证） |
| `qmt-windows-bridge-merge-once` | A | 待删除 |
| `option-rls-merge-once` | A | 待删除 |
| `open-wake-pr-once` | B | 待删除 |
| `open-deno-bootstrap-pr-once` | B | 待删除 |
| `open-qmt-client-pr-once` | B | 待删除 |
| `open-qmt-gateway-pr-once` | B | 待删除（已取证） |
| `create-codespace-persistence-pr-once` | B | 待删除 |
| `qmt-windows-bridge-pr-once` | B | 已退役为 410 |
| `ensure-automation-codespace-once` | C | 待删除（已取证） |
| `recreate-automation-codespace-once` | C | 待删除（已取证，含 DELETE） |
| `stop-stock-gateway-codespace-once` | C | 待删除 |
| `stop-dedicated-automation-once` | C | 待删除（已取证） |
| `resolve-stock-gateway-codespace-once` | C | 待删除（已取证） |
| `update-quick-tunnel-readiness-once` | D | 待删除（已取证） |
| `update-wake-health-once` | D | 待删除 |
| `fix-mobile-build-once` | D | 待删除 |
| `qmt-gateway-red-once` | D | 待删除（已取证） |
| `qmt-gateway-green-once` | D | 待删除 |
| `fix-qmt-gateway-test-once` | D | 待删除 |
| `revert-qmt-version-bump-once` | D | 待删除 |
| `codespace-rebuild-main-once` | D | 已退役为 410 |
| `bootstrap-codespace-persistence` | D | 待删除（已取证） |
| `bootstrap-codespace-persistence-once` | D | 待删除 |
| `option-rls-branch-once` | D | 已退役为 410 |
| `option-rls-clean-worker-once` | D | 已退役为 410 |
| `qmt-windows-bridge-red-once` | D | 已退役为 410 |
| `qmt-windows-bridge-green-once` | D | 已退役为 410 |

「已退役为 410」= 函数体已被替换为返回 410 的空壳，无害但仍应删除以减少攻击面。
「已取证」= 完整源码已被读取核验，模板归类有直接证据；其余按同构推定。

## 不在删除范围内

| 函数 | 处置 |
|---|---|
| `mobile-core-smoke` / `mobile-prod-smoke` / `mobile-options-smoke` / `mobile-options-diagnostic` | 已被退役为 410 空壳——**生产 smoke 能力目前是空的**，需在仓库内重建为正式脚本后再删除这些占位 |
| `cmship-live-once` | 唯一真实的完整决策运行实例（601872，依次调用 5 个生产 MCP 工具）。应收编为仓库内正式的 `daily-decision-run` |
| `codespace-bridge` / `github-sync` / `htsc-inspect` | 有鉴权，属控制面基础设施。但见下节 |

## 遗留的更严重问题：控制面复用数据面凭证

`codespace-bridge`、`github-sync`、`htsc-inspect`、`mcp-handoff`、`mcp-options`、`mcp-htsc`
的鉴权逻辑都是同一句：

```ts
auth === `Bearer ${await secret("jin10_bearer_token")}`
```

即**生产 MCP 数据网关的访问凭证，同时也是控制面的写权限凭证**。

持有该 bearer 者可以：
- 通过 `github-sync` 的 `put_file` / `ensure_branch` 直接写仓库
- 通过 `codespace-bridge` 投递 job，令 Codespace runner 执行
  `write_file` / `remove_file` / `apply_patch` / `exec`（argv 限 `deno|git|gh`）

一个只应具备行情读取权限的 token，实际拥有生产源码写权限。这是权限提升。

**修复方向**：控制面另建独立 secret（例如 `control_plane_bearer`），
与 `jin10_bearer_token` 完全隔离并独立轮换。数据面 token 泄露不应导致源码被改。
