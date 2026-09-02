# References and provider roadmap

Last reviewed: 2026-09-02.

This file records design inputs, not runtime truth. A provider is usable only
when the running system has verified its capability, entitlement, and freshness.
Every production data result should preserve `source_timestamp`, `stale`,
`confidence`, and `data_kind` (`raw` or `derived`) semantics.

## Official QMT / XtQuant material

- ThinkTrader / QMT knowledge base: https://dict.thinktrader.net/
- XtQuant `xtdata` reference: https://dict.thinktrader.net/nativeApi/xtdata.html
- ThinkTrader function index: https://dict.thinktrader.net/VBA/check_sheet.html

The official material is the primary reference for QMT capability names and
field semantics. Current documentation exposes Level-2 periods such as
`l2quote`, `l2quoteaux`, `l2order`, `l2transaction`,
`l2transactioncount`, and `l2orderqueue`, and documents option helpers such as
`get_option_list`, `get_option_iv`, and `bsm_iv`.

These names do not by themselves prove that a specific broker account can use
them. Runtime capability must be determined in this order:

```text
QMT installed
  -> SDK method exists
  -> broker server supports it
  -> account entitlement exists
  -> data is fresh
  -> provider is usable
```

Installation alone is never sufficient evidence for Level-2, option, or
fund-flow availability.

## Primary reference implementations

### 2233admin/qmtcli

Repository: https://github.com/2233admin/qmtcli

Use as a first-class engineering reference for:

- capability discovery and machine-readable schemas;
- a stable JSON boundary around local `xtquant`;
- fake-`xtquant` CI so tests do not require a broker workstation;
- SDK/document alignment checks and documentation-drift testing;
- MCP/agent exposure derived from one capability registry.

Do not copy its trading surface into this gateway. The first QMT phase here is
read-only and must not expose order placement, cancellation, or an unrestricted
escape hatch into `XtQuantTrader`.

### juju-w/qmt-mcp

Repository: https://github.com/juju-w/qmt-mcp

Study its Windows/Docker QMT appliance, local XtQuant integration, broker-pack
separation, Streamable HTTP MCP transport, authentication, and operational
boundaries. Prefer reusing or adapting a proven local-QMT lifecycle boundary
where practical instead of duplicating the entire QMT lifecycle inside
`stock-info-mcp-gateway`.

Account mutation and trading remain out of scope for the first phase.

## Secondary references

### AKShare

Repository: https://github.com/akfamily/akshare

Use for broad coverage, enrichment, and fallback research. Do not treat AKShare
as the primary high-frequency intraday truth source; upstream websites and
interface behavior can change independently.

### mootdx

Repository: https://github.com/mootdx/mootdx

Use as a reference for TongDaXin-compatible data access and as a possible
fallback/compatibility source. It is not a replacement for entitlement-backed
QMT Level-2 or broker-originated real-time data.

### iwencai-cli

Repository: https://github.com/shaw-baobao/iwencai-cli

Use for candidate discovery and natural-language screening. Browser-driven
iWenCai automation is not a market-data source of truth and must not be promoted
to verified quote/flow status.

### tickflow-stock-panel

Repository: https://github.com/shy3130/tickflow-stock-panel

Use for workflow and product ideas around screening, monitoring, feature
pipelines, and backtesting. Its application-layer architecture is a reference,
not a provider truth source for this gateway.

### GitHub `a-shares` topic

Discovery page: https://github.com/topics/a-shares

Use only to discover projects worth evaluating. A repository discovered through
the topic is never added to production solely because it is popular or recent.

## Pending verification

User-supplied Zhihu article:

https://zhuanlan.zhihu.com/p/2068288354643350659

If the article body cannot be retrieved and reviewed, keep it marked
`pending verification`. Do not infer technical capability from its title,
metadata, or surrounding discussion.

## Provider roadmap

### Tier 1: QMT / XtQuant, read-only

QMT is the preferred roadmap provider for entitlement-backed data:

- capabilities and environment diagnostics;
- quotes and intraday bars;
- ETF option chain and option fields;
- ETF VIX where the connected QMT environment exposes it;
- Level-2 quote/order/transaction data;
- `transactioncount`/order-flow families when actually entitled;
- explicit provider timestamps, staleness, confidence, and raw/derived status.

For Put Pressure, the target architecture is:

```text
QMT option chain
  -> primary Put Pressure input

Sina ETF options
  -> public fallback
```

QMT-provided option fields or locally calculated IV can reduce dependence on
Sina Greeks, but only after runtime parity tests.

For flow/chip scoring, QMT may upgrade the current `price_volume` proxy to
verified `net_flow` / chip evidence only when the data is entitlement-backed,
fresh, and semantically validated. Until then, proxy observations remain
non-critical and the candidate grade cap stays in force.

### Public / broad-coverage fallback

Keep independent public and commercial fallbacks for graceful degradation:

- Tencent for public A-share quote/intraday data;
- Sina for ETF options while QMT is unavailable;
- Jin10 for market/news/calendar coverage where licensed;
- HiThink / 同花顺 and other configured providers according to entitlement;
- AKShare/mootdx for non-critical breadth or fallback use cases.

Fallback selection must prefer fresh usable data over stale earlier providers
and must expose provider disagreement rather than silently averaging it away.

### Candidate discovery

iWenCai-style natural-language screening may feed a candidate pool, but candidate
discovery is separate from market-data truth. Every candidate still requires
fresh quote, technical, flow/chip, and risk-gate validation from approved
providers.

## Explicit non-goals

The current QMT roadmap does not expose:

- automatic order submission;
- order cancellation or modification;
- unattended broker mutation;
- HTSC mutation tools in smoke or test paths.

"Dark pool" or "hidden money" signals derived from Level-2 behavior must be
labelled `data_kind=derived`. They are algorithmic estimates, not an official
exchange dark-pool feed.
