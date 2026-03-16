<script>
    import { onMount, setContext } from "svelte";
    import { createRemoteStorageRepository } from "./lib/remotestorage.js";
    import { createAppStore } from "./lib/stores/app.svelte.js";

    import TopBar from "./lib/components/layout/TopBar.svelte";
    import BottomNav from "./lib/components/layout/BottomNav.svelte";
    import RollScreen from "./lib/components/roll/RollScreen.svelte";
    import SongsScreen from "./lib/components/songs/SongsScreen.svelte";
    import BandScreen from "./lib/components/band/BandScreen.svelte";

    const repo = createRemoteStorageRepository();
    const store = createAppStore(repo);
    setContext("app", store);

    onMount(() => {
        return store.init();
    });
</script>

<svelte:head>
    <title>{store.appTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

{#if store.connectionStatus !== "connected"}
    <main class="connect-shell">
        <section class="connect-card">
            <p class="eyebrow">Setlist Generator</p>
            <h1>{store.appTitle}</h1>
            <p class="lede">
                Connect to remoteStorage to keep your songs and presets safe.
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
{:else}
    <div class="app-shell">
        <TopBar />

        <main class="main-content">
            {#if store.activeView === "roll"}
                <RollScreen />
            {:else if store.activeView === "songs"}
                <SongsScreen />
            {:else if store.activeView === "band"}
                <BandScreen />
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
            <p class="modal-desc">Give the generator something to call you.</p>
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

<div class="toast-stack" aria-live="polite">
    {#each store.toastMessages as toast (toast.id)}
        <div class="toast {toast.tone}">{toast.message}</div>
    {/each}
</div>

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

    /* ---- Toasts ---- */
    .toast-stack {
        position: fixed;
        bottom: calc(var(--bottom-nav-height) + var(--safe-bottom) + var(--space-3));
        left: var(--space-3);
        right: var(--space-3);
        display: grid;
        gap: var(--space-2);
        z-index: 40;
        pointer-events: none;
    }

    .toast {
        background: rgba(18, 27, 39, 0.95);
        color: #fff;
        border-radius: var(--radius-md);
        padding: 0.75rem 1rem;
        box-shadow: 0 18px 34px rgba(18, 27, 39, 0.24);
        animation: toast-in 180ms ease;
        font-size: 0.85rem;
        pointer-events: auto;
    }

    .toast.danger {
        background: rgba(122, 36, 24, 0.96);
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @keyframes toast-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
    }
</style>
