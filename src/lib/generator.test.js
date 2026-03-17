import { describe, it, expect } from "vitest";
import { generateSetlist, scoreFixedOrder, buildDefaultPerformance } from "./generator.js";


// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSong(name, opts = {}) {
    return {
        id: opts.id || name.toLowerCase().replace(/\s+/g, "-"),
        name,
        cover: opts.cover || false,
        instrumental: opts.instrumental || false,
        notGoodOpener: opts.notGoodOpener || false,
        notGoodCloser: opts.notGoodCloser || false,
        unpracticed: false,
        key: opts.key || "G",
        schemaVersion: 1,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        members: opts.members || {}
    };
}

function makeConfig(overrides = {}) {
    return {
        general: {
            count: 15,
            beamWidth: 512,
            limits: { covers: 2, instrumentals: 2 },
            order: {
                first: [["notGoodOpener", false], ["cover", false], ["instrumental", false]],
                second: [["cover", false], ["instrumental", false]],
                penultimate: [],
                last: [["notGoodCloser", false]]
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
            },
            ...overrides.general
        },
        props: overrides.props || {
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
        show: overrides.show || { members: {} },
        band: overrides.band || { members: {} },
        catalog: overrides.catalog || { tunings: [], tuningsByInstrument: {} }
    };
}

/** Fixed-seed deterministic options for reproducible tests */
function deterministicOptions(overrides = {}) {
    return {
        count: overrides.count || 10,
        seed: overrides.seed || 42,
        beamWidth: overrides.beamWidth || 64,
        randomness: {
            shuffleCatalog: false,
            songBias: 0,
            variantJitter: 0,
            stateJitter: 0,
            temperature: 0.85,
            finalChoicePool: 1,
            ...overrides.randomness
        },
        show: overrides.show || {},
        ...overrides
    };
}

/** Generate a catalog of simple songs (no members) */
function simpleCatalog(count) {
    return Array.from({ length: count }, (_, i) => makeSong(`Song ${i + 1}`));
}

/** Generate songs where a member alternates instruments */
function twoInstrumentCatalog(count, memberName = "nick") {
    return Array.from({ length: count }, (_, i) => {
        const instruments = [
            { name: "guitar", tuning: ["Standard"], capo: 0, picking: [] },
            { name: "banjo", tuning: ["Open G"], capo: 0, picking: [] }
        ];
        return makeSong(`Song ${i + 1}`, {
            members: {
                [memberName]: { instruments }
            }
        });
    });
}

/** Generate songs where a member has two tunings on one instrument */
function twoTuningCatalog(count, memberName = "nick") {
    return Array.from({ length: count }, (_, i) =>
        makeSong(`Song ${i + 1}`, {
            members: {
                [memberName]: {
                    instruments: [
                        { name: "guitar", tuning: ["Standard", "DADGAD"], capo: 0, picking: [] }
                    ]
                }
            }
        })
    );
}


// ===================================================================
// Basic generation
// ===================================================================
describe("generateSetlist — basics", () => {
    it("returns the correct number of songs", () => {
        const songs = simpleCatalog(20);
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 10 }));
        expect(result.songs).toHaveLength(10);
    });

    it("clamps to catalog size when count exceeds available songs", () => {
        const songs = simpleCatalog(5);
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 15 }));
        expect(result.songs).toHaveLength(5);
    });

    it("handles empty catalog", () => {
        const result = generateSetlist([], makeConfig(), deterministicOptions({ count: 10 }));
        expect(result.songs).toHaveLength(0);
    });

    it("handles single song", () => {
        const result = generateSetlist([makeSong("Only")], makeConfig(), deterministicOptions({ count: 1 }));
        expect(result.songs).toHaveLength(1);
        expect(result.songs[0].name).toBe("Only");
    });

    it("each song appears at most once", () => {
        const songs = simpleCatalog(15);
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 15 }));
        const ids = result.songs.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("includes summary with score, covers, instrumentals, anxiety", () => {
        const songs = simpleCatalog(10);
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 5 }));
        expect(result.summary).toBeDefined();
        expect(typeof result.summary.score).toBe("number");
        expect(typeof result.summary.covers).toBe("number");
        expect(typeof result.summary.instrumentals).toBe("number");
        expect(result.summary.anxiety).toBeDefined();
        expect(typeof result.summary.anxiety.scaled).toBe("number");
    });
});


// ===================================================================
// Determinism
// ===================================================================
describe("generateSetlist — determinism", () => {
    it("same seed produces identical output", () => {
        const songs = simpleCatalog(20);
        const config = makeConfig();
        const opts = deterministicOptions({ count: 10, seed: 777 });
        const r1 = generateSetlist(songs, config, opts);
        const r2 = generateSetlist(songs, config, opts);
        expect(r1.songs.map(s => s.id)).toEqual(r2.songs.map(s => s.id));
    });

    it("different seeds produce different output (high probability)", () => {
        const songs = simpleCatalog(20);
        const config = makeConfig();
        const r1 = generateSetlist(songs, config, deterministicOptions({ count: 10, seed: 1 }));
        const r2 = generateSetlist(songs, config, deterministicOptions({ count: 10, seed: 2 }));
        // With 20 songs picking 10, different seeds should almost certainly differ
        const ids1 = r1.songs.map(s => s.id).join(",");
        const ids2 = r2.songs.map(s => s.id).join(",");
        expect(ids1).not.toBe(ids2);
    });
});


// ===================================================================
// Cover / Instrumental limits
// ===================================================================
describe("generateSetlist — cover and instrumental limits", () => {
    it("respects maxCovers", () => {
        const songs = Array.from({ length: 10 }, (_, i) =>
            makeSong(`Song ${i + 1}`, { cover: true })
        );
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 10, maxCovers: 2 }));
        const covers = result.songs.filter(s => s.cover);
        expect(covers.length).toBeLessThanOrEqual(2);
    });

    it("respects maxInstrumentals", () => {
        const songs = Array.from({ length: 10 }, (_, i) =>
            makeSong(`Song ${i + 1}`, { instrumental: true })
        );
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 10, maxInstrumentals: 1 }));
        const instrumentals = result.songs.filter(s => s.instrumental);
        expect(instrumentals.length).toBeLessThanOrEqual(1);
    });

    it("all covers with maxCovers=1 produces exactly 1 song", () => {
        const songs = Array.from({ length: 5 }, (_, i) =>
            makeSong(`Cover ${i + 1}`, { cover: true })
        );
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 5, maxCovers: 1 }));
        expect(result.songs.length).toBe(1);
    });
});


// ===================================================================
// Position rules
// ===================================================================
describe("generateSetlist — position rules", () => {
    it("avoids notGoodOpener in first position (across seeds)", () => {
        const songs = [
            makeSong("Opener", { notGoodOpener: true }),
            ...simpleCatalog(14).map((s, i) => ({ ...s, id: `other-${i}`, name: `Other ${i + 1}` }))
        ];
        const config = makeConfig();
        let openerFirst = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const result = generateSetlist(songs, config, deterministicOptions({ count: 10, seed }));
            if (result.songs[0]?.name === "Opener") openerFirst++;
        }
        // Should very rarely be first (position penalty makes it expensive)
        expect(openerFirst).toBeLessThanOrEqual(2);
    });

    it("avoids notGoodCloser in last position (across seeds)", () => {
        const songs = [
            makeSong("Closer", { notGoodCloser: true }),
            ...simpleCatalog(14).map((s, i) => ({ ...s, id: `other-${i}`, name: `Other ${i + 1}` }))
        ];
        const config = makeConfig();
        let closerLast = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const result = generateSetlist(songs, config, deterministicOptions({ count: 10, seed }));
            const last = result.songs[result.songs.length - 1];
            if (last?.name === "Closer") closerLast++;
        }
        expect(closerLast).toBeLessThanOrEqual(2);
    });

    it("avoids covers in first two positions", () => {
        const songs = [
            makeSong("Cover 1", { cover: true }),
            makeSong("Cover 2", { cover: true }),
            ...simpleCatalog(13).map((s, i) => ({ ...s, id: `other-${i}`, name: `Other ${i + 1}` }))
        ];
        const config = makeConfig();
        let coverEarly = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const result = generateSetlist(songs, config, deterministicOptions({ count: 10, seed }));
            if (result.songs[0]?.cover || result.songs[1]?.cover) coverEarly++;
        }
        expect(coverEarly).toBeLessThanOrEqual(3);
    });
});


// ===================================================================
// Variant expansion
// ===================================================================
describe("generateSetlist — variant expansion", () => {
    it("song with no members has one variant (empty performance)", () => {
        const result = generateSetlist([makeSong("Simple")], makeConfig(), deterministicOptions({ count: 1 }));
        expect(result.songs[0].performance).toEqual({});
    });

    it("song with one member and one instrument gets that performance", () => {
        const songs = [makeSong("Tune", {
            members: {
                nick: {
                    instruments: [{ name: "banjo", tuning: ["Open G"], capo: 0, picking: ["clawhammer"] }]
                }
            }
        })];
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 1 }));
        const perf = result.songs[0].performance;
        expect(perf.nick).toBeDefined();
        expect(perf.nick.instrument).toBe("banjo");
        expect(perf.nick.tuning).toBe("Open G");
    });

    it("filters variants by allowedInstruments", () => {
        const songs = twoInstrumentCatalog(5);
        const config = makeConfig({
            show: {
                members: {
                    nick: { allowedInstruments: ["guitar"] }
                }
            }
        });
        const result = generateSetlist(songs, config, deterministicOptions({ count: 5 }));
        // All songs should use guitar since banjo is filtered out
        for (const song of result.songs) {
            expect(song.performance.nick.instrument).toBe("guitar");
        }
    });

    it("song with all instruments filtered out is excluded from catalog", () => {
        const songs = [
            makeSong("Only Banjo", {
                members: {
                    nick: { instruments: [{ name: "banjo", tuning: ["Open G"], capo: 0, picking: [] }] }
                }
            }),
            makeSong("Filler")
        ];
        const config = makeConfig({
            show: {
                members: {
                    nick: { allowedInstruments: ["guitar"] } // banjo not allowed
                }
            }
        });
        const result = generateSetlist(songs, config, deterministicOptions({ count: 2 }));
        // Only Banjo should be excluded since its only instrument is filtered
        expect(result.songs.map(s => s.name)).not.toContain("Only Banjo");
    });
});


// ===================================================================
// Detection correctness (via generator output)
// ===================================================================
describe("generateSetlist — change detection", () => {
    it("detects tuning changes in transition notes", () => {
        const songs = [
            makeSong("Song A", {
                members: { nick: { instruments: [{ name: "guitar", tuning: ["Standard"], capo: 0, picking: [] }] } }
            }),
            makeSong("Song B", {
                members: { nick: { instruments: [{ name: "guitar", tuning: ["DADGAD"], capo: 0, picking: [] }] } }
            })
        ];
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 2 }));
        // One of the songs should have tuning in transition notes
        const allNotes = result.songs.flatMap(s => s.transitionNotes);
        expect(allNotes.some(n => n.includes("tuning"))).toBe(true);
    });

    it("array picking order does NOT cause false change detection", () => {
        // Both songs have same techniques, just different array ordering
        const songs = [
            makeSong("Song A", {
                members: { nick: { instruments: [{ name: "guitar", tuning: ["Standard"], capo: 0, picking: ["slide", "picking"] }] } }
            }),
            makeSong("Song B", {
                members: { nick: { instruments: [{ name: "guitar", tuning: ["Standard"], capo: 0, picking: ["picking", "slide"] }] } }
            })
        ];
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 2 }));
        // Second song should have no picking change
        const song2 = result.songs[1];
        expect(song2.propChanges.picking.changed).toBe(false);
    });

    it("detects member appearing as instrument set change", () => {
        const songs = [
            makeSong("Song A", { members: {} }),
            makeSong("Song B", {
                members: { nick: { instruments: [{ name: "banjo", tuning: ["Open G"], capo: 0, picking: [] }] } }
            })
        ];
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 2 }));
        const song2 = result.songs[1];
        expect(song2.propChanges.instruments.changed).toBe(true);
    });

    it("detects member disappearing as instrument set change", () => {
        const songs = [
            makeSong("Song A", {
                members: { nick: { instruments: [{ name: "banjo", tuning: ["Open G"], capo: 0, picking: [] }] } }
            }),
            makeSong("Song B", { members: {} })
        ];
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 2 }));
        const song2 = result.songs[1];
        expect(song2.propChanges.instruments.changed).toBe(true);
    });

    it("capo change magnitude reflects numeric delta", () => {
        const songs = [
            makeSong("Song A", {
                members: { nick: { instruments: [{ name: "guitar", tuning: ["Standard"], capo: 0, picking: [] }] } }
            }),
            makeSong("Song B", {
                members: { nick: { instruments: [{ name: "guitar", tuning: ["Standard"], capo: 3, picking: [] }] } }
            })
        ];
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 2 }));
        const song2 = result.songs[1];
        expect(song2.propChanges.capo.changed).toBe(true);
        expect(song2.propChanges.capo.magnitude).toBe(3);
    });
});


// ===================================================================
// Constraint enforcement — minStreak
// ===================================================================
describe("generateSetlist — minStreak enforcement", () => {
    it("respects tuning minStreak=2 (no back-to-back tuning changes)", () => {
        const songs = twoTuningCatalog(15);
        const config = makeConfig();
        // Run across multiple seeds
        for (let seed = 1; seed <= 5; seed++) {
            const result = generateSetlist(songs, config, deterministicOptions({ count: 10, seed }));
            let consecutive = 0;
            for (let i = 1; i < result.songs.length; i++) {
                if (result.songs[i].propChanges.tuning?.changed) {
                    consecutive++;
                    // With minStreak=2, two consecutive changes should not happen
                    expect(consecutive).toBeLessThanOrEqual(1);
                } else {
                    consecutive = 0;
                }
            }
        }
    });
});


// ===================================================================
// Bug #6 regression: maxChanges enforced on last song
// ===================================================================
describe("generateSetlist — maxChanges on last song", () => {
    it("maxChanges is enforced even when allowChangeOnLastSong is true", () => {
        const songs = twoTuningCatalog(10);
        const config = makeConfig({
            props: {
                tuning: {
                    kind: "instrumentField",
                    field: "tuning",
                    minStreak: 1,
                    maxChanges: 1,
                    allowChangeOnLastSong: true
                }
            }
        });

        for (let seed = 1; seed <= 10; seed++) {
            const result = generateSetlist(songs, config, deterministicOptions({ count: 5, seed }));
            const tuningChanges = result.songs.filter(s => s.propChanges.tuning?.changed).length;
            expect(tuningChanges).toBeLessThanOrEqual(1);
        }
    });
});


// ===================================================================
// minSongsPerInstrument enforcement
// ===================================================================
describe("generateSetlist — minSongsPerInstrument", () => {
    it("both instruments appear at least min times with sufficient catalog", () => {
        const songs = twoInstrumentCatalog(15);
        const config = makeConfig();
        const opts = deterministicOptions({
            count: 10,
            show: {
                members: {
                    nick: {
                        allowedInstruments: ["guitar", "banjo"],
                        minSongsPerInstrument: 2
                    }
                }
            }
        });

        let bothMet = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const result = generateSetlist(songs, config, { ...opts, seed });
            const guitarCount = result.songs.filter(s => s.performance.nick?.instrument === "guitar").length;
            const banjoCount = result.songs.filter(s => s.performance.nick?.instrument === "banjo").length;
            if (guitarCount >= 2 && banjoCount >= 2) bothMet++;
        }
        // Should meet minimums most of the time
        expect(bothMet).toBeGreaterThanOrEqual(7);
    });

    it("still produces a result when minimums are impossible", () => {
        // Only 3 songs but min=5 per instrument
        const songs = twoInstrumentCatalog(3);
        const config = makeConfig();
        const opts = deterministicOptions({
            count: 3,
            show: {
                members: {
                    nick: {
                        allowedInstruments: ["guitar", "banjo"],
                        minSongsPerInstrument: 5
                    }
                }
            }
        });
        const result = generateSetlist(songs, config, opts);
        // Should still produce some result even if minimums can't be met
        expect(result.songs.length).toBeGreaterThan(0);
    });

    it("instrument switch actually happens in the setlist", () => {
        const songs = twoInstrumentCatalog(10);
        const config = makeConfig();
        const opts = deterministicOptions({
            count: 8,
            show: {
                members: {
                    nick: {
                        allowedInstruments: ["guitar", "banjo"],
                        minSongsPerInstrument: 3
                    }
                }
            }
        });

        let hasBoth = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const result = generateSetlist(songs, config, { ...opts, seed });
            const instruments = new Set(result.songs.map(s => s.performance.nick?.instrument));
            if (instruments.has("guitar") && instruments.has("banjo")) hasBoth++;
        }
        expect(hasBoth).toBeGreaterThanOrEqual(8);
    });
});


// ===================================================================
// minSongsPerTuning enforcement
// ===================================================================
describe("generateSetlist — minSongsPerTuning", () => {
    it("both tunings appear at least min times with sufficient catalog", () => {
        const songs = twoTuningCatalog(15);
        const config = makeConfig();
        const opts = deterministicOptions({
            count: 10,
            show: {
                members: {
                    nick: {
                        allowedTunings: { guitar: ["Standard", "DADGAD"] },
                        minSongsPerTuning: { guitar: 2 }
                    }
                }
            }
        });

        let bothMet = 0;
        for (let seed = 1; seed <= 10; seed++) {
            const result = generateSetlist(songs, config, { ...opts, seed });
            const standardCount = result.songs.filter(s => s.performance.nick?.tuning === "Standard").length;
            const dadgadCount = result.songs.filter(s => s.performance.nick?.tuning === "DADGAD").length;
            if (standardCount >= 2 && dadgadCount >= 2) bothMet++;
        }
        expect(bothMet).toBeGreaterThanOrEqual(7);
    });
});


// ===================================================================
// scoreFixedOrder
// ===================================================================
describe("scoreFixedOrder", () => {
    const config = makeConfig();

    it("returns correct structure", () => {
        const songs = [
            { id: "1", name: "A", performance: { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: [] } } },
            { id: "2", name: "B", performance: { nick: { instrument: "guitar", tuning: "DADGAD", capo: 0, picking: [] } } }
        ];
        const result = scoreFixedOrder(songs, config);
        expect(result.songs).toHaveLength(2);
        expect(result.summary).toBeDefined();
        expect(result.summary.anxiety).toBeDefined();
    });

    it("scores identical songs as 0", () => {
        const perf = { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: [] } };
        const songs = [
            { id: "1", name: "A", performance: perf },
            { id: "2", name: "B", performance: perf },
            { id: "3", name: "C", performance: perf }
        ];
        const result = scoreFixedOrder(songs, config);
        expect(result.summary.score).toBe(0);
    });

    it("detects tuning change with correct weight", () => {
        const songs = [
            { id: "1", name: "A", performance: { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: [] } } },
            { id: "2", name: "B", performance: { nick: { instrument: "guitar", tuning: "DADGAD", capo: 0, picking: [] } } }
        ];
        const result = scoreFixedOrder(songs, config);
        expect(result.songs[1].propChanges.tuning.changed).toBe(true);
        expect(result.songs[1].incrementalScore).toBe(4); // weight 4
    });

    it("uses shared detection (array order independence)", () => {
        const songs = [
            { id: "1", name: "A", performance: { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: ["slide", "picking"] } } },
            { id: "2", name: "B", performance: { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: ["picking", "slide"] } } }
        ];
        const result = scoreFixedOrder(songs, config);
        expect(result.songs[1].propChanges.picking.changed).toBe(false);
    });

    it("includes anxiety in summary", () => {
        const songs = [
            { id: "1", name: "A", performance: { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: [] } } },
            { id: "2", name: "B", performance: { nick: { instrument: "banjo", tuning: "Open G", capo: 0, picking: ["clawhammer"] } } }
        ];
        const result = scoreFixedOrder(songs, config);
        expect(result.summary.anxiety.scaled).toBeGreaterThan(0);
    });

    it("detects member appearing/disappearing", () => {
        const songs = [
            { id: "1", name: "A", performance: { nick: { instrument: "banjo", tuning: "Open G", capo: 0, picking: [] } } },
            { id: "2", name: "B", performance: {} },
            { id: "3", name: "C", performance: { nick: { instrument: "banjo", tuning: "Open G", capo: 0, picking: [] } } }
        ];
        const result = scoreFixedOrder(songs, config);
        // nick disappears in song 2
        expect(result.songs[1].propChanges.instruments.changed).toBe(true);
        // nick reappears in song 3
        expect(result.songs[2].propChanges.instruments.changed).toBe(true);
    });
});


// ===================================================================
// Edge cases
// ===================================================================
describe("generateSetlist — edge cases", () => {
    it("generates with no props configured", () => {
        const songs = simpleCatalog(10);
        const config = makeConfig({ props: {} });
        const result = generateSetlist(songs, config, deterministicOptions({ count: 5 }));
        expect(result.songs).toHaveLength(5);
        expect(result.summary.score).toBe(0);
    });

    it("handles songs where every song has cover=true and instrumental=true", () => {
        const songs = Array.from({ length: 5 }, (_, i) =>
            makeSong(`Song ${i + 1}`, { cover: true, instrumental: true })
        );
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 5, maxCovers: 5, maxInstrumentals: 5 }));
        expect(result.songs.length).toBeGreaterThan(0);
    });

    it("handles mixed catalog — some songs with members, some without", () => {
        const songs = [
            makeSong("With Members", {
                members: { nick: { instruments: [{ name: "guitar", tuning: ["Standard"], capo: 0, picking: [] }] } }
            }),
            makeSong("Without Members"),
            makeSong("Also Without"),
        ];
        const result = generateSetlist(songs, makeConfig(), deterministicOptions({ count: 3 }));
        expect(result.songs).toHaveLength(3);
    });
});


// ---------------------------------------------------------------------------
// fixedSongIds
// ---------------------------------------------------------------------------

describe("generateSetlist — fixedSongIds", () => {
    const catalog = Array.from({ length: 10 }, (_, i) => makeSong(`Song ${i + 1}`));

    it("restricts output to exactly the fixed song IDs", () => {
        const fixedIds = ["song-2", "song-5", "song-7"];
        const result = generateSetlist(catalog, makeConfig(), deterministicOptions({
            count: 3,
            fixedSongIds: fixedIds,
        }));
        expect(result.songs).toHaveLength(3);
        const resultIds = result.songs.map(s => s.id).sort();
        expect(resultIds).toEqual([...fixedIds].sort());
    });

    it("ignores count option and uses all fixed songs", () => {
        const fixedIds = ["song-1", "song-3", "song-4", "song-6"];
        const result = generateSetlist(catalog, makeConfig(), deterministicOptions({
            count: 2,
            fixedSongIds: fixedIds,
        }));
        expect(result.songs).toHaveLength(4);
    });

    it("includes songs that would be filtered without fixedSongIds", () => {
        // Without fixedSongIds, song-8 through song-10 would be in the pool.
        // With fixedSongIds, only the specified subset is used.
        const fixedIds = ["song-1", "song-2"];
        const result = generateSetlist(catalog, makeConfig(), deterministicOptions({
            count: 10,
            fixedSongIds: fixedIds,
        }));
        expect(result.songs).toHaveLength(2);
        const resultIds = result.songs.map(s => s.id).sort();
        expect(resultIds).toEqual([...fixedIds].sort());
    });
});


// ---------------------------------------------------------------------------
// buildDefaultPerformance
// ---------------------------------------------------------------------------

describe("buildDefaultPerformance", () => {
    it("returns performance for a song with members", () => {
        const song = makeSong("Tune", {
            members: {
                nick: { instruments: [{ name: "guitar", tuning: ["Standard"], capo: 0, picking: ["pick"] }] }
            }
        });
        const perf = buildDefaultPerformance(song);
        expect(perf).toHaveProperty("nick");
        expect(perf.nick.instrument).toBe("guitar");
        expect(perf.nick.tuning).toBe("Standard");
    });

    it("returns empty object for song with no members", () => {
        const song = makeSong("Simple");
        const perf = buildDefaultPerformance(song);
        expect(perf).toEqual({});
    });

    it("returns empty object when show constraints filter all instruments", () => {
        const song = makeSong("Filtered", {
            members: { nick: { instruments: [{ name: "banjo", tuning: ["Open G"], capo: 0, picking: [] }] } }
        });
        const perf = buildDefaultPerformance(song, { members: { nick: { allowedInstruments: ["guitar"] } } });
        expect(perf).toEqual({});
    });
});
