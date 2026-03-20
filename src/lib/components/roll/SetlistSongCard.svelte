<script>
  const { song, index, prevSong, onDragStart, onEdit, onRemove } = $props();

  let expanded = $state(false);

  function normalizeTechniqueValue(value) {
    if (!Array.isArray(value)) return String(value || "");
    return value.filter((technique) => technique && technique !== "none").slice().sort().join(",");
  }

  function techniqueDisplay(value) {
    if (!Array.isArray(value)) return value || null;
    const normalized = value.filter((technique) => technique && technique !== "none").slice().sort();
    return normalized.length ? normalized.join(", ") : null;
  }

  function toggleExpand() {
    expanded = !expanded;
  }

  function getChanges(memberName) {
    const curr = song.performance?.[memberName];
    if (!curr) return [];
    const prev = prevSong?.performance?.[memberName];
    const changes = [];
    if (!prev || curr.instrument !== prev.instrument) {
      if (prev && curr.instrument) changes.push(curr.instrument);
    }
    if (!prev || curr.tuning !== prev.tuning) {
      if (curr.tuning) changes.push(curr.tuning);
    }
    if (!prev || curr.capo !== prev.capo) {
      if (curr.capo) changes.push(`capo ${curr.capo}`);
      else if (prev?.capo) changes.push("capo off");
    }
    const currTech = normalizeTechniqueValue(curr.picking);
    const prevTech = prev ? normalizeTechniqueValue(prev.picking) : "";
    if (currTech !== prevTech && currTech) {
      const tech = techniqueDisplay(curr.picking);
      if (tech) changes.push(tech);
    }
    return changes;
  }

  function allChanges() {
    if (!song.performance) return [];
    const lines = [];
    for (const [memberName, _perf] of Object.entries(song.performance)) {
      const changes = getChanges(memberName);
      if (changes.length > 0) {
        lines.push({ member: memberName, changes });
      }
    }
    return lines;
  }
</script>

<div class="song-card" class:expanded>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="card-main" onclick={toggleExpand} onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(); } }} role="button" tabindex="0">
    <span
      class="drag-handle"
      aria-label="Drag to reorder"
      onpointerdown={(e) => { e.stopPropagation(); if (onDragStart) onDragStart(e, index); }}
    >&#9776;</span>

    <div class="card-body">
      <div class="title-row">
        <span class="position">{song.position}.</span>
        <span class="song-name">{song.name}</span>
        {#if song.key}
          <span class="key-badge">{song.key}</span>
        {/if}
      </div>

      {#if prevSong}
        {@const changes = allChanges()}
        {#if changes.length > 0}
          <div class="change-lines">
            {#each changes as line}
              <div class="change-line">
                <span class="change-member">{line.member}</span>
                <span class="change-detail">{line.changes.join(", ")}</span>
              </div>
            {/each}
          </div>
        {/if}
      {:else if song.performance}
        <div class="change-lines">
          {#each Object.entries(song.performance) as [memberName, perf]}
            {@const techStr = techniqueDisplay(perf.picking)}
            {@const parts = [perf.instrument, perf.tuning, perf.capo ? `capo ${perf.capo}` : null, techStr].filter(Boolean)}
            {#if parts.length > 0}
              <div class="change-line first-song">
                <span class="change-member">{memberName}</span>
                <span class="change-detail">{parts.join(", ")}</span>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if expanded}
    <div class="expanded-actions">
      <button class="edit-btn" onclick={(e) => { e.stopPropagation(); if (onEdit) onEdit(song.id); expanded = false; }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit song
      </button>
      <button class="edit-btn remove-btn" onclick={(e) => { e.stopPropagation(); if (onRemove) onRemove(index); expanded = false; }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        Remove
      </button>
    </div>
  {/if}
</div>

<style>
  .song-card {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(27, 49, 80, 0.1);
    border-radius: var(--radius-md, 12px);
    padding: 0.65rem 0.75rem;
    transition: border-color 150ms ease;
  }

  .song-card.expanded {
    border-color: rgba(225, 91, 55, 0.25);
  }

  .card-main {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .drag-handle {
    flex-shrink: 0;
    cursor: grab;
    font-size: 1rem;
    color: var(--muted, #8a95a5);
    padding: 0.1rem 0;
    line-height: 1.4;
    touch-action: none;
    user-select: none;
  }

  .card-body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.25rem;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .position {
    font-weight: 800;
    font-size: 0.82rem;
    color: var(--muted, #8a95a5);
    min-width: 1.4rem;
  }

  .song-name {
    font-weight: 700;
    font-size: 0.92rem;
    color: var(--ink, #182230);
  }

  .key-badge {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: rgba(27, 49, 80, 0.07);
    color: var(--ink, #182230);
  }

  .change-lines {
    display: grid;
    gap: 0.1rem;
    padding-left: 1.4rem;
  }

  .change-line {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    font-size: 0.75rem;
  }

  .change-member {
    font-weight: 700;
    color: var(--accent, #e15b37);
    flex-shrink: 0;
  }

  .change-detail {
    color: var(--accent, #e15b37);
    font-weight: 600;
  }

  .first-song .change-member {
    color: var(--muted, #8a95a5);
  }

  .first-song .change-detail {
    color: var(--muted, #8a95a5);
    font-weight: 500;
  }

  .expanded-actions {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.5rem;
    margin-top: 0.5rem;
    border-top: 1px solid rgba(27, 49, 80, 0.08);
    padding-left: 1.4rem;
  }

  .edit-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 2rem;
    padding: 0.3rem 0.75rem;
    border: 1px solid rgba(27, 49, 80, 0.14);
    border-radius: var(--radius-md, 12px);
    background: rgba(255, 255, 255, 0.92);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ink, #182230);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .edit-btn:active {
    background: rgba(0, 0, 0, 0.04);
  }

  .remove-btn {
    color: var(--muted, #8a95a5);
    border-color: rgba(27, 49, 80, 0.1);
  }

  .remove-btn:active {
    background: rgba(225, 91, 55, 0.06);
    color: var(--accent, #e15b37);
  }
</style>
