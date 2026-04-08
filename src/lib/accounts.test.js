import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    getAccountToken,
    getKnownAccounts,
    getKnownAccountsRaw,
    KNOWN_ACCOUNTS_KEY,
    removeKnownAccountEntry,
    saveKnownAccount,
    scopedKey,
} from "./accounts.js";

// ===================================================================
// localStorage stub
// ===================================================================
let store;

beforeEach(() => {
    store = {};
    globalThis.localStorage = {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => {
            store[k] = String(v);
        },
        removeItem: (k) => {
            delete store[k];
        },
    };
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-04-09T12:00:00.000Z");
});

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.localStorage;
});

// ===================================================================
// scopedKey
// ===================================================================
describe("scopedKey", () => {
    it("returns unscoped key when no user address", () => {
        expect(scopedKey("snapshot", "")).toBe("setlist-roller-snapshot");
        expect(scopedKey("snapshot", undefined)).toBe("setlist-roller-snapshot");
    });

    it("returns hashed key for a user address", () => {
        const key = scopedKey("snapshot", "alice@example.com");
        expect(key).toMatch(/^setlist-roller-snapshot-[a-z0-9]+$/);
    });

    it("produces different keys for different addresses", () => {
        const a = scopedKey("snapshot", "alice@example.com");
        const b = scopedKey("snapshot", "bob@example.com");
        expect(a).not.toBe(b);
    });

    it("produces the same key for the same address", () => {
        const a = scopedKey("snapshot", "alice@example.com");
        const b = scopedKey("snapshot", "alice@example.com");
        expect(a).toBe(b);
    });

    it("produces different keys for different bases", () => {
        const a = scopedKey("snapshot", "alice@example.com");
        const b = scopedKey("opts", "alice@example.com");
        expect(a).not.toBe(b);
    });
});

// ===================================================================
// saveKnownAccount / getKnownAccounts / getKnownAccountsRaw
// ===================================================================
describe("saveKnownAccount", () => {
    it("adds a new account", () => {
        saveKnownAccount("alice@example.com", "The Band", "tok_alice");
        const raw = getKnownAccountsRaw();
        expect(raw).toHaveLength(1);
        expect(raw[0]).toMatchObject({
            address: "alice@example.com",
            bandName: "The Band",
            token: "tok_alice",
            lastUsed: "2026-04-09T12:00:00.000Z",
        });
    });

    it("upserts an existing account", () => {
        saveKnownAccount("alice@example.com", "Old Name", "tok_1");
        saveKnownAccount("alice@example.com", "New Name", "tok_2");
        const raw = getKnownAccountsRaw();
        expect(raw).toHaveLength(1);
        expect(raw[0].bandName).toBe("New Name");
        expect(raw[0].token).toBe("tok_2");
    });

    it("keeps existing bandName when new one is empty", () => {
        saveKnownAccount("alice@example.com", "The Band", "tok_1");
        saveKnownAccount("alice@example.com", "", "tok_2");
        expect(getKnownAccountsRaw()[0].bandName).toBe("The Band");
    });

    it("keeps existing token when new one is falsy", () => {
        saveKnownAccount("alice@example.com", "Band", "tok_1");
        saveKnownAccount("alice@example.com", "Band", "");
        expect(getKnownAccountsRaw()[0].token).toBe("tok_1");
    });

    it("does nothing for empty address", () => {
        saveKnownAccount("", "Band", "tok");
        expect(getKnownAccountsRaw()).toHaveLength(0);
    });

    it("stores multiple accounts", () => {
        saveKnownAccount("alice@example.com", "Band A", "tok_a");
        saveKnownAccount("bob@example.com", "Band B", "tok_b");
        expect(getKnownAccountsRaw()).toHaveLength(2);
    });
});

describe("getKnownAccounts", () => {
    it("strips tokens from the returned list", () => {
        saveKnownAccount("alice@example.com", "Band", "secret_token");
        const accounts = getKnownAccounts();
        expect(accounts).toHaveLength(1);
        expect(accounts[0]).toEqual({
            address: "alice@example.com",
            bandName: "Band",
            lastUsed: "2026-04-09T12:00:00.000Z",
        });
        expect(accounts[0]).not.toHaveProperty("token");
    });

    it("returns empty array when no accounts stored", () => {
        expect(getKnownAccounts()).toEqual([]);
    });

    it("returns empty array for corrupted localStorage", () => {
        store[KNOWN_ACCOUNTS_KEY] = "not-json{{{";
        expect(getKnownAccounts()).toEqual([]);
    });

    it("sorts by lastUsed descending", () => {
        store[KNOWN_ACCOUNTS_KEY] = JSON.stringify([
            { address: "old@x.com", bandName: "Old", lastUsed: "2026-01-01T00:00:00.000Z" },
            { address: "new@x.com", bandName: "New", lastUsed: "2026-04-01T00:00:00.000Z" },
        ]);
        const accounts = getKnownAccounts();
        expect(accounts[0].address).toBe("new@x.com");
        expect(accounts[1].address).toBe("old@x.com");
    });
});

// ===================================================================
// getAccountToken
// ===================================================================
describe("getAccountToken", () => {
    it("returns token for a known account", () => {
        saveKnownAccount("alice@example.com", "Band", "tok_alice");
        expect(getAccountToken("alice@example.com")).toBe("tok_alice");
    });

    it("returns empty string for unknown account", () => {
        expect(getAccountToken("unknown@example.com")).toBe("");
    });

    it("returns empty string when no accounts exist", () => {
        expect(getAccountToken("anyone@example.com")).toBe("");
    });
});

// ===================================================================
// removeKnownAccountEntry
// ===================================================================
describe("removeKnownAccountEntry", () => {
    it("removes the specified account", () => {
        saveKnownAccount("alice@example.com", "Band A", "tok_a");
        saveKnownAccount("bob@example.com", "Band B", "tok_b");
        removeKnownAccountEntry("alice@example.com");
        const accounts = getKnownAccountsRaw();
        expect(accounts).toHaveLength(1);
        expect(accounts[0].address).toBe("bob@example.com");
    });

    it("does nothing for unknown address", () => {
        saveKnownAccount("alice@example.com", "Band A", "tok_a");
        removeKnownAccountEntry("unknown@example.com");
        expect(getKnownAccountsRaw()).toHaveLength(1);
    });

    it("does nothing for empty address", () => {
        saveKnownAccount("alice@example.com", "Band A", "tok_a");
        removeKnownAccountEntry("");
        expect(getKnownAccountsRaw()).toHaveLength(1);
    });

    it("handles removing the last account", () => {
        saveKnownAccount("alice@example.com", "Band A", "tok_a");
        removeKnownAccountEntry("alice@example.com");
        expect(getKnownAccountsRaw()).toEqual([]);
    });
});
