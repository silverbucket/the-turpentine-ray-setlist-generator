<script>
  let { open = false, onclose, title = "", children } = $props();
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" class:visible={open} onclick={onclose} onkeydown={() => {}}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="sheet" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <div class="handle-area" onclick={onclose} onkeydown={() => {}}>
        <div class="handle"></div>
      </div>

      {#if title}
        <div class="sheet-header">
          <h2 class="sheet-title">{title}</h2>
        </div>
      {/if}

      <div class="sheet-content">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 500;
    display: flex;
    align-items: flex-end;
    animation: fade-in 0.2s ease;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .sheet {
    width: 100%;
    max-height: 85vh;
    background: var(--paper);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    display: flex;
    flex-direction: column;
    animation: slide-up 0.25s ease;
  }

  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }

  .handle-area {
    display: flex;
    justify-content: center;
    padding: 12px 0 4px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .handle {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
  }

  .sheet-header {
    padding: 8px 20px 12px;
    border-bottom: 1px solid var(--line);
  }

  .sheet-title {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: var(--ink);
  }

  .sheet-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    -webkit-overflow-scrolling: touch;
  }
</style>
