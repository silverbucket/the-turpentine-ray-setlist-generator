// Pitch class indices (0–11), handling enharmonic equivalents
const PITCH_MAP = {
    "C": 0, "B#": 0,
    "C#": 1, "Db": 1,
    "D": 2,
    "D#": 3, "Eb": 3,
    "E": 4, "Fb": 4,
    "F": 5, "E#": 5,
    "F#": 6, "Gb": 6,
    "G": 7,
    "G#": 8, "Ab": 8,
    "A": 9,
    "A#": 10, "Bb": 10,
    "B": 11, "Cb": 11
};

// Semitone difference → circle-of-fifths distance (0–6)
const FIFTHS_DISTANCE = [0, 5, 2, 3, 4, 1, 6, 1, 4, 3, 2, 5];

// Semitone → position on the circle of fifths (C=0, G=1, D=2, ... F=11)
const SEMITONE_TO_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export const MAJOR_KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const MINOR_KEYS = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "Abm", "Am", "Bbm", "Bm"];
export const ALL_KEYS = [...MAJOR_KEYS, ...MINOR_KEYS];

/**
 * Parse a key string like "G", "Am", "Bb", "F#m" into { pitch, minor }.
 * Returns null for empty or unrecognized keys.
 */
export function parseKey(str) {
    if (!str || typeof str !== "string") return null;
    const trimmed = str.trim();
    if (!trimmed) return null;

    const minor = trimmed.endsWith("m");
    const note = minor ? trimmed.slice(0, -1) : trimmed;
    const pitch = PITCH_MAP[note];
    if (pitch === undefined) return null;

    return { pitch, minor };
}

/**
 * Returns the position on the circle of fifths (0–11) for a key string,
 * converting minor keys to their relative major first.
 * Returns null for empty/invalid keys.
 */
export function fifthsPosition(keyStr) {
    const k = parseKey(keyStr);
    if (!k) return null;
    const pitch = k.minor ? (k.pitch + 3) % 12 : k.pitch;
    return SEMITONE_TO_FIFTHS[pitch];
}

/**
 * Returns the signed shortest direction on the circle of fifths from keyA to keyB.
 * Positive = clockwise (sharps direction), negative = counterclockwise (flats direction).
 * Returns 0 for same position, null if either key is invalid.
 */
export function fifthsDirection(keyA, keyB) {
    const posA = fifthsPosition(keyA);
    const posB = fifthsPosition(keyB);
    if (posA === null || posB === null) return null;

    const raw = posB - posA;
    // Wrap to [-6, 6]: shortest path around the circle
    const wrapped = ((raw + 6) % 12 + 12) % 12 - 6;
    return wrapped;
}

/**
 * Circle-of-fifths distance between two key strings.
 * Returns 0–6, or null if either key is empty/invalid.
 * Relative major/minor pairs (e.g. C and Am) return 0.
 */
export function keyDistance(keyA, keyB) {
    const a = parseKey(keyA);
    const b = parseKey(keyB);
    if (!a || !b) return null;

    // Convert minor keys to their relative major (pitch + 3 semitones)
    const aPitch = a.minor ? (a.pitch + 3) % 12 : a.pitch;
    const bPitch = b.minor ? (b.pitch + 3) % 12 : b.pitch;

    const diff = ((aPitch - bPitch) % 12 + 12) % 12;
    return FIFTHS_DISTANCE[diff];
}
