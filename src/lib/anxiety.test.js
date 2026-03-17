import { describe, it, expect } from "vitest";
import { computeAnxiety, anxietyLabel, _internals } from "./anxiety.js";

const { normalizeValue, displayValue, detectInstrumentSetChange, detectFieldChange, scoreTransition } = _internals;

// ---------------------------------------------------------------------------
// Test config matching the user's real band setup
// ---------------------------------------------------------------------------

const BAND_CONFIG = {
    general: {
        weighting: {
            tuning: 4,
            capo: 2,
            instrument: 3,
            technique: 1,
            positionMiss: 8,
            earlyCover: 2,
            earlyInstrumental: 2
        }
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
    }
};


// ---------------------------------------------------------------------------
// Helper: build a song with performance data
// ---------------------------------------------------------------------------
function song(name, key, members = {}) {
    const performance = {};
    for (const [memberName, setup] of Object.entries(members)) {
        performance[memberName] = {
            instrument: setup.instrument || "guitar",
            tuning: setup.tuning || "Standard",
            capo: setup.capo || 0,
            picking: setup.picking || []
        };
    }
    return { id: name.toLowerCase().replace(/\s+/g, "-"), name, key, performance };
}


// ===================================================================
// normalizeValue
// ===================================================================
describe("normalizeValue", () => {
    it("returns empty string for null/undefined", () => {
        expect(normalizeValue(null)).toBe("");
        expect(normalizeValue(undefined)).toBe("");
    });

    it("stringifies primitives", () => {
        expect(normalizeValue("Standard")).toBe("Standard");
        expect(normalizeValue(2)).toBe("2");
    });

    it("sorts and joins arrays", () => {
        expect(normalizeValue(["picking", "slide"])).toBe("picking,slide");
        expect(normalizeValue(["slide", "picking"])).toBe("picking,slide");
        expect(normalizeValue([])).toBe("");
    });
});


// ===================================================================
// detectInstrumentSetChange
// ===================================================================
describe("detectInstrumentSetChange", () => {
    it("detects no change when instruments stay the same", () => {
        const prev = { nick: { instrument: "banjo" }, mark: { instrument: "guitar" } };
        const next = { nick: { instrument: "banjo" }, mark: { instrument: "guitar" } };
        const result = detectInstrumentSetChange(prev, next);
        expect(result.changed).toBe(false);
        expect(result.magnitude).toBe(0);
    });

    it("detects instrument swap for one member", () => {
        const prev = { nick: { instrument: "banjo" } };
        const next = { nick: { instrument: "guitar" } };
        const result = detectInstrumentSetChange(prev, next);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(1);
        expect(result.notes[0]).toContain("nick instrument banjo -> guitar");
    });

    it("detects member appearing (on/off)", () => {
        const prev = {};
        const next = { nick: { instrument: "banjo" } };
        const result = detectInstrumentSetChange(prev, next);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(1);
    });

    it("detects member disappearing (on/off)", () => {
        const prev = { nick: { instrument: "banjo" } };
        const next = {};
        const result = detectInstrumentSetChange(prev, next);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(1);
    });

    it("counts per-member changes independently", () => {
        const prev = { nick: { instrument: "banjo" }, mark: { instrument: "guitar" } };
        const next = { nick: { instrument: "guitar" }, mark: { instrument: "bass" } };
        const result = detectInstrumentSetChange(prev, next);
        expect(result.magnitude).toBe(2);
    });
});


// ===================================================================
// detectFieldChange
// ===================================================================
describe("detectFieldChange", () => {
    it("detects tuning change for shared member", () => {
        const prev = { mark: { tuning: "DADDAD" } };
        const next = { mark: { tuning: "Standard" } };
        const result = detectFieldChange(prev, next, "tuning", false);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(1);
    });

    it("detects no change when tuning is same", () => {
        const prev = { mark: { tuning: "Standard" } };
        const next = { mark: { tuning: "Standard" } };
        const result = detectFieldChange(prev, next, "tuning", false);
        expect(result.changed).toBe(false);
    });

    it("detects capo delta change (scaleByDelta=true)", () => {
        const prev = { nick: { capo: 0 } };
        const next = { nick: { capo: 2 } };
        const result = detectFieldChange(prev, next, "capo", true);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(2);
    });

    it("handles array fields (picking/techniques)", () => {
        const prev = { nick: { picking: ["picking"] } };
        const next = { nick: { picking: ["clawhammer"] } };
        const result = detectFieldChange(prev, next, "picking", false);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(1);
    });

    it("detects change from empty array to populated array", () => {
        const prev = { nick: { picking: [] } };
        const next = { nick: { picking: ["slide"] } };
        const result = detectFieldChange(prev, next, "picking", false);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(1);
    });

    it("detects change between multi-element arrays", () => {
        const prev = { nick: { picking: ["picking", "slide"] } };
        const next = { nick: { picking: ["clawhammer"] } };
        const result = detectFieldChange(prev, next, "picking", false);
        expect(result.changed).toBe(true);
        expect(result.magnitude).toBe(1);
    });

    it("treats same-elements-different-order arrays as identical", () => {
        const prev = { nick: { picking: ["slide", "picking"] } };
        const next = { nick: { picking: ["picking", "slide"] } };
        const result = detectFieldChange(prev, next, "picking", false);
        expect(result.changed).toBe(false);
    });

    it("skips members only in one song (instrument set handles that)", () => {
        const prev = { mark: { tuning: "Standard" } };
        const next = { nick: { tuning: "Open G" } };
        const result = detectFieldChange(prev, next, "tuning", false);
        // Neither member is in both songs — no field comparison possible
        expect(result.changed).toBe(false);
    });

    it("counts changes per member independently", () => {
        const prev = { nick: { capo: 0 }, mark: { capo: 0 } };
        const next = { nick: { capo: 2 }, mark: { capo: 3 } };
        const result = detectFieldChange(prev, next, "capo", true);
        expect(result.magnitude).toBe(5); // |0-2| + |0-3|
    });
});


// ===================================================================
// scoreTransition
// ===================================================================
describe("scoreTransition", () => {
    const propNames = ["tuning", "capo", "instruments", "picking"];
    const propConfig = BAND_CONFIG.props;
    const weights = BAND_CONFIG.general.weighting;

    it("returns zero for first song (no prev)", () => {
        const s = song("Test", "G", { nick: { instrument: "banjo" } });
        const result = scoreTransition(null, s, propNames, propConfig, weights);
        expect(result.score).toBe(0);
        for (const p of propNames) {
            expect(result.changes[p].changed).toBe(false);
        }
    });

    it("scores a tuning change correctly", () => {
        const s1 = song("A", "G", { mark: { tuning: "DADDAD" } });
        const s2 = song("B", "G", { mark: { tuning: "Standard" } });
        const result = scoreTransition(s1, s2, propNames, propConfig, weights);
        expect(result.changes.tuning.changed).toBe(true);
        expect(result.changes.tuning.magnitude).toBe(1);
        expect(result.score).toBe(4); // magnitude 1 * weight 4
    });

    it("scores a capo change with delta", () => {
        const s1 = song("A", "G", { mark: { capo: 0 } });
        const s2 = song("B", "G", { mark: { capo: 3 } });
        const result = scoreTransition(s1, s2, propNames, propConfig, weights);
        expect(result.changes.capo.changed).toBe(true);
        expect(result.changes.capo.magnitude).toBe(3);
        expect(result.score).toBe(6); // magnitude 3 * weight 2
    });

    it("scores a picking/technique change", () => {
        const s1 = song("A", "G", { nick: { picking: ["picking"] } });
        const s2 = song("B", "G", { nick: { picking: ["clawhammer"] } });
        const result = scoreTransition(s1, s2, propNames, propConfig, weights);
        expect(result.changes.picking.changed).toBe(true);
        expect(result.changes.picking.magnitude).toBe(1);
        expect(result.score).toBe(1); // magnitude 1 * technique weight 1
    });

    it("scores multiple simultaneous changes", () => {
        const s1 = song("A", "G", { nick: { instrument: "banjo", tuning: "Open G", picking: ["picking"] } });
        const s2 = song("B", "G", { nick: { instrument: "guitar", tuning: "Standard", picking: ["clawhammer"] } });
        const result = scoreTransition(s1, s2, propNames, propConfig, weights);
        expect(result.changes.instruments.changed).toBe(true);
        expect(result.changes.tuning.changed).toBe(true);
        expect(result.changes.picking.changed).toBe(true);
        // instrument(3) + tuning(4) + technique(1) = 8
        expect(result.score).toBe(8);
    });
});


// ===================================================================
// computeAnxiety — the user's actual setlist
// ===================================================================
describe("computeAnxiety — real setlist", () => {
    // Recreate the user's 15-song setlist from their bug report
    const realSetlist = [
        song("O' the Topside", "E", {
            mark: { instrument: "guitar", tuning: "DADDAD" },
            nick: { instrument: "banjo", tuning: "Open G", picking: ["picking", "slide"] }
        }),
        song("Bob Dylan", "D", {}),  // no members listed
        song("Tubsies Requiem", "G", {
            nick: { picking: ["clawhammer"] }
        }),
        song("Run Along", "C", {
            mark: { tuning: "Standard" },
            nick: { picking: ["picking"] }
        }),
        song("In a Station Wagon", "G", {
            nick: { picking: ["clawhammer"] }
        }),
        song("Courtroom Sketch Artist", "G", {
            nick: { picking: ["picking"] }
        }),
        song("Trying to get to the Port", "G", {}),
        song("Saturn V", "C", {
            nick: { picking: ["clawhammer"] }
        }),
        song("Bottle of Soot", "D", {
            nick: { picking: ["slide", "picking"] }
        }),
        song("Farewell to Cheyenne", "", {
            nick: { picking: ["picking"] }
        }),
        song("Lester Young", "G", {
            nick: { picking: ["slide", "picking"] }
        }),
        song("Bad On Me", "D", {
            mark: { capo: 2 },
            nick: { capo: 2, picking: ["picking"] }
        }),
        song("Jump Down Turn Around", "E", {}),
        song("To Rob A Bank", "D", {}),
        song("Locomotive Smoke", "D", {})
    ];

    it("detects the correct number of total transitions", () => {
        const result = computeAnxiety(realSetlist, BAND_CONFIG);
        expect(result.totalTransitions).toBe(14);
    });

    it("detects more than 5 raw gear changes", () => {
        const result = computeAnxiety(realSetlist, BAND_CONFIG);
        // The user saw "5 gear changes across 2 of 14 transitions" — this was wrong.
        // Manual count: nick's picking alone changes on nearly every transition.
        expect(result.rawChanges).toBeGreaterThan(5);
    });

    it("detects changes on more than 2 transitions", () => {
        const result = computeAnxiety(realSetlist, BAND_CONFIG);
        expect(result.transitionsDisrupted).toBeGreaterThan(2);
    });

    it("scores anxiety higher than 3 for this change-heavy setlist", () => {
        const result = computeAnxiety(realSetlist, BAND_CONFIG);
        expect(result.scaled).toBeGreaterThan(3);
    });

    it("produces a detail entry for each transition", () => {
        const result = computeAnxiety(realSetlist, BAND_CONFIG);
        expect(result.details).toHaveLength(14);
        expect(result.details[0].from).toBe("O' the Topside");
        expect(result.details[0].to).toBe("Bob Dylan");
    });

    it("detail entries include per-prop change breakdowns", () => {
        const result = computeAnxiety(realSetlist, BAND_CONFIG);
        // Transition from song 1 (O' the Topside) to song 2 (Bob Dylan) —
        // mark and nick disappear, so instruments should detect on/off.
        const t1 = result.details[0];
        expect(t1.changes.instruments).toBeDefined();
        // Both mark and nick disappear
        expect(t1.changes.instruments.changed).toBe(true);
        expect(t1.changes.instruments.magnitude).toBe(2);
    });

    it("detects nick's picking changes across transitions", () => {
        const result = computeAnxiety(realSetlist, BAND_CONFIG);

        // Tubsies Requiem (clawhammer) → Run Along (picking)
        // index 2 → index 3, detail index 2
        const t_tubsies_to_run = result.details[2];
        expect(t_tubsies_to_run.from).toBe("Tubsies Requiem");
        expect(t_tubsies_to_run.to).toBe("Run Along");
        expect(t_tubsies_to_run.changes.picking.changed).toBe(true);

        // Run Along (picking) → In a Station Wagon (clawhammer)
        const t_run_to_station = result.details[3];
        expect(t_run_to_station.from).toBe("Run Along");
        expect(t_run_to_station.to).toBe("In a Station Wagon");
        expect(t_run_to_station.changes.picking.changed).toBe(true);

        // In a Station Wagon (clawhammer) → Courtroom Sketch Artist (picking)
        const t_station_to_court = result.details[4];
        expect(t_station_to_court.changes.picking.changed).toBe(true);
    });
});


// ===================================================================
// computeAnxiety — varying inputs
// ===================================================================
describe("computeAnxiety — no changes", () => {
    it("returns 0 for identical songs", () => {
        const songs = Array.from({ length: 10 }, (_, i) =>
            song(`Song ${i + 1}`, "G", { nick: { instrument: "guitar", tuning: "Standard", picking: [] } })
        );
        const result = computeAnxiety(songs, BAND_CONFIG);
        expect(result.scaled).toBe(0);
        expect(result.rawChanges).toBe(0);
        expect(result.transitionsDisrupted).toBe(0);
    });
});

describe("computeAnxiety — single transition", () => {
    it("handles a 2-song setlist with one change", () => {
        const songs = [
            song("A", "G", { nick: { tuning: "Standard" } }),
            song("B", "G", { nick: { tuning: "DADGAD" } })
        ];
        const result = computeAnxiety(songs, BAND_CONFIG);
        expect(result.totalTransitions).toBe(1);
        expect(result.rawChanges).toBe(1);
        expect(result.transitionsDisrupted).toBe(1);
        expect(result.details).toHaveLength(1);
        expect(result.scaled).toBeGreaterThan(0);
    });
});

describe("computeAnxiety — every transition has changes", () => {
    it("returns high anxiety when every song boundary has gear swaps", () => {
        const songs = [];
        for (let i = 0; i < 10; i++) {
            songs.push(song(`Song ${i + 1}`, "G", {
                nick: { tuning: i % 2 === 0 ? "Standard" : "DADGAD", picking: i % 2 === 0 ? ["picking"] : ["clawhammer"] },
                mark: { instrument: i % 2 === 0 ? "guitar" : "banjo", capo: i % 3 }
            }));
        }
        const result = computeAnxiety(songs, BAND_CONFIG);
        expect(result.transitionsDisrupted).toBe(9);
        expect(result.scaled).toBeGreaterThanOrEqual(7);
    });
});

describe("computeAnxiety — grouped vs scattered changes", () => {
    it("scores scattered changes higher than grouped changes (same total)", () => {
        // Scattered: change on every other transition
        const scattered = [];
        for (let i = 0; i < 10; i++) {
            scattered.push(song(`S${i + 1}`, "G", {
                nick: { tuning: i % 2 === 0 ? "Standard" : "DADGAD" }
            }));
        }

        // Grouped: all changes in a burst, then stable
        const grouped = [];
        for (let i = 0; i < 10; i++) {
            const tunings = ["Standard", "DADGAD", "Open G", "Drop D", "Standard"];
            grouped.push(song(`G${i + 1}`, "G", {
                nick: { tuning: i < 5 ? tunings[i] : "Standard" }
            }));
        }

        const scatteredResult = computeAnxiety(scattered, BAND_CONFIG);
        const groupedResult = computeAnxiety(grouped, BAND_CONFIG);

        // Scattered should have higher anxiety (more transitions disrupted)
        expect(scatteredResult.transitionsDisrupted).toBeGreaterThan(groupedResult.transitionsDisrupted);
        // The spread factor should make scattered score higher
        expect(scatteredResult.weightedScore).toBeGreaterThan(groupedResult.weightedScore);
    });
});


// ===================================================================
// computeAnxiety — different weight configurations
// ===================================================================
describe("computeAnxiety — weight sensitivity", () => {
    const baseSongs = [
        song("A", "G", { nick: { tuning: "Standard", picking: ["picking"] } }),
        song("B", "G", { nick: { tuning: "DADGAD", picking: ["clawhammer"] } }),
        song("C", "G", { nick: { tuning: "Open G", picking: ["picking"] } })
    ];

    it("higher tuning weight increases anxiety for tuning-heavy setlist", () => {
        const lowWeight = { ...BAND_CONFIG, general: { weighting: { ...BAND_CONFIG.general.weighting, tuning: 1 } } };
        const highWeight = { ...BAND_CONFIG, general: { weighting: { ...BAND_CONFIG.general.weighting, tuning: 10 } } };

        const lowResult = computeAnxiety(baseSongs, lowWeight);
        const highResult = computeAnxiety(baseSongs, highWeight);

        expect(highResult.weightedScore).toBeGreaterThan(lowResult.weightedScore);
    });

    it("zero weight means prop changes don't affect weighted score", () => {
        const zeroConfig = {
            general: { weighting: { tuning: 0, capo: 0, instrument: 0, technique: 0 } },
            props: BAND_CONFIG.props
        };

        const result = computeAnxiety(baseSongs, zeroConfig);
        expect(result.weightedScore).toBe(0);
        expect(result.scaled).toBe(0);
        // But raw changes should still be counted
        expect(result.rawChanges).toBeGreaterThan(0);
    });
});


// ===================================================================
// computeAnxiety — no props configured
// ===================================================================
describe("computeAnxiety — no props", () => {
    it("returns 0 anxiety when config has no props", () => {
        const songs = [
            song("A", "G", { nick: { tuning: "Standard" } }),
            song("B", "G", { nick: { tuning: "DADGAD" } })
        ];
        const result = computeAnxiety(songs, { general: { weighting: {} }, props: {} });
        expect(result.scaled).toBe(0);
        expect(result.rawChanges).toBe(0);
    });
});


// ===================================================================
// computeAnxiety — edge cases
// ===================================================================
describe("computeAnxiety — edge cases", () => {
    it("handles single song", () => {
        const result = computeAnxiety([song("Only", "G")], BAND_CONFIG);
        expect(result.scaled).toBe(0);
        expect(result.totalTransitions).toBe(1); // Math.max(1, 0)
        expect(result.details).toHaveLength(0);
    });

    it("handles empty setlist", () => {
        const result = computeAnxiety([], BAND_CONFIG);
        expect(result.scaled).toBe(0);
        expect(result.details).toHaveLength(0);
    });

    it("handles songs with no performance data", () => {
        const songs = [song("A", "G"), song("B", "D"), song("C", "E")];
        const result = computeAnxiety(songs, BAND_CONFIG);
        expect(result.rawChanges).toBe(0);
        expect(result.scaled).toBe(0);
    });

    it("handles songs where members appear and disappear", () => {
        const songs = [
            song("A", "G", { nick: { instrument: "banjo" } }),
            song("B", "G", {}),
            song("C", "G", { nick: { instrument: "banjo" } })
        ];
        const result = computeAnxiety(songs, BAND_CONFIG);
        // nick disappears then reappears — instrument set changes
        expect(result.rawChanges).toBeGreaterThan(0);
    });
});


// ===================================================================
// computeAnxiety — large setlists
// ===================================================================
describe("computeAnxiety — scaling", () => {
    it("anxiety scales with setlist length", () => {
        function makeAlternating(count) {
            return Array.from({ length: count }, (_, i) =>
                song(`S${i + 1}`, "G", {
                    nick: { tuning: i % 2 === 0 ? "Standard" : "DADGAD" }
                })
            );
        }

        const short = computeAnxiety(makeAlternating(5), BAND_CONFIG);
        const long = computeAnxiety(makeAlternating(20), BAND_CONFIG);

        // Both have ~100% disrupted transitions, so spread ratio ≈ 1
        // But longer setlist has more total changes. Scaled should be similar
        // because baselines also scale with song count.
        expect(short.rawChanges).toBeLessThan(long.rawChanges);
        // Scaled should be roughly comparable (both near max for their length)
        expect(Math.abs(short.scaled - long.scaled)).toBeLessThanOrEqual(2);
    });
});


// ===================================================================
// anxietyLabel
// ===================================================================
describe("anxietyLabel", () => {
    it("returns relaxed message for 0 changes", () => {
        const label = anxietyLabel({ scaled: 0, rawChanges: 0, transitionsDisrupted: 0, totalTransitions: 14 });
        expect(label).toContain("relaxed");
    });

    it("returns 'barely notices' for low anxiety", () => {
        const label = anxietyLabel({ scaled: 1, rawChanges: 2, transitionsDisrupted: 1, totalTransitions: 14 });
        expect(label).toContain("barely notices");
        expect(label).toContain("1 of 14 transitions");
    });

    it("returns 'crowd work' for medium anxiety", () => {
        const label = anxietyLabel({ scaled: 4, rawChanges: 8, transitionsDisrupted: 5, totalTransitions: 14 });
        expect(label).toContain("crowd work");
    });

    it("returns 'sweating' for high anxiety", () => {
        const label = anxietyLabel({ scaled: 7, rawChanges: 15, transitionsDisrupted: 10, totalTransitions: 14 });
        expect(label).toContain("sweating");
    });

    it("returns 'stand-up set' for extreme anxiety", () => {
        const label = anxietyLabel({ scaled: 9, rawChanges: 25, transitionsDisrupted: 14, totalTransitions: 14 });
        expect(label).toContain("stand-up set");
    });

    it("pluralizes 'gear change' correctly", () => {
        expect(anxietyLabel({ scaled: 1, rawChanges: 1, transitionsDisrupted: 1, totalTransitions: 5 }))
            .toContain("1 gear change ");
        expect(anxietyLabel({ scaled: 2, rawChanges: 3, transitionsDisrupted: 2, totalTransitions: 5 }))
            .toContain("3 gear changes");
    });
});


// ===================================================================
// Comprehensive transition-by-transition verification
// ===================================================================
describe("transition-by-transition detail verification", () => {
    const setlist = [
        song("Song 1", "G", { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: ["picking"] } }),
        song("Song 2", "G", { nick: { instrument: "guitar", tuning: "DADGAD", capo: 0, picking: ["picking"] } }),
        song("Song 3", "G", { nick: { instrument: "banjo", tuning: "Open G", capo: 0, picking: ["clawhammer"] } }),
        song("Song 4", "G", { nick: { instrument: "banjo", tuning: "Open G", capo: 2, picking: ["clawhammer"] } }),
        song("Song 5", "G", { nick: { instrument: "guitar", tuning: "Standard", capo: 0, picking: ["picking"] } })
    ];

    it("transition 1→2: tuning change only", () => {
        const result = computeAnxiety(setlist, BAND_CONFIG);
        const t = result.details[0];
        expect(t.changes.tuning.changed).toBe(true);
        expect(t.changes.tuning.magnitude).toBe(1);
        expect(t.changes.instruments.changed).toBe(false);
        expect(t.changes.capo.changed).toBe(false);
        expect(t.changes.picking.changed).toBe(false);
    });

    it("transition 2→3: instrument + tuning + picking change", () => {
        const result = computeAnxiety(setlist, BAND_CONFIG);
        const t = result.details[1];
        expect(t.changes.instruments.changed).toBe(true);
        expect(t.changes.instruments.magnitude).toBe(1);
        expect(t.changes.tuning.changed).toBe(true);
        expect(t.changes.picking.changed).toBe(true);
        expect(t.changes.capo.changed).toBe(false);
        // Score: instrument(3) + tuning(4) + technique(1) = 8
        expect(t.score).toBe(8);
    });

    it("transition 3→4: capo change only (delta=2)", () => {
        const result = computeAnxiety(setlist, BAND_CONFIG);
        const t = result.details[2];
        expect(t.changes.capo.changed).toBe(true);
        expect(t.changes.capo.magnitude).toBe(2);
        expect(t.changes.instruments.changed).toBe(false);
        expect(t.changes.tuning.changed).toBe(false);
        expect(t.changes.picking.changed).toBe(false);
        // Score: capo magnitude 2 * weight 2 = 4
        expect(t.score).toBe(4);
    });

    it("transition 4→5: everything changes", () => {
        const result = computeAnxiety(setlist, BAND_CONFIG);
        const t = result.details[3];
        expect(t.changes.instruments.changed).toBe(true);
        expect(t.changes.tuning.changed).toBe(true);
        expect(t.changes.capo.changed).toBe(true);
        expect(t.changes.capo.magnitude).toBe(2); // |2-0|
        expect(t.changes.picking.changed).toBe(true);
        // instrument(3) + tuning(4) + capo(2*2=4) + technique(1) = 12
        expect(t.score).toBe(12);
    });

    it("total rawChanges matches sum of detail rawChanges", () => {
        const result = computeAnxiety(setlist, BAND_CONFIG);
        const sumFromDetails = result.details.reduce((sum, d) => sum + d.rawChanges, 0);
        expect(result.rawChanges).toBe(sumFromDetails);
    });

    it("transitionsDisrupted matches count of non-zero detail entries", () => {
        const result = computeAnxiety(setlist, BAND_CONFIG);
        const disrupted = result.details.filter(d => d.rawChanges > 0).length;
        expect(result.transitionsDisrupted).toBe(disrupted);
    });
});
