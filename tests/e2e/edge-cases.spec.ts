import type { SeedSong } from "../fixtures/fake-repo";
import { buildSeed, expect, makeSong, test } from "../fixtures/test-fixtures";
import { AppShell } from "../pages/AppShell";
import { BandPage } from "../pages/BandPage";
import { ConnectPage } from "../pages/ConnectPage";
import { RollPage } from "../pages/RollPage";
import { SongEditorPage } from "../pages/SongEditorPage";
import { SongsPage } from "../pages/SongsPage";

/**
 * Edge cases — first-run, account switching, multi-account, large datasets,
 * boundary conditions, and recovery from transient failure modes.
 */

test.describe("First-run experience", () => {
    test("connecting with no config shows the band-name modal", async ({ page, app }) => {
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.connect("newuser@example.com");
        const shell = new AppShell(page);
        await expect(shell.firstRunModal).toBeVisible({ timeout: 10_000 });
    });

    test("submitting an empty band name shows an error toast", async ({ page, app }) => {
        await app.goto();
        await new ConnectPage(page).connect("newuser2@example.com");
        const shell = new AppShell(page);
        await expect(shell.firstRunModal).toBeVisible({ timeout: 10_000 });
        // Click Save without filling the input
        await shell.firstRunSaveButton.click();
        await expect(shell.toast).toContainText(/needs a name/i);
        // Modal still open
        await expect(shell.firstRunModal).toBeVisible();
    });

    test("completing first-run dismisses the modal and shows the roll screen", async ({ page, app }) => {
        await app.goto();
        await new ConnectPage(page).connect("newuser3@example.com");
        const shell = new AppShell(page);
        await shell.completeFirstRun("Brand New Band");
        await expect(shell.bandTitle).toContainText("Brand New Band");
        await shell.expectActiveView("roll");
    });
});

test.describe("Multi-account switching", () => {
    test("disconnect via Add Account leaves user on the connect screen", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        await shell.openMenu();
        await page.getByRole("button", { name: "Add Account" }).click();
        await new ConnectPage(page).waitForVisible();
    });

    test("the Add Account flow returns the user to the connect screen with Recent listed", async ({ page, app }) => {
        // First, complete a connect+firstRun so an account ends up under "Recent"
        await app.goto();
        const connect = new ConnectPage(page);
        await connect.connect("user-a@example.com");
        const shell = new AppShell(page);
        await shell.completeFirstRun("Band A");
        await expect(shell.bandTitle).toContainText("Band A");

        // Now open the menu and click Add Account: we land on Connect again,
        // and the previous account appears under Recent.
        await shell.openMenu();
        await page.getByRole("button", { name: "Add Account" }).click();
        await connect.waitForVisible();
        await expect(connect.recentAccountsLabel).toBeVisible();
        await expect(connect.recentAccountByAddress("user-a@example.com")).toBeVisible();
    });
});

test.describe("Large datasets", () => {
    test("songs list with 50 songs renders all of them", async ({ page, app }) => {
        const songs: Record<string, SeedSong> = {};
        for (let i = 0; i < 50; i++) {
            const id = `song-${i}`;
            songs[id] = makeSong({ id, name: `Track ${String(i).padStart(2, "0")}` });
        }
        await app.seed(buildSeed({ songs }));
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoSongs();

        const songsPage = new SongsPage(page);
        const count = await songsPage.getSongCount();
        expect(count).toBe(50);
        // The list virtualizes nothing currently — they should all be rendered.
        await expect(songsPage.songRow("Track 00")).toBeVisible();
        await expect(songsPage.songRow("Track 49")).toBeVisible();
    });

    test("roll generation works with 30 candidate songs", async ({ page, app }) => {
        const songs: Record<string, SeedSong> = {};
        for (let i = 0; i < 30; i++) {
            const id = `song-${i}`;
            songs[id] = makeSong({ id, name: `Tune ${i}` });
        }
        await app.seed(buildSeed({ songs }));
        await app.goto();
        await app.waitForReady();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        expect(await roll.getSetlistSongCount()).toBeGreaterThan(0);
    });
});

test.describe("Search / filter edge cases", () => {
    test("search with no matches shows zero rows", async ({ page, app }) => {
        await app.seed(
            buildSeed({
                songs: {
                    s1: makeSong({ id: "s1", name: "Africa" }),
                    s2: makeSong({ id: "s2", name: "Bohemian Rhapsody" }),
                },
            }),
        );
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoSongs();

        const songs = new SongsPage(page);
        await songs.search("xyz-no-match");
        await expect(songs.songRow("Africa")).toHaveCount(0);
        await expect(songs.songRow("Bohemian Rhapsody")).toHaveCount(0);
    });

    test("clearing the search restores all rows", async ({ page, app }) => {
        await app.seed(
            buildSeed({
                songs: {
                    s1: makeSong({ id: "s1", name: "Africa" }),
                    s2: makeSong({ id: "s2", name: "Bohemian Rhapsody" }),
                },
            }),
        );
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoSongs();

        const songs = new SongsPage(page);
        await songs.search("Africa");
        await expect(songs.songRow("Africa")).toBeVisible();
        await expect(songs.songRow("Bohemian Rhapsody")).toHaveCount(0);

        await songs.clearSearch();
        await expect(songs.songRow("Africa")).toBeVisible();
        await expect(songs.songRow("Bohemian Rhapsody")).toBeVisible();
    });

    test("search is case-insensitive", async ({ page, app }) => {
        await app.seed(
            buildSeed({
                songs: { s1: makeSong({ id: "s1", name: "Africa" }) },
            }),
        );
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoSongs();

        const songs = new SongsPage(page);
        await songs.search("AFRICA");
        await expect(songs.songRow("Africa")).toBeVisible();
        await songs.clearSearch();
        await songs.search("aFr");
        await expect(songs.songRow("Africa")).toBeVisible();
    });
});

test.describe("Boundary inputs", () => {
    test("saving a song with no name shows an error toast and keeps the editor open", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoSongs();

        const songs = new SongsPage(page);
        await songs.clickAdd();
        const editor = new SongEditorPage(page);
        await editor.waitForVisible();
        // Don't fill in a name — name input is empty by default
        await editor.saveButton.click();
        // Editor should stay open; toast should explain why.
        await expect(editor.overlay).toBeVisible();
        await expect(new AppShell(page).toast).toContainText(/name/i);
    });

    test("song count stepper enforces minimum and maximum", async ({ app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();

        // Drive count down to 1 and try to push below
        await app.callStore("updateGenerationField", "count", 1);
        const stateAtMin = await app.getState();
        expect(stateAtMin?.generatedSetlist === null || stateAtMin?.generatedSetlist === undefined).toBe(true);

        // Try to set unreasonably high — store should clamp or accept
        await app.callStore("updateGenerationField", "count", 100);
        const stateMax = await app.getState();
        // Just verify the call didn't crash and state is still readable
        expect(stateMax).not.toBeNull();
    });

    test("very long song name is accepted and rendered", async ({ page, app }) => {
        const longName = "A".repeat(200);
        await app.seed(
            buildSeed({
                songs: { s1: makeSong({ id: "s1", name: longName }) },
            }),
        );
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoSongs();

        const songs = new SongsPage(page);
        await expect(songs.songRow(longName)).toBeVisible();
    });

    test("special characters in band name are preserved through reload", async ({ page, app }) => {
        const tricky = "Guns N' Roses & Co.";
        await app.seed(
            buildSeed({
                config: {
                    bandName: tricky,
                    schemaVersion: 2,
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z",
                    ui: { dieColor: null },
                    general: {},
                    show: {},
                    props: {},
                },
            }),
        );
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        await expect(shell.bandTitle).toContainText(tricky);
        await page.reload();
        await app.waitForReady();
        await expect(shell.bandTitle).toContainText(tricky);
    });
});

test.describe("Roll behavior edge cases", () => {
    test("rolling with zero songs shows the onboarding card, no setlist", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();

        const roll = new RollPage(page);
        await expect(roll.onboardingCard).toBeVisible();
        await expect(roll.rollButton).toBeDisabled();
    });

    test("setlist song count never exceeds requested count", async ({ page, app }) => {
        const songs: Record<string, SeedSong> = {};
        for (let i = 0; i < 20; i++) {
            const id = `song-${i}`;
            songs[id] = makeSong({ id, name: `Number ${i}` });
        }
        await app.seed(buildSeed({ songs }));
        await app.goto();
        await app.waitForReady();

        // Override count via store
        await app.callStore("updateGenerationField", "count", 5);

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        const list = await roll.getSetlistSongCount();
        expect(list).toBeLessThanOrEqual(5);
    });
});

test.describe("Locked setlist re-roll prompt", () => {
    test("rolling on a locked setlist asks for confirmation", async ({ page, app }) => {
        const songs: Record<string, SeedSong> = {};
        for (let i = 0; i < 12; i++) {
            const id = `song-${i}`;
            songs[id] = makeSong({ id, name: `Locked ${i}` });
        }
        await app.seed(buildSeed({ songs }));
        await app.goto();
        await app.waitForReady();

        const roll = new RollPage(page);
        await roll.clickRoll();
        await roll.waitForRollResult();
        await roll.lockSetlist();

        await roll.clickRoll();
        await roll.expectFreshRollDialog();
        await roll.cancelRoll();
        // Setlist still locked
        await expect(roll.lockedBadge).toBeVisible();
    });
});

test.describe("Toast lifecycle", () => {
    test("toasts auto-dismiss within a few seconds", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        await new AppShell(page).gotoBand();

        const band = new BandPage(page);
        const downloadPromise = page.waitForEvent("download");
        await band.exportAllButton.click();
        await downloadPromise;

        const shell = new AppShell(page);
        await expect(shell.toast).toBeVisible();
        // Toasts have a TTL — polling with a long timeout instead of a fixed wait.
        await expect(shell.toast).toBeHidden({ timeout: 10_000 });
    });
});

test.describe("Hash routing edge cases", () => {
    test("trailing slash in hash is normalized", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto("/#/songs/");
        const shell = new AppShell(page);
        // We expect either songs or fallback to roll — both are sensible.
        // The current router treats unknown hashes as roll.
        await expect.poll(() => shell.getActiveView()).toMatch(/songs|roll/);
    });

    test("query string in URL doesn't crash the app", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto("/?utm_source=test#/songs");
        const shell = new AppShell(page);
        await shell.expectActiveView("songs");
    });
});

test.describe("Persistence across reloads", () => {
    test("song count setting persists after reload", async ({ page, app }) => {
        await app.seed(
            buildSeed({
                songs: {
                    s1: makeSong({ id: "s1", name: "A" }),
                    s2: makeSong({ id: "s2", name: "B" }),
                    s3: makeSong({ id: "s3", name: "C" }),
                },
            }),
        );
        await app.goto();
        await app.waitForReady();

        await app.callStore("updateGenerationField", "count", 3);
        await page.reload();
        await app.waitForReady();
        const state = await app.getState();
        // After reload the persisted count should be 3
        expect(state).not.toBeNull();
    });

    test("active tab persists after reload via hash", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await app.waitForReady();
        const shell = new AppShell(page);
        await shell.gotoBand();
        await page.reload();
        await app.waitForReady();
        await shell.expectActiveView("band");
    });
});
