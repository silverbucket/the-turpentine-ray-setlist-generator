<script>
  import { getContext } from "svelte";
  import NumberStepper from "../shared/NumberStepper.svelte";
  import ChipToggle from "../shared/ChipToggle.svelte";
  import SetlistSongCard from "./SetlistSongCard.svelte";

  const store = getContext("app");

  function handleRoll() {
    store.generate();
  }

  function handleSaveSetlist() {
    store.saveCurrentSetlist();
  }

  function handleRemoveSaved(id) {
    store.removeSavedSetlist(id);
  }

  // Determine which members have multiple instrument/tuning options worth toggling
  function memberHasChoices(memberName) {
    const instruments = store.memberInstrumentChoicesByMember?.[memberName];
    if (instruments && instruments.length > 1) return true;
    const tunings = store.memberTuningChoicesByMember?.[memberName];
    if (tunings) {
      for (const inst of Object.keys(tunings)) {
        if (tunings[inst].length > 1) return true;
      }
    }
    return false;
  }

  function membersWithChoices() {
    return (store.availableMemberNames || []).filter(memberHasChoices);
  }

  function selectedInstrumentCount(memberName) {
    return (store.generationOptions.show?.members?.[memberName]?.allowedInstruments || []).length;
  }

  function selectedTuningCount(memberName, instName) {
    return (store.generationOptions.show?.members?.[memberName]?.allowedTunings?.[instName] || []).length;
  }

  // Variety slider: maps 0-100 to temperature 0.3-2.0
  function varietyToTemp(v) { return 0.3 + (v / 100) * 1.7; }
  function tempToVariety(t) { return Math.round(((t - 0.3) / 1.7) * 100); }
  let varietyValue = $derived(tempToVariety(store.generationOptions.randomness?.temperature ?? 0.85));

  // ---- drag-to-reorder ----
  function handleEditSong(songId) {
    const catalogSong = store.songs.find((s) => s.id === songId);
    if (catalogSong) {
      store.openSong(catalogSong);
      store.navigate("songs");
    }
  }

  let dragIndex = $state(null);
  let dragOverIndex = $state(null);
  let songListEl = $state(null);

  function handleDragStart(e, index) {
    e.preventDefault();
    dragIndex = index;
    dragOverIndex = index;

    const onMove = (me) => {
      if (dragIndex === null || !songListEl) return;
      const cards = Array.from(songListEl.children);
      const y = me.clientY;
      let closest = dragIndex;
      let minDist = Infinity;
      cards.forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(y - mid);
        if (dist < minDist) { minDist = dist; closest = i; }
      });
      dragOverIndex = closest;
    };

    const onUp = () => {
      if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
        store.reorderSetlistSong(dragIndex, dragOverIndex);
      }
      dragIndex = null;
      dragOverIndex = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }
</script>

<div class="roll-screen">
  <!-- Hero area -->
  <div class="hero">
    <div class="hero-row">
      <div class="count-control">
        <span class="field-label">Songs</span>
        <NumberStepper
          value={store.generationOptions.count}
          min={1}
          max={30}
          label="Song count"
          onchange={(v) => store.updateGenerationField("count", v)}
        />
      </div>
      <button class="roll-btn" onclick={handleRoll}>Roll</button>
    </div>
  </div>

  <!-- Constraints section -->
  {#if membersWithChoices().length > 0}
    <details class="section-details">
      <summary class="section-summary"><span>Constraints</span><svg class="chevron-down" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></summary>
      <div class="section-body">
        {#each membersWithChoices() as memberName}
          <div class="constraint-member">
            <span class="constraint-member-name">{memberName}</span>

            {#if (store.memberInstrumentChoicesByMember?.[memberName] || []).length > 1}
              <div class="chip-row">
                {#each store.memberInstrumentChoicesByMember[memberName] as instrument}
                  <ChipToggle
                    checked={(store.generationOptions.show?.members?.[memberName]?.allowedInstruments || []).includes(instrument)}
                    onchange={() => {
                      store.ensureMemberShowConfig(memberName);
                      store.toggleListValue(`show.members.${memberName}.allowedInstruments`, instrument);
                    }}
                  >
                    {instrument}
                  </ChipToggle>
                {/each}
              </div>
              {#if selectedInstrumentCount(memberName) >= 2}
                <div class="min-songs-row">
                  <span class="min-songs-label">Min songs each</span>
                  <NumberStepper
                    value={store.generationOptions.show?.members?.[memberName]?.minSongsPerInstrument ?? 2}
                    min={1}
                    max={5}
                    label="Min songs per instrument"
                    onchange={(v) => store.updateGenerationField(`show.members.${memberName}.minSongsPerInstrument`, v)}
                  />
                </div>
              {/if}
            {/if}

            {#if store.memberTuningChoicesByMember?.[memberName]}
              {#each Object.entries(store.memberTuningChoicesByMember[memberName]) as [instName, tunings]}
                {#if tunings.length > 1}
                  <div class="tuning-group">
                    <span class="tuning-label">{instName} tunings</span>
                    <div class="chip-row">
                      {#each tunings as tuning}
                        <ChipToggle
                          checked={(store.generationOptions.show?.members?.[memberName]?.allowedTunings?.[instName] || []).includes(tuning)}
                          onchange={() => {
                            store.ensureMemberShowConfig(memberName);
                            store.toggleListValue(`show.members.${memberName}.allowedTunings.${instName}`, tuning);
                          }}
                        >
                          {tuning}
                        </ChipToggle>
                      {/each}
                    </div>
                    {#if selectedTuningCount(memberName, instName) >= 2}
                      <div class="min-songs-row">
                        <span class="min-songs-label">Min songs each</span>
                        <NumberStepper
                          value={store.generationOptions.show?.members?.[memberName]?.minSongsPerTuning?.[instName] ?? 2}
                          min={1}
                          max={5}
                          label="Min songs per tuning"
                          onchange={(v) => store.updateGenerationField(`show.members.${memberName}.minSongsPerTuning.${instName}`, v)}
                        />
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        {/each}
      </div>
    </details>
  {/if}

  <!-- Quick Settings -->
  <details class="section-details">
    <summary class="section-summary"><span>Quick Settings</span><svg class="chevron-down" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></summary>
    <div class="section-body">
      <div class="quick-row">
        <label class="adv-field">
          <span>Max covers</span>
          <input
            type="number"
            min="0"
            value={store.generationOptions.maxCovers}
            oninput={(e) => store.updateGenerationField("maxCovers", Number(e.currentTarget.value))}
          />
        </label>
        <label class="adv-field">
          <span>Max instrumentals</span>
          <input
            type="number"
            min="0"
            value={store.generationOptions.maxInstrumentals}
            oninput={(e) => store.updateGenerationField("maxInstrumentals", Number(e.currentTarget.value))}
          />
        </label>
      </div>

      <div class="variety-field">
        <div class="variety-header">
          <span class="variety-label">Variety</span>
          <span class="variety-hint">{varietyValue < 30 ? "Predictable" : varietyValue > 70 ? "Adventurous" : "Balanced"}</span>
        </div>
        <input
          class="variety-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={varietyValue}
          oninput={(e) => store.updateGenerationField("randomness.temperature", varietyToTemp(Number(e.currentTarget.value)))}
        />
        <div class="variety-labels">
          <span>Predictable</span>
          <span>Adventurous</span>
        </div>
      </div>

      <label class="adv-field">
        <span>Seed <span class="field-hint">(leave 0 for random)</span></span>
        <input
          type="number"
          value={store.generationOptions.seed}
          oninput={(e) => store.updateGenerationField("seed", Number(e.currentTarget.value))}
        />
      </label>
    </div>
  </details>

  <!-- Setlist result -->
  {#if store.generatedSetlist}
    <section class="result-section">
      <div class="summary-bar">
        <div class="stat-pill"><span class="stat-val">{store.generatedSetlist.songs.length}</span><span class="stat-label">songs</span></div>
        <div class="stat-pill"><span class="stat-val">{store.generatedSetlist.summary.score.toFixed(1)}</span><span class="stat-label">score</span></div>
        <div class="stat-pill"><span class="stat-val">{store.generatedSetlist.summary.covers}</span><span class="stat-label">covers</span></div>
        <div class="stat-pill"><span class="stat-val">{store.generatedSetlist.summary.instrumentals}</span><span class="stat-label">inst.</span></div>
      </div>

      <div class="song-list" bind:this={songListEl}>
        {#each store.generatedSetlist.songs as song, i}
          <div class="song-list-item" class:drag-over={dragIndex !== null && dragOverIndex === i && dragIndex !== i}>
            <SetlistSongCard
              {song}
              index={i}
              prevSong={i > 0 ? store.generatedSetlist.songs[i - 1] : null}
              onDragStart={handleDragStart}
              onEdit={handleEditSong}
            />
          </div>
        {/each}
      </div>

      <button class="save-set-btn" onclick={handleSaveSetlist}>Save this set</button>
    </section>
  {/if}

  <!-- Saved sets -->
  {#if store.savedSetlists?.length > 0}
    <section class="saved-section">
      <h3 class="saved-heading">Saved sets</h3>
      <div class="saved-scroll">
        {#each store.savedSetlists as saved}
          <div class="saved-card">
            <div class="saved-card-top">
              <span class="saved-songs">{saved.songs?.length || 0} songs</span>
              <button class="saved-remove" onclick={() => handleRemoveSaved(saved.id)} aria-label="Remove saved set">&times;</button>
            </div>
            {#if saved.summary}
              <div class="saved-stats">
                <span>Score {saved.summary.score}</span>
                <span>{saved.summary.covers}c / {saved.summary.instrumentals}i</span>
              </div>
            {/if}
            {#if saved.seed != null}
              <span class="saved-seed">seed {saved.seed}</span>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .roll-screen {
    display: grid;
    gap: 1rem;
    padding: 0.75rem;
    max-width: 540px;
    margin: 0 auto;
  }

  /* Hero */
  .hero {
    position: sticky;
    top: 48px;
    z-index: 50;
    background: var(--paper, rgba(255, 255, 255, 0.96));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: var(--radius-lg, 16px);
    border: 1px solid rgba(27, 49, 80, 0.1);
    padding: 0.75rem;
    display: grid;
    gap: 0.6rem;
  }

  .hero-row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
  }

  .count-control {
    display: grid;
    gap: 0.25rem;
  }

  .field-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted, #8a95a5);
  }

  .roll-btn {
    flex: 1;
    min-height: 2.8rem;
    border: none;
    border-radius: var(--radius-md, 12px);
    background: var(--accent, #e15b37);
    color: #fff;
    font-size: 1.05rem;
    font-weight: 800;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: background 140ms ease, transform 80ms ease;
  }

  .roll-btn:hover,
  .roll-btn:active {
    background: #c64724;
  }

  .roll-btn:active {
    transform: scale(0.97);
  }

  /* Collapsible sections */
  .section-details {
    border: 1px solid rgba(27, 49, 80, 0.1);
    border-radius: var(--radius-lg, 16px);
    background: rgba(255, 255, 255, 0.76);
    overflow: hidden;
  }

  .section-summary {
    padding: 0.7rem 0.85rem;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--ink, #182230);
    cursor: pointer;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    min-height: 2.6rem;
  }

  .section-summary::-webkit-details-marker {
    display: none;
  }

  .chevron-down {
    flex-shrink: 0;
    color: var(--muted, #8a95a5);
    transition: transform 200ms ease;
  }

  .section-details[open] > .section-summary .chevron-down {
    transform: rotate(180deg);
  }

  .section-body {
    padding: 0 0.85rem 0.85rem;
    display: grid;
    gap: 0.75rem;
  }

  /* Constraints */
  .constraint-member {
    display: grid;
    gap: 0.4rem;
  }

  .constraint-member-name {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--accent, #e15b37);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .tuning-group {
    display: grid;
    gap: 0.25rem;
  }

  .tuning-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted, #8a95a5);
  }

  /* Min songs per constraint */
  .min-songs-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0;
  }

  .min-songs-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted, #8a95a5);
    white-space: nowrap;
  }

  /* Quick Settings */
  .quick-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.65rem;
  }

  .variety-field {
    display: grid;
    gap: 0.3rem;
  }

  .variety-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .variety-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted, #8a95a5);
  }

  .variety-hint {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--accent, #e15b37);
  }

  .variety-slider {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 3px;
    background: rgba(27, 49, 80, 0.1);
    outline: none;
    cursor: pointer;
  }

  .variety-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent, #e15b37);
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    cursor: pointer;
  }

  .variety-slider::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent, #e15b37);
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.2);
    cursor: pointer;
  }

  .variety-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--muted, #8a95a5);
  }

  .field-hint {
    font-weight: 500;
    color: var(--muted, #8a95a5);
    font-size: 0.72rem;
  }

  .adv-field {
    display: grid;
    gap: 0.25rem;
  }

  .adv-field span {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--muted, #8a95a5);
  }

  .adv-field input {
    min-height: 2.2rem;
    padding: 0 0.5rem;
    border: 1px solid rgba(27, 49, 80, 0.14);
    border-radius: var(--radius-md, 12px);
    background: rgba(255, 255, 255, 0.92);
    font-size: 0.85rem;
    font-weight: 600;
    -moz-appearance: textfield;
  }

  .adv-field input::-webkit-inner-spin-button,
  .adv-field input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Result */
  .result-section {
    display: grid;
    gap: 0.65rem;
  }

  .summary-bar {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .stat-pill {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    padding: 0.35rem 0.65rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(27, 49, 80, 0.1);
    font-size: 0.78rem;
  }

  .stat-val {
    font-weight: 800;
    color: var(--ink, #182230);
  }

  .stat-label {
    font-weight: 600;
    color: var(--muted, #8a95a5);
  }

  .song-list {
    display: grid;
    gap: 0.4rem;
  }

  .song-list-item {
    transition: transform 150ms ease;
  }

  .drag-over {
    outline: 2px solid var(--accent, #e15b37);
    outline-offset: -1px;
    border-radius: var(--radius-md, 12px);
  }

  .save-set-btn {
    min-height: 2.6rem;
    border: 2px solid var(--accent, #e15b37);
    border-radius: var(--radius-md, 12px);
    background: transparent;
    color: var(--accent, #e15b37);
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition: background 140ms ease;
  }

  .save-set-btn:hover,
  .save-set-btn:active {
    background: rgba(225, 91, 55, 0.12);
  }

  /* Saved sets */
  .saved-section {
    display: grid;
    gap: 0.5rem;
  }

  .saved-heading {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ink, #182230);
  }

  .saved-scroll {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
  }

  .saved-card {
    flex: 0 0 auto;
    width: clamp(120px, 38vw, 160px);
    padding: 0.65rem;
    border-radius: var(--radius-md, 12px);
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid rgba(27, 49, 80, 0.1);
    display: grid;
    gap: 0.3rem;
    scroll-snap-align: start;
  }

  .saved-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .saved-songs {
    font-weight: 700;
    font-size: 0.82rem;
    color: var(--ink, #182230);
  }

  .saved-remove {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 1.1rem;
    color: var(--muted, #8a95a5);
    padding: 0;
    line-height: 1;
    min-width: 24px;
    min-height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .saved-remove:hover,
  .saved-remove:active {
    color: var(--accent, #e15b37);
  }

  .saved-stats {
    display: flex;
    gap: 0.4rem;
    font-size: 0.7rem;
    color: var(--muted, #8a95a5);
    font-weight: 600;
  }

  .saved-seed {
    font-size: 0.65rem;
    color: var(--muted, #8a95a5);
    font-family: monospace;
  }
</style>
