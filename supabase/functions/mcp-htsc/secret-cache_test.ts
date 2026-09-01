import { assertEquals } from "jsr:@std/assert@1";
import { SecretCache } from "./secret-cache.ts";

Deno.test("HTSC secret cache reuses value inside 60 seconds", async () => {
  let now = 1_000;
  let loads = 0;

  const cache = new SecretCache(
    async () => `key-${++loads}`,
    60_000,
    () => now,
  );

  assertEquals(await cache.get("ht_apikey"), "key-1");

  now += 59_999;

  assertEquals(await cache.get("ht_apikey"), "key-1");
  assertEquals(loads, 1);
});

Deno.test("HTSC secret cache reloads value after 60 seconds", async () => {
  let now = 1_000;
  let loads = 0;

  const cache = new SecretCache(
    async () => `key-${++loads}`,
    60_000,
    () => now,
  );

  assertEquals(await cache.get("ht_apikey"), "key-1");

  now += 60_000;

  assertEquals(await cache.get("ht_apikey"), "key-2");
  assertEquals(loads, 2);
});
