export type QmtCapabilityStatus =
  | "ok"
  | "permission"
  | "unsupported"
  | "unavailable";

export type QmtCapabilityProbe = {
  qmtInstalled: boolean;
  sdkMethodExists: boolean;
  runtimeSupported: boolean;
  entitled: boolean;
  dataPresent: boolean;
  fresh: boolean | null;
};

export type QmtCapabilityResult = {
  status: QmtCapabilityStatus;
  usable: boolean;
  layer:
    | "installation"
    | "sdk"
    | "runtime"
    | "entitlement"
    | "data"
    | "freshness"
    | "ready";
};

export function evaluateQmtCapability(
  probe: QmtCapabilityProbe,
): QmtCapabilityResult {
  if (!probe.qmtInstalled) return { status: "unavailable", usable: false, layer: "installation" };
  if (!probe.sdkMethodExists) return { status: "unsupported", usable: false, layer: "sdk" };
  if (!probe.runtimeSupported) return { status: "unsupported", usable: false, layer: "runtime" };
  if (!probe.entitled) return { status: "permission", usable: false, layer: "entitlement" };
  if (!probe.dataPresent) return { status: "unavailable", usable: false, layer: "data" };
  if (probe.fresh !== true) return { status: "unavailable", usable: false, layer: "freshness" };
  return { status: "ok", usable: true, layer: "ready" };
}
