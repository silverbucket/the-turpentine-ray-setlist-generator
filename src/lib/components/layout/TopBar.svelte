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
    store.startAddAccountFlow();
  }
</script>

{#if menuOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="menu-backdrop" onclick={closeMenu} onkeydown={() => {}}></div>
{/if}

<header class="top-bar">
  <div class="title-group">
    <span class="conn-dot" class:connected={store.connectionStatus === 'connected'} class:syncing={store.syncActivelyRunning}></span>
    <span class="band-name">{store.appTitle}</span>
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
                <span class="current-band">{currentAccount.bandName || "Unnamed"}</span>
                <span class="current-addr">{currentAccount.address}</span>
              </div>
            </div>
          {/if}

          {#if otherAccounts.length > 0}
            <div class="dropdown-divider"></div>
            <span class="dropdown-label">Switch to</span>
            {#each otherAccounts as account (account.address)}
              <button type="button" class="dropdown-item dropdown-item--account" onclick={() => handleSwitchTo(account.address)}>
                <span class="account-band">{account.bandName || "Unnamed"}</span>
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

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.4); }
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
