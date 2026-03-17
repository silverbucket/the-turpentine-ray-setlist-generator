<script>
  import { getContext } from "svelte";
  const store = getContext("app");

  let menuOpen = $state(false);

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function handleExport() {
    closeMenu();
    store.exportAllData();
  }

  function handleImport() {
    closeMenu();
    store.navigate("band");
    store.bandSubView = "main";
  }

  function handleDisconnect() {
    closeMenu();
    store.disconnectStorage();
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
      <button class="menu-btn" onclick={toggleMenu} aria-label="Menu">
        &middot;&middot;&middot;
      </button>

      {#if menuOpen}
        <div class="dropdown">
          <button class="dropdown-item" onclick={handleExport}>Export Data</button>
          <button class="dropdown-item" onclick={handleImport}>Import Data</button>
          <button class="dropdown-item dropdown-item--danger" onclick={handleDisconnect}>Disconnect</button>
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
    height: 48px;
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
    background: #1f8f61;
    box-shadow: 0 0 4px rgba(31, 143, 97, 0.4);
  }

  .conn-dot.syncing {
    background: var(--accent);
    box-shadow: 0 0 6px rgba(225, 91, 55, 0.4);
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
    min-width: 160px;
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
  }

  .dropdown-item:active {
    background: var(--line);
  }

  .dropdown-item + .dropdown-item {
    border-top: 1px solid var(--line);
  }

  .dropdown-item--danger {
    color: var(--accent);
  }
</style>
