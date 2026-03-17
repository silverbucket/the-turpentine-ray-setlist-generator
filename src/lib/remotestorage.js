import RemoteStorage from "remotestoragejs";
import {
    createDefaultAppConfig,
    normalizeAppConfig,
    normalizeSongRecord,
    sortSongs
} from "./defaults.js";
import { clone, nowIso } from "./utils.js";

const APP_SCOPE = "setlist-roller";
const TYPES = {
    song: "setlist-roller-song",
    preset: "setlist-roller-preset",
    config: "setlist-roller-config",
    meta: "setlist-roller-meta",
    setlist: "setlist-roller-setlist",
    member: "setlist-roller-member"
};

const OBJECT_SCHEMA = {
    type: "object",
    additionalProperties: true
};


export function createRemoteStorageRepository() {
    const remoteStorage = new RemoteStorage({
        changeEvents: {
            local: true,
            remote: true,
            conflict: true,
            window: false
        },
        logging: false
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

    return {
        remoteStorage,
        client,

        connect(userAddress) {
            // Re-enable caching in case it was reset by a previous disconnect
            remoteStorage.caching.enable(`/${APP_SCOPE}/`);
            remoteStorage.connect(userAddress);
        },

        disconnect() {
            // Reset the local cache before disconnecting to prevent data leaking to the next account
            remoteStorage.caching.reset();
            remoteStorage.disconnect();
        },

        async sync() {
            if (!remoteStorage.connected) {
                return;
            }
            await remoteStorage.startSync();
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

        hasStoredCredentials() {
            return !!remoteStorage.remote?.token || remoteStorage.connected;
        },

        getUserAddress() {
            return remoteStorage.remote?.userAddress || "";
        },

        async loadAll() {
            const [songs, config, bootstrap, setlists, members] = await Promise.all([
                this.listSongs(),
                this.getConfig(),
                this.getBootstrapMeta(),
                this.listSetlists(),
                this.listMembers()
            ]);

            return { songs, config, bootstrap, setlists, members };
        },

        async listSongs() {
            const items = await client.getAll("songs/", false);
            return sortSongs(Object.values(items || {}).map((song) => normalizeSongRecord(song)));
        },

        async putSong(song) {
            const normalized = normalizeSongRecord({
                ...clone(song),
                updatedAt: nowIso()
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
                updatedAt: nowIso()
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
                updatedAt: nowIso()
            };
            await client.storeObject(TYPES.meta, "meta/bootstrap", nextMeta);
            return nextMeta;
        },

        // ---- setlists ----
        async listSetlists() {
            const items = await client.getAll("setlists/", false);
            return Object.values(items || {})
                .sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
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
        }
    };
}
