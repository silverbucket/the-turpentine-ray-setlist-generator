<script>
    const { checked = false, onchange, children } = $props();
</script>

<label class="chip-toggle" class:active={checked}>
    <input type="checkbox" {checked} onchange={onchange} />
    {@render children()}
</label>

<style>
    .chip-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        min-height: 2.4rem;
        padding: 0.4rem 0.75rem;
        border-radius: 999px;
        background: var(--paper-soft);
        border: 1px solid var(--line);
        color: var(--ink, #182230);
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
        touch-action: manipulation;
        user-select: none;
    }
    .chip-toggle input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
        width: 0;
        height: 0;
        min-height: 0;
    }
    .chip-toggle.active {
        background: var(--accent-soft, rgba(225, 91, 55, 0.12));
        border-color: var(--accent-line, rgba(225, 91, 55, 0.24));
        color: var(--accent-strong, #c64724);
    }
</style>
