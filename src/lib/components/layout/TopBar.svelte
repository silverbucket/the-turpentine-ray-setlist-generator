<script>
  import { getContext } from "svelte";
  import { cycleTheme, getThemePreference } from "../../theme.svelte.js";

  const store = getContext("app");

  let menuOpen = $state(false);
  const themeLabel = { system: "◐ System", light: "☀ Light", dark: "☽ Dark" };

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  let currentAccount = $derived(
    store.knownAccounts.find((a) => a.address === store.connectAddress)
  );

  let otherAccounts = $derived(
    store.knownAccounts.filter((a) => a.address !== store.connectAddress)
  );

  function handleSwitchTo(address) {
    closeMenu();
    store.connectToAccount(address);
  }

  function handleAddAccount() {
    closeMenu();
    store.connectAddress = "";
    store.disconnectStorage();
  }
</script>

{#if menuOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="menu-backdrop" onclick={closeMenu} onkeydown={() => {}}></div>
{/if}

<header class="top-bar">
  <div class="title-group">
    <span
      class="conn-dot"
      class:connected={store.connectionStatus === 'connected'}
      class:syncing={store.syncActivelyRunning || store.syncState === 'syncing'}
      class:errored={store.syncState === 'error'}
    ></span>
    <span class="band-name">{store.appTitle}</span>
    {#if store.syncState === 'syncing'}
      <span class="sync-pill" role="status" aria-live="polite" title={store.syncStatusLabel}>
        <span class="sync-pill-spinner" aria-hidden="true"></span>
        <span class="sync-pill-label">Syncing…</span>
      </span>
    {:else if store.syncState === 'synced'}
      <span class="sync-pill sync-pill--ok" role="status" aria-live="polite">
        <span class="sync-pill-check" aria-hidden="true">✓</span>
        <span class="sync-pill-label">Up to date</span>
      </span>
    {:else if store.syncState === 'error'}
      <span class="sync-pill sync-pill--err" role="status" aria-live="polite" title={store.syncStatusLabel}>
        <span class="sync-pill-label">Sync failed</span>
      </span>
    {/if}
  </div>

  <div class="right">

    <div class="menu-wrapper">
      <button type="button" class="menu-btn" onclick={toggleMenu} aria-label="Menu">
        &middot;&middot;&middot;
      </button>

      {#if menuOpen}
        <div class="dropdown">
          {#if currentAccount}
            <div class="dropdown-current">
              <span class="active-dot"></span>
              <div class="current-info">
                <span class="current-band">{currentAccount.metadata?.bandName || "Unnamed"}</span>
                <span class="current-addr">{currentAccount.address}</span>
              </div>
            </div>
          {/if}

          {#if otherAccounts.length > 0}
            <div class="dropdown-divider"></div>
            <span class="dropdown-label">Switch to</span>
            {#each otherAccounts as account (account.address)}
              <button type="button" class="dropdown-item dropdown-item--account" onclick={() => handleSwitchTo(account.address)}>
                <span class="account-band">{account.metadata?.bandName || "Unnamed"}</span>
                <span class="account-addr">{account.address}</span>
              </button>
            {/each}
          {/if}

          <div class="dropdown-divider"></div>
          <button type="button" class="dropdown-item dropdown-item--add" onclick={handleAddAccount}>Add Account</button>

          <div class="dropdown-divider"></div>
          <button type="button" class="dropdown-item" onclick={cycleTheme}>Theme: {themeLabel[getThemePreference()]}</button>
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--top-bar-height);
    padding-top: env(safe-area-inset-top, 0px);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding-left: 16px;
    padding-right: 8px;
    background: var(--paper);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--line);
    z-index: 200;
  }

  .title-group {
    grid-column: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
    min-width: 0;
  }

  .conn-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--line);
    flex-shrink: 0;
    transition: background 300ms ease, box-shadow 300ms ease;
  }

  .conn-dot.connected {
    background: var(--success);
    box-shadow: 0 0 4px color-mix(in srgb, var(--success) 40%, transparent);
  }

  .conn-dot.syncing {
    background: var(--accent);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 40%, transparent);
    animation: dot-pulse 1s ease-in-out infinite;
  }

  .conn-dot.errored {
    background: var(--danger, #d44);
    box-shadow: 0 0 6px color-mix(in srgb, var(--danger, #d44) 40%, transparent);
  }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.4); }
  }

  .sync-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
    animation: pill-fade-in 200ms ease-out both;
  }

  .sync-pill--ok {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--success);
  }

  .sync-pill--err {
    background: color-mix(in srgb, var(--danger, #d44) 14%, transparent);
    color: var(--danger, #d44);
  }

  .sync-pill-spinner {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    animation: pill-spin 700ms linear infinite;
  }

  .sync-pill-check {
    font-size: 12px;
    font-weight: 800;
    line-height: 1;
  }

  .sync-pill-label {
    letter-spacing: 0.02em;
  }

  /* Hide the verbose label on very narrow screens — the dot + spinner still
     communicate state. */
  @media (max-width: 360px) {
    .sync-pill-label { display: none; }
    .sync-pill { padding: 4px; }
  }

  @keyframes pill-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes pill-fade-in {
    from { opacity: 0; transform: translateY(-2px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .sync-pill-spinner { animation-duration: 1.4s; }
    .sync-pill { animation: none; }
    .conn-dot.syncing { animation: none; }
  }

  .band-name {
    font-size: 16px;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
  }

  .right {
    grid-column: 3;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    position: relative;
    z-index: 1;
  }

  .menu-wrapper {
    position: relative;
  }

  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 20px;
    letter-spacing: 2px;
    color: var(--ink);
    border-radius: var(--radius-md);
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .menu-btn:active {
    background: var(--line);
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 199;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    min-width: 200px;
    background: var(--paper);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    overflow: hidden;
    z-index: 201;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 12px 16px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--ink);
    text-align: left;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .dropdown-item:active {
    background: var(--line);
  }

  .dropdown-item + .dropdown-item {
    border-top: 1px solid var(--line);
  }

  .dropdown-current {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
  }

  .active-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 4px color-mix(in srgb, var(--success) 40%, transparent);
    flex-shrink: 0;
  }

  .current-info {
    display: grid;
    gap: 2px;
  }

  .current-band {
    font-size: 13px;
    font-weight: 700;
    color: var(--ink);
  }

  .current-addr {
    font-size: 11px;
    color: var(--muted);
  }

  .dropdown-label {
    display: block;
    padding: 8px 16px 4px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .dropdown-divider {
    height: 1px;
    background: var(--line);
  }

  .dropdown-item--account {
    display: grid;
    gap: 1px;
    padding: 10px 16px;
  }

  .dropdown-item--account + .dropdown-item--account {
    border-top: 1px solid var(--line);
  }

  .account-band {
    font-size: 13px;
    font-weight: 600;
  }

  .account-addr {
    font-size: 11px;
    color: var(--muted);
  }

  .dropdown-item--add {
    font-weight: 700;
    color: var(--accent);
  }
</style>
