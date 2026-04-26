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
const AUTH_POPUP_FEATURES = "popup=yes,width=480,height=720";
const STANDALONE_AUTH_FAILURE_MESSAGE =
    "Authorization did not start correctly in the installed app. If iOS opened login in Safari, close it and retry, or sign in via Safari instead of the home-screen app.";
const REMOTE_STORAGE_EVENTS = new Set([
    "ready",
    "authing",
    "connecting",
    "connected",
    "disconnected",
    "not-connected",
    "conflict",
    "error",
    "features-loaded",
    "sync-interval-change",
    "sync-started",
    "sync-req-done",
    "sync-done",
    "wire-busy",
    "wire-done",
    "network-offline",
    "network-online",
]);

export function isIosStandaloneAuthContext(env = globalThis.window) {
    if (!env) return false;
    const displayStandalone = env.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
    const legacyStandalone = env.navigator?.standalone === true;
    if (!displayStandalone && !legacyStandalone) return false;
    const ua = env.navigator?.userAgent || "";
    const isiPadLike = env.navigator?.platform === "MacIntel" && env.navigator?.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || isiPadLike;
}

export function buildAuthorizeUrl(options) {
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

export function normalizeStandaloneAuthorizeOptions(options, env = globalThis.window) {
    const authorizeOptions = { ...(options ?? {}) };
    if (typeof authorizeOptions.scope !== "string" || authorizeOptions.scope.trim() === "") {
        throw new Error("Cannot authorize due to undefined or empty scope; did you forget to access.claim()?");
    }
    if (typeof authorizeOptions.redirectUri === "undefined") {
        if (!env?.location?.origin) {
            throw new Error("Standalone authorization requires a browser location.");
        }
        let redirectUri = env.location.origin;
        if (env.location.pathname) {
            redirectUri += env.location.pathname;
        }
        authorizeOptions.redirectUri = redirectUri;
    }
    if (typeof authorizeOptions.clientId === "undefined") {
        authorizeOptions.clientId = new URL(authorizeOptions.redirectUri).origin;
    }
    return authorizeOptions;
}

function normalizeBearerToken(token) {
    return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function createStandaloneAuthMessageHandler({ attemptId, origin, onSuccess, onError }) {
    return (event) => {
        if (event.origin !== origin) return false;
        const payload = event.data;
        if (payload?.type !== AUTH_MESSAGE_TYPE || payload?.attemptId !== attemptId) return false;

        const params = payload.params || {};
        if (params.error) {
            onError(new Error(`Authorization failed: ${params.error}`));
            return true;
        }
        if (!params.access_token) {
            onError(new Error("Authorization did not return an access token."));
            return true;
        }

        onSuccess({
            accessToken: params.access_token,
            state: params.state || "",
        });
        return true;
    };
}

export function authorizeWithStandalonePopup(
    remoteStorage,
    options,
    {
        env = globalThis.window,
        popup: providedPopup = null,
        emitError = (error) => {
            throw error;
        },
    } = {},
) {
    if (!env) {
        throw new Error("Standalone authorization requires a browser window.");
    }

    const attemptId = globalThis.crypto?.randomUUID?.() || `auth-${Date.now()}`;
    const redirectUri = `${env.location.origin}/auth-relay.html?attempt=${encodeURIComponent(attemptId)}`;
    const authUrl = buildAuthorizeUrl({
        ...options,
        redirectUri,
        clientId: options.clientId || env.location.origin,
    });

    const popup =
        providedPopup && !providedPopup.closed ? providedPopup : env.open(authUrl, "_blank", AUTH_POPUP_FEATURES);
    if (!popup) {
        throw new Error("Authorization popup was blocked.");
    }
    if (popup === providedPopup) {
        try {
            popup.location.replace(authUrl);
        } catch {
            popup.location.href = authUrl;
        }
    }

    let finished = false;
    let closePoll = null;
    let timeoutId = null;

    const cleanup = () => {
        env.removeEventListener("message", onMessage);
        if (closePoll) env.clearInterval(closePoll);
        if (timeoutId) env.clearTimeout(timeoutId);
    };

    const fail = (message) => {
        if (finished) return;
        finished = true;
        cleanup();
        emitError(new Error(message));
    };

    const onMessage = createStandaloneAuthMessageHandler({
        attemptId,
        origin: env.location.origin,
        onSuccess: ({ accessToken, state }) => {
            if (finished) return;
            finished = true;
            cleanup();
            remoteStorage.remote.configure({ token: accessToken });
            if (state) {
                env.location.hash = state;
            }
        },
        onError: (error) => {
            if (finished) return;
            finished = true;
            cleanup();
            emitError(error);
        },
    });

    env.addEventListener("message", onMessage);

    closePoll = env.setInterval(() => {
        if (!popup.closed || finished) return;
        fail("Authorization window was closed before login finished.");
    }, 500);

    timeoutId = env.setTimeout(() => {
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
        // rs.js drains its task queue per cycle and waits `syncInterval` ms
        // between cycles. Initial bootstrap typically spans 3 cycles (root
        // listing → folder listings → bodies), so the default 10 000 ms
        // makes a fresh account feel "loaded" only after ~30 s. Start at the
        // library's minimum (2 000 ms) for snappy bootstrap; the app bumps
        // this back up to a calmer 10 000 ms once the first sync settles —
        // see `BOOTSTRAP_SYNC_INTERVAL_MS` / `STEADY_SYNC_INTERVAL_MS` in
        // app.svelte.js.
        syncInterval: 2000,
    });

    const localEventHandlers = new Map();
    function emitLocal(eventName, payload) {
        const handlers = localEventHandlers.get(eventName);
        if (!handlers) return;
        for (const handler of handlers) {
            handler(payload);
        }
    }

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
                const authorizeOptions = normalizeStandaloneAuthorizeOptions({
                    ...(options ?? {}),
                    scope: options?.scope ?? remoteStorage.access.scopeParameter,
                });
                emitLocal("standalone-auth-redirect", {
                    userAddress: remoteStorage.remote?.userAddress || "",
                    redirectUri: authorizeOptions.redirectUri,
                });
                defaultAuthorize(authorizeOptions);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                emitLocal("error", new Error(`${STANDALONE_AUTH_FAILURE_MESSAGE} ${reason}`));
            }
            return;
        }
        defaultAuthorize(options);
    };

    /**
     * After a disconnect, rs.js's `Sync._rs_cleanup` nulls
     * `remoteStorage.sync` but does NOT clear `caching.activateHandler` —
     * which still references the dead Sync's lambda. If we then call
     * `caching.enable(path)`, `set()` finds the (stale) handler set and
     * calls it directly, so the path is NOT pushed to `pendingActivations`.
     * When the new Sync is constructed (on the next `ready` event), its
     * `caching.onActivate(newCb)` overwrites the handler but finds
     * `pendingActivations` empty — so the new Sync never receives the
     * path activation, never queues a root task, and `forAllNodes`-based
     * fallbacks (`collectDiffTasks`, `collectRefreshTasks`) find nothing
     * because `IndexedDB._rs_cleanup` already deleted the local DB.
     *
     * Net effect: after an account swap, rs.js completes sync rounds
     * without ever fetching the scope folder — songs never appear until
     * the page is reloaded (which constructs a fresh Sync from a clean
     * caching state). Clearing the handler restores the documented
     * `enable → pendingActivations → new Sync's onActivate` flow.
     */
    function resetActivateHandler() {
        remoteStorage.caching.activateHandler = undefined;
        remoteStorage.caching.pendingActivations = [];
    }

    return {
        remoteStorage,
        client,

        connect(userAddress, token) {
            const normalizedToken = normalizeBearerToken(token);
            // Re-enable caching in case it was reset by a previous disconnect.
            // Clear the stale activate handler first — see resetActivateHandler.
            resetActivateHandler();
            remoteStorage.caching.enable(`/${APP_SCOPE}/`);
            remoteStorage.connect(userAddress, normalizedToken);
        },

        disconnect() {
            // Reset the local cache before disconnecting to prevent data leaking to the next account
            remoteStorage.caching.reset();
            remoteStorage.disconnect();
        },

        /**
         * Switch to a different account: disconnect cleanly, reset the local
         * cache so the previous account's data can't leak, then connect.
         * Resolves once `connect()` has been issued — callers should still
         * wait for the `connected` event for sync.
         *
         * Avoids mutating rs.js internals beyond the documented
         * disconnect → connect lifecycle, with one exception:
         * `caching.activateHandler` is cleared before re-enabling — see
         * resetActivateHandler for the rationale.
         */
        async swap(userAddress, token) {
            if (remoteStorage.connected) {
                await new Promise((resolve) => {
                    let settled = false;
                    const finish = () => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        remoteStorage.removeEventListener("disconnected", handler);
                        resolve();
                    };
                    const handler = () => finish();
                    // Safety net: if rs.js never fires `disconnected` (already
                    // mid-disconnect, library hiccup), don't strand the user.
                    const timer = setTimeout(finish, 3000);
                    remoteStorage.on("disconnected", handler);
                    remoteStorage.caching.reset();
                    remoteStorage.disconnect();
                });
            }
            // The OLD Sync's activate handler must be cleared before
            // enable() — otherwise the path activation goes to the dead
            // handler and the new Sync never queues any tasks.
            resetActivateHandler();
            remoteStorage.caching.enable(`/${APP_SCOPE}/`);
            remoteStorage.connect(userAddress, normalizeBearerToken(token));
        },

        async sync() {
            if (!remoteStorage.connected) {
                return;
            }
            await remoteStorage.startSync();
        },

        /**
         * Read/adjust rs.js's foreground sync polling interval. The library
         * enforces 2000–3 600 000 ms; setSyncInterval throws outside that.
         */
        getSyncInterval() {
            return remoteStorage.getSyncInterval();
        },
        setSyncInterval(ms) {
            remoteStorage.setSyncInterval(ms);
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
            if (REMOTE_STORAGE_EVENTS.has(eventName)) {
                remoteStorage.on(eventName, handler);
            }
            if (!localEventHandlers.has(eventName)) {
                localEventHandlers.set(eventName, new Set());
            }
            localEventHandlers.get(eventName).add(handler);
            return () => {
                if (REMOTE_STORAGE_EVENTS.has(eventName)) {
                    remoteStorage.removeEventListener(eventName, handler);
                }
                localEventHandlers.get(eventName)?.delete(handler);
            };
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
            const songsPromise = this.listSongs().then((result) => {
                onStep?.(`Loaded ${result.songs.length} songs${result.pending ? ` (${result.pending} pending)` : ""}`);
                return result;
            });

            onStep?.("Loading settings");
            const configPromise = this.getConfig().then((config) => {
                onStep?.(config ? "Loaded settings" : "No settings found yet");
                return config;
            });

            onStep?.("Loading bootstrap info");
            const bootstrapPromise = this.getBootstrapMeta().then((bootstrap) => {
                onStep?.(bootstrap ? "Loaded bootstrap info" : "No bootstrap info found");
                return bootstrap;
            });

            onStep?.("Loading saved setlists");
            const setlistsPromise = this.listSetlists().then((result) => {
                onStep?.(
                    `Loaded ${result.setlists.length} saved setlists${result.pending ? ` (${result.pending} pending)` : ""}`,
                );
                return result;
            });

            onStep?.("Loading band members");
            const membersPromise = this.listMembers().then((result) => {
                onStep?.(
                    `Loaded ${Object.keys(result.members || {}).length} band members${result.pending ? ` (${result.pending} pending)` : ""}`,
                );
                return result;
            });

            const [songsResult, config, bootstrap, setlistsResult, membersResult] = await Promise.all([
                songsPromise,
                configPromise,
                bootstrapPromise,
                setlistsPromise,
                membersPromise,
            ]);

            // pendingBodies: total documents whose bodies haven't yet arrived
            // from the remote. rs.js's getAll(path, false) returns stub
            // entries (`true` / `{}` / object without id) for items it knows
            // exist (folder ETag) but whose bodies are not yet in the local
            // cache. As long as this is > 0, more onChange events will fire
            // and the UI is not yet in a settled state.
            const pendingBodies =
                (songsResult.pending || 0) + (setlistsResult.pending || 0) + (membersResult.pending || 0);

            return {
                songs: songsResult.songs,
                config,
                bootstrap,
                setlists: setlistsResult.setlists,
                members: membersResult.members,
                pendingBodies,
            };
        },

        async listSongs() {
            const items = await client.getAll("songs/", false);
            const all = Object.values(items || {});
            const records = [];
            let pending = 0;
            for (const item of all) {
                if (item && typeof item === "object" && item.id) {
                    records.push(item);
                } else {
                    pending += 1;
                }
            }
            return {
                songs: sortSongs(records.map((song) => normalizeSongRecord(song))),
                pending,
            };
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
            // Same stub-tolerant treatment as listSongs. Setlists must have a
            // `savedAt` to sort; missing/non-object entries are pending bodies.
            const all = Object.values(items || {});
            const records = [];
            let pending = 0;
            for (const item of all) {
                if (item && typeof item === "object" && item.savedAt) {
                    records.push(item);
                } else {
                    pending += 1;
                }
            }
            records.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
            return { setlists: records, pending };
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
            // A real member doc has `name`; stubs / empty placeholders count
            // as pending bodies and surface in the sync indicator.
            const result = {};
            let pending = 0;
            for (const [key, value] of Object.entries(items || {})) {
                if (value && typeof value === "object" && value.name) {
                    result[value.name || key] = value;
                } else {
                    pending += 1;
                }
            }
            return { members: result, pending };
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
