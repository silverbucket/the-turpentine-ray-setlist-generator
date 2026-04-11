import { describe, expect, it, vi } from "vitest";

import { createAppStore, normalizeAuthToken } from "./app.svelte.js";

describe("normalizeAuthToken", () => {
    it("keeps non-empty string tokens", () => {
        expect(normalizeAuthToken("saved-token")).toBe("saved-token");
    });

    it("drops click events and other non-string values", () => {
        expect(normalizeAuthToken({ type: "click" })).toBeUndefined();
        expect(normalizeAuthToken("")).toBeUndefined();
        expect(normalizeAuthToken(null)).toBeUndefined();
    });
});

describe("startAddAccountFlow", () => {
    it("returns to the login screen immediately before remoteStorage confirms disconnect", () => {
        const repo = {
            disconnect: vi.fn(),
            getToken: vi.fn(() => ""),
        };
        const store = createAppStore(repo);

        store.connectAddress = "band@example.com";

        store.startAddAccountFlow();

        expect(store.connectionStatus).toBe("disconnected");
        expect(store.connectAddress).toBe("");
        expect(store.initialSyncComplete).toBe(false);
        expect(repo.disconnect).toHaveBeenCalledTimes(1);
    });
});
