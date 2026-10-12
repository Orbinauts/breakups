import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { sha256File } from "./release.ts";

const work = mkdtempSync(join(tmpdir(), "breakups-release-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("a file's hash", () => {
  test("is SHA-256's, for a file read in many pieces and for an empty one", () => {
    // The test vectors of FIPS 180-2: a million times "a", and the empty message.
    const million = join(work, "million-a");
    writeFileSync(million, "a".repeat(1_000_000));
    expect(sha256File(million)).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    const empty = join(work, "empty");
    writeFileSync(empty, "");
    expect(sha256File(empty)).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
