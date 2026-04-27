import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Auto-fills sha256 hashes into CSP meta tags. Source HTML files put
// __CSP_SCRIPT_HASHES__ / __CSP_STYLE_HASHES__ tokens in the directive
// values; this plugin replaces them with the space-joined hash sources of
// every inline <script>/<style> in the document. Covers index.html via
// transformIndexHtml (dev + build) and listed public/* HTML files via dev
// middleware and post-build rewrite.

const SCRIPT_TOKEN = "__CSP_SCRIPT_HASHES__";
const STYLE_TOKEN = "__CSP_STYLE_HASHES__";

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("base64");

function inlineHashes(html, tag) {
    // Strip HTML comments first — comment text can contain literal
    // "<script>" / "<style>" markers that would otherwise trip the regex.
    const cleaned = html.replace(/<!--[\s\S]*?-->/g, "");
    const re = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "g");
    return [...cleaned.matchAll(re)].filter((m) => !/\bsrc\s*=/i.test(m[1])).map((m) => `'sha256-${sha256(m[2])}'`);
}

function rewrite(html) {
    const scripts = inlineHashes(html, "script").join(" ");
    const styles = inlineHashes(html, "style").join(" ");
    return html.replaceAll(SCRIPT_TOKEN, scripts).replaceAll(STYLE_TOKEN, styles);
}

export function cspHashPlugin({ publicHtml = [] } = {}) {
    return {
        name: "csp-hash",
        // index.html (and any other Vite-processed entry) — runs in dev + build.
        // `order: post` so we see Vite's injected <script src="..."> tags; our
        // filter skips them (they have src=), but post-ordering is safer if
        // Vite ever inlines something we'd want hashed.
        transformIndexHtml: {
            order: "post",
            handler(html) {
                return rewrite(html);
            },
        },
        // Dev: intercept requests for public/* HTML files and serve rewritten.
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = req.url?.split("?")[0];
                const match = publicHtml.find((f) => `/${f}` === url);
                if (!match) return next();
                try {
                    const html = readFileSync(join(server.config.publicDir, match), "utf8");
                    res.setHeader("Content-Type", "text/html");
                    res.end(rewrite(html));
                } catch (e) {
                    next(e);
                }
            });
        },
        // Build: Vite copies public/* to dist/ untouched; rewrite in place.
        writeBundle(options) {
            for (const file of publicHtml) {
                const path = join(options.dir, file);
                writeFileSync(path, rewrite(readFileSync(path, "utf8")));
            }
        },
    };
}
