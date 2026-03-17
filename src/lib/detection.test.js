import { describe, it, expect } from "vitest";
import {
    normalizeValue,
    displayValue,
    detectInstrumentSetChange,
    detectFieldChange,
    detectInstrumentSetChangeLite,
    detectFieldChangeLite,
    inferPropKind
} from "./detection.js";


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
        expect(normalizeValue(0)).toBe("0");
    });

    it("sorts and joins arrays", () => {
        expect(normalizeValue(["picking", "slide"])).toBe("picking,slide");
        expect(normalizeValue(["slide", "picking"])).toBe("picking,slide");
    });

    it("returns empty string for empty array", () => {
        expect(normalizeValue([])).toBe("");
    });

    it("handles single-element arrays", () => {
        expect(normalizeValue(["clawhammer"])).toBe("clawhammer");
    });
});


// ===================================================================
// displayValue
// ===================================================================
describe("displayValue", () => {
    it("returns 'default' for null/undefined/empty", () => {
        expect(displayValue(null)).toBe("default");
        expect(displayValue(undefined)).toBe("default");
        expect(displayValue("")).toBe("default");
    });

    it("returns 'default' for empty array", () => {
        expect(displayValue([])).toBe("default");
    });

    it("joins arrays with comma-space", () => {
        expect(displayValue(["picking", "slide"])).toBe("picking, slide");
    });

    it("returns string for primitives", () => {
        expect(displayValue("Standard")).toBe("Standard");
        expect(displayValue(2)).toBe("2");
    });
});


// ===================================================================
// detectInstrumentSetChange (full)
// ===================================================================
describe("detectInstrumentSetChange", () => {
    it("no change when instruments stay the same", () => {
        const prev = { nick: { instrument: "banjo" }, mark: { instrument: "guitar" } };
        const next = { nick: { instrument: "banjo" }, mark: { instrument: "guitar" } };
        const r = detectInstrumentSetChange(prev, next);
        expect(r.changed).toBe(false);
        expect(r.magnitude).toBe(0);
        expect(r.notes).toHaveLength(0);
    });

    it("detects instrument swap", () => {
        const prev = { nick: { instrument: "banjo" } };
        const next = { nick: { instrument: "guitar" } };
        const r = detectInstrumentSetChange(prev, next);
        expect(r.changed).toBe(true);
        expect(r.magnitude).toBe(1);
        expect(r.notes[0]).toContain("banjo -> guitar");
    });

    it("detects member appearing", () => {
        const r = detectInstrumentSetChange({}, { nick: { instrument: "banjo" } });
        expect(r.changed).toBe(true);
        expect(r.magnitude).toBe(1);
        expect(r.notes[0]).toContain("on/off");
    });

    it("detects member disappearing", () => {
        const r = detectInstrumentSetChange({ nick: { instrument: "banjo" } }, {});
        expect(r.changed).toBe(true);
        expect(r.magnitude).toBe(1);
    });

    it("counts each member independently", () => {
        const prev = { nick: { instrument: "banjo" }, mark: { instrument: "guitar" } };
        const next = { nick: { instrument: "guitar" }, mark: { instrument: "bass" } };
        const r = detectInstrumentSetChange(prev, next);
        expect(r.magnitude).toBe(2);
    });

    it("detects simultaneous appear + disappear", () => {
        const prev = { nick: { instrument: "banjo" } };
        const next = { mark: { instrument: "guitar" } };
        const r = detectInstrumentSetChange(prev, next);
        expect(r.magnitude).toBe(2); // nick disappears, mark appears
    });
});


// ===================================================================
// detectInstrumentSetChangeLite
// ===================================================================
describe("detectInstrumentSetChangeLite", () => {
    it("no change when same", () => {
        const prev = { nick: { instrument: "banjo" } };
        const next = { nick: { instrument: "banjo" } };
        const r = detectInstrumentSetChangeLite(prev, next);
        expect(r.changed).toBe(false);
        expect(r.magnitude).toBe(0);
        expect(r).not.toHaveProperty("notes");
    });

    it("detects instrument swap", () => {
        const r = detectInstrumentSetChangeLite(
            { nick: { instrument: "banjo" } },
            { nick: { instrument: "guitar" } }
        );
        expect(r.magnitude).toBe(1);
    });

    it("detects member appearing", () => {
        const r = detectInstrumentSetChangeLite({}, { nick: { instrument: "banjo" } });
        expect(r.magnitude).toBe(1);
    });

    it("detects member disappearing", () => {
        const r = detectInstrumentSetChangeLite({ nick: { instrument: "banjo" } }, {});
        expect(r.magnitude).toBe(1);
    });

    it("counts both directions", () => {
        const r = detectInstrumentSetChangeLite(
            { nick: { instrument: "banjo" } },
            { mark: { instrument: "guitar" } }
        );
        expect(r.magnitude).toBe(2);
    });
});


// ===================================================================
// detectFieldChange (full)
// ===================================================================
describe("detectFieldChange", () => {
    it("detects tuning change for shared member", () => {
        const prev = { mark: { tuning: "DADDAD" } };
        const next = { mark: { tuning: "Standard" } };
        const r = detectFieldChange(prev, next, "tuning", false);
        expect(r.changed).toBe(true);
        expect(r.magnitude).toBe(1);
        expect(r.notes[0]).toContain("DADDAD -> Standard");
    });

    it("no change when values match", () => {
        const prev = { mark: { tuning: "Standard" } };
        const next = { mark: { tuning: "Standard" } };
        const r = detectFieldChange(prev, next, "tuning", false);
        expect(r.changed).toBe(false);
    });

    it("capo delta scaling", () => {
        const prev = { nick: { capo: 0 } };
        const next = { nick: { capo: 3 } };
        const r = detectFieldChange(prev, next, "capo", true);
        expect(r.magnitude).toBe(3);
    });

    it("handles array fields — order independent", () => {
        const prev = { nick: { picking: ["slide", "picking"] } };
        const next = { nick: { picking: ["picking", "slide"] } };
        const r = detectFieldChange(prev, next, "picking", false);
        expect(r.changed).toBe(false); // same elements, different order
    });

    it("detects array content change", () => {
        const prev = { nick: { picking: ["picking"] } };
        const next = { nick: { picking: ["clawhammer"] } };
        const r = detectFieldChange(prev, next, "picking", false);
        expect(r.changed).toBe(true);
        expect(r.magnitude).toBe(1);
    });

    it("detects empty array to populated array", () => {
        const prev = { nick: { picking: [] } };
        const next = { nick: { picking: ["slide"] } };
        const r = detectFieldChange(prev, next, "picking", false);
        expect(r.changed).toBe(true);
    });

    it("skips members only in one song", () => {
        const prev = { mark: { tuning: "Standard" } };
        const next = { nick: { tuning: "Open G" } };
        const r = detectFieldChange(prev, next, "tuning", false);
        expect(r.changed).toBe(false); // no shared members for field comparison
    });

    it("counts changes per member independently", () => {
        const prev = { nick: { capo: 0 }, mark: { capo: 0 } };
        const next = { nick: { capo: 2 }, mark: { capo: 3 } };
        const r = detectFieldChange(prev, next, "capo", true);
        expect(r.magnitude).toBe(5); // 2 + 3
    });
});


// ===================================================================
// detectFieldChangeLite
// ===================================================================
describe("detectFieldChangeLite", () => {
    it("detects tuning change", () => {
        const r = detectFieldChangeLite(
            { mark: { tuning: "DADDAD" } },
            { mark: { tuning: "Standard" } },
            "tuning", false
        );
        expect(r.changed).toBe(true);
        expect(r.magnitude).toBe(1);
        expect(r).not.toHaveProperty("notes");
    });

    it("no change when values match", () => {
        const r = detectFieldChangeLite(
            { mark: { tuning: "Standard" } },
            { mark: { tuning: "Standard" } },
            "tuning", false
        );
        expect(r.changed).toBe(false);
    });

    it("handles array fields — order independent", () => {
        const r = detectFieldChangeLite(
            { nick: { picking: ["slide", "picking"] } },
            { nick: { picking: ["picking", "slide"] } },
            "picking", false
        );
        expect(r.changed).toBe(false);
    });

    it("capo delta", () => {
        const r = detectFieldChangeLite(
            { nick: { capo: 0 } },
            { nick: { capo: 4 } },
            "capo", true
        );
        expect(r.magnitude).toBe(4);
    });

    it("skips members only in one song", () => {
        const r = detectFieldChangeLite(
            { mark: { tuning: "Standard" } },
            { nick: { tuning: "Open G" } },
            "tuning", false
        );
        expect(r.changed).toBe(false);
    });
});


// ===================================================================
// inferPropKind
// ===================================================================
describe("inferPropKind", () => {
    it("instruments -> instrumentSet", () => {
        expect(inferPropKind("instruments")).toBe("instrumentSet");
    });

    it("capo -> instrumentDelta", () => {
        expect(inferPropKind("capo")).toBe("instrumentDelta");
    });

    it("tuning -> instrumentField", () => {
        expect(inferPropKind("tuning")).toBe("instrumentField");
    });

    it("picking -> instrumentField (NOT instrumentBoolean)", () => {
        expect(inferPropKind("picking")).toBe("instrumentField");
    });

    it("unknown -> instrumentField", () => {
        expect(inferPropKind("foo")).toBe("instrumentField");
    });
});
