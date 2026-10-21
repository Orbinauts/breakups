import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BACKFILL_SPACING_SECONDS, BASE, credentialsFromEnv, MAX_REQUESTS, SPACING_SECONDS, SpaceTrack } from "./space-track.ts";

/**
 * The catalogue's client over a stand-in `fetch` that answers as the
 * catalogue does (a session cookie on login, rows as JSON), with the
 * clock faked so the spacing between requests is read, not waited for.
 * Never a network call.
 */

const CREDENTIALS = { identity: "someone@example", password: "secret" };

interface Call {
  at: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

let dir: string;
let calls: Call[];
/** What the stand-in catalogue answers: the login's body and cookie, and each query's status and body. */
let answers: { login: { status: number; body: string; cookie: string | null }; query: (url: string) => { status: number; body: string } };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "breakups-space-track-"));
  calls = [];
  answers = { login: { status: 200, body: '""', cookie: "chocolatechip=abc123; path=/; secure" }, query: () => ({ status: 200, body: '[{"NORAD_CAT_ID":"25544"}]' }) };
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 12) });
  vi.stubGlobal("fetch", async (url: string, init: { method?: string; headers: Record<string, string>; body?: URLSearchParams }) => {
    calls.push({ at: Date.now(), url, method: init.method ?? "GET", headers: init.headers, body: init.body?.toString() ?? null });
    if (url === `${BASE}/ajaxauth/login`) {
      const headers = new Headers();
      if (answers.login.cookie !== null) headers.append("Set-Cookie", answers.login.cookie);
      return new Response(answers.login.body, { status: answers.login.status, headers });
    }
    const { status, body } = answers.query(url);
    return new Response(body, { status });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** A query run to its end, the faked clock moved on while it waits its turn. */
async function settled<T>(promise: Promise<T>): Promise<T> {
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(2 * SPACING_SECONDS * 1000);
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}

const ledger = (): string[] => readFileSync(join(dir, "requests.log"), "utf8").trim().split("\n");

describe("the catalogue's credentials", () => {
  test("come from the environment, and are asked for by name where either is missing", () => {
    vi.stubEnv("SPACETRACK_IDENTITY", "someone@example");
    vi.stubEnv("SPACETRACK_PASSWORD", "");
    expect(() => credentialsFromEnv()).toThrow(/set SPACETRACK_IDENTITY and SPACETRACK_PASSWORD/);
    vi.stubEnv("SPACETRACK_PASSWORD", "secret");
    expect(credentialsFromEnv()).toEqual(CREDENTIALS);
  });
});

describe("the catalogue's client", () => {
  test("logs in once, asks with the session's cookie, keeps the answer gzipped, and writes each request to the ledger", async () => {
    const client = new SpaceTrack(CREDENTIALS, dir);
    const cache = join(dir, "history", "2026", "2026-10-01.json.gz");
    const first = await settled(client.rows<{ NORAD_CAT_ID: string }>(cache, "/basicspacedata/query/class/gp_history/EPOCH/2026-10-01--2026-10-02/format/json"));
    expect(first).toEqual({ rows: [{ NORAD_CAT_ID: "25544" }], cached: false });
    expect(JSON.parse(gunzipSync(readFileSync(cache)).toString("utf8"))).toEqual([{ NORAD_CAT_ID: "25544" }]);
    await settled(client.rows(join(dir, "b.json.gz"), "/b"));
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", `${BASE}/ajaxauth/login`],
      ["GET", `${BASE}/basicspacedata/query/class/gp_history/EPOCH/2026-10-01--2026-10-02/format/json`],
      ["GET", `${BASE}/b`],
    ]);
    expect(new URLSearchParams(calls[0]!.body!).get("identity")).toBe("someone@example");
    expect(calls[1]!.headers["Cookie"]).toBe("chocolatechip=abc123");
    expect(calls[2]!.headers["Cookie"]).toBe("chocolatechip=abc123");
    expect(ledger().map((line) => line.split(" ").slice(1).join(" "))).toEqual([`POST ${BASE}/ajaxauth/login 200`, `GET ${BASE}/basicspacedata/query/class/gp_history/EPOCH/2026-10-01--2026-10-02/format/json 200`, `GET ${BASE}/b 200`]);
    // The password is never written down.
    expect(readFileSync(join(dir, "requests.log"), "utf8")).not.toContain("secret");
  });

  test("spaces its requests at least the spacing apart", async () => {
    const client = new SpaceTrack(CREDENTIALS, dir);
    for (const name of ["a", "b", "c"]) await settled(client.rows(join(dir, `${name}.json.gz`), `/${name}`));
    const gaps = calls.slice(1).map((call, i) => call.at - calls[i]!.at);
    expect(gaps).toHaveLength(3);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(SPACING_SECONDS * 1000);
  });

  test("paced for the backfill, spaces its requests thirty-six seconds apart, a hundred an hour, counts them, and says when the next would pass its cap", async () => {
    expect(BACKFILL_SPACING_SECONDS).toBe(36);
    expect(3600 / BACKFILL_SPACING_SECONDS).toBe(100);
    const client = new SpaceTrack(CREDENTIALS, dir, { spacingSeconds: BACKFILL_SPACING_SECONDS, maxRequests: 3 });
    expect(client.made).toBe(0);
    expect(client.atCap).toBe(false);
    const paced = async <T>(promise: Promise<T>): Promise<T> => {
      const outcome = promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(2 * BACKFILL_SPACING_SECONDS * 1000);
      const result = await outcome;
      if ("error" in result) throw result.error;
      return result.value;
    };
    await paced(client.rows(join(dir, "a.json.gz"), "/a"));
    await paced(client.rows(join(dir, "b.json.gz"), "/b"));
    const gaps = calls.slice(1).map((call, i) => call.at - calls[i]!.at);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(BACKFILL_SPACING_SECONDS * 1000);
    // The login and two queries: the cap of three is reached, and the next request is refused.
    expect(client.made).toBe(3);
    expect(client.atCap).toBe(true);
    await expect(paced(client.rows(join(dir, "c.json.gz"), "/c"))).rejects.toThrow(/made 3 requests/);
  });

  test("answers from the cache with no request at all, not even a login", async () => {
    const cache = join(dir, "kept.json.gz");
    mkdirSync(dir, { recursive: true });
    writeFileSync(cache, gzipSync('[{"NORAD_CAT_ID":"7"}]'));
    expect(await new SpaceTrack(CREDENTIALS, dir).rows(cache, "/kept")).toEqual({ rows: [{ NORAD_CAT_ID: "7" }], cached: true });
    expect(calls).toEqual([]);
    expect(existsSync(join(dir, "requests.log"))).toBe(false);
  });

  test("refuses a failed login, one answered with the catalogue's failure, and one with no session cookie", async () => {
    answers.login = { status: 401, body: "", cookie: null };
    await expect(settled(new SpaceTrack(CREDENTIALS, dir).rows(join(dir, "x.json.gz"), "/x"))).rejects.toThrow("login failed (401)");
    answers.login = { status: 200, body: '{"Login":"Failed"}', cookie: "chocolatechip=abc" };
    await expect(settled(new SpaceTrack(CREDENTIALS, dir).rows(join(dir, "x.json.gz"), "/x"))).rejects.toThrow("login failed (200)");
    answers.login = { status: 200, body: '""', cookie: "other=1" };
    await expect(settled(new SpaceTrack(CREDENTIALS, dir).rows(join(dir, "x.json.gz"), "/x"))).rejects.toThrow("login answered no session cookie");
    expect(calls.every((c) => c.method === "POST")).toBe(true);
  });

  test("refuses an answer that is not a success, with its status and the start of its body, and keeps nothing", async () => {
    answers.query = () => ({ status: 500, body: "the catalogue is down for maintenance" });
    const cache = join(dir, "x.json.gz");
    await expect(settled(new SpaceTrack(CREDENTIALS, dir).rows(cache, "/x"))).rejects.toThrow(`${BASE}/x: 500 the catalogue is down for maintenance`);
    expect(existsSync(cache)).toBe(false);
    expect(ledger().at(-1)).toContain(`GET ${BASE}/x 500`);
  });

  test("stops a run at its cap of requests, the login counted", { timeout: 60_000 }, async () => {
    const client = new SpaceTrack(CREDENTIALS, dir);
    for (let i = 0; i < MAX_REQUESTS - 1; i++) await settled(client.rows(join(dir, `${i}.json.gz`), `/${i}`));
    expect(calls).toHaveLength(MAX_REQUESTS);
    await expect(settled(client.rows(join(dir, "more.json.gz"), "/more"))).rejects.toThrow(`this run has made ${MAX_REQUESTS} requests; stop and run again later`);
    expect(calls).toHaveLength(MAX_REQUESTS);
  });
});
