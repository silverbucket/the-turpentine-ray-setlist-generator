import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remoteStorageMockState = vi.hoisted(() => ({
    instance: null,
    defaultAuthorize: null,
}));

vi.mock("remotestoragejs", () => ({
    default: vi.fn(() => remoteStorageMockState.instance),
}));

import {
    authorizeWithStandalonePopup,
    buildAuthorizeUrl,
    createRemoteStorageRepository,
    createStandaloneAuthMessageHandler,
    isIosStandaloneAuthContext,
    normalizeStandaloneAuthorizeOptions,
} from "./remotestorage.js";

let originalWindow;

beforeEach(() => {
    const defaultAuthorize = vi.fn();
    const remoteStorage = {
        access: {
            claim: vi.fn(),
            setStorageType: vi.fn(),
            scopeParameter: "setlist-roller:rw",
        },
        caching: {
            enable: vi.fn(),
            reset: vi.fn(),
        },
        scope: vi.fn(() => ({
            declareType: vi.fn(),
            on: vi.fn(),
            removeEventListener: vi.fn(),
        })),
        remote: {
            storageApi: "webdav",
            configure: vi.fn(),
            connected: false,
            userAddress: "",
            token: "",
        },
        authorize: defaultAuthorize,
        on: vi.fn(),
        removeEventListener: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        startSync: vi.fn(),
        connected: false,
    };

    remoteStorageMockState.instance = remoteStorage;
    remoteStorageMockState.defaultAuthorize = defaultAuthorize;
    originalWindow = globalThis.window;
});

afterEach(() => {
    vi.restoreAllMocks();
    remoteStorageMockState.instance = null;
    remoteStorageMockState.defaultAuthorize = null;
    if (typeof originalWindow === "undefined") {
        delete globalThis.window;
    } else {
        globalThis.window = originalWindow;
    }
});

describe("isIosStandaloneAuthContext", () => {
    it("returns false without a browser-like environment", () => {
        expect(isIosStandaloneAuthContext(undefined)).toBe(false);
    });

    it("returns false when not running in standalone mode", () => {
        const env = {
            matchMedia: () => ({ matches: false }),
            navigator: {
                standalone: false,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
        };
        expect(isIosStandaloneAuthContext(env)).toBe(false);
    });

    it("detects iPhone standalone mode", () => {
        const env = {
            matchMedia: () => ({ matches: true }),
            navigator: {
                standalone: false,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
        };
        expect(isIosStandaloneAuthContext(env)).toBe(true);
    });

    it("detects iPad-style standalone mode on MacIntel touch devices", () => {
        const env = {
            matchMedia: () => ({ matches: false }),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
                platform: "MacIntel",
                maxTouchPoints: 5,
            },
        };
        expect(isIosStandaloneAuthContext(env)).toBe(true);
    });
});

describe("buildAuthorizeUrl", () => {
    it("derives state from the redirect hash and strips it from redirect_uri", () => {
        const url = new URL(
            buildAuthorizeUrl({
                authURL: "https://auth.example.com/oauth",
                redirectUri: "https://app.example.com/#/songs",
                clientId: "https://app.example.com",
                scope: "setlist-roller:rw",
            }),
        );

        expect(url.searchParams.get("state")).toBe("/songs");
        expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/");
        expect(url.searchParams.get("response_type")).toBe("token");
        expect(url.searchParams.get("scope")).toBe("setlist-roller:rw");
    });

    it("includes explicit OAuth options when provided", () => {
        const url = new URL(
            buildAuthorizeUrl({
                authURL: "https://auth.example.com/oauth",
                redirectUri: "https://app.example.com/auth-relay.html",
                clientId: "https://app.example.com",
                scope: "setlist-roller:rw",
                response_type: "code",
                state: "attempt-123",
                code_challenge: "challenge",
                code_challenge_method: "S256",
                token_access_type: "offline",
            }),
        );

        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("state")).toBe("attempt-123");
        expect(url.searchParams.get("code_challenge")).toBe("challenge");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("token_access_type")).toBe("offline");
    });
});

describe("normalizeStandaloneAuthorizeOptions", () => {
    it("fills in redirectUri and clientId from the current location", () => {
        const options = normalizeStandaloneAuthorizeOptions(
            { authURL: "https://auth.example.com/oauth", scope: "setlist-roller:rw" },
            {
                location: {
                    origin: "https://app.example.com",
                    pathname: "/app",
                },
            },
        );

        expect(options.redirectUri).toBe("https://app.example.com/app");
        expect(options.clientId).toBe("https://app.example.com");
        expect(options.scope).toBe("setlist-roller:rw");
    });

    it("preserves a trailing slash when the current pathname is root", () => {
        const options = normalizeStandaloneAuthorizeOptions(
            { authURL: "https://auth.example.com/oauth", scope: "setlist-roller:rw" },
            {
                location: {
                    origin: "https://app.example.com",
                    pathname: "/",
                },
            },
        );

        expect(options.redirectUri).toBe("https://app.example.com/");
        expect(options.clientId).toBe("https://app.example.com");
    });

    it("rejects empty or non-string scopes", () => {
        expect(() =>
            normalizeStandaloneAuthorizeOptions(
                { authURL: "https://auth.example.com/oauth", scope: "" },
                {
                    location: {
                        origin: "https://app.example.com",
                        pathname: "/",
                    },
                },
            ),
        ).toThrow("undefined or empty scope");

        expect(() =>
            normalizeStandaloneAuthorizeOptions(
                { authURL: "https://auth.example.com/oauth", scope: null },
                {
                    location: {
                        origin: "https://app.example.com",
                        pathname: "/",
                    },
                },
            ),
        ).toThrow("undefined or empty scope");
    });
});

describe("createStandaloneAuthMessageHandler", () => {
    it("ignores unrelated messages", () => {
        const onSuccess = vi.fn();
        const onError = vi.fn();
        const handler = createStandaloneAuthMessageHandler({
            attemptId: "attempt-1",
            origin: "https://app.example.com",
            onSuccess,
            onError,
        });

        expect(
            handler({
                origin: "https://elsewhere.example.com",
                data: {},
            }),
        ).toBe(false);
        expect(
            handler({
                origin: "https://app.example.com",
                data: { type: "wrong-type", attemptId: "attempt-1" },
            }),
        ).toBe(false);
        expect(
            handler({
                origin: "https://app.example.com",
                data: { type: "setlist-roller-auth-result", attemptId: "attempt-2" },
            }),
        ).toBe(false);
        expect(onSuccess).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it("passes successful auth results through", () => {
        const onSuccess = vi.fn();
        const onError = vi.fn();
        const handler = createStandaloneAuthMessageHandler({
            attemptId: "attempt-1",
            origin: "https://app.example.com",
            onSuccess,
            onError,
        });

        expect(
            handler({
                origin: "https://app.example.com",
                data: {
                    type: "setlist-roller-auth-result",
                    attemptId: "attempt-1",
                    params: {
                        access_token: "token-123",
                        state: "/roll",
                    },
                },
            }),
        ).toBe(true);

        expect(onSuccess).toHaveBeenCalledWith({
            accessToken: "token-123",
            state: "/roll",
        });
        expect(onError).not.toHaveBeenCalled();
    });

    it("surfaces auth errors and missing tokens", () => {
        const onSuccess = vi.fn();
        const onError = vi.fn();
        const handler = createStandaloneAuthMessageHandler({
            attemptId: "attempt-1",
            origin: "https://app.example.com",
            onSuccess,
            onError,
        });

        handler({
            origin: "https://app.example.com",
            data: {
                type: "setlist-roller-auth-result",
                attemptId: "attempt-1",
                params: { error: "access_denied" },
            },
        });
        handler({
            origin: "https://app.example.com",
            data: {
                type: "setlist-roller-auth-result",
                attemptId: "attempt-1",
                params: {},
            },
        });

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onError.mock.calls[0][0].message).toContain("access_denied");
        expect(onError.mock.calls[1][0].message).toContain("did not return an access token");
    });
});

describe("authorizeWithStandalonePopup", () => {
    it("configures the token and updates the hash when the relay responds", () => {
        const configure = vi.fn();
        const handlers = new Map();
        const clearInterval = vi.fn();
        const clearTimeout = vi.fn();
        let timeoutCallback;
        const env = {
            location: {
                origin: "https://app.example.com",
                hash: "",
            },
            open: vi.fn(() => ({ closed: false })),
            addEventListener: vi.fn((eventName, handler) => handlers.set(eventName, handler)),
            removeEventListener: vi.fn((eventName) => handlers.delete(eventName)),
            setInterval: vi.fn(() => 1),
            clearInterval,
            setTimeout: vi.fn((callback) => {
                timeoutCallback = callback;
                return 2;
            }),
            clearTimeout,
        };

        authorizeWithStandalonePopup(
            { remote: { configure } },
            {
                authURL: "https://auth.example.com/oauth",
                redirectUri: "https://app.example.com",
                clientId: "https://app.example.com",
                scope: "setlist-roller:rw",
            },
            {
                env,
                emitError: vi.fn(),
            },
        );

        const authUrl = env.open.mock.calls[0][0];
        const redirectUri = new URL(authUrl).searchParams.get("redirect_uri");
        const attemptId = new URL(redirectUri).searchParams.get("attempt");
        handlers.get("message")({
            origin: "https://app.example.com",
            data: {
                type: "setlist-roller-auth-result",
                attemptId,
                params: {
                    access_token: "token-123",
                    state: "/saved",
                },
            },
        });

        expect(configure).toHaveBeenCalledWith({ token: "token-123" });
        expect(env.location.hash).toBe("/saved");
        expect(timeoutCallback).toBeTypeOf("function");
        expect(clearInterval).toHaveBeenCalledWith(1);
        expect(clearTimeout).toHaveBeenCalledWith(2);
    });
});

describe("createRemoteStorageRepository", () => {
    it("does not throw when standalone authorize is called without options", () => {
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: {
                origin: "https://app.example.com",
                hash: "",
            },
            open: vi.fn(() => null),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();
        const errorHandler = vi.fn();

        repo.on("error", errorHandler);

        expect(() => repo.remoteStorage.authorize()).not.toThrow();
        expect(remoteStorageMockState.instance.access.setStorageType).toHaveBeenCalledWith("webdav");
        expect(remoteStorageMockState.defaultAuthorize).not.toHaveBeenCalled();
        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(errorHandler.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it("uses the standalone popup authorize path and emits popup errors", () => {
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: {
                origin: "https://app.example.com",
                hash: "",
            },
            open: vi.fn(() => null),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();
        const errorHandler = vi.fn();

        repo.on("error", errorHandler);

        expect(() =>
            repo.remoteStorage.authorize({
                authURL: "https://auth.example.com/oauth",
            }),
        ).not.toThrow();
        expect(remoteStorageMockState.instance.access.setStorageType).toHaveBeenCalledWith("webdav");
        expect(remoteStorageMockState.defaultAuthorize).not.toHaveBeenCalled();
        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(errorHandler.mock.calls[0][0].message).toContain("popup was blocked");
        const authUrl = globalThis.window.open.mock.calls[0][0];
        const redirectUri = new URL(authUrl).searchParams.get("redirect_uri");
        expect(redirectUri).toMatch(/^https:\/\/app\.example\.com\/auth-relay\.html\?attempt=/);
    });

    it("closes the reserved popup on disconnect", () => {
        const popup = {
            closed: false,
            document: { write: vi.fn(), close: vi.fn() },
            close: vi.fn(),
        };
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: { origin: "https://app.example.com", hash: "" },
            open: vi.fn(() => popup),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();
        repo.connect("user@example.com");
        expect(popup.close).not.toHaveBeenCalled();

        repo.disconnect();
        expect(popup.close).toHaveBeenCalledTimes(1);
        expect(remoteStorageMockState.instance.caching.reset).toHaveBeenCalled();
        expect(remoteStorageMockState.instance.disconnect).toHaveBeenCalled();
    });

    it("reserves a popup during standalone switchTo without a token", () => {
        const popup = {
            closed: false,
            document: { write: vi.fn(), close: vi.fn() },
            close: vi.fn(),
        };
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: { origin: "https://app.example.com", hash: "" },
            open: vi.fn(() => popup),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();
        repo.switchTo("other@example.com");

        expect(globalThis.window.open).toHaveBeenCalledWith("", "_blank", "popup=yes,width=480,height=720");
        expect(remoteStorageMockState.instance.connect).toHaveBeenCalledWith("other@example.com", undefined);
    });

    it("closes reserved popup during switchTo with a token", () => {
        const popup = {
            closed: false,
            document: { write: vi.fn(), close: vi.fn() },
            close: vi.fn(),
        };
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: { origin: "https://app.example.com", hash: "" },
            open: vi.fn(() => popup),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();
        // First connect without token to reserve a popup
        repo.connect("user@example.com");
        expect(popup.close).not.toHaveBeenCalled();

        // Switch with a token — should close the reserved popup
        repo.switchTo("other@example.com", "saved-token");
        expect(popup.close).toHaveBeenCalledTimes(1);
        expect(remoteStorageMockState.instance.connect).toHaveBeenLastCalledWith("other@example.com", "saved-token");
    });

    it("falls back to a fresh popup when the reserved popup was closed by the user", () => {
        const closedPopup = {
            closed: true,
            location: { replace: vi.fn(), href: "" },
            document: { write: vi.fn(), close: vi.fn() },
            close: vi.fn(),
        };
        const freshPopup = {
            closed: false,
            location: { replace: vi.fn(), href: "" },
            document: { write: vi.fn(), close: vi.fn() },
            close: vi.fn(),
        };
        let openCallCount = 0;
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: { origin: "https://app.example.com", hash: "" },
            open: vi.fn(() => {
                openCallCount++;
                return openCallCount === 1 ? closedPopup : freshPopup;
            }),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(() => 1),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(() => 2),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();
        repo.connect("user@example.com");

        // The reserved popup is now "closed" (user dismissed it)
        repo.remoteStorage.authorize({
            authURL: "https://auth.example.com/oauth",
            clientId: "https://app.example.com",
            redirectUri: "https://app.example.com",
            scope: "setlist-roller:rw",
        });

        // Should have opened a fresh popup since the reserved one was closed
        expect(globalThis.window.open).toHaveBeenCalledTimes(2);
        // The fresh popup should NOT have location.replace called (it was opened with the auth URL directly)
        expect(freshPopup.location.replace).not.toHaveBeenCalled();
    });

    it("pre-opens a popup during standalone connect and reuses it for authorize", () => {
        const popup = {
            closed: false,
            location: {
                replace: vi.fn(),
                href: "",
            },
            document: {
                write: vi.fn(),
                close: vi.fn(),
            },
            close: vi.fn(),
        };
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: {
                origin: "https://app.example.com",
                hash: "",
            },
            open: vi.fn(() => popup),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(() => 1),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(() => 2),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();

        repo.connect("user@example.com");

        expect(globalThis.window.open).toHaveBeenCalledTimes(1);
        const [popupUrl, popupTarget, popupFeatures] = globalThis.window.open.mock.calls[0];
        expect(popupUrl).toBe("");
        expect(popupTarget).toBe("_blank");
        expect(popupFeatures).toContain("popup=yes");
        expect(popupFeatures).toContain("width=480");
        expect(popupFeatures).toContain("height=720");
        expect(remoteStorageMockState.instance.connect).toHaveBeenCalledWith("user@example.com", undefined);

        repo.remoteStorage.authorize({
            authURL: "https://auth.example.com/oauth",
        });

        expect(globalThis.window.open).toHaveBeenCalledTimes(1);
        expect(popup.location.replace).toHaveBeenCalledTimes(1);
        expect(popup.location.replace.mock.calls[0][0]).toContain("https://auth.example.com/oauth");
        expect(decodeURIComponent(popup.location.replace.mock.calls[0][0])).toContain(
            "redirect_uri=https://app.example.com/auth-relay.html",
        );
    });

    it("pre-opens a popup during tokenless switchTo and closes it on disconnect", () => {
        const reservedPopup = {
            closed: false,
            location: {
                replace: vi.fn(),
                href: "",
            },
            document: {
                write: vi.fn(),
                close: vi.fn(),
            },
            close: vi.fn(),
        };
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: {
                origin: "https://app.example.com",
                hash: "",
            },
            open: vi.fn(() => reservedPopup),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(() => 1),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(() => 2),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();

        repo.switchTo("other@example.com");

        expect(globalThis.window.open).toHaveBeenCalledTimes(1);
        expect(remoteStorageMockState.instance.remote.configure).toHaveBeenCalledWith({ token: null });
        expect(remoteStorageMockState.instance.connect).toHaveBeenCalledWith("other@example.com", undefined);

        repo.disconnect();

        expect(reservedPopup.close).toHaveBeenCalledTimes(1);
        expect(remoteStorageMockState.instance.caching.reset).toHaveBeenCalledTimes(1);
        expect(remoteStorageMockState.instance.disconnect).toHaveBeenCalledTimes(1);
    });
});
