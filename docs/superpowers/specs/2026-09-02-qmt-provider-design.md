# QMT Read-Only Provider Design

## Status

Approved scope for the next provider subsystem in `stock-info-mcp-gateway`.
The first milestone is read-only. No order placement, cancellation, transfer,
watchlist mutation, or other account mutation is in scope.

## Goal

Add QMT/XtQuant as a permission-aware, timestamped broker data family that can
improve option Put Pressure, Level-2, and fund-flow evidence while preserving
existing Sina/iTick/Tencent fallback behavior.

## Constraints

- GitHub remains the canonical source of truth.
- Supabase remains the cloud production runtime.
- QMT runs close to the broker terminal; Supabase must not import or execute the
  Windows-only `xtquant` SDK directly.
- QMT broker credentials remain on the broker host. Only a dedicated relay
  URL/token may be stored in Supabase Vault.
- SDK method existence is not proof of broker-build support or entitlement.
- Every provider result preserves source timestamp when available, fetched time,
  stale state, confidence, and raw/derived/estimate classification.
- Missing, stale, unauthorized, or unsupported QMT data must degrade explicitly
  and continue fallback; it must never fabricate neutral or healthy data.
- All observations derived from one QMT upstream family count as one independent
  source family for consensus.

## Topology

```text
Broker Windows host
  QMT / MiniQMT
      |
    xtquant
      |
  read-only QMT adapter/relay
      |
 authenticated HTTPS
      |
Supabase Edge gateway
  -> qmt provider adapter
  -> normalized provider contracts
  -> existing consensus / scoring / option snapshot logic
```

The preferred broker-host boundary is a narrow adapter around a proven QMT
runtime such as `qmtcli` or a similarly constrained local MCP implementation.
The gateway owns the remote contract. Callers never receive a generic remote
`xtdata`, `data-call`, `trade-call`, or shell escape hatch.

For a qmtcli-backed adapter, `qmtcli server` is preferred for a long-lived local
process after initial smoke. A per-request `qmtcli rpc` path is acceptable for
diagnosis and early integration testing.

## Local relay boundary

The first broker-host relay may be implemented as a small Python 3.11 service
owned by this repository. It authenticates every non-health request with a
dedicated relay token, validates symbols/periods, serializes fixed qmtcli calls,
and never stores QMT login credentials.

Allowed remote logical actions are fixed and read-only. Internally, the adapter
may map them to reviewed qmtcli/xtdata operations. A request body must never be
able to select an arbitrary method name.

Explicitly unreachable from the remote surface:

- buy/sell/submit order;
- cancel/replace/cancel-all;
- transfer or account mutation;
- generic `XtQuantTrader` calls;
- generic `xtdata`/`data-call` invocation;
- arbitrary shell execution.

## Relay capability surface

The first milestone exposes these logical read-only capabilities:

- `health`: adapter version, SDK source/version, and QMT connection state.
- `capabilities`: runtime capability/entitlement summary without secrets.
- `quote_snapshot(symbols)`: latest broker quote/tick plus source timestamp.
- `option_chain(underlying, expiry)`: call/put contract discovery and metadata.
- `option_quotes(codes)`: timestamp, last, volume, open interest, bid/ask, and
  reviewed optional IV/Greeks fields when available.
- `vix(symbol)`: documented ETF VIX quote when the connected environment exposes
  it.
- `l2_depth(symbol)`: normalized `l2quote` book.
- `l2_aux(symbol)`: reviewed `l2quoteaux` totals/withdrawal fields.
- `l2_order(symbol)`: read-only per-order data when entitled.
- `l2_transaction(symbol)`: read-only per-transaction data when entitled.
- `transaction_count(symbol, period)`: permissioned `transactioncount1m/1d`
  statistics.
- `order_flow(symbol, period)`: permissioned `orderflow1m/1d` data when exposed
  by the connected broker build.

## Capability model

Capability discovery is layered:

```text
QMT installed
  -> SDK method/period exists
  -> broker runtime accepts the call
  -> account entitlement/data is available
  -> source timestamp is fresh enough
  -> provider is usable
```

Each logical capability reports one of:

- `ok`
- `permission`
- `unsupported`
- `unavailable`

`unsupported` is a capability-layer state. The current gateway-wide
`ProviderStatus` does not need to be expanded merely for documentation. During
implementation, RED tests should decide whether unsupported needs a new common
status or can be represented as explicit capability metadata plus an existing
provider status.

## Provider normalization

Reuse the existing `SourceResult<T>` contract for cloud-facing results:

- `source_family: "qmt"`;
- source names such as `qmt-quote`, `qmt-option`, `qmt-l2`,
  `qmt-transactioncount`, and `qmt-orderflow`;
- direct broker records use `data_kind: "raw"`;
- algorithmic signals derived from broker records use
  `data_kind: "derived"`;
- confidence depends on capability, source timestamp, completeness, and field
  semantics.

QMT data that includes a reliable broker timestamp should normally produce a
real `stale: false/true` decision rather than `null`.

## Quote and intraday data

QMT quote/tick/bars are preferred when the runtime is healthy and fresh. Public
Tencent quote/intraday remains an independent fallback. Provider selection must
prefer fresh usable data and retain failed/stale attempt diagnostics.

## Level-2

Generalize the current Level-2 service so source metadata is not hard-coded to
iTick. Normalize QMT `l2quote` into the same depth shape used by current
imbalance metrics. iTick remains a fallback/independent provider.

QMT `l2quoteaux`, `l2order`, and `l2transaction` may support richer pressure,
withdrawal, queue, cancellation, and hidden/latent buying models. Any such
signal is algorithmic and must be `data_kind=derived`; it must not be described
as an official exchange dark-pool feed.

## Fund flow and chip evidence

Use entitled `transactioncount1m/1d` and, where reviewed and available,
`orderflow1m/1d` as the preferred QMT inputs for verified flow evidence. The raw
broker fields remain raw; the gateway's normalized directional signal is
derived.

A QMT-derived `FlowObservation` should use:

- `sourceFamily: "qmt"`;
- `kind: "net_flow"` or another reviewed existing semantic kind;
- `dataKind: "derived"`;
- source timestamp-derived stale state;
- confidence above public price-volume proxy only when required fields and
  entitlement are actually present.

Once a fresh positive-confidence QMT observation satisfies the existing
critical flow/chip contract, it may remove the candidate B+ cap that remains
when only price-volume/orderbook proxies exist. This is conditional on semantic
validation; QMT installation alone never removes the cap.

## Options / Put Pressure

Move option acquisition behind a provider interface. Preferred order when QMT
is configured, entitled, and fresh:

1. QMT option chain + option quotes;
2. Sina option chain/quote/Greeks fallback.

The normalized option contract must preserve volume, open interest, bid/ask,
last, strike, side, expiry, and provider timestamp when available. If IV is not
available from the reviewed QMT surface, return `iv: null`; do not silently
synthesize it. A later reviewed local `bsm_iv()` path may supply IV with explicit
provenance.

Put Pressure can continue using PCR volume, PCR OI, OI delta, Put Wall, and
active-put-buying when IV is unavailable. `iv_skew` must remain explicitly
unavailable and completeness must reflect the missing component.

Snapshot persistence must become provider-neutral: store the selected provider
source and provider source timestamp instead of assuming Sina provenance.
Previous open-interest comparison remains contract-code based.

## VIX

Expose reviewed ETF VIX as a separate risk-gate observable first. Do not alter
Put Pressure model weights merely because VIX becomes available. Weighting
changes require a separate model version plus validation/backtesting.

## Error handling

- Relay unreachable -> `unavailable`, confidence 0, continue fallback.
- Method/period absent or broker build unsupported -> capability
  `unsupported`; do not retry aggressively.
