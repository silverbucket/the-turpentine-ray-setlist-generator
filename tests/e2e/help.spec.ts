import { buildSeed, expect, test } from "../fixtures/test-fixtures";
import { AppShell } from "../pages/AppShell";
import { HelpPage } from "../pages/HelpPage";

/**
 * Help screen — static documentation with inline buttons that navigate to
 * other tabs. Verifies that the page renders and that all the in-text
 * links behave like nav buttons.
 */
test.describe("Help screen", () => {
    test("renders title and all sections", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await new AppShell(page).gotoHelp();

        const help = new HelpPage(page);
        await expect(help.title).toBeVisible();
        // Each major section heading should be present
        for (const heading of [
            "Getting started",
            'What "incomplete" means',
            "After you roll",
            "Tweaking the results",
            "Data & backups",
        ]) {
            await expect(help.screen.getByRole("heading", { name: heading })).toBeVisible();
        }
    });

    test("Band inline link navigates to band tab", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoHelp();

        const help = new HelpPage(page);
        await help.inlineLink("Band").first().click();
        await shell.expectActiveView("band");
    });

    test("Songs inline link navigates to songs tab", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoHelp();

        const help = new HelpPage(page);
        await help.inlineLink("Songs").first().click();
        await shell.expectActiveView("songs");
    });

    test("Roll inline link navigates to roll tab", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoHelp();

        const help = new HelpPage(page);
        await help.inlineLink("Roll").first().click();
        await shell.expectActiveView("roll");
    });

    test("Saved inline link navigates to saved tab", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoHelp();

        const help = new HelpPage(page);
        await help.inlineLink("Saved").first().click();
        await shell.expectActiveView("saved");
    });
});
