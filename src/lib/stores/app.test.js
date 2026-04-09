import { describe, expect, it, vi } from "vitest";

import { createAppStore } from "./app.svelte.js";

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
