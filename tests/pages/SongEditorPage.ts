import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Song editor overlay — opened by clicking + Add or any song row in
 * SongsPage. Lives at the very top of the z-index, fills the viewport.
 */
export class SongEditorPage {
    readonly page: Page;
    readonly overlay: Locator;
    readonly title: Locator;
    readonly backButton: Locator;
    readonly saveButton: Locator;
    readonly nameInput: Locator;
    readonly keySelect: Locator;
    readonly notesInput: Locator;
    readonly addNewMemberButton: Locator;
    readonly duplicateButton: Locator;
    readonly deleteButton: Locator;

    constructor(page: Page) {
        this.page = page;
        this.overlay = page.locator(".editor-overlay");
        this.title = this.overlay.locator(".editor-title");
        this.backButton = this.overlay.getByRole("button", { name: "Back" });
        this.saveButton = this.overlay.getByRole("button", { name: "Save" });
        // The Basics section's Song Name input
        this.nameInput = this.overlay.getByPlaceholder("Song title");
        this.keySelect = this.overlay.locator("select").first();
        this.notesInput = this.overlay.getByPlaceholder("Anything to remember on stage...");
        this.addNewMemberButton = this.overlay.getByRole("button", { name: "+ New member" });
        this.duplicateButton = this.overlay.getByRole("button", { name: "Duplicate song" });
        this.deleteButton = this.overlay.getByRole("button", { name: "Delete song" });
    }

    async waitForVisible() {
        await expect(this.overlay).toBeVisible();
    }

    async fillName(name: string) {
        await this.nameInput.fill(name);
    }

    async selectKey(key: string) {
        await this.keySelect.selectOption(key);
    }

    async fillNotes(notes: string) {
        await this.notesInput.fill(notes);
    }

    /** Toggle the Cover / Instrumental / Unpracticed / Not a good opener / closer chips */
    async toggleChip(label: string) {
        await this.overlay.locator("label.chip-toggle, label").filter({ hasText: label }).first().click();
    }

    async save() {
        await this.saveButton.click();
        // Save closes the editor — wait for it to vanish so callers don't race.
        await expect(this.overlay).toBeHidden();
    }

    async close() {
        await this.backButton.click();
        await expect(this.overlay).toBeHidden();
    }

    async confirmDelete() {
        // First click reveals the confirm; second commits.
        await this.deleteButton.click();
        // The store's deleteSong() also calls window.confirm() — auto-accept it.
        this.page.once("dialog", (d) => d.accept());
        await this.overlay.getByRole("button", { name: "Yes, delete" }).click();
        await expect(this.overlay).toBeHidden();
    }

    async cancelDelete() {
        await this.deleteButton.click();
        await this.overlay.getByRole("button", { name: "Cancel" }).click();
    }

    async duplicate() {
        await this.duplicateButton.click();
    }

    /** Add an existing band member to this song via the per-row chip */
    async addMemberByName(name: string) {
        await this.overlay.getByRole("button", { name: `+ ${name}` }).click();
    }

    /** Add a brand new member via the new-member button */
    async addNewMember() {
        await this.addNewMemberButton.click();
    }

    /** Returns the locator for a member section within the editor */
    memberSection(memberName: string): Locator {
        return this.overlay.locator(".member-card").filter({ hasText: memberName });
    }

    async expandMember(memberName: string) {
        await this.memberSection(memberName).locator(".member-header").click();
    }

    async setInstrumentName(memberName: string, value: string) {
        const sec = this.memberSection(memberName);
        const input = sec.getByPlaceholder("e.g. Guitar, Bass, Keys").first();
        await input.fill(value);
        await input.press("Enter");
    }
}
