import { assertEquals } from "jsr:@std/assert@1";
import {
  evaluateQmtCapability,
  type QmtCapabilityProbe,
  type QmtCapabilityResult,
} from "./qmt-capabilities.ts";

type FakeXtquantCase = [
  string,
  Partial<QmtCapabilityProbe>,
  QmtCapabilityResult,
];

const base: QmtCapabilityProbe = {
  qmtInstalled: true,
  sdkMethodExists: true,
  runtimeSupported: true,
  entitled: true,
  dataPresent: true,
  fresh: true,
};

const cases: FakeXtquantCase[] = [
  ["ready", {}, { status: "ok", usable: true, layer: "ready" }],
  ["missing QMT", { qmtInstalled: false }, { status: "unavailable", usable: false, layer: "installation" }],
  ["missing SDK method", { sdkMethodExists: false }, { status: "unsupported", usable: false, layer: "sdk" }],
  ["unsupported broker runtime", { runtimeSupported: false }, { status: "unsupported", usable: false, layer: "runtime" }],
  ["missing entitlement", { entitled: false }, { status: "permission", usable: false, layer: "entitlement" }],
  ["empty data", { dataPresent: false }, { status: "unavailable", usable: false, layer: "data" }],
  ["unknown freshness", { fresh: null }, { status: "unavailable", usable: false, layer: "freshness" }],
  ["stale data", { fresh: false }, { status: "unavailable", usable: false, layer: "freshness" }],
];

Deno.test("fake xtquant capability cases enforce layered usability", () => {
  for (const [name, override, expected] of cases) {
    assertEquals(
      evaluateQmtCapability({ ...base, ...override }),
      expected,
      name,
    );
  }
});

Deno.test("QMT installation alone never implies Level-2 availability", () => {
  const result = evaluateQmtCapability({
    ...base,
    entitled: false,
  });

  assertEquals(result.usable, false);
  assertEquals(result.status, "permission");
});
