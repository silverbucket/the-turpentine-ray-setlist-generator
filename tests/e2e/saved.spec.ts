import { test, expect, buildSeed, makeSong } from "../fixtures/test-fixtures";
import { AppShell } from "../pages/AppShell";
import { SavedPage } from "../pages/SavedPage";
import { RollPage } from "../pages/RollPage";

/**
 * Saved screen ("Greatest Hits") — list of saved setlists, view/edit/load/
 * delete actions, plus the print modal.
 */
function setlistFixture(overrides: any = {}) {
    return {
        id: "set-1",
        name: "Friday Night Set",
        savedAt: "2024-09-15T20:00:00.000Z",
        songCount: 2,
        songs: [
            { id: "a", name: "Africa", key: "B" },
            { id: "b", name: "Bohemian Rhapsody", key: "Bb", cover: true },
        ],
        summary: { anxiety: { scaled: 4, label: "Calm" } },
        schemaVersion: 2,
        createdAt: "2024-09-15T20:00:00.000Z",
        updatedAt: "2024-09-15T20:00:00.000Z",
        ...overrides,
    };
}

test.describe("Saved screen — empty state", () => {
    test("empty state appears when no saved setlists exist", async ({ page, app }) => {
        await app.seed(buildSeed());
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await expect(saved.emptyState).toContainText("Nothing saved yet");
    });
});

test.describe("Saved screen — list", () => {
    test("seeded setlists render as cards with name and song count", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: {
                "set-1": setlistFixture({ id: "set-1", name: "Friday" }),
                "set-2": setlistFixture({ id: "set-2", name: "Saturday", savedAt: "2024-09-16T20:00:00.000Z" }),
            },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await expect(saved.savedCards).toHaveCount(2);
        await expect(saved.cardByName("Friday")).toBeVisible();
        await expect(saved.cardByName("Saturday")).toBeVisible();
        await expect(saved.cardByName("Friday")).toContainText("2 songs");
    });

    test("setlists are sorted by savedAt (most recent first)", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: {
                old: setlistFixture({ id: "old", name: "Old Show", savedAt: "2024-01-01T00:00:00.000Z" }),
                new: setlistFixture({ id: "new", name: "New Show", savedAt: "2024-12-31T00:00:00.000Z" }),
            },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        const names = await saved.savedCards.locator(".saved-name").allInnerTexts();
        expect(names).toEqual(["New Show", "Old Show"]);
    });
});

test.describe("Saved screen — view modal", () => {
    test("clicking a card opens the print/view modal", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s", name: "Acoustic" }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.openCard("Acoustic");
        await expect(saved.modal.locator(".print-songs")).toBeVisible();
        await expect(saved.modal).toContainText("Africa");
        await expect(saved.modal).toContainText("Bohemian Rhapsody");
    });

    test("Close button closes the modal", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s" }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.openCard("Friday Night Set");
        await saved.closeCard();
    });

    test("Load to Roll button loads the setlist into the Roll screen", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s", name: "Loadable" }) },
        }));
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoSaved();

        const saved = new SavedPage(page);
        await saved.loadToRoll("Loadable");

        // After Load to Roll the user is moved to the Roll tab.
        await shell.expectActiveView("roll");
        const roll = new RollPage(page);
        const songs = await roll.getSetlistSongNames();
        expect(songs.length).toBeGreaterThan(0);
    });
});

test.describe("Saved screen — edit", () => {
    test("can rename a saved setlist", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s", name: "Old Name" }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.startEdit("Old Name");
        await saved.fillEditName("Old Name", "New Hotness");
        await saved.saveEdit("Old Name");

        await expect(saved.cardByName("New Hotness")).toBeVisible();
        await expect(saved.cardByName("Old Name")).toHaveCount(0);
    });

    test("Cancel discards the rename", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s", name: "Stable" }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.startEdit("Stable");
        await saved.fillEditName("Stable", "Discarded");
        await saved.cancelEdit("Stable");
        await expect(saved.cardByName("Stable")).toBeVisible();
    });
});

test.describe("Saved screen — load", () => {
    test("Load button on the card navigates to roll with that setlist", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s", name: "Direct Load" }) },
        }));
        await app.goto();
        const shell = new AppShell(page);
        await shell.gotoSaved();

        const saved = new SavedPage(page);
        await saved.loadSavedFromCard("Direct Load");
        await shell.expectActiveView("roll");
    });
});

test.describe("Saved screen — delete with confirm", () => {
    test("Remove → Delete? confirms and deletes", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s", name: "Doomed Set" }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.deleteSaved("Doomed Set");
        await expect(saved.cardByName("Doomed Set")).toHaveCount(0);
    });

    test("Remove → No cancels the deletion", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({ id: "s", name: "Reprieve" }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.cancelDelete("Reprieve");
        await expect(saved.cardByName("Reprieve")).toBeVisible();
    });
});

test.describe("Saved screen — modal contents", () => {
    test("anxiety summary appears in the modal when present", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({
                id: "s",
                name: "With Anxiety",
                summary: { anxiety: { scaled: 6, label: "Sweaty" } },
            }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.openCard("With Anxiety");
        await expect(saved.modal.locator(".print-anxiety")).toContainText("6/10");
    });

    test("song notes are rendered in the print modal", async ({ page, app }) => {
        await app.seed(buildSeed({
            setlists: { "s": setlistFixture({
                id: "s",
                name: "With Notes",
                songs: [{ id: "a", name: "Africa", notes: "Cue intro on synth" }],
            }) },
        }));
        await app.goto();
        await new AppShell(page).gotoSaved();

        const saved = new SavedPage(page);
        await saved.openCard("With Notes");
        await expect(saved.modal.locator(".print-notes")).toContainText("Cue intro");
    });
});
