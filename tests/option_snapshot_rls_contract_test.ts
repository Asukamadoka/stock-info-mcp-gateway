import { assert } from "jsr:@std/assert";

const migrationPath =
  "supabase/migrations/20260903014000_option_snapshot_rls.sql";

Deno.test("option snapshot tables are service-only behind RLS", async () => {
  const sql = (await Deno.readTextFile(migrationPath)).toLowerCase();

  for (const table of [
    "public.option_chain_snapshots",
    "public.option_contract_snapshots",
  ]) {
    assert(
      sql.includes(`alter table ${table} enable row level security`),
      `${table} must enable RLS`,
    );
  }

  assert(
    sql.includes("from anon, authenticated"),
    "direct PostgREST roles must have table privileges revoked",
  );

  assert(
    !sql.includes("create policy"),
    "service-only option snapshots must not gain public/authenticated policies",
  );
});

Deno.test("option snapshot RLS migration does not alter snapshot data", async () => {
  const sql = (await Deno.readTextFile(migrationPath)).toLowerCase();

  for (const forbidden of [
    "delete from",
    "truncate",
    "drop table",
    "update public.option_",
  ]) {
    assert(
      !sql.includes(forbidden),
      `migration must not mutate existing snapshots: ${forbidden}`,
    );
  }
});
