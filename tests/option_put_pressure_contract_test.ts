import { assertEquals } from "jsr:@std/assert@1";

Deno.test("mcp-options exposes persisted Put Pressure tool", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/mcp-options/index.ts",
  );

  assertEquals(source.includes("computePutPressure"), true);
  assertEquals(source.includes("previousOpenInterestFromRows"), true);
  assertEquals(source.includes("toContractSnapshotRows"), true);

  assertEquals(source.includes("option_put_pressure"), true);
  assertEquals(source.includes("optionPutPressure"), true);

  assertEquals(source.includes("loadPreviousSnapshot"), true);
  assertEquals(source.includes("saveSnapshot"), true);

  assertEquals(source.includes("option_chain_snapshots"), true);
  assertEquals(source.includes("option_contract_snapshots"), true);

  assertEquals(source.includes("listManyRaw"), true);
});
