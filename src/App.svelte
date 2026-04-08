<script>
    import { onMount, setContext } from "svelte";
    import { createRemoteStorageRepository } from "./lib/remotestorage.js";
    import { createAppStore } from "./lib/stores/app.svelte.js";

    import TopBar from "./lib/components/layout/TopBar.svelte";
    import BottomNav from "./lib/components/layout/BottomNav.svelte";
    import RollScreen from "./lib/components/roll/RollScreen.svelte";
    import SongsScreen from "./lib/components/songs/SongsScreen.svelte";
    import BandScreen from "./lib/components/band/BandScreen.svelte";
    import SavedScreen from "./lib/components/saved/SavedScreen.svelte";
    import HelpScreen from "./lib/components/help/HelpScreen.svelte";

    const repo = createRemoteStorageRepository();
    const store = createAppStore(repo);
    setContext("app", store);

    onMount(() => {
        return store.init();
    });

    const DEFAULT_DIE_COLOR = "#e15b37";
    let dieColor = $derived(store.appConfig?.ui?.dieColor || DEFAULT_DIE_COLOR);

    function hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `${r}, ${g}, ${b}`;
    }
    let dieColorRgb = $derived(hexToRgb(dieColor));

    // Darken a hex color by a factor (0-1, where 0.8 = 80% brightness)
    function darken(hex, factor) {
        const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
        const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
        const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }

    let faviconHref = $derived(
        `data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
            `<path fill="${dieColor}" d="M256 66L420.5 161 256 256 91.5 161Z"/>` +
            `<path fill="${darken(dieColor, 0.78)}" d="M91.5 161L256 256 256 446 91.5 351Z"/>` +
            `<path fill="${darken(dieColor, 0.62)}" d="M256 256L420.5 161 420.5 351 256 446Z"/>` +
            `<path fill="none" stroke="#000" stroke-width="2.5" stroke-opacity=".1" stroke-linejoin="round" d="M256 66L420.5 161 420.5 351 256 446 91.5 351 91.5 161Z"/>` +
            `<path stroke="#000" stroke-width="2" stroke-opacity=".08" d="M256 256L91.5 161M256 256L420.5 161M256 256L256 446"/>` +
            `<ellipse cx="256" cy="113.5" rx="18" ry="10" fill="#fff"/>` +
            `<ellipse cx="338.25" cy="161" rx="18" ry="10" fill="#fff"/>` +
            `<ellipse cx="256" cy="161" rx="18" ry="10" fill="#fff"/>` +
            `<ellipse cx="173.75" cy="161" rx="18" ry="10" fill="#fff"/>` +
            `<ellipse cx="256" cy="208.5" rx="18" ry="10" fill="#fff"/>` +
            `<ellipse cx="132.6" cy="232" rx="13" ry="16" fill="#ebebeb"/>` +
            `<ellipse cx="173.8" cy="303" rx="13" ry="16" fill="#ebebeb"/>` +
            `<ellipse cx="214.9" cy="374" rx="13" ry="16" fill="#ebebeb"/>` +
            `<ellipse cx="338.3" cy="303" rx="13" ry="16" fill="#d9d9d9"/>` +
            `</svg>`
        )}`
    );
</script>

<svelte:head>
    <title>{store.appTitle}</title>
    <link rel="icon" type="image/svg+xml" href={faviconHref} />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

{#if store.connectionStatus === "disconnected"}
    <main class="connect-shell">
        <section class="connect-card">
            <p class="eyebrow">Setlist Roller</p>
            <h1>{store.appTitle}</h1>
            <p class="lede">
                Connect to remoteStorage so your songs survive the tour bus.
            </p>

            <label class="field">
                <span>remoteStorage address</span>
                <input
                    value={store.connectAddress}
                    oninput={(e) => store.connectAddress = e.currentTarget.value}
                    placeholder="you@example.com"
                    autocomplete="off"
                    onkeydown={(e) => { if (e.key === "Enter") store.connectStorage(); }}
                />
            </label>

            <button class="btn primary" onclick={store.connectStorage} disabled={store.connectionStatus === "connecting"}>
                {store.connectionStatus === "connecting" ? "Connecting..." : "Connect"}
            </button>

            {#if store.loadError}
                <p class="error-text">{store.loadError}</p>
            {/if}
        </section>
    </main>
{:else if !store.initialSyncComplete}
    <main class="sync-shell">
        <div class="sync-content">
            <div class="sync-die-face" style="--die-rgb: {dieColorRgb};">
                <span class="sync-pip" style="left:25%;top:25%"></span>
                <span class="sync-pip" style="left:75%;top:25%"></span>
                <span class="sync-pip" style="left:50%;top:50%"></span>
                <span class="sync-pip" style="left:25%;top:75%"></span>
                <span class="sync-pip" style="left:75%;top:75%"></span>
            </div>
            <div class="sync-label">
                <span class="spinner"></span>
                Syncing&hellip;
            </div>
        </div>
    </main>
{:else}
    <div class="app-shell">
        <TopBar />

        <main class="main-content">
            {#if store.activeView === "roll"}
                <RollScreen />
            {:else if store.activeView === "saved"}
                <SavedScreen />
            {:else if store.activeView === "songs"}
                <SongsScreen />
            {:else if store.activeView === "band"}
                <BandScreen />
            {:else if store.activeView === "help"}
                <HelpScreen />
            {/if}
        </main>

        <BottomNav />
    </div>
{/if}

{#if store.showFirstRunPrompt}
    <div class="modal-backdrop">
        <div class="modal">
            <p class="eyebrow">First Run</p>
            <h3>Name Your Band</h3>
            <p class="modal-desc">What do we call this operation? Don't overthink it.</p>
            <label class="field">
                <span>Band name</span>
                <input
                    value={store.firstRunBandName}
                    oninput={(e) => store.firstRunBandName = e.currentTarget.value}
                    placeholder="Your Band Name"
                    onkeydown={(e) => { if (e.key === "Enter") store.finishFirstRun(); }}
                />
            </label>
            <button class="btn primary" onclick={store.finishFirstRun}>Save</button>
        </div>
    </div>
{/if}

{#if store.busyMessage}
    <div class="busy-overlay">
        <div class="busy-chip">
            <span class="spinner"></span>
            {store.busyMessage}
        </div>
    </div>
{/if}

{#if store.toastMessages.length > 0}
    {@const latest = store.toastMessages[store.toastMessages.length - 1]}
    <div class="toast-pill {latest.tone}" aria-live="polite">
        {latest.message}
    </div>
{/if}

<style>
    /* ---- Connect screen ---- */
    .connect-shell {
        min-height: 100vh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: var(--space-4);
    }

    .connect-card {
        width: min(100%, 440px);
        padding: var(--space-6);
        display: grid;
        gap: var(--space-4);
        background: var(--paper-strong);
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
    }

    .eyebrow {
        margin: 0;
        color: var(--accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
    }

    h1 {
        font-size: clamp(1.6rem, 4vw, 2.4rem);
    }

    .lede {
        color: var(--muted);
    }

    /* ---- Sync screen ---- */
    .sync-shell {
        min-height: 100vh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: var(--space-4);
    }

    .sync-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-4);
    }

    .sync-die-face {
        position: relative;
        width: 72px;
        height: 72px;
        border-radius: 14px;
        background: rgba(var(--die-rgb), 0.06);
        border: 2px solid rgba(var(--die-rgb), 0.12);
        animation: pulse-fade 2s ease-in-out infinite;
    }

    .sync-pip {
        position: absolute;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: rgba(var(--die-rgb), 0.18);
        transform: translate(-50%, -50%);
    }

    .sync-label {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--muted);
    }

    @keyframes pulse-fade {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.06); }
    }

    /* ---- App shell ---- */
    .app-shell {
        min-height: 100vh;
        min-height: 100dvh;
        display: flex;
        flex-direction: column;
    }

    .main-content {
        flex: 1;
        padding: var(--space-3);
        padding-top: calc(var(--top-bar-height) + var(--space-3));
        padding-bottom: calc(var(--bottom-nav-height) + var(--safe-bottom) + var(--space-3));
        max-width: 640px;
        width: 100%;
        margin: 0 auto;
    }

    @media (min-width: 960px) {
        .main-content {
            max-width: 720px;
        }
    }

    /* ---- Field ---- */
    .field {
        display: grid;
        gap: 0.35rem;
    }

    .field > span {
        color: var(--ink);
        font-weight: 700;
        font-size: 0.85rem;
    }

    input {
        width: 100%;
        min-height: 2.8rem;
        padding: 0.7rem 0.85rem;
        border-radius: var(--radius-md);
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.92);
        color: var(--ink);
        font-size: 0.95rem;
        transition: border-color 140ms ease, box-shadow 140ms ease;
    }

    input:focus {
        outline: none;
        border-color: var(--accent-line);
        box-shadow: 0 0 0 0.2rem rgba(225, 91, 55, 0.12);
    }

    /* ---- Buttons ---- */
    .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.8rem;
        padding: 0.7rem 1rem;
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        background: rgba(255,255,255,0.84);
        color: var(--ink);
        font-weight: 800;
        font-size: 0.95rem;
        line-height: 1;
        transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
        touch-action: manipulation;
        cursor: pointer;
    }

    .btn:active {
        transform: scale(0.98);
    }

    .btn.primary {
        color: #fff;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        border-color: rgba(0,0,0,0.04);
    }

    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .error-text {
        color: var(--danger);
        font-size: 0.85rem;
    }

    /* ---- Modal ---- */
    .modal-backdrop {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: var(--space-4);
        background: rgba(30, 38, 52, 0.28);
        backdrop-filter: blur(8px);
        z-index: 50;
    }

    .modal {
        width: min(100%, 400px);
        padding: var(--space-6);
        display: grid;
        gap: var(--space-4);
        background: var(--paper-strong);
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow);
    }

    h3 {
        font-size: 1.2rem;
    }

    .modal-desc {
        color: var(--muted);
        font-size: 0.9rem;
    }

    /* ---- Busy overlay ---- */
    .busy-overlay {
        position: fixed;
        top: calc(var(--top-bar-height) + var(--space-2));
        left: 50%;
        transform: translateX(-50%);
        z-index: 30;
    }

    .busy-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: 0.5rem 1rem;
        border-radius: var(--radius-full);
        background: var(--paper-strong);
        border: 1px solid var(--line);
        box-shadow: var(--shadow-soft);
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--muted);
        white-space: nowrap;
    }

    .spinner {
        width: 0.85rem;
        height: 0.85rem;
        border-radius: 999px;
        border: 2px solid rgba(225, 91, 55, 0.2);
        border-top-color: var(--accent);
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
    }

    /* ---- Toast pill ---- */
    .toast-pill {
        position: fixed;
        top: calc(env(safe-area-inset-top, 0px) + 48px);
        left: 50%;
        transform: translateX(-50%);
        max-width: calc(100vw - 2rem);
        padding: 5px 14px;
        font-size: 0.78rem;
        font-weight: 600;
        text-align: center;
        color: #fff;
        background: #1b3150;
        border: none;
        border-radius: 0 0 var(--radius-md, 12px) var(--radius-md, 12px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 300;
        pointer-events: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        animation: toast-slide-down 200ms ease;
    }

    .toast-pill.danger {
        background: #992f20;
        color: #fff;
    }

    .toast-pill.warning {
        background: #7a5c10;
        color: #fff;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @keyframes toast-slide-down {
        from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
</style>
