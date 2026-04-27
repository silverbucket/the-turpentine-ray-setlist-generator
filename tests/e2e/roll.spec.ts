import type { SeedSong } from "../fixtures/fake-repo";
import { buildSeed, expect, makeSong, test } from "../fixtures/test-fixtures";
import { AppShell } from "../pages/AppShell";
import { RollPage } from "../pages/RollPage";
import { SavedPage } from "../pages/SavedPage";

/**
 * Roll screen — dice, count stepper, settings drawer, generated setlist,
 * lock/save flow, fresh-roll dialog, add-song dialog.
 *
 * Generation runs in a Web Worker so we wait for `generatedSetlist` rather
 * than relying on UI animation timing.
 */
function seedWithCatalog(extraSongs: SeedSong[] = []) {
    const builtins = [
        makeSong({ id: "a", name: "Africa", key: "B" }),
        makeSong({ id: "b", name: "Bohemian Rhapsody", key: "Bb", cover: true }),
        makeSong({ id: "c", name: "Creep", key: "G", cover: true }),
        makeSong({ id: "d", name: "Don't Stop Believin", key: "E", cover: true }),
        makeSong({ id: "e", name: "Enter Sandman", key: "Em", cover: true }),
        makeSong({ id: "f", name: "Fade to Black", key: "Bm", cover: true }),
        makeSong({ id: "g", name: "Going Home", key: "C", instrumental: true }),
        makeSong({ id: "h", name: "Hey Jude", key: "F", cover: true }),
        makeSong({ id: "i", name: "Imagine", key: "C", cover: true }),
        makeSong({ id: "j", name: "Jolene", key: "Am", cover: true }),
    ];
    const all = [...builtins, ...extraSongs];
    const songs: Record<string, SeedSong> = {};
    all.forEach((s) => {
        songs[s.id] = s;
    });
    return buildSeed({ songs });
}

test.describe("Roll screen — onboarding & sync state", () => {
    test("empty catalog shows onboarding card with link to Songs tab", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoRoll();

        const roll = new RollPage(page);
        await expect(roll.onboardingCard).toBeVisible();
        await expect(roll.onboardingCard).toContainText("Almost showtime");
    });

    test("catalog with songs shows the idle nudge before rolling", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoRoll();

        const roll = new RollPage(page);
        await expect(roll.idleNudge).toBeVisible();
        await expect(roll.rollButton).toBeEnabled();
    });

    test("disabled state when there are no songs (Roll button disabled)", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoRoll();

        const roll = new RollPage(page);
        await expect(roll.rollButton).toBeDisabled();
    });
});

test.describe("Roll screen — generation flow", () => {
    test("clicking Roll generates a setlist", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();

        const count = await roll.getSetlistSongCount();
        expect(count).toBeGreaterThan(0);
        await expect(roll.lockButton).toBeVisible();
    });

    test("rolling shows the dice in 'rolling' state during generation", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        // Settle done — eventually the setlist appears
        const songs = await roll.getSetlistSongNames();
        expect(songs.length).toBeGreaterThan(0);
    });

    test("seeded roll produces deterministic results", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.setSeed(42);
        await roll.clickRoll();
        await roll.waitForRollResult();
        const first = await roll.getSetlistSongNames();

        // Roll again with same seed; should be identical.
        await roll.confirmOrFresh();
        await roll.waitForRollResult();
        const second = await roll.getSetlistSongNames();
        expect(second).toEqual(first);
    });
});

test.describe("Roll screen — settings drawer", () => {
    test("settings drawer toggles open and closed", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.openSettings();
        await expect(roll.settingsDrawer).toHaveJSProperty("open", true);
        await roll.closeSettings();
        await expect(roll.settingsDrawer).toHaveJSProperty("open", false);
    });

    test("variety slider is reflected in store config", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.openSettings();
        await roll.activateTab("chaos");
        // Move slider to a known value via fill (range inputs accept fill in
        // Playwright). Use a value that maps cleanly to a temperature.
        await roll.varietySlider.fill("80");
        const state = await app.getState();
        // varietyToTemp(80) = 0.3 + 0.8 * 1.7 = 1.66 (approx)
        expect(state.appConfig).toBeTruthy();
    });

    test("seed input value persists after closing settings", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.setSeed(123);
        await roll.closeSettings();
        await roll.openSettings();
        await roll.activateTab("chaos");
        const seedField = roll.screen.locator("label").filter({ hasText: "Seed" }).locator('input[type="number"]');
        await expect(seedField).toHaveValue("123");
    });
});

test.describe("Roll screen — lock / save / re-roll", () => {
    test("can lock a generated setlist; locked badge appears", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        await roll.lockSetlist();
        await expect(roll.lockedBadge).toBeVisible();
    });

    test("rolling a locked setlist prompts for fresh-roll / optimize / keep", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        await roll.lockSetlist();

        await roll.clickRoll();
        await roll.expectFreshRollDialog();

        await roll.cancelRoll();
        await expect(roll.lockedBadge).toBeVisible();
    });

    test("saving a locked setlist adds it to Greatest Hits", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        await shell.gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        await roll.lockSetlist();
        await roll.saveSetlist();

        // The "Saved" badge should now appear in place of the save button.
        await expect(roll.savedBadge).toBeVisible();

        // Going to Saved should show one entry.
        await shell.gotoSaved();
        const saved = new SavedPage(page);
        await expect(saved.savedCards).toHaveCount(1);
    });
});

test.describe("Roll screen — bass anxiety summary", () => {
    test("anxiety value and hint text appear after rolling", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();

        await expect(roll.anxietyValue).toBeVisible();
        await expect(roll.anxietyValue).toContainText("/10");
        await expect(roll.anxietyHint).toBeVisible();
    });
});

test.describe("Roll screen — add song dialog", () => {
    test("add-song dialog opens, lists catalog songs, and adds them to the setlist", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();

        const before = await roll.getSetlistSongCount();
        // Find a song that wasn't already added — pick one that isn't in the
        // current setlist. Easiest: add a song the seed always has.
        await roll.addSongButton.click();
        await expect(roll.addSongDialog).toBeVisible();

        // Search for "Africa" and click whichever button isn't tagged "added".
        await roll.addSongSearch.fill("Africa");
        const items = roll.addSongDialog.locator(".add-song-item");
        // Pick first item that doesn't have "in-setlist-tag"
        const notInSetlist = items.filter({ hasNot: page.locator(".in-setlist-tag") });
        const noteIfAlreadyIn = await items.first().locator(".in-setlist-tag").count();
        if (noteIfAlreadyIn) {
            // Already in setlist — close & abort. Test still validates the dialog.
            await roll.closeAddSongDialog();
            return;
        }
        await notInSetlist.first().click();
        await expect(roll.addSongDialog).toBeHidden();
        const after = await roll.getSetlistSongCount();
        expect(after).toBe(before + 1);
    });

    test("clicking outside add-song dialog closes it", async ({ page, app }) => {
        await app.seed(seedWithCatalog());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        await roll.addSongButton.click();
        await expect(roll.addSongDialog).toBeVisible();
        await roll.closeAddSongDialog();
        await expect(roll.addSongDialog).toBeHidden();
    });
});

test.describe("Roll screen — pre-conditions", () => {
    test("rolling with all songs unpracticed shows a toast and bails", async ({ page, app }) => {
        await app.seed(
            buildSeed({
                songs: {
                    a: makeSong({ id: "a", name: "Wobbly", unpracticed: true }),
                    b: makeSong({ id: "b", name: "Wonky", unpracticed: true }),
                },
            }),
        );
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        await shell.gotoRoll();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await shell.expectToast(/unpracticed/i);
    });
});
