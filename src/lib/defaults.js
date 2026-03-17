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
                ["notGoodOpener", false],
                ["cover", false],
                ["instrumental", false]
            ],
            second: [
                ["cover", false],
                ["instrumental", false]
            ],
            penultimate: [],
            last: [
                ["notGoodCloser", false]
            ]
        },
        weighting: {
            tuning: 4,
            capo: 2,
            instrument: 3,
            technique: 1,
            positionMiss: 8,
            earlyCover: 2,
            earlyInstrumental: 2
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
            minStreak: 2,
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
            kind: "instrumentField",
            field: "picking",
            weightKey: "technique",
            summaryLabel: "technique changes",
            minStreak: 1,
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
            ? memberConfig.instruments.map((instrument) => ({
                name: instrument?.name || "",
                tunings: Array.isArray(instrument?.tunings)
                    ? instrument.tunings.filter(Boolean)
                    : [],
                defaultTuning: instrument?.defaultTuning || "",
                techniques: Array.isArray(instrument?.techniques)
                    ? instrument.techniques.filter(Boolean)
                    : [],
                defaultTechnique: instrument?.defaultTechnique || ""
            })).filter((instrument) => instrument.name)
            : [];

        result[memberName] = {
            instruments,
            defaultInstrument: memberConfig?.defaultInstrument || ""
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
        cover: false,
        instrumental: false,
        notGoodOpener: false,
        notGoodCloser: false,
        unpracticed: false,
        key: "",
        schemaVersion: SCHEMA_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
        members: {}
    };
}


export function normalizeSongRecord(song) {
    const timestamp = song.createdAt || nowIso();
    return {
        id: String(song.id),
        name: song.name || "",
        cover: Boolean(song.cover),
        instrumental: Boolean(song.instrumental),
        notGoodOpener: Boolean(song.notGoodOpener),
        notGoodCloser: Boolean(song.notGoodCloser),
        unpracticed: Boolean(song.unpracticed),
        key: song.key || "",
        schemaVersion: song.schemaVersion || SCHEMA_VERSION,
        createdAt: song.createdAt || timestamp,
        updatedAt: song.updatedAt || timestamp,
        members: song.members || {}
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
