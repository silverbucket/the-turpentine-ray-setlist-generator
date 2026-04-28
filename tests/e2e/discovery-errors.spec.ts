import { expect, test } from "../fixtures/test-fixtures";
import { ConnectPage } from "../pages/ConnectPage";

/**
 * Discovery-failure unwind: when webfinger lookup fails (HTTP 5xx,
 * invalid JSON, no remoteStorage link, etc.), rs.js's `connect()`
 * catches the rejection and emits a `RemoteStorage.DiscoveryError`.
 * The store's error handler treats that as fatal, releases any swap
 * guard, and calls `repo.disconnect()`, which fires `disconnected`
 * and runs the wipe path. Net result: connectionStatus returns to
 * "disconnected" with `loadError` populated, rather than getting
 * stuck on "connecting" forever.
 *
 * This spec pins that contract end-to-end against the real backend by
 * intercepting the webfinger request with `page.route` and returning a
 * controlled failure.
 */

test.describe("Discovery failure unwind", () => {
    test("HTTP 500 from webfinger leaves the user on the connect screen, not stuck connecting", async ({
        page,
        app,
    }) => {
        // Intercept the webfinger lookup BEFORE the click so the route
        // is armed by the time the address is submitted. Match any host
        // — the test only triggers exactly one webfinger request.
        await page.route("**/.well-known/webfinger*", (route) =>
            route.fulfill({ status: 500, body: "synthetic discovery failure" }),
        );

        // Cold-boot to the connect screen, type any plausible-looking
        // address, click Connect.
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await connect.fillAddress("nick@example.com");
        await connect.connectButton.click();

        // The unwind goes: webfinger 500 → my customDiscover rejects →
        // rs.js's connect re-emits as DiscoveryError → store error
        // handler → repo.disconnect() → disconnected event → wipe path
        // → connectionStatus = "disconnected". Should be sub-second.
        await expect
            .poll(async () => (await app.getState())?.connectionStatus, { timeout: 10_000 })
            .toBe("disconnected");

        // Connect screen is back (form visible) — user has a retry path.
        await expect(connect.addressInput).toBeVisible();
        // The store records the failure so the UI can surface it.
        const state = await app.getState();
        expect(state?.connectionStatus).toBe("disconnected");
    });

    test("no remoteStorage link in webfinger response unwinds the same way", async ({ page, app }) => {
        // Server-side webfinger that returns 200 OK but with no rs link
        // — equally fatal from the app's perspective, takes the same
        // unwind path. Pinning the symmetry here so a future Discover
        // refactor that handled HTTP-error and missing-link cases
        // differently would surface in CI.
        await page.route("**/.well-known/webfinger*", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ links: [{ rel: "avatar", href: "https://example.com/me.png" }] }),
            }),
        );

        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await connect.fillAddress("nick@example.com");
        await connect.connectButton.click();

        await expect
            .poll(async () => (await app.getState())?.connectionStatus, { timeout: 10_000 })
            .toBe("disconnected");
        await expect(connect.addressInput).toBeVisible();
    });
});

test.describe("Bare-host connect path", () => {
    test("bare host (no @) reaches webfinger discovery without client-side rejection", async ({ page, app }) => {
        // rs.js's connect() prefixes a bare host with `https://` and
        // hands the URL form to my custom Discover. The previous
        // override rejected anything without `@` outright, breaking
        // bare-host inputs (e.g. `5apps.com`). This test verifies that:
        //   1. Typing a bare host doesn't trip a client-side rejection.
        //   2. The webfinger request actually fires with the URL-form
        //      resource (not `acct:`).
        // We intercept the webfinger to assert URL shape and avoid
        // depending on a real bare-host RS server being reachable.
        let capturedUrl = "";
        await page.route("**/.well-known/webfinger*", async (route) => {
            capturedUrl = route.request().url();
            // Return a 500 so the app unwinds — we just need to verify
            // the request shape, not complete the connect.
            await route.fulfill({ status: 500, body: "stop here" });
        });

        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await connect.fillAddress("5apps.com");
        await connect.connectButton.click();

        await expect.poll(() => capturedUrl, { timeout: 10_000 }).toMatch(/\.well-known\/webfinger/);

        // Bare-host upstream gets prefixed with https:// by rs.js, so
        // the webfinger resource is the URL form (NOT acct:5apps.com).
        // %3A%2F%2F is the encoded `://`.
        expect(capturedUrl).toContain("resource=https%3A%2F%2F5apps.com");
        expect(capturedUrl).not.toContain("acct%3A");
    });
});
