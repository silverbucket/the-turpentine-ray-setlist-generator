/**
 * Bass Player Anxiety — standalone setlist transition scoring.
 *
 * Analyses a fixed-order setlist and returns how many gear changes happen,
 * where they happen, and a 0-10 "anxiety" score scaled to the band's own
 * configuration weights.
 *
 * Usage:
 *   import { computeAnxiety } from "./anxiety.js";
 *   const result = computeAnxiety(songs, config);
 *   // result.scaled          — 0-10 integer
 *   // result.rawChanges      — total magnitude across all props
 *   // result.weightedScore   — magnitude * weight, adjusted for spread
 *   // result.transitionsDisrupted — how many song boundaries had a change
 *   // result.totalTransitions     — songCount - 1
 *   // result.details         — per-transition breakdown
 */


// ---------------------------------------------------------------------------
// Change detection helpers (pure functions, no class state)
// ---------------------------------------------------------------------------

function normalizeValue(value) {
    if (value === undefined || value === null) return "";
    if (Array.isArray(value)) return value.slice().sort().join(",");
    return String(value);
}

function displayValue(value) {
    if (value === undefined || value === null || value === "") return "default";
    if (Array.isArray(value)) return value.length === 0 ? "default" : value.join(", ");
    return String(value);
}

/**
 * Detect whether a member's instrument itself changed (e.g. guitar → banjo).
 * Also detects members appearing / disappearing between songs.
 */
function detectInstrumentSetChange(prevPerf, nextPerf) {
    const members = new Set([
        ...Object.keys(prevPerf),
        ...Object.keys(nextPerf)
    ]);
    const notes = [];
    let magnitude = 0;

    for (const member of Array.from(members).sort()) {
        const prev = prevPerf[member];
        const next = nextPerf[member];

        if (!prev || !next) {
            magnitude += 1;
            notes.push(`${member} instrument on/off`);
            continue;
        }
        if (prev.instrument !== next.instrument) {
            magnitude += 1;
            notes.push(`${member} instrument ${prev.instrument} -> ${next.instrument}`);
        }
    }

    return { changed: magnitude > 0, magnitude, notes };
}

/**
 * Detect value changes for a given field across all members present in
 * EITHER song (not just shared members — a member disappearing or appearing
 * is itself a change worth noting for field-level props).
 */
function detectFieldChange(prevPerf, nextPerf, field, scaleByDelta) {
    const allMembers = new Set([
        ...Object.keys(prevPerf),
        ...Object.keys(nextPerf)
    ]);
    const notes = [];
    let magnitude = 0;

    for (const member of Array.from(allMembers).sort()) {
        const prev = prevPerf[member];
        const next = nextPerf[member];

        // Member only in one song — skip field comparison (instrument set
        // change handles the on/off transition).
        if (!prev || !next) continue;

        const prevValue = prev[field];
        const nextValue = next[field];

        const left = normalizeValue(prevValue);
        const right = normalizeValue(nextValue);

        if (left === right) continue;

        const amount = scaleByDelta
            ? Math.abs((Number(prevValue) || 0) - (Number(nextValue) || 0))
            : 1;
        if (!amount) continue;

        magnitude += amount;
        notes.push(`${member} ${field} ${displayValue(prevValue)} -> ${displayValue(nextValue)}`);
    }

    return { changed: magnitude > 0, magnitude, notes };
}


// ---------------------------------------------------------------------------
// Per-transition scoring
// ---------------------------------------------------------------------------

/**
 * Score one transition (prevSong → nextSong) across all configured props.
 *
 * @param {object|null} prevSong - previous song (null for first song)
 * @param {object} nextSong - current song
 * @param {string[]} propNames - ordered property names
 * @param {object} propConfig - prop name → rule
 * @param {object} weights - weightKey → numeric weight
 * @returns {{ score: number, notes: string[], changes: object }}
 */
function scoreTransition(prevSong, nextSong, propNames, propConfig, weights) {
    if (!prevSong) {
        const changes = {};
        for (const p of propNames) changes[p] = { changed: false, magnitude: 0, notes: [] };
        return { score: 0, notes: [], changes };
    }

    const prevPerf = prevSong.performance || {};
    const nextPerf = nextSong.performance || {};

    const changes = {};
    const notes = [];
    let score = 0;

    for (const propName of propNames) {
        const rule = propConfig[propName] || {};
        const kind = rule.kind || inferPropKind(propName);
        let change;

        if (kind === "instrumentSet") {
            change = detectInstrumentSetChange(prevPerf, nextPerf);
        } else if (kind === "instrumentDelta") {
            change = detectFieldChange(prevPerf, nextPerf, rule.field || propName, true);
        } else {
            // instrumentField and instrumentBoolean both use field comparison.
            // The normalizeValue handles arrays, strings, and booleans uniformly.
            change = detectFieldChange(prevPerf, nextPerf, rule.field || propName, false);
        }

        changes[propName] = change;
        if (change.changed) {
            const weightKey = rule.weightKey || propName;
            const w = weights[weightKey] || 0;
            score += change.magnitude * w;
            notes.push(...change.notes);
        }
    }

    return { score, notes, changes };
}

function inferPropKind(propName) {
    if (propName === "instruments") return "instrumentSet";
    if (propName === "capo") return "instrumentDelta";
    return "instrumentField";
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS = {
    positionMiss: 8,
    earlyCover: 6,
    earlyInstrumental: 4
};

/**
 * Compute the Bass Player Anxiety score for a fixed-order setlist.
 *
 * @param {object[]} songs - ordered array of song objects with `.performance`
 * @param {object} config - app config with `.props` and `.general.weighting`
 * @returns {AnxietyResult}
 *
 * @typedef {object} AnxietyResult
 * @property {number} scaled - 0-10 integer score
 * @property {number} rawChanges - total magnitude across all props & transitions
 * @property {number} weightedScore - magnitude * weight, spread-adjusted
 * @property {number} transitionsDisrupted - transitions with at least one change
 * @property {number} totalTransitions - songCount - 1
 * @property {TransitionDetail[]} details - per-transition breakdown
 *
 * @typedef {object} TransitionDetail
 * @property {number} index - transition index (1-based, matching song position)
 * @property {string} from - previous song name
 * @property {string} to - current song name
 * @property {object} changes - propName → { changed, magnitude, notes }
 * @property {string[]} notes - aggregated human-readable notes
 * @property {number} score - weighted score for this transition
 */
export function computeAnxiety(songs, config) {
    const weights = Object.assign({}, DEFAULT_WEIGHTS, config?.general?.weighting || {});
    const propNames = Object.keys(config?.props || {});
    const propConfig = config?.props || {};

    const totalTransitions = Math.max(1, songs.length - 1);
    let totalWeighted = 0;
    let totalRawChanges = 0;
    let transitionsWithChanges = 0;
    const details = [];

    for (let i = 1; i < songs.length; i++) {
        const prev = songs[i - 1];
        const curr = songs[i];
        const transition = scoreTransition(prev, curr, propNames, propConfig, weights);

        let hasChange = false;
        let transitionRaw = 0;

        for (const propName of propNames) {
            const change = transition.changes[propName];
            if (change && change.changed) {
                const weightKey = (propConfig[propName] || {}).weightKey || propName;
                const w = weights[weightKey] || 0;
                totalWeighted += change.magnitude * w;
                totalRawChanges += change.magnitude;
                transitionRaw += change.magnitude;
                hasChange = true;
            }
        }

        if (hasChange) transitionsWithChanges++;

        details.push({
            index: i,
            from: prev.name || `Song ${i}`,
            to: curr.name || `Song ${i + 1}`,
            changes: transition.changes,
            notes: transition.notes,
            score: transition.score,
            rawChanges: transitionRaw
        });
    }

    // Spread factor: scattered changes = more dead-air moments = worse
    const spreadRatio = transitionsWithChanges / totalTransitions;
    const adjustedWeighted = totalWeighted * (0.5 + spreadRatio * 0.5);

    // Dynamic scale from the band's own weights
    let avgWeight = 0;
    if (propNames.length > 0) {
        let sumW = 0;
        for (const propName of propNames) {
            const weightKey = (propConfig[propName] || {}).weightKey || propName;
            sumW += weights[weightKey] || 0;
        }
        avgWeight = sumW / propNames.length;
    }

    const mediumBaseline = totalTransitions * 0.3 * avgWeight;
    const maxBaseline = totalTransitions * avgWeight * 2;

    let scaled;
    if (maxBaseline <= 0) {
        scaled = 0;
    } else if (adjustedWeighted <= mediumBaseline) {
        scaled = Math.round((adjustedWeighted / mediumBaseline) * 5);
    } else {
        scaled = 5 + Math.round(((adjustedWeighted - mediumBaseline) / (maxBaseline - mediumBaseline)) * 5);
    }
    scaled = Math.max(0, Math.min(10, scaled));

    return {
        scaled,
        rawChanges: totalRawChanges,
        weightedScore: Math.round(adjustedWeighted * 10) / 10,
        transitionsDisrupted: transitionsWithChanges,
        totalTransitions,
        details
    };
}


/**
 * Generate a human-readable label for a given anxiety result.
 */
export function anxietyLabel(result) {
    const { scaled, rawChanges, transitionsDisrupted, totalTransitions } = result;
    const spreadNote = transitionsDisrupted > 0
        ? ` across ${transitionsDisrupted} of ${totalTransitions} transitions`
        : "";

    if (rawChanges === 0) {
        return "Bass player is relaxed for once. Zero gear changes — smooth sailing.";
    }
    if (scaled <= 2) {
        return `${rawChanges} gear change${rawChanges === 1 ? "" : "s"}${spreadNote}. Bass player barely notices.`;
    }
    if (scaled <= 5) {
        return `${rawChanges} gear changes${spreadNote}. Bass player is rehearsing crowd work.`;
    }
    if (scaled <= 7) {
        return `${rawChanges} gear changes${spreadNote}. Bass player is visibly sweating.`;
    }
    return `${rawChanges} gear changes${spreadNote}. Bass player is writing a stand-up set to fill all the dead air.`;
}


// Export internals for testing
export const _internals = {
    normalizeValue,
    displayValue,
    detectInstrumentSetChange,
    detectFieldChange,
    scoreTransition,
    inferPropKind
};
