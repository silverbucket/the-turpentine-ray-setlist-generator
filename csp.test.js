import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// Recomputes sha256 for every inline <script>/<style> block and asserts the
// CSP meta tag's directive lists it. If you edit a script body, this test
// fails with the new hash to paste into the meta tag. See issue #79.

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");

function inlineBlocks(html, tag) {
    // Strip HTML comments first — they can contain literal "<script>" /
    // "<style>" text that would otherwise trip the tag regex.
    const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
    const re = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "g");
    return [...cleaned.matchAll(re)].filter((m) => !/\bsrc\s*=/i.test(m[1])).map((m) => m[2]);
}

function cspDirective(html, name) {
    const meta = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]+content="([^"]+)"/i);
    if (!meta) throw new Error("CSP meta tag not found");
    const part = meta[1].split(";").find((d) => d.trim().startsWith(name));
    return part ? part.trim() : "";
}

async function check(file, tag, directive) {
    const html = await readFile(file, "utf8");
    const blocks = inlineBlocks(html, tag);
    expect(blocks.length, `${file} should have at least one inline <${tag}>`).toBeGreaterThan(0);
    const d = cspDirective(html, directive);
    for (const body of blocks) {
        expect(d).toContain(`'sha256-${sha256(body)}'`);
    }
}

describe("csp inline-content hashes", () => {
    it("index.html script-src covers the inline theme script", () => check("./index.html", "script", "script-src"));
    it("auth-relay.html script-src covers the inline OAuth handler", () =>
        check("./public/auth-relay.html", "script", "script-src"));
    it("auth-relay.html style-src covers the inline style block", () =>
        check("./public/auth-relay.html", "style", "style-src"));
});
