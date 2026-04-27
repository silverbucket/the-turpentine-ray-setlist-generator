import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Setlist Roller.
 *
 * The app is a Svelte 5 PWA backed by remoteStorage. For E2E testing we inject
 * an in-memory fake repo (see `tests/fixtures/fake-repo.ts`) via
 * `window.__SR_TEST_REPO_FACTORY__` before the app boots. This bypasses the
 * real remoteStorage discovery / OAuth flow and gives tests full control over
 * "remote" data.
 */
export default defineConfig({
    testDir: "./tests/e2e",
    /* Run files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in source */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on CI */
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
    timeout: 30_000,
    expect: {
        timeout: 5_000,
    },
    use: {
        baseURL: "http://127.0.0.1:4173",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        actionTimeout: 10_000,
        navigationTimeout: 15_000,
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "mobile",
            use: { ...devices["iPhone 13"] },
        },
    ],

    /* Run the dev server before starting tests */
    webServer: {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
    },
});
