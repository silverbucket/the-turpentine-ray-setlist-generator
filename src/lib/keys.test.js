import { describe, expect, it } from "vitest";
import {
    ALL_KEYS,
    fifthsDirection,
    fifthsPosition,
    keyDistance,
    MAJOR_KEYS,
    MINOR_KEYS,
    parseKey,
    scoreKeyTransition,
} from "./keys.js";

describe("parseKey", () => {
    it("parses major keys", () => {
        expect(parseKey("C")).toEqual({ pitch: 0, minor: false });
        expect(parseKey("G")).toEqual({ pitch: 7, minor: false });
        expect(parseKey("F#")).toEqual({ pitch: 6, minor: false });
        expect(parseKey("Bb")).toEqual({ pitch: 10, minor: false });
    });

    it("parses minor keys", () => {
        expect(parseKey("Am")).toEqual({ pitch: 9, minor: true });
        expect(parseKey("F#m")).toEqual({ pitch: 6, minor: true });
        expect(parseKey("Ebm")).toEqual({ pitch: 3, minor: true });
    });

    it("handles enharmonic equivalents", () => {
        expect(parseKey("C#").pitch).toBe(parseKey("Db").pitch);
        expect(parseKey("D#").pitch).toBe(parseKey("Eb").pitch);
        expect(parseKey("F#").pitch).toBe(parseKey("Gb").pitch);
        expect(parseKey("G#").pitch).toBe(parseKey("Ab").pitch);
        expect(parseKey("A#").pitch).toBe(parseKey("Bb").pitch);
    });

    it("returns null for empty or invalid input", () => {
        expect(parseKey("")).toBeNull();
        expect(parseKey(null)).toBeNull();
        expect(parseKey(undefined)).toBeNull();
        expect(parseKey("X")).toBeNull();
        expect(parseKey("Hm")).toBeNull();
        expect(parseKey("  ")).toBeNull();
    });

    it("trims whitespace", () => {
        expect(parseKey(" G ")).toEqual({ pitch: 7, minor: false });
    });
});

describe("keyDistance", () => {
    it("returns 0 for same key", () => {
        expect(keyDistance("C", "C")).toBe(0);
        expect(keyDistance("F#", "F#")).toBe(0);
        expect(keyDistance("Am", "Am")).toBe(0);
    });

    it("returns 0 for enharmonic equivalents", () => {
        expect(keyDistance("C#", "Db")).toBe(0);
        expect(keyDistance("F#", "Gb")).toBe(0);
        expect(keyDistance("Bb", "A#")).toBe(0);
    });

    it("returns 0 for relative major/minor pairs", () => {
        expect(keyDistance("C", "Am")).toBe(0);
        expect(keyDistance("Am", "C")).toBe(0);
        expect(keyDistance("G", "Em")).toBe(0);
        expect(keyDistance("Eb", "Cm")).toBe(0);
        expect(keyDistance("A", "F#m")).toBe(0);
    });

    it("returns 1 for keys one fifth apart", () => {
        expect(keyDistance("C", "G")).toBe(1);
        expect(keyDistance("C", "F")).toBe(1);
        expect(keyDistance("G", "D")).toBe(1);
        expect(keyDistance("Bb", "F")).toBe(1);
    });

    it("returns correct distance for further keys", () => {
        expect(keyDistance("C", "D")).toBe(2); // two fifths
        expect(keyDistance("C", "A")).toBe(3); // three fifths
        expect(keyDistance("C", "E")).toBe(4); // four fifths
        expect(keyDistance("C", "B")).toBe(5); // five fifths
        expect(keyDistance("C", "F#")).toBe(6); // tritone (max distance)
        expect(keyDistance("C", "Gb")).toBe(6); // tritone via enharmonic
    });

    it("is symmetric", () => {
        expect(keyDistance("C", "E")).toBe(keyDistance("E", "C"));
        expect(keyDistance("Am", "D")).toBe(keyDistance("D", "Am"));
    });

    it("returns null when either key is empty or invalid", () => {
        expect(keyDistance("C", "")).toBeNull();
        expect(keyDistance("", "G")).toBeNull();
        expect(keyDistance("", "")).toBeNull();
        expect(keyDistance("C", null)).toBeNull();
        expect(keyDistance("X", "G")).toBeNull();
    });

    it("handles minor-to-minor distances via relative major", () => {
        // Am (rel C) to Em (rel G) = 1 fifth
        expect(keyDistance("Am", "Em")).toBe(1);
        // Am (rel C) to Dm (rel F) = 1 fifth
        expect(keyDistance("Am", "Dm")).toBe(1);
    });
});

describe("fifthsPosition", () => {
    it("returns correct circle-of-fifths positions", () => {
        expect(fifthsPosition("C")).toBe(0);
        expect(fifthsPosition("G")).toBe(1);
        expect(fifthsPosition("D")).toBe(2);
        expect(fifthsPosition("A")).toBe(3);
        expect(fifthsPosition("F")).toBe(11);
        expect(fifthsPosition("Bb")).toBe(10);
    });

    it("converts minor keys to relative major position", () => {
        // Am is relative to C (position 0)
        expect(fifthsPosition("Am")).toBe(0);
        // Em is relative to G (position 1)
        expect(fifthsPosition("Em")).toBe(1);
    });

    it("returns null for invalid keys", () => {
        expect(fifthsPosition("")).toBeNull();
        expect(fifthsPosition(null)).toBeNull();
    });
});

describe("fifthsDirection", () => {
    it("returns positive for clockwise movement (sharps)", () => {
        // C to G = +1 on circle of fifths
        expect(fifthsDirection("C", "G")).toBe(1);
        // C to D = +2
        expect(fifthsDirection("C", "D")).toBe(2);
    });

    it("returns negative for counterclockwise movement (flats)", () => {
        // C to F = -1 on circle of fifths
        expect(fifthsDirection("C", "F")).toBe(-1);
        // C to Bb = -2
        expect(fifthsDirection("C", "Bb")).toBe(-2);
    });

    it("returns 0 for same key", () => {
        expect(fifthsDirection("C", "C")).toBe(0);
        expect(fifthsDirection("Am", "C")).toBe(0); // relative major/minor
    });

    it("takes shortest path, tritone always returns -6", () => {
        // C to F# = tritone, both directions equal, always returns -6
        expect(fifthsDirection("C", "F#")).toBe(-6);
        expect(fifthsDirection("C", "Gb")).toBe(-6);
    });

    it("is antisymmetric (except tritone)", () => {
        expect(fifthsDirection("C", "G")).toBe(-fifthsDirection("G", "C"));
        // A to D is +5 on circle of fifths, but shortest path is -5 semitones... let's use closer keys
        expect(fifthsDirection("C", "D")).toBe(-fifthsDirection("D", "C"));
        expect(fifthsDirection("G", "F")).toBe(-fifthsDirection("F", "G"));
    });

    it("returns null for invalid keys", () => {
        expect(fifthsDirection("C", "")).toBeNull();
        expect(fifthsDirection("", "G")).toBeNull();
    });
});

describe("scoreKeyTransition", () => {
    it("returns zero score for null keys", () => {
        expect(scoreKeyTransition("C", "", 0, 2)).toEqual({ score: 0, dir: 0 });
        expect(scoreKeyTransition("", "G", 0, 2)).toEqual({ score: 0, dir: 0 });
    });

    it("scores based on distance times weight", () => {
        // C to G = distance 1, weight 4 → score 4
        const result = scoreKeyTransition("C", "G", 0, 4);
        expect(result.score).toBe(4);
        expect(result.dir).toBe(1); // clockwise
    });

    it("adds reversal penalty when direction flips", () => {
        // Both G→D and G→C are 1 fifth apart (distance 1), but G→C reverses direction
        const noReversal = scoreKeyTransition("G", "D", 1, 4); // continues clockwise, dist 1
        const reversal = scoreKeyTransition("G", "C", 1, 4); // reverses counterclockwise, dist 1
        // Same distance, so the difference is purely the reversal penalty (weight * 1.5 = 6)
        expect(reversal.score - noReversal.score).toBe(6);
    });

    it("preserves previous direction when current keys are the same", () => {
        const result = scoreKeyTransition("C", "Am", 3, 2); // relative major/minor = distance 0
        expect(result.score).toBe(0);
        expect(result.dir).toBe(3); // preserved
    });
});

describe("key lists", () => {
    it("has 12 major keys", () => {
        expect(MAJOR_KEYS).toHaveLength(12);
    });

    it("has 12 minor keys", () => {
        expect(MINOR_KEYS).toHaveLength(12);
    });

    it("ALL_KEYS combines both", () => {
        expect(ALL_KEYS).toHaveLength(24);
        expect(ALL_KEYS).toEqual([...MAJOR_KEYS, ...MINOR_KEYS]);
    });

    it("all keys are parseable", () => {
        for (const key of ALL_KEYS) {
            expect(parseKey(key)).not.toBeNull();
        }
    });
});
