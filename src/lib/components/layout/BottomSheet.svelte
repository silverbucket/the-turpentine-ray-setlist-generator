<script>
  import { tick } from "svelte";

  let { open = false, onclose, title = "", children } = $props();

  let sheetEl = $state();
  let previousFocus = null;

  // Focusable elements inside the sheet, used for both initial focus and the
  // Tab-cycle trap. Excludes anything explicitly opted-out via tabindex="-1".
  function getFocusableElements() {
    if (!sheetEl) return [];
    return [
      ...sheetEl.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
  }

  function handleKeydown(e) {
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      onclose?.();
      return;
    }

    if (e.key === "Tab") {
      const focusable = getFocusableElements();
      // Empty sheet: pin focus on the dialog container so Tab can't escape.
      if (focusable.length === 0) {
        e.preventDefault();
        if (sheetEl) sheetEl.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // If focus has somehow leaked outside the sheet, pull it back in.
      if (!sheetEl?.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // While open: listen for Escape/Tab on window, move focus into the sheet,
  // and restore focus to the previously focused element on close.
  $effect(() => {
    if (!open) return;

    previousFocus = document.activeElement;
    window.addEventListener("keydown", handleKeydown);

    tick().then(() => {
      if (!open) return;
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else if (sheetEl) {
        sheetEl.focus();
      }
    });

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      if (
        previousFocus &&
        typeof previousFocus.focus === "function" &&
        document.body.contains(previousFocus)
      ) {
        previousFocus.focus();
      }
      previousFocus = null;
    };
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" class:visible={open} onclick={onclose}>
    <div
      class="sheet"
      bind:this={sheetEl}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Bottom sheet"}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="handle-area" onclick={onclose}>
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
    background: var(--overlay);
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

  /* The dialog container itself is not part of the visible focus flow — it's
     only focusable as a fallback when the sheet has no interactive content
     (e.g. a static info sheet). Hide the focus ring in that case. */
  .sheet:focus {
    outline: none;
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
