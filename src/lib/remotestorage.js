import RemoteStorage from "remotestoragejs";
import { createDefaultAppConfig, normalizeAppConfig, normalizeSongRecord, sortSongs } from "./defaults.js";
import { clone, nowIso } from "./utils.js";

const APP_SCOPE = "setlist-roller";
const TYPES = {
    song: "setlist-roller-song",
    preset: "setlist-roller-preset",
    config: "setlist-roller-config",
    meta: "setlist-roller-meta",
    setlist: "setlist-roller-setlist",
    member: "setlist-roller-member",
};

const OBJECT_SCHEMA = {
    type: "object",
    additionalProperties: true,
};

const AUTH_MESSAGE_TYPE = "setlist-roller-auth-result";
const AUTH_POPUP_TIMEOUT_MS = 180000;

function isIosStandaloneAuthContext() {
    if (typeof window === "undefined") return false;
    const displayStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    const legacyStandalone = window.navigator?.standalone === true;
    if (!displayStandalone && !legacyStandalone) return false;
    const ua = window.navigator?.userAgent || "";
    const isiPadLike = window.navigator?.platform === "MacIntel" && window.navigator?.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || isiPadLike;
}

function buildAuthorizeUrl(options) {
    const redirect = new URL(options.redirectUri);
    const state = options.state ?? (redirect.hash ? redirect.hash.substring(1) : "");
    const responseType = options.response_type || "token";
    const url = new URL(options.authURL);
    url.searchParams.set("redirect_uri", options.redirectUri.replace(/#.*$/, ""));
    url.searchParams.set("scope", options.scope);
    url.searchParams.set("client_id", options.clientId);
    for (const [key, value] of Object.entries({
        state,
        response_type: responseType,
        code_challenge: options.code_challenge,
        code_challenge_method: options.code_challenge_method,
        token_access_type: options.token_access_type,
    })) {
        if (value) url.searchParams.set(key, value);
    }
    return url.toString();
}

function authorizeWithStandalonePopup(remoteStorage, options) {
    if (typeof window === "undefined") {
        throw new Error("Standalone authorization requires a browser window.");
    }

    const attemptId = globalThis.crypto?.randomUUID?.() || `auth-${Date.now()}`;
    const redirectUri = `${window.location.origin}/auth-relay.html?attempt=${encodeURIComponent(attemptId)}`;
    const authUrl = buildAuthorizeUrl({
        ...options,
        redirectUri,
        clientId: options.clientId || window.location.origin,
    });

    const popup = window.open(authUrl, "_blank", "popup=yes,width=480,height=720");
    if (!popup) {
        throw new Error("Authorization popup was blocked.");
    }

    let finished = false;
    let closePoll = null;
    let timeoutId = null;

    const cleanup = () => {
        window.removeEventListener("message", onMessage);
        if (closePoll) window.clearInterval(closePoll);
        if (timeoutId) window.clearTimeout(timeoutId);
    };

    const fail = (message) => {
        if (finished) return;
        finished = true;
        cleanup();
        remoteStorage._emit("error", new Error(message));
    };

    const onMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        const payload = event.data;
        if (payload?.type !== AUTH_MESSAGE_TYPE || payload?.attemptId !== attemptId) return;

        finished = true;
        cleanup();

        const params = payload.params || {};
        if (params.error) {
            remoteStorage._emit("error", new Error(`Authorization failed: ${params.error}`));
            return;
        }
        if (!params.access_token) {
            remoteStorage._emit("error", new Error("Authorization did not return an access token."));
            return;
        }

        remoteStorage.remote.configure({ token: params.access_token });
        if (params.state) {
            window.location.hash = params.state;
        }
    };

    window.addEventListener("message", onMessage);

    closePoll = window.setInterval(() => {
        if (!popup.closed || finished) return;
        fail("Authorization window was closed before login finished.");
    }, 500);

    timeoutId = window.setTimeout(() => {
        fail("Authorization timed out before the app received a token.");
    }, AUTH_POPUP_TIMEOUT_MS);
}

export function createRemoteStorageRepository() {
    const remoteStorage = new RemoteStorage({
        changeEvents: {
            local: true,
            remote: true,
            conflict: true,
            window: false,
        },
        logging: false,
    });

    remoteStorage.access.claim(APP_SCOPE, "rw");
    remoteStorage.caching.enable(`/${APP_SCOPE}/`);

    const client = remoteStorage.scope(`/${APP_SCOPE}/`);
    client.declareType(TYPES.song, OBJECT_SCHEMA);
    client.declareType(TYPES.preset, OBJECT_SCHEMA);
    client.declareType(TYPES.config, OBJECT_SCHEMA);
    client.declareType(TYPES.meta, OBJECT_SCHEMA);
    client.declareType(TYPES.setlist, OBJECT_SCHEMA);
    client.declareType(TYPES.member, OBJECT_SCHEMA);

    const defaultAuthorize = remoteStorage.authorize.bind(remoteStorage);
    remoteStorage.authorize = (options) => {
        if (isIosStandaloneAuthContext()) {
            try {
                remoteStorage.access.setStorageType(remoteStorage.remote.storageApi);
                if (typeof options.scope === "undefined") {
                    options.scope = remoteStorage.access.scopeParameter;
                }
                authorizeWithStandalonePopup(remoteStorage, options);
            } catch (error) {
                remoteStorage._emit("error", error instanceof Error ? error : new Error(String(error)));
            }
            return;
        }
        defaultAuthorize(options);
    };

    return {
        remoteStorage,
        client,

        connect(userAddress, token) {
            // Re-enable caching in case it was reset by a previous disconnect
            remoteStorage.caching.enable(`/${APP_SCOPE}/`);
            remoteStorage.connect(userAddress, token);
        },

        disconnect() {
            // Reset the local cache before disconnecting to prevent data leaking to the next account
            remoteStorage.caching.reset();
            remoteStorage.disconnect();
        },

        /**
         * Switch to a different account without destroying IndexedDB.
         * Works like a page refresh — just reconfigures credentials and reconnects.
         */
        switchTo(userAddress, token) {
            // Clear current connection without full disconnect cleanup
            remoteStorage.remote.configure({ token: null });
            remoteStorage.remote.connected = false;
            // Re-enable caching and connect to new account
            remoteStorage.caching.enable(`/${APP_SCOPE}/`);
            remoteStorage.connect(userAddress, token || undefined);
        },

        async sync() {
            if (!remoteStorage.connected) {
                return;
            }
            await remoteStorage.startSync();
        },

        /**
         * Wait until remote data has actually arrived in the local cache.
         * Resolves after a sync-done fires with no remaining tasks (meaning
         * all rounds are complete), or after a safety timeout.
         */
        syncAndWait() {
            return new Promise((resolve) => {
                const timeout = setTimeout(cleanup, 15000);
                function cleanup() {
                    clearTimeout(timeout);
                    remoteStorage.removeEventListener("sync-done", handler);
                    resolve();
                }
                function handler(e) {
                    // sync-done with completed=true means all rounds finished
                    if (e?.completed) {
                        cleanup();
                    }
                    // else: more rounds pending, keep waiting
                }
                remoteStorage.on("sync-done", handler);
            });
        },

        on(eventName, handler) {
            remoteStorage.on(eventName, handler);
            return () => remoteStorage.removeEventListener(eventName, handler);
        },

        onChange(handler) {
            client.on("change", handler);
            return () => client.removeEventListener("change", handler);
        },

        isConnected() {
            return remoteStorage.connected;
        },

        getUserAddress() {
            return remoteStorage.remote?.userAddress || "";
        },

        getToken() {
            return remoteStorage.remote?.token || "";
        },

        async loadAll({ onStep } = {}) {
            onStep?.("Loading songs");
            const songs = await this.listSongs();
            onStep?.(`Loaded ${songs.length} songs`);

            onStep?.("Loading settings");
            const config = await this.getConfig();
            onStep?.(config ? "Loaded settings" : "No settings found yet");

            onStep?.("Loading bootstrap info");
            const bootstrap = await this.getBootstrapMeta();
            onStep?.(bootstrap ? "Loaded bootstrap info" : "No bootstrap info found");

            onStep?.("Loading saved setlists");
            const setlists = await this.listSetlists();
            onStep?.(`Loaded ${setlists.length} saved setlists`);

            onStep?.("Loading band members");
            const members = await this.listMembers();
            onStep?.(`Loaded ${Object.keys(members || {}).length} band members`);

            return { songs, config, bootstrap, setlists, members };
        },

        async listSongs() {
            const items = await client.getAll("songs/", false);
            return sortSongs(Object.values(items || {}).map((song) => normalizeSongRecord(song)));
        },

        async putSong(song) {
            const normalized = normalizeSongRecord({
                ...clone(song),
                updatedAt: nowIso(),
            });
            await client.storeObject(TYPES.song, `songs/${normalized.id}`, normalized);
            return normalized;
        },

        async deleteSong(songId) {
            await client.remove(`songs/${songId}`);
        },

        async deleteConfig() {
            await client.remove("settings/app-config");
        },

        async getConfig() {
            const result = await client.getObject("settings/app-config");
            return normalizeAppConfig(result);
        },

        async getRawConfig() {
            return await client.getObject("settings/app-config");
        },

        async ensureConfig(bandName) {
            const existing = await this.getConfig();
            if (existing) {
                return existing;
            }

            const config = createDefaultAppConfig({ bandName });
            await this.putConfig(config);
            return config;
        },

        async putConfig(config) {
            const normalized = normalizeAppConfig({
                ...clone(config),
                updatedAt: nowIso(),
            });
            await client.storeObject(TYPES.config, "settings/app-config", normalized);
            return normalized;
        },

        async getBootstrapMeta() {
            const result = await client.getObject("meta/bootstrap");
            return result || null;
        },

        async putBootstrapMeta(meta) {
            const nextMeta = {
                ...clone(meta),
                updatedAt: nowIso(),
            };
            await client.storeObject(TYPES.meta, "meta/bootstrap", nextMeta);
            return nextMeta;
        },

        // ---- setlists ----
        async listSetlists() {
            const items = await client.getAll("setlists/", false);
            return Object.values(items || {}).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
        },

        async putSetlist(setlist) {
            const doc = { ...clone(setlist), updatedAt: nowIso() };
            await client.storeObject(TYPES.setlist, `setlists/${doc.id}`, doc);
            return doc;
        },

        async deleteSetlist(setlistId) {
            await client.remove(`setlists/${setlistId}`);
        },

        // ---- members ----
        async listMembers() {
            const items = await client.getAll("members/", false);
            const result = {};
            for (const [key, value] of Object.entries(items || {})) {
                result[value.name || key] = value;
            }
            return result;
        },

        async putMember(name, data) {
            const doc = { ...clone(data), name, updatedAt: nowIso() };
            await client.storeObject(TYPES.member, `members/${name}`, doc);
            return doc;
        },

        async deleteMember(name) {
            await client.remove(`members/${name}`);
        },
    };
}
