import {
  assertEquals,
} from "jsr:@std/assert@1";

import {
  previousOpenInterestFromRows,
  toContractSnapshotRows,
  type SnapshotContract,
} from "./snapshot.ts";

Deno.test("previous snapshot rows become OI lookup map", () => {
  const map = previousOpenInterestFromRows([
    { contract_code: "C100", open_interest: 120 },
    { contract_code: "P100", open_interest: 180 },
    { contract_code: "P105", open_interest: null },
  ]);

  assertEquals(map, {
    C100: 120,
    P100: 180,
  });
});

Deno.test("contract snapshot rows preserve call/put and raw market fields", () => {
  const contracts: SnapshotContract[] = [
    {
      code: "P100",
      side: "put",
      strike: 100,
      volume: 50,
      openInterest: 300,
      iv: 0.25,
      bid: 1.3,
      ask: 1.5,
      last: 1.5,
    },
  ];

  const rows = toContractSnapshotRows(
    "snapshot-1",
    "510050",
    "2609",
    contracts,
  );

  assertEquals(rows, [
    {
      snapshot_id: "snapshot-1",
      underlying: "510050",
      expiry: "2609",
      contract_code: "P100",
      side: "put",
      strike: 100,
      volume: 50,
      open_interest: 300,
      iv: 0.25,
      bid: 1.3,
      ask: 1.5,
      last: 1.5,
    },
  ]);
});
