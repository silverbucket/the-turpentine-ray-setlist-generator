import { describe, expect, it } from "vitest";
import { workboxConfig } from "./vite.config.js";

// Guards the workbox precache manifest against accidentally re-including
// auth-relay.html. That file is the OAuth redirect target; if Workbox precaches
// it, the rs.js flow lands on a stale cached copy and never returns control to
// the app. Both the glob and the navigate-fallback denylist must exclude it.
// See issue #80.
describe("workbox config", () => {
    it("excludes auth-relay.html from the precache glob", () => {
        expect(workboxConfig.globIgnores).toContain("**/auth-relay.html");
    });

    it("excludes auth-relay.html from the navigate fallback", () => {
        // Cover the realistic OAuth landing URLs — implicit grant returns the
        // token in the hash, code grant returns it in the query, and the bare
        // path catches the corner where the relay loads with no callback data.
        // A regex change that anchored too tightly (e.g. `$` at the end) would
        // pass the bare-path case but break OAuth, so all three are asserted.
        const candidates = [
            "/auth-relay.html",
            "/auth-relay.html?code=abc&state=xyz",
            "/auth-relay.html#access_token=zzz",
        ];
        for (const url of candidates) {
            const matches = workboxConfig.navigateFallbackDenylist.some((re) => re.test(url));
            expect(matches, `denylist must match ${url}`).toBe(true);
        }
    });
});
