# ADR 0003：金十是一个 provider，不是网关的骨架

**状态**：已採纳，待实施
**日期**：2026-09-05

## 背景

金十在本项目中的定位应该是：**采集热点资讯与部分市场数据时调用的一个接口**。

实际代码里，它占据了四个它不该占的结构位置。

## 证据

以下均出自 `supabase/functions/mcp-v3/index.ts`。

### 1. 它是网关的鉴权权威

```ts
async function clientAuth(req: Request) {
  return (req.headers.get("authorization") || "") === `Bearer ${await secret("jin10_bearer_token")}`;
}
```

一个数据源的凭证成了网关自己的门锁。详见 ADR 0002。

### 2. 它是 `tools/list` 的硬依赖

```ts
if (m === "tools/list") {
  const j = await callUpstream(jin10, "tools/list", {});   // 无 try/catch
  const hi = await hiTools();
  return jres(id, { tools: [...LOCAL, ...hi, ...(j?.tools || [])] });
}
```

**金十挂掉，整个网关的工具表就没了**——包括完全不依赖金十的
`a_quote_tencent`、`candidate_score`、`option_put_pressure`。

直接违反硬约束：任何单一源失败不得拖垮整个网关。

注意同一文件里 `resources/list` **是有**容错的：

```ts
let jr: any = { resources: [] };
try { jr = await callUpstream(jin10, "resources/list", {}) } catch {}
```

说明当时意识到了这个风险，只是漏了 `tools/list`。

### 3. 它是 `tools/call` 的默认处理者

```ts
if (n === "qmt_status") ... else if (n === "a_quote_tencent") ... /* 十几个显式分支 */
const hi = await findHi(n); if (hi) return ...;
return jres(id, await callUpstream(jin10, "tools/call", p));   // ← 托底
```

**任何未被识别的工具名都会被转发给金十。**

这意味着金十在架构上是**主体**，本地工具反而是一堆特例。三个具体后果：

- **命名空间被占满。** 所有未声明的工具名默认属于金十，边界是隐式的。
- **调用方可控的字符串被转发给第三方。** 工具名和参数原样出站，
  这是一条未经设计的数据外发路径。
- **错误归属混淆。** 金十的报错以网关自身错误的形式返回，provenance 丢失。

### 4. 它也是 `resources/read` 的默认处理者

```ts
if (p?.uri === "a-stock-data://skill") return ...;
return jres(id, await callUpstream(jin10, "resources/read", p));
```

同样的托底模式。

## 根因

金十 MCP 是第一个接入的上游。v0.1 阶段网关几乎就等于「金十的代理」，
那时把它当主体是合理的。

后来腾讯、新浪、同花顺、TuShare、QMT 陆续接入，**但骨架没改**。
新 provider 都是以「在托底之前插一个分支」的方式加进来的。

这是典型的演进痕迹：第一个接入者默认成为架构中心，而没有人重新审视过这个地位是否还成立。

## 决定

金十降为**与腾讯、新浪、TuShare、QMT 平级的 provider**。

| 位置 | 现状 | 改为 |
|---|---|---|
| 入站鉴权 | `jin10_bearer_token` | `gateway_client_token`（ADR 0002） |
| `tools/list` | 无容错硬依赖 | 容错扇出，单源挂掉只丢它自己的工具 |
| `tools/call` 托底 | 盲转发给金十 | **取消盲转发**，改为显式路由 |
| `resources/read` 托底 | 盲转发给金十 | 同上 |
| 出站凭证 | `jin10_bearer_token` | **不变**——这才是它原本的用途 |

金十唯一保留的职责：**当你需要热点资讯或市场信息时调用的一个上游**。

## 如何取消盲转发而不打断移动端

直接给金十工具加 `jin10_` 前缀会**重命名定时任务正在调用的工具**，不可接受。

正确做法是把「托底」换成「清单」：

1. 启动时（或带 TTL 缓存）拉一次金十的 `tools/list`，得到它**实际声明**的工具名集合
2. `tools/call` 只在名字命中该集合时转发给金十
3. 不在集合内的未知名字 → 返回 `-32601 Method not found`，**不转发**
4. 同时接受 `jin10_<name>` 显式写法，作为新客户端的推荐形式
5. 金十不可达时集合为空 → 它的工具暂不可用，**其余工具不受影响**

行为对现有调用方完全不变，但边界从隐式变成显式，且不再把任意字符串转发给第三方。

## 实施顺序

先做低风险的，再动鉴权。

1. `tools/list` 容错扇出——纯改善，无行为变化，无切换风险
2. 托底 → 清单（含 `jin10_` 双写法支持）
3. 鉴权拆分（ADR 0002 的双接受窗口）
4. 客户端与定时任务切新 token 与新工具名
5. 移除双接受与旧写法

**第 1 步可以立刻做。** 它修掉的是一个真实存在的单点故障：
今天金十如果挂 5 分钟，你的手机定时任务会看到一个空工具表。

## 后果

- 新 provider 接入时不再需要「在托底前插分支」，而是注册到一张路由表
- 每个工具的归属 provider 变得可查，provenance 不再丢失
- 金十不可达不再是网关级故障，只是它自己的工具不可用
