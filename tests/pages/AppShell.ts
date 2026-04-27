import { type Page, type Locator, expect } from "@playwright/test";

/**
 * Common chrome — top bar, bottom nav, toasts, modals — that lives outside
 * any one screen. Page objects for individual screens compose this.
 */
export class AppShell {
    readonly page: Page;

    // Bottom nav tabs
    readonly rollTab: Locator;
    readonly savedTab: Locator;
    readonly songsTab: Locator;
    readonly bandTab: Locator;
    readonly helpTab: Locator;

    // Top bar
    readonly menuButton: Locator;
    readonly bandTitle: Locator;
    readonly connectionDot: Locator;

    // Modals & overlays
    readonly firstRunModal: Locator;
    readonly firstRunInput: Locator;
    readonly firstRunSaveButton: Locator;
    readonly toast: Locator;

    constructor(page: Page) {
        this.page = page;

        const bottomNav = page.locator("nav.bottom-nav");
        this.rollTab = bottomNav.getByRole("button", { name: /Roll/ });
        this.savedTab = bottomNav.getByRole("button", { name: /Saved/ });
        this.songsTab = bottomNav.getByRole("button", { name: /Songs/ });
        this.bandTab = bottomNav.getByRole("button", { name: /Band/ });
        this.helpTab = bottomNav.getByRole("button", { name: /Help/ });

        const topBar = page.locator("header.top-bar");
        this.menuButton = topBar.getByRole("button", { name: "Menu" });
        this.bandTitle = topBar.locator(".band-name");
        this.connectionDot = topBar.locator(".conn-dot");

        this.firstRunModal = page.locator(".modal-backdrop").filter({
            has: page.getByRole("heading", { name: "Name Your Band" }),
        });
        this.firstRunInput = this.firstRunModal.getByPlaceholder("Your Band Name");
        this.firstRunSaveButton = this.firstRunModal.getByRole("button", { name: "Save" });

        this.toast = page.locator(".toast-pill");
    }

    async gotoRoll() { await this.rollTab.click(); }
    async gotoSaved() { await this.savedTab.click(); }
    async gotoSongs() { await this.songsTab.click(); }
    async gotoBand() { await this.bandTab.click(); }
    async gotoHelp() { await this.helpTab.click(); }

    /**
     * Idempotent: opens the dropdown if it's closed, no-ops if already open.
     * The menu button is a toggle, so calling it twice would close the menu.
     * Some actions (like cycling theme) leave the menu open, so subsequent
     * openMenu() calls have to be aware of current state.
     */
    async openMenu() {
        const dropdown = this.page.locator(".dropdown");
        if (await dropdown.isVisible().catch(() => false)) return;
        await this.menuButton.click();
        await dropdown.waitFor({ state: "visible" });
    }

    async cycleTheme() {
        await this.openMenu();
        await this.page.getByRole("button", { name: /^Theme:/ }).click();
    }

    async getTheme(): Promise<string> {
        return this.page.evaluate(() => document.documentElement.dataset.theme || "");
    }

    async getThemePreference(): Promise<string | null> {
        return this.page.evaluate(() => localStorage.getItem("setlist-roller-theme"));
    }

    async getActiveView(): Promise<string> {
        return this.page.evaluate(() => (window as any).__SR_STORE__?.activeView);
    }

    async expectActiveView(name: string) {
        await expect.poll(() => this.getActiveView()).toBe(name);
    }

    async completeFirstRun(bandName: string) {
        await expect(this.firstRunModal).toBeVisible();
        await this.firstRunInput.fill(bandName);
        await this.firstRunSaveButton.click();
        await expect(this.firstRunModal).toBeHidden();
    }

    async expectToast(text: string | RegExp) {
        await expect(this.toast).toBeVisible();
        await expect(this.toast).toContainText(text);
    }

    async addAccount() {
        await this.openMenu();
        await this.page.getByRole("button", { name: "Add Account" }).click();
    }

    async switchToAccount(address: string) {
        await this.openMenu();
        await this.page
            .locator(".dropdown-item--account")
            .filter({ hasText: address })
            .click();
    }
}
