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
            // Mirror the rs.js Caching public API used by repo's swap/connect
            // flow. Tests assert these get cleared so that `enable()` routes
            // its path through `pendingActivations` for the new Sync to pick
            // up — see resetActivateHandler in remotestorage.js.
            activateHandler: undefined,
            pendingActivations: [],
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
    it("delegates standalone auth to the library redirect flow with the app URL", () => {
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
                pathname: "/app",
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
        const redirectHandler = vi.fn();

        repo.on("standalone-auth-redirect", redirectHandler);

        expect(() =>
            repo.remoteStorage.authorize({
                authURL: "https://auth.example.com/oauth",
            }),
        ).not.toThrow();
        expect(remoteStorageMockState.instance.access.setStorageType).toHaveBeenCalledWith("webdav");
        expect(remoteStorageMockState.defaultAuthorize).toHaveBeenCalledTimes(1);
        expect(remoteStorageMockState.defaultAuthorize).toHaveBeenCalledWith({
            authURL: "https://auth.example.com/oauth",
            scope: "setlist-roller:rw",
            redirectUri: "https://app.example.com/app",
            clientId: "https://app.example.com",
        });
        expect(globalThis.window.open).not.toHaveBeenCalled();
        expect(redirectHandler).toHaveBeenCalledWith({
            userAddress: "",
            redirectUri: "https://app.example.com/app",
        });
    });

    it("surfaces standalone authorization startup failures with a specific message", () => {
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
                pathname: "/",
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
        remoteStorageMockState.defaultAuthorize.mockImplementation(() => {
            throw new Error("Missing auth URL");
        });

        const repo = createRemoteStorageRepository();
        const errorHandler = vi.fn();

        repo.on("error", errorHandler);

        expect(() => repo.remoteStorage.authorize()).not.toThrow();
        expect(remoteStorageMockState.instance.access.setStorageType).toHaveBeenCalledWith("webdav");
        expect(remoteStorageMockState.defaultAuthorize).toHaveBeenCalledTimes(1);
        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(errorHandler.mock.calls[0][0].message).toContain("installed app");
        expect(errorHandler.mock.calls[0][0].message).toContain("Missing auth URL");
    });

    it("connects in standalone mode without pre-opening a popup", () => {
        globalThis.window = {
            matchMedia: vi.fn(() => ({ matches: true })),
            navigator: {
                standalone: true,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
                platform: "iPhone",
                maxTouchPoints: 5,
            },
            location: { origin: "https://app.example.com", pathname: "/", hash: "" },
            open: vi.fn(() => null),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            setInterval: vi.fn(),
            clearInterval: vi.fn(),
            setTimeout: vi.fn(),
            clearTimeout: vi.fn(),
        };

        const repo = createRemoteStorageRepository();
        repo.connect("user@example.com");
        expect(globalThis.window.open).not.toHaveBeenCalled();
        expect(remoteStorageMockState.instance.connect).toHaveBeenCalledWith("user@example.com", undefined);
    });

    it("ignores non-string connect tokens", () => {
        const repo = createRemoteStorageRepository();
        repo.connect("user@example.com", { type: "click" });
        expect(remoteStorageMockState.instance.connect).toHaveBeenCalledWith("user@example.com", undefined);
    });

    describe("swap", () => {
        it("connects directly when no prior connection exists", async () => {
            const repo = createRemoteStorageRepository();
            const rs = remoteStorageMockState.instance;
            rs.connected = false;

            await repo.swap("other@example.com", "tok-2");

            expect(rs.disconnect).not.toHaveBeenCalled();
            expect(rs.caching.reset).not.toHaveBeenCalled();
            expect(rs.caching.enable).toHaveBeenCalledWith("/setlist-roller/");
            expect(rs.connect).toHaveBeenCalledWith("other@example.com", "tok-2");
        });

        it("disconnects, resets the cache, then connects when a prior connection exists", async () => {
            const repo = createRemoteStorageRepository();
            const rs = remoteStorageMockState.instance;
            rs.connected = true;

            // Capture the order of operations so we can assert disconnect →
            // resetCache → connect happens in sequence (no library-internal
            // mutations slipped in between).
            const order = [];
            rs.caching.reset.mockImplementation(() => order.push("reset"));
            rs.disconnect.mockImplementation(() => order.push("disconnect"));
            rs.connect.mockImplementation(() => order.push("connect"));

            // Capture the `disconnected` listener so we can fire it.
            let disconnectedHandler;
            rs.on.mockImplementation((event, handler) => {
                if (event === "disconnected") disconnectedHandler = handler;
            });

            const swapPromise = repo.swap("other@example.com", "tok-2");

            // swap() registers the listener and triggers disconnect(), but
            // doesn't proceed to connect() until `disconnected` fires.
            expect(rs.on).toHaveBeenCalledWith("disconnected", expect.any(Function));
            expect(disconnectedHandler).toBeTypeOf("function");
            expect(rs.connect).not.toHaveBeenCalled();

            disconnectedHandler();
            await swapPromise;

            expect(rs.removeEventListener).toHaveBeenCalledWith("disconnected", disconnectedHandler);
            expect(order).toEqual(["reset", "disconnect", "connect"]);
            expect(rs.caching.enable).toHaveBeenLastCalledWith("/setlist-roller/");
            expect(rs.connect).toHaveBeenCalledWith("other@example.com", "tok-2");
        });

        it("does not mutate the rs.js `remote.connected` flag", async () => {
            const repo = createRemoteStorageRepository();
            const rs = remoteStorageMockState.instance;
            rs.connected = true;

            // Make `remote.connected` a getter so any assignment would throw.
            const guard = vi.fn();
            Object.defineProperty(rs.remote, "connected", {
                configurable: true,
                get: () => true,
                set: guard,
            });

            let disconnectedHandler;
            rs.on.mockImplementation((event, handler) => {
                if (event === "disconnected") disconnectedHandler = handler;
            });

            const swapPromise = repo.swap("other@example.com", "tok-2");
            disconnectedHandler();
            await swapPromise;

            expect(guard).not.toHaveBeenCalled();
        });

        it("normalizes non-string tokens to undefined", async () => {
            const repo = createRemoteStorageRepository();
            const rs = remoteStorageMockState.instance;
            rs.connected = false;
            await repo.swap("other@example.com", { type: "click" });
            expect(rs.connect).toHaveBeenCalledWith("other@example.com", undefined);
        });

        it("clears the stale caching.activateHandler before re-enabling", async () => {
            // Regression: rs.js's Sync._rs_cleanup leaves
            // caching.activateHandler pointing at the dead Sync's lambda. If
            // we don't clear it, enable() routes the path to that defunct
            // handler instead of pendingActivations, and the new Sync never
            // queues any sync tasks — the next account's data never loads
            // until the page is reloaded.
            const repo = createRemoteStorageRepository();
            const rs = remoteStorageMockState.instance;
            rs.connected = true;

            const staleHandler = vi.fn();
            rs.caching.activateHandler = staleHandler;
            rs.caching.pendingActivations = ["/setlist-roller/"];

            // Capture the state of caching at the moment enable() is called —
            // it must already be cleared by then.
            let handlerAtEnable;
            let pendingAtEnable;
            rs.caching.enable.mockImplementation(() => {
                handlerAtEnable = rs.caching.activateHandler;
                pendingAtEnable = rs.caching.pendingActivations;
            });

            let disconnectedHandler;
            rs.on.mockImplementation((event, handler) => {
                if (event === "disconnected") disconnectedHandler = handler;
            });

            const swapPromise = repo.swap("other@example.com", "tok-2");
            disconnectedHandler();
            await swapPromise;

            expect(handlerAtEnable).toBeUndefined();
            expect(pendingAtEnable).toEqual([]);
            expect(staleHandler).not.toHaveBeenCalled();
        });

        it("clears caching.activateHandler on direct connect too", () => {
            // Same regression as the swap path: a connect after disconnect
            // (without an explicit swap) hits the same stale-handler hazard.
            const repo = createRemoteStorageRepository();
            const rs = remoteStorageMockState.instance;
            const staleHandler = vi.fn();
            rs.caching.activateHandler = staleHandler;
            rs.caching.pendingActivations = ["/setlist-roller/"];

            let handlerAtEnable;
            rs.caching.enable.mockImplementation(() => {
                handlerAtEnable = rs.caching.activateHandler;
            });

            repo.connect("user@example.com", "tok");

            expect(handlerAtEnable).toBeUndefined();
            expect(staleHandler).not.toHaveBeenCalled();
        });
    });
});
