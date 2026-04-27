import { test as base } from "@playwright/test";
import { FAKE_REPO_INIT_SCRIPT, type FakeRepoSeed, type SeedMember, type SeedSong } from "./fake-repo";

/**
 * Custom fixture that:
 *  1. Installs the fake remoteStorage repo before page navigation
 *  2. Provides `seed()` to pre-populate state and `goto()` to load the app
 *  3. Provides `store` and `repo` accessors that proxy into the running app
 *
 * Tests opt into seeded state with `await app.seed({ ... })` followed by
 * `await app.goto()`. By default the app boots auto-connected with a fake
 * user so tests don't have to walk the connection screen.
 */
/**
 * Shape of the snapshot we read out of the running store via `getState()`.
 * The fields below are JSON-cloned from the live `$state` runes, so anything
 * we want to assert against has to be listed here.
 */
export type AppStateSnapshot = {
    connectionStatus: string;
    activeView: string;
    songs: SeedSong[];
    savedSetlists: unknown[];
    bandMembers: Record<string, SeedMember>;
    appConfig: Record<string, unknown> | null;
    generatedSetlist: Record<string, unknown> | null;
    setlistLocked: boolean;
    setlistSaved: boolean;
    showFirstRunPrompt: boolean;
    toastMessages: unknown[];
};

export type AppContext = {
    /**
     * Set seed data and inject scripts. Must be called before goto(). Calling
     * goto() without a prior seed boots the app on the connection screen.
     */
    seed: (seed: FakeRepoSeed) => Promise<void>;
    /** Navigate to "/" with whatever seed was last applied. */
    goto: (path?: string) => Promise<void>;
    /** Wait until the app shell is rendered (post-sync). */
    waitForReady: () => Promise<void>;
    /** Read the current store state out of the running app. */
    getState: () => Promise<AppStateSnapshot | null>;
    /** Drive the store directly — useful for setup that bypasses the UI. */
    callStore: <T = unknown>(name: string, ...args: unknown[]) => Promise<T>;
};

export const test = base.extend<{ app: AppContext }>({
    app: async ({ page }, use) => {
        let hasNavigated = false;

        // Install the fake-repo factory and the test-mode flag *before* any
        // page-script runs. The init scripts persist across navigations within
        // this fixture's lifetime.
        await page.addInitScript(FAKE_REPO_INIT_SCRIPT);

        const ctx: AppContext = {
            async seed(seed: FakeRepoSeed) {
                // The seed has to land in window.__SR_FAKE_SEED__ before the
                // factory runs. addInitScript fires for every navigation in
                // this BrowserContext, so we attach the seed once and reuse.
                await page.addInitScript((s) => {
                    (window as unknown as { __SR_FAKE_SEED__: FakeRepoSeed }).__SR_FAKE_SEED__ = s;
                }, seed);
            },
            async goto(path = "/") {
                await page.goto(path);
                hasNavigated = true;
            },
            async waitForReady() {
                if (!hasNavigated) {
                    await page.goto("/");
                    hasNavigated = true;
                }
                // The app shell only renders once initialSyncComplete=true.
                // BottomNav is the canonical "we are in the app" marker.
                await page.locator("nav.bottom-nav").waitFor({ state: "visible" });
            },
            async getState() {
                return page.evaluate(() => {
                    const s = (window as unknown as { __SR_STORE__?: Record<string, unknown> }).__SR_STORE__;
                    if (!s) return null;
                    return {
                        connectionStatus: s.connectionStatus as string,
                        activeView: s.activeView as string,
                        songs: JSON.parse(JSON.stringify(s.songs)),
                        savedSetlists: JSON.parse(JSON.stringify(s.savedSetlists)),
                        bandMembers: JSON.parse(JSON.stringify(s.bandMembers)),
                        appConfig: JSON.parse(JSON.stringify(s.appConfig || null)),
                        generatedSetlist: s.generatedSetlist ? JSON.parse(JSON.stringify(s.generatedSetlist)) : null,
                        setlistLocked: s.setlistLocked as boolean,
                        setlistSaved: s.setlistSaved as boolean,
                        showFirstRunPrompt: s.showFirstRunPrompt as boolean,
                        toastMessages: JSON.parse(JSON.stringify(s.toastMessages)),
                    };
                });
            },
            async callStore<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
                return page.evaluate(
                    ({ name, args }) => {
                        const s = (window as unknown as { __SR_STORE__?: Record<string, unknown> }).__SR_STORE__;
                        if (!s) throw new Error("Store not available");
                        const fn = s[name];
                        if (typeof fn !== "function") throw new Error(`Store has no method '${name}'`);
                        return (fn as (...a: unknown[]) => unknown).call(s, ...args);
                    },
                    { name, args },
                ) as Promise<T>;
            },
        };

        await use(ctx);
    },
});

export const expect = test.expect;

/**
 * Convenience builder for a fully-formed seeded "user" with a band, members
 * and songs. Tests can pass-through partial overrides.
 */
export function buildSeed(overrides: Partial<FakeRepoSeed> = {}): FakeRepoSeed {
    const baseConfig = {
        bandName: "Test Band",
        schemaVersion: 2,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        ui: { dieColor: null },
        general: {
            count: 9,
            beamWidth: 512,
            limits: { covers: -1, instrumentals: -1 },
            order: {
                first: [
                    ["notGoodOpener", false],
                    ["cover", false],
                    ["instrumental", false],
                ],
                second: [
                    ["cover", false],
                    ["instrumental", false],
                ],
                penultimate: [],
                last: [["notGoodCloser", false]],
            },
            weighting: {
                tuning: 4,
                capo: 2,
                instrument: 3,
                technique: 1,
                keyFlow: 2,
                positionMiss: 8,
                earlyCover: 2,
                earlyInstrumental: 2,
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
                blockShuffleTemperature: 1.4,
            },
        },
        show: {},
        props: {
            tuning: { kind: "instrumentField", field: "tuning", minStreak: 2, allowChangeOnLastSong: true },
            capo: { kind: "instrumentDelta", field: "capo", minStreak: 2, allowChangeOnLastSong: true },
            instruments: { kind: "instrumentSet", weightKey: "instrument", minStreak: 2, allowChangeOnLastSong: true },
            picking: {
                kind: "instrumentField",
                field: "picking",
                weightKey: "technique",
                minStreak: 1,
                allowChangeOnLastSong: true,
            },
        },
    };

    return {
        autoConnectAs: "test@example.com",
        config: baseConfig,
        bootstrap: { schemaVersion: 2, createdAt: "2024-01-01T00:00:00.000Z" },
        songs: {},
        setlists: {},
        members: {},
        ...overrides,
    };
}

let songCounter = 0;
export function makeSong(overrides: Partial<SeedSong> = {}): SeedSong {
    songCounter += 1;
    const id = (overrides.id as string | undefined) || `song-${songCounter}`;
    const name = (overrides.name as string | undefined) || `Song ${songCounter}`;
    return {
        id,
        name,
        cover: false,
        instrumental: false,
        notGoodOpener: false,
        notGoodCloser: false,
        unpracticed: false,
        key: "",
        notes: "",
        schemaVersion: 2,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        members: {},
        ...overrides,
    };
}

export function makeMember(name: string, overrides: Partial<SeedMember> = {}): SeedMember {
    return {
        name,
        instruments: [],
        defaultInstrument: "",
        updatedAt: "2024-01-01T00:00:00.000Z",
        ...overrides,
    };
}
