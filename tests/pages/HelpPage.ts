import { type Page, type Locator } from "@playwright/test";

/**
 * Help screen — static documentation with inline links that navigate
 * elsewhere in the app.
 */
export class HelpPage {
    readonly page: Page;
    readonly screen: Locator;
    readonly title: Locator;

    constructor(page: Page) {
        this.page = page;
        this.screen = page.locator(".help-screen");
        this.title = this.screen.getByRole("heading", { level: 1, name: "How Setlist Roller Works" });
    }

    /** Inline links inside the help text — links navigate to a tab. */
    inlineLink(label: string): Locator {
        return this.screen.locator(".inline-link").filter({ hasText: label });
    }
}
