export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}


export function deepMerge(left = {}, right = {}) {
    const base = clone(left);

    Object.keys(right).forEach((key) => {
        const leftValue = base[key];
        const rightValue = right[key];

        if (
            leftValue &&
            rightValue &&
            typeof leftValue === "object" &&
            typeof rightValue === "object" &&
            !Array.isArray(leftValue) &&
            !Array.isArray(rightValue)
        ) {
            base[key] = deepMerge(leftValue, rightValue);
            return;
        }

        base[key] = clone(rightValue);
    });

    return base;
}


export function toArray(value) {
    if (Array.isArray(value)) {
        return value.slice();
    }
    if (value === undefined || value === null || value === "") {
        return [];
    }
    return [value];
}


export function setByPath(target, path, value) {
    const parts = Array.isArray(path) ? path : String(path).split(".");
    const root = clone(target);
    let cursor = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
        const key = parts[index];
        if (
            cursor[key] === undefined ||
            cursor[key] === null ||
            typeof cursor[key] !== "object" ||
            Array.isArray(cursor[key])
        ) {
            cursor[key] = {};
        }
        cursor = cursor[key];
    }

    cursor[parts[parts.length - 1]] = value;
    return root;
}


export function getByPath(target, path, fallback = undefined) {
    const parts = Array.isArray(path) ? path : String(path).split(".");
    let cursor = target;

    for (let index = 0; index < parts.length; index += 1) {
        const key = parts[index];
        if (cursor === undefined || cursor === null) {
            return fallback;
        }
        cursor = cursor[key];
    }

    return cursor === undefined ? fallback : cursor;
}


export function parseDelimitedList(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}


export function formatDelimitedList(value) {
    return toArray(value).join(", ");
}


export function titleForBand(bandName) {
    const clean = String(bandName || "").trim();
    return clean ? `${clean} — Setlist Roller` : "Setlist Roller";
}


export function uid(prefix = "id") {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}


export function nowIso() {
    return new Date().toISOString();
}


export function sortByName(list) {
    return list.slice().sort((left, right) => {
        return String(left.name || "").localeCompare(String(right.name || ""));
    });
}


export function tryParseJson(text, fallback) {
    try {
        return JSON.parse(text);
    } catch (error) {
        return fallback;
    }
}

export const DEFAULT_DIE_COLOR = "#e15b37";

function parseHexChannel(hex, offset) {
    const v = parseInt(hex.slice(offset, offset + 2), 16);
    return Number.isFinite(v) ? v : 0;
}

function clampByte(v) {
    return Math.min(255, Math.max(0, Math.round(v)));
}

export function hexToRgb(hex) {
    if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
        return hexToRgb(DEFAULT_DIE_COLOR);
    }
    return `${parseHexChannel(hex, 1)}, ${parseHexChannel(hex, 3)}, ${parseHexChannel(hex, 5)}`;
}

export function darkenHex(hex, factor) {
    if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
        return darkenHex(DEFAULT_DIE_COLOR, factor);
    }
    const f = Number.isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 1;
    const r = clampByte(parseHexChannel(hex, 1) * f);
    const g = clampByte(parseHexChannel(hex, 3) * f);
    const b = clampByte(parseHexChannel(hex, 5) * f);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
