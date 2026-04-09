import { describe, expect, it, vi } from "vitest";
import {
    authorizeWithStandalonePopup,
    buildAuthorizeUrl,
    createStandaloneAuthMessageHandler,
    isIosStandaloneAuthContext,
} from "./remotestorage.js";

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
