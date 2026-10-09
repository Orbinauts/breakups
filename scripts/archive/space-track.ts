import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * A client for the catalogue's history class that keeps to its use
 * guidelines: one login per run, requests spaced out (fewer than thirty a
 * minute and three hundred an hour), every answer cached under the Archive
 * so a day once pulled is never asked for again, and every request written
 * to a ledger (`requests.log`) a person can read. Credentials come from the
 * environment only (`SPACETRACK_IDENTITY`, `SPACETRACK_PASSWORD`), never
 * from a file in the repository.
 */

export const BASE = "https://www.space-track.org";
const USER_AGENT = "breakups-archive (https://github.com/Orbinauts/breakups)";
/** Seconds between requests: ten a minute, a third of what the guidelines allow. */
export const SPACING_SECONDS = 6;
/** Requests one run may make, so a bug cannot run away with the account. */
export const MAX_REQUESTS = 400;

export interface Credentials {
  identity: string;
  password: string;
}

export function credentialsFromEnv(): Credentials {
  const identity = process.env.SPACETRACK_IDENTITY;
  const password = process.env.SPACETRACK_PASSWORD;
  if (identity === undefined || password === undefined || identity === "" || password === "") {
    throw new Error("set SPACETRACK_IDENTITY and SPACETRACK_PASSWORD in the environment (for example in a .env file the repository ignores, run with node --env-file=.env)");
  }
  return { identity, password };
}

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export class SpaceTrack {
  private cookie: string | null = null;
  private lastRequest = 0;
  private requests = 0;

  private readonly credentials: Credentials;
  private readonly archive: string;

  constructor(credentials: Credentials, archive: string) {
    this.credentials = credentials;
    this.archive = archive;
  }

  private ledger(line: string): void {
    appendFileSync(join(this.archive, "requests.log"), `${new Date().toISOString()} ${line}\n`);
  }

  private async login(): Promise<string> {
    if (this.cookie !== null) return this.cookie;
    await this.space();
    const response = await fetch(`${BASE}/ajaxauth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({ identity: this.credentials.identity, password: this.credentials.password }),
    });
    this.ledger(`POST ${BASE}/ajaxauth/login ${response.status}`);
    const body = await response.text();
    if (!response.ok || body.includes('"Login":"Failed"')) throw new Error(`login failed (${response.status})`);
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .find((c) => c.startsWith("chocolatechip="));
    if (cookie === undefined) throw new Error("login answered no session cookie");
    this.cookie = cookie;
    return cookie;
  }

  private async space(): Promise<void> {
    if (this.requests >= MAX_REQUESTS) throw new Error(`this run has made ${MAX_REQUESTS} requests; stop and run again later`);
    const wait = this.lastRequest + SPACING_SECONDS * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();
    this.requests++;
  }

  /** The rows a query answers, from the cache when it holds them, else fetched, gzipped and kept. */
  async rows<T>(cachePath: string, path: string): Promise<{ rows: T[]; cached: boolean }> {
    if (existsSync(cachePath)) return { rows: JSON.parse(gunzipSync(readFileSync(cachePath)).toString("utf8")) as T[], cached: true };
    const cookie = await this.login();
    await this.space();
    const url = `${BASE}${path}`;
    const response = await fetch(url, { headers: { Cookie: cookie, "User-Agent": USER_AGENT } });
    this.ledger(`GET ${url} ${response.status}`);
    if (!response.ok) throw new Error(`${url}: ${response.status} ${(await response.text()).slice(0, 200)}`);
    const text = await response.text();
    const rows = JSON.parse(text) as T[];
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, gzipSync(text));
    return { rows, cached: false };
  }
}
