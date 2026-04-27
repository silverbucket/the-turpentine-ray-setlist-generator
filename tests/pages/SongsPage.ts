import { type Page, type Locator, expect } from "@playwright/test";

/**
 * Songs catalog screen — list, search, filter, add. The detailed editor is
 * `SongEditorPage`.
 */
export class SongsPage {
    readonly page: Page;
    readonly screen: Locator;
    readonly heading: Locator;
    readonly addButton: Locator;
    readonly searchInput: Locator;
    readonly emptyState: Locator;
    readonly emptyTitle: Locator;
    readonly songList: Locator;
    readonly keyFilterClear: Locator;

    constructor(page: Page) {
        this.page = page;
        this.screen = page.locator(".songs-screen");
        this.heading = this.screen.getByRole("heading", { level: 2 });
        this.addButton = this.screen.getByRole("button", { name: /\+ Add/ });
        this.searchInput = this.screen.getByPlaceholder("Search songs...");
        this.emptyState = this.screen.locator(".empty-state");
        this.emptyTitle = this.screen.locator(".empty-title");
        this.songList = this.screen.locator(".song-list");
        this.keyFilterClear = this.screen.getByRole("button", { name: "Clear" });
    }

    async clickAdd() {
        await this.addButton.click();
    }

    async search(query: string) {
        await this.searchInput.fill(query);
    }

    async clearSearch() {
        await this.searchInput.fill("");
    }

    songRow(name: string): Locator {
        return this.screen.locator(".song-row").filter({ hasText: name });
    }

    async openSong(name: string) {
        await this.songRow(name).first().click();
    }

    async clickFilterChip(label: string) {
        // Type filter buttons (All, Originals, Covers, Instrumentals)
        await this.screen.getByRole("button", { name: label, exact: true }).click();
    }

    async clickStatusFilter(label: "Incomplete" | "Unpracticed") {
        await this.screen.locator(".status-chip").filter({ hasText: label }).click();
    }

    async clickKeyFilter(key: string) {
        // The chip toggles are <label> elements containing checkboxes; click the label.
        await this.screen.locator(".key-chips label").filter({ hasText: key }).click();
    }

    async getVisibleSongNames(): Promise<string[]> {
        const rows = this.screen.locator(".song-name");
        return rows.allInnerTexts();
    }

    async getSongCount(): Promise<number> {
        const text = await this.heading.innerText();
        const match = text.match(/\((\d+)\)/);
        return match ? Number(match[1]) : 0;
    }

    async expectSongVisible(name: string) {
        await expect(this.songRow(name).first()).toBeVisible();
    }

    async expectSongHidden(name: string) {
        await expect(this.songRow(name)).toHaveCount(0);
    }
}
