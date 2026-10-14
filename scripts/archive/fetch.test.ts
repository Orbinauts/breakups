import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchText } from "./fetch.ts";

/**
 * A download tried again over a stand-in `fetch`: a socket the server closed
 * before it answered (as NASA's did to the prospective run of 2026-10-14)
 * and a busy reply are each survived, and the third failure is thrown.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchText", () => {
  test("tries a closed socket or a busy reply again, and fails on the third", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const replies: (() => Response)[] = [
      () => {
        throw new TypeError("fetch failed", { cause: new Error("other side closed") });
      },
      () => new Response("busy", { status: 503 }),
      () => new Response("third time"),
    ];
    vi.stubGlobal("fetch", async () => replies.shift()!());
    const done = fetchText("https://example.org/x");
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await done).toBe("third time");

    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    const failed = fetchText("https://example.org/x").catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(String(await failed)).toContain("https://example.org/x: 503");
  });
});
