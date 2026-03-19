/**
 * Bass Player Anxiety — standalone setlist transition scoring.
 *
 * Analyses a fixed-order setlist and returns how many gear changes happen,
 * where they happen, and a 0-10 "anxiety" score scaled to the band's own
 * configuration weights.
 *
 * Per-member deduplication: when one member changes multiple things at the
 * same transition (e.g. capo AND picking), it counts as ONE change scored
 * at the highest-weighted prop that changed for that member.
 *
 * Usage:
 *   import { computeAnxiety } from "./anxiety.js";
 *   const result = computeAnxiety(songs, config);
 *   // result.scaled      — 0-10 integer
 *   // result.changes     — disrupted transition spots
 *   // result.memberChanges — total member-changes (deduplicated per member per spot)
 *   // result.spots       — how many song boundaries had a change
 *   // result.songCount   — total songs in setlist
 *   // result.weightedScore — max-weight per member, adjusted for spread
 *   // result.details     — per-transition breakdown
 */

import {
    normalizeValue,
    displayValue,
    detectInstrumentSetChange,
    detectFieldChange,
    inferPropKind
} from "./detection.js";


// ---------------------------------------------------------------------------
// Per-transition scoring
// ---------------------------------------------------------------------------

/**
 * Score one transition (prevSong → nextSong) across all configured props.
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


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS = {
    positionMiss: 8,
    earlyCover: 6,
    earlyInstrumental: 4
};

export const ANXIETY_WEIGHT_EXPONENT = 1.35;

function anxietyWeightPressure(weight) {
    if (weight <= 0) {
        return 0;
    }
    return Math.pow(weight, ANXIETY_WEIGHT_EXPONENT);
}

export function scoreAnxietyPressure(prevSong, nextSong, propNames, propConfig, weights) {
    if (!prevSong) {
        return { changed: false, memberChanges: 0, weightedScore: 0 };
    }

    const prevPerf = prevSong.performance || {};
    const nextPerf = nextSong.performance || {};
    const allMembers = new Set([...Object.keys(prevPerf), ...Object.keys(nextPerf)]);

    let memberChanges = 0;
    let weightedScore = 0;

    for (const member of allMembers) {
        let maxWeight = 0;

        for (const propName of propNames) {
            const rule = propConfig[propName] || {};
            const kind = rule.kind || inferPropKind(propName);
            const weightKey = rule.weightKey || propName;
            const weight = weights[weightKey] || 0;
            const prevMember = prevPerf[member];
            const nextMember = nextPerf[member];
            let changed = false;

            if (kind === "instrumentSet") {
                if (!prevMember || !nextMember) changed = true;
                else if (prevMember.instrument !== nextMember.instrument) changed = true;
            } else if (prevMember && nextMember) {
                const field = rule.field || propName;
                const left = normalizeValue(prevMember[field]);
                const right = normalizeValue(nextMember[field]);
                if (left !== right) changed = true;
            }

            if (changed && weight > maxWeight) {
                maxWeight = weight;
            }
        }

        if (maxWeight > 0) {
            memberChanges += 1;
            weightedScore += anxietyWeightPressure(maxWeight);
        }
    }

    return {
        changed: memberChanges > 0,
        memberChanges,
        weightedScore
    };
}

/**
 * Compute the Bass Player Anxiety score for a fixed-order setlist.
 *
 * @param {object[]} songs - ordered array of song objects with `.performance`
 * @param {object} config - app config with `.props` and `.general.weighting`
 * @returns {AnxietyResult}
 */
export function computeAnxiety(songs, config) {
    const weights = Object.assign({}, DEFAULT_WEIGHTS, config?.general?.weighting || {});
    const propNames = Object.keys(config?.props || {});
    const propConfig = config?.props || {};

    const totalTransitions = songs.length - 1;
    let totalWeighted = 0;
    let totalMemberChanges = 0;
    let spotsWithChanges = 0;
    let peakWeighted = 0;
    const details = [];

    for (let i = 1; i < songs.length; i++) {
        const prev = songs[i - 1];
        const curr = songs[i];

        // Keep scoreTransition for per-prop notes/details
        const transition = scoreTransition(prev, curr, propNames, propConfig, weights);

        const pressure = scoreAnxietyPressure(prev, curr, propNames, propConfig, weights);

        if (pressure.changed) spotsWithChanges++;
        totalWeighted += pressure.weightedScore;
        totalMemberChanges += pressure.memberChanges;
        peakWeighted = Math.max(peakWeighted, pressure.weightedScore);

        details.push({
            index: i,
            from: prev.name || `Song ${i}`,
            to: curr.name || `Song ${i + 1}`,
            changes: transition.changes,
            notes: transition.notes,
            score: pressure.weightedScore,
            memberChanges: pressure.memberChanges
        });
    }

    // Spread factor: changes spread across many spots = more dead-air moments = worse.
    // Using power curve so sparse changes (e.g. 3/14) are meaningfully dampened,
    // while dense disruption (most spots affected) stays close to full weight.
    const spreadRatio = totalTransitions > 0 ? spotsWithChanges / totalTransitions : 0;
    const adjustedWeighted = totalWeighted * Math.pow(spreadRatio, 0.7);

    // Dynamic scale from the band's own weights, with heavier props contributing
    // disproportionately more pressure than lightweight technique changes.
    let avgWeight = 0;
    if (propNames.length > 0) {
        let sumW = 0;
        for (const propName of propNames) {
            const weightKey = (propConfig[propName] || {}).weightKey || propName;
            sumW += anxietyWeightPressure(weights[weightKey] || 0);
        }
        avgWeight = sumW / propNames.length;
    }

    const severityBoost = peakWeighted * 0.55;
    const cadenceBoost = Math.max(0, spotsWithChanges - 2) * avgWeight * 0.16;
    const compositeWeighted = adjustedWeighted + severityBoost + cadenceBoost;

    // Scale against a band-relative maximum and curve the low end downward so
    // scattered capo/technique-only sets do not read as medium anxiety.
    const maxBaseline = Math.max(totalTransitions * 0.7 * avgWeight, avgWeight * 6);
    let scaled = 0;
    if (maxBaseline > 0) {
        const normalized = Math.min(1, compositeWeighted / maxBaseline);
        scaled = Math.round(Math.pow(normalized, 0.8) * 10);
        if (normalized > 0 && scaled === 0) {
            scaled = 1;
        }
    }
    scaled = Math.max(0, Math.min(10, scaled));

    return {
        scaled,
        changes: spotsWithChanges,
        memberChanges: totalMemberChanges,
        spots: spotsWithChanges,
        songCount: songs.length,
        weightedScore: Math.round(compositeWeighted * 10) / 10,
        totalTransitions,
        details
    };
}


/**
 * Generate a human-readable label for a given anxiety result.
 */
export function anxietyLabel(result) {
    const { scaled, changes, spots, songCount } = result;
    const spotNote = spots > 0
        ? ` in ${spots} spot${spots === 1 ? "" : "s"} over ${songCount} songs`
        : "";

    if (changes === 0) {
        return "Bass player is relaxed for once. Zero gear changes — smooth sailing.";
    }
    if (scaled <= 2) {
        return `${changes} change${changes === 1 ? "" : "s"}${spotNote}. Bass player barely notices.`;
    }
    if (scaled <= 5) {
        return `${changes} change${changes === 1 ? "" : "s"}${spotNote}. Bass player is rehearsing crowd work.`;
    }
    if (scaled <= 7) {
        return `${changes} change${changes === 1 ? "" : "s"}${spotNote}. Bass player is visibly sweating.`;
    }
    return `${changes} change${changes === 1 ? "" : "s"}${spotNote}. Bass player is writing a stand-up set to fill all the dead air.`;
}


// Export internals for testing
export const _internals = {
    ANXIETY_WEIGHT_EXPONENT,
    normalizeValue,
    displayValue,
    detectInstrumentSetChange,
    detectFieldChange,
    scoreAnxietyPressure,
    scoreTransition,
    inferPropKind,
    anxietyWeightPressure
};
