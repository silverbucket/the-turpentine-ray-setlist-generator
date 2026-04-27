import { buildSeed, expect, test } from "../fixtures/test-fixtures";
import { AppShell } from "../pages/AppShell";

/**
 * Theme preference cycling — system → light → dark → system. The
 * cycleTheme button lives in the top-bar dropdown menu. Persistence is via
 * localStorage key "setlist-roller-theme".
 */
test.describe("Theme cycling", () => {
    test("cycling theme through system → light → dark → system", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);

        // Initial: system (whatever resolution that maps to)
        expect(await shell.getThemePreference()).toBeNull();

        await shell.cycleTheme();
        expect(await shell.getThemePreference()).toBe("light");
        expect(await shell.getTheme()).toBe("light");

        await shell.cycleTheme();
        expect(await shell.getThemePreference()).toBe("dark");
        expect(await shell.getTheme()).toBe("dark");

        await shell.cycleTheme();
        expect(await shell.getThemePreference()).toBe("system");
    });

    test("theme persists across reloads", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);

        await shell.cycleTheme();
        await shell.cycleTheme();
        // dark
        expect(await shell.getThemePreference()).toBe("dark");
        await page.reload();
        await app.waitForReady();
        expect(await shell.getThemePreference()).toBe("dark");
        expect(await shell.getTheme()).toBe("dark");
    });

    test("emulated dark color scheme makes 'system' resolve to dark", async ({ page, app }) => {
        // The default browser context honors emulateMedia. We re-create page
        // with the dark scheme set so the system preference resolves there.
        await page.emulateMedia({ colorScheme: "dark" });
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        // system preference = null in storage; resolved theme should be dark
        expect(await shell.getThemePreference()).toBeNull();
        expect(await shell.getTheme()).toBe("dark");
    });

    test("emulated light color scheme makes 'system' resolve to light", async ({ page, app }) => {
        await page.emulateMedia({ colorScheme: "light" });
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        expect(await shell.getTheme()).toBe("light");
    });
});

test.describe("Theme menu", () => {
    test("Theme button in dropdown shows current preference label", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);

        await shell.openMenu();
        const themeBtn = page.getByRole("button", { name: /^Theme:/ });
        await expect(themeBtn).toContainText(/System|Light|Dark/);
    });

    test("clicking the theme item changes the label on next open", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);

        await shell.openMenu();
        const themeBtn = page.getByRole("button", { name: /^Theme:/ });
        const before = await themeBtn.innerText();
        await themeBtn.click();

        await shell.openMenu();
        const after = await themeBtn.innerText();
        expect(after).not.toBe(before);
    });
});
