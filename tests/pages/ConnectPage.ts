import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Connection screen — the first thing users see before connecting their
 * remoteStorage account. Driven from `App.svelte` when
 * `connectionStatus === "disconnected"`.
 */
export class ConnectPage {
    readonly page: Page;
    readonly heading: Locator;
    readonly addressInput: Locator;
    readonly connectButton: Locator;
    readonly errorText: Locator;
    readonly recentAccountsLabel: Locator;

    constructor(page: Page) {
        this.page = page;
        this.heading = page.getByRole("heading", { level: 1 });
        this.addressInput = page.getByPlaceholder("you@example.com");
        this.connectButton = page.getByRole("button", { name: /^Connect|Connecting/ });
        this.errorText = page.locator(".error-text");
        this.recentAccountsLabel = page.getByText("Recent", { exact: true });
    }

    async waitForVisible() {
        await expect(this.addressInput).toBeVisible();
    }

    async fillAddress(address: string) {
        await this.addressInput.fill(address);
    }

    async submit() {
        await this.connectButton.click();
    }

    async connect(address: string) {
        await this.fillAddress(address);
        await this.submit();
    }

    recentAccountByAddress(address: string): Locator {
        return this.page.locator(".recent-account").filter({
            has: this.page.getByText(address, { exact: true }),
        });
    }

    async forgetAccount(address: string) {
        await this.recentAccountByAddress(address).getByRole("button", { name: "Forget account" }).click();
    }
}
