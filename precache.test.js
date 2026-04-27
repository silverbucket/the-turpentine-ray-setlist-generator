import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Builds the project and inspects the generated sw.js. Catches a vite-plugin-pwa
// or Workbox bump that silently re-includes auth-relay.html in the precache —
// caching the OAuth relay would break rs.js's redirect flow. See issue #80.
let outDir;
let swJs;

beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "sr-precache-"));
    await build({
        logLevel: "silent",
        build: { outDir, write: true, emptyOutDir: true },
    });
    swJs = await readFile(join(outDir, "sw.js"), "utf8");
}, 60_000);

afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
});

describe("workbox precache (built sw.js)", () => {
    it("does not include auth-relay.html", () => {
        const m = swJs.match(/precacheAndRoute\(\[([\s\S]*?)\]/);
        expect(m, "precache array missing from sw.js").toBeTruthy();
        const urls = [...m[1].matchAll(/url:"([^"]+)"/g)].map((x) => x[1]);
        expect(urls.every((u) => !u.includes("auth-relay"))).toBe(true);
    });

    it("keeps a navigate-fallback denylist for auth-relay.html", () => {
        // The denylist stops the SPA navigate-fallback from serving index.html
        // for /auth-relay.html. The exact spacing/quoting depends on Workbox's
        // emitter, so just assert the substring appears under a denylist key.
        expect(swJs).toMatch(/denylist\s*:\s*\[[^\]]*auth-relay/);
    });
});
