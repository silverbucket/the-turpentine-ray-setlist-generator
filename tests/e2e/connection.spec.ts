import { buildSeed, expect, test } from "../fixtures/test-fixtures";
import { AppShell } from "../pages/AppShell";
import { ConnectPage } from "../pages/ConnectPage";

/**
 * The connection screen is the disconnected entry point. Without a seed,
 * the fake repo never auto-connects, so the app stays disconnected — same
 * shape the user sees on first visit.
 */
test.describe("Connection screen", () => {
    test("shows connect form when disconnected", async ({ page, app }) => {
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await expect(connect.heading).toContainText("Setlist Roller");
        await expect(connect.connectButton).toBeVisible();
    });

    test("connects with an address and shows app shell", async ({ page, app }) => {
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await connect.connect("alice@example.com");

        // After connect, the app shell should appear (BottomNav is the marker)
        const shell = new AppShell(page);
        await expect(shell.rollTab).toBeVisible({ timeout: 10_000 });
    });

    test("Enter key submits the connect form", async ({ page, app }) => {
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await connect.fillAddress("bob@example.com");
        await connect.addressInput.press("Enter");

        const shell = new AppShell(page);
        await expect(shell.rollTab).toBeVisible({ timeout: 10_000 });
    });

    test("Connect button is disabled when address is empty", async ({ page, app }) => {
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await expect(connect.connectButton).toBeDisabled();
        // App shell never appears
        await expect(page.locator("nav.bottom-nav")).toHaveCount(0);
    });

    test("known accounts appear in Recent list after connecting", async ({ page, app }) => {
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.waitForVisible();
        await connect.connect("recurring@example.com");
        const shell = new AppShell(page);
        await expect(shell.rollTab).toBeVisible({ timeout: 10_000 });

        // Disconnect and verify the address shows up under Recent
        await shell.openMenu();
        await page.getByRole("button", { name: "Add Account" }).click();
        await connect.waitForVisible();
        await expect(connect.recentAccountsLabel).toBeVisible();
        await expect(connect.recentAccountByAddress("recurring@example.com")).toBeVisible();
    });

    test("Recent account can be forgotten", async ({ page, app }) => {
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.connect("forget@example.com");
        const shell = new AppShell(page);
        await expect(shell.rollTab).toBeVisible({ timeout: 10_000 });

        await shell.openMenu();
        await page.getByRole("button", { name: "Add Account" }).click();
        await connect.forgetAccount("forget@example.com");
        await expect(connect.recentAccountByAddress("forget@example.com")).toHaveCount(0);
    });
});

test.describe("Auto-connect with seed", () => {
    test("seeded user boots straight into app shell", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        const shell = new AppShell(page);
        await expect(shell.rollTab).toBeVisible({ timeout: 10_000 });
        await expect(shell.bandTitle).toContainText("Test Band");
    });

    test("connection dot reads connected after seeded boot", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        await expect(shell.connectionDot).toHaveClass(/connected/);
    });
});
