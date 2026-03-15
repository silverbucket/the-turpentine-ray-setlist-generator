import bundledConfig from "../../config.json";
import bundledSongs from "../../songs.json";
import { clone, deepMerge, nowIso, sortByName, uid } from "./utils.js";

export const SCHEMA_VERSION = 1;

const DEFAULT_CONFIG_TEMPLATE = {
    general: {
        count: 15,
        beamWidth: 512,
        limits: {
            covers: 2,
            instrumentals: 2
        },
        order: {
            first: [
                ["energy", [1, 2]],
                ["cover", false],
                ["instrumental", false]
            ],
            second: [
                ["energy", 2],
                ["cover", false],
                ["instrumental", false]
            ],
            penultimate: [
                ["energy", [2, 3]]
            ],
            last: [
                ["energy", 3]
            ]
        },
        weighting: {
            tuning: 5,
            capo: 2,
            instrument: 3,
            picking: 1,
            positionMiss: 8,
            energyTarget: 3,
            repeatEnergy: 2,
            energyStreak: 4,
            bigEnergyJump: 3,
            earlyCover: 6,
            earlyInstrumental: 4
        },
        randomness: {
            variantJitter: 1.5,
            stateJitter: 1,
            finalChoicePool: 12,
            temperature: 0.85,
            shuffleCatalog: true,
            songBias: 3,
            beamChoicePoolMultiplier: 6,
            beamTemperature: 1.1,
            maxStatesPerLastSong: 24,
            blockShuffleTemperature: 1.4
        }
    },
    show: {
        members: {}
    },
    props: {
        tuning: {
            kind: "instrumentField",
            field: "tuning",
            summaryLabel: "tuning changes",
            minStreak: 3,
            allowChangeOnLastSong: true
        },
        capo: {
            kind: "instrumentDelta",
            field: "capo",
            summaryLabel: "capo steps",
            minStreak: 2,
            allowChangeOnLastSong: true
        },
        instruments: {
            kind: "instrumentSet",
            weightKey: "instrument",
            summaryLabel: "instrument swaps",
            minStreak: 2,
            allowChangeOnLastSong: true,
            mutuallyExclusive: []
        },
        picking: {
            kind: "instrumentBoolean",
            field: "picking",
            summaryLabel: "picking changes",
            minStreak: 2,
            allowChangeOnLastSong: true
        }
    },
    band: {
        members: {}
    },
    catalog: {
        tunings: [],
        tuningsByInstrument: {}
    }
};

export const BUNDLED_SONGS = bundledSongs.map((song) => normalizeSongRecord(song));
export const BUNDLED_CONFIG = createDefaultAppConfig({
    bandName: "",
    seedConfig: bundledConfig
});
export const DEFAULT_APP_CONFIG = createDefaultAppConfig();

function normalizeCatalogConfig(seedConfig = {}) {
    return {
        tunings: Array.isArray(seedConfig.catalog?.tunings)
            ? seedConfig.catalog.tunings.slice()
            : [],
        tuningsByInstrument: clone(seedConfig.catalog?.tuningsByInstrument || {})
    };
}

function normalizeBandMembers(seedMembers = {}) {
    return Object.entries(seedMembers || {}).reduce((result, [memberName, memberConfig]) => {
        const instruments = Array.isArray(memberConfig?.instruments)
            ? memberConfig.instruments.map((instrument) => {
                if (typeof instrument === "string") {
                    return {
                        name: instrument,
                        tunings: [],
                        defaultTuning: ""
                    };
                }

                return {
                    name: instrument?.name || instrument?.instrument || "",
                    tunings: Array.isArray(instrument?.tunings)
                        ? instrument.tunings.filter(Boolean)
                        : [],
                    defaultTuning: instrument?.defaultTuning || ""
                };
            }).filter((instrument) => instrument.name)
            : [];

        result[memberName] = {
            instruments
        };
        return result;
    }, {});
}

export function createDefaultAppConfig({ bandName = "", seedConfig = DEFAULT_CONFIG_TEMPLATE } = {}) {
    const timestamp = nowIso();
    const baseConfig = clone(seedConfig);
    baseConfig.show = baseConfig.show || {};
    baseConfig.show.members = {};
    baseConfig.band = {
        members: normalizeBandMembers(baseConfig.band?.members || {})
    };
    baseConfig.catalog = normalizeCatalogConfig(baseConfig);

    return {
        bandName,
        schemaVersion: SCHEMA_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...baseConfig
    };
}


export function blankSong() {
    const timestamp = nowIso();
    return {
        id: uid("song"),
        name: "",
        energy: 2,
        cover: false,
        instrumental: false,
        key: "",
        schemaVersion: SCHEMA_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
        members: {}
    };
}


export function blankPreset(currentOptions = {}) {
    const timestamp = nowIso();
    return {
        id: uid("preset"),
        name: "",
        notes: "",
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        schemaVersion: SCHEMA_VERSION,
        options: clone(currentOptions)
    };
}


export function normalizeSongRecord(song) {
    const timestamp = song.createdAt || nowIso();
    return {
        id: String(song.id),
        name: song.name || "",
        energy: Number(song.energy || 2),
        cover: Boolean(song.cover),
        instrumental: Boolean(song.instrumental),
        key: song.key || "",
        schemaVersion: song.schemaVersion || SCHEMA_VERSION,
        createdAt: song.createdAt || timestamp,
        updatedAt: song.updatedAt || timestamp,
        members: clone(song.members || {})
    };
}


export function normalizePresetRecord(preset) {
    const timestamp = preset.createdAt || nowIso();
    return {
        id: String(preset.id || uid("preset")),
        name: preset.name || "",
        notes: preset.notes || "",
        tags: Array.isArray(preset.tags) ? preset.tags.slice() : [],
        options: clone(preset.options || {}),
        schemaVersion: preset.schemaVersion || SCHEMA_VERSION,
        createdAt: preset.createdAt || timestamp,
        updatedAt: preset.updatedAt || timestamp
    };
}


export function normalizeAppConfig(config) {
    if (!config) {
        return null;
    }

    const timestamp = config.createdAt || nowIso();
    const bandMembers = normalizeBandMembers(config.band?.members || {});
    const catalog = normalizeCatalogConfig(config);
    return deepMerge(createDefaultAppConfig({ bandName: config.bandName || "" }), {
        ...clone(config),
        bandName: config.bandName || "",
        band: {
            members: bandMembers
        },
        catalog,
        schemaVersion: config.schemaVersion || SCHEMA_VERSION,
        createdAt: config.createdAt || timestamp,
        updatedAt: config.updatedAt || timestamp
    });
}


export function sortSongs(list) {
    return sortByName(list.map((song) => normalizeSongRecord(song)));
}
