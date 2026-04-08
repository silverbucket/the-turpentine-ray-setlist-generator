import { nowIso } from "./utils.js";

const STORAGE_PREFIX = "setlist-roller";
export const KNOWN_ACCOUNTS_KEY = `${STORAGE_PREFIX}-known-accounts`;

/**
 * Scope a localStorage key per user address so accounts don't leak data.
 */
export function scopedKey(base, userAddress) {
    if (!userAddress) return `${STORAGE_PREFIX}-${base}`;
    let h = 0;
    for (let i = 0; i < userAddress.length; i++) {
        h = ((h << 5) - h + userAddress.charCodeAt(i)) | 0;
    }
    return `${STORAGE_PREFIX}-${base}-${(h >>> 0).toString(36)}`;
}

export function getKnownAccountsRaw() {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = localStorage.getItem(KNOWN_ACCOUNTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return list.sort((a, b) => (b.lastUsed || "").localeCompare(a.lastUsed || ""));
    } catch { return []; }
}

export function getKnownAccounts() {
    return getKnownAccountsRaw().map(({ address, bandName, lastUsed }) => ({ address, bandName, lastUsed }));
}

export function saveKnownAccount(address, bandName, token) {
    if (typeof localStorage === "undefined" || !address) return;
    const list = getKnownAccountsRaw();
    const existing = list.find((a) => a.address === address);
    if (existing) {
        existing.bandName = bandName || existing.bandName;
        if (token) existing.token = token;
        existing.lastUsed = nowIso();
    } else {
        list.push({ address, bandName: bandName || "", token: token || "", lastUsed: nowIso() });
    }
    localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(list));
}

export function getAccountToken(address) {
    return getKnownAccountsRaw().find((a) => a.address === address)?.token || "";
}

export function removeKnownAccountEntry(address) {
    if (typeof localStorage === "undefined" || !address) return;
    const list = getKnownAccountsRaw().filter((a) => a.address !== address);
    localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(list));
}
