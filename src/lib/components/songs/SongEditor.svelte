<script>
    import { getContext } from "svelte";
    import ChipToggle from "../shared/ChipToggle.svelte";
    import NumberStepper from "../shared/NumberStepper.svelte";

    const store = getContext("app");

    let expandedMember = $state("");
    let confirmingDelete = $state(false);

    function toggleMember(name) {
        expandedMember = expandedMember === name ? "" : name;
    }

    function availableInstruments(memberName, option) {
        return Array.from(
            new Set(
                [
                    ...(store.memberInstrumentChoicesByMember?.[memberName] || []),
                    option?.name,
                ].filter(Boolean)
            )
        );
    }

    function availableTunings(memberName, option) {
        const instrumentName = option?.name || "";
        return Array.from(
            new Set([
                ...(store.memberTuningChoicesByMember?.[memberName]?.[instrumentName] || []),
                ...((option && option.tuning) || []),
            ])
        );
    }

    function defaultTuning(memberName, instrumentName) {
        return store.defaultTuningByMemberInstrument?.[memberName]?.[instrumentName] || "";
    }

    function availableTechniques(memberName, option) {
        const instrumentName = option?.name || "";
        const memberConfig = store.appConfig?.band?.members?.[memberName];
        const instConfig = (memberConfig?.instruments || []).find((i) => i.name === instrumentName);
        return instConfig?.techniques || [];
    }

    function toggleTuning(memberName, index, tuning) {
        const current =
            store.editorSong.members[memberName].instruments[index].tuning || [];
        const next = current.includes(tuning)
            ? current.filter((t) => t !== tuning)
            : current.concat(tuning);
        store.updateInstrumentOption(memberName, index, "tuning", next);
    }

    function handleSave() {
        store.saveSong();
    }

    function handleDelete() {
        if (confirmingDelete) {
            store.deleteSong(store.editorSong);
            confirmingDelete = false;
        } else {
            confirmingDelete = true;
        }
    }

    function cancelDelete() {
        confirmingDelete = false;
    }
</script>

<div class="editor-overlay">
    <header class="editor-header">
        <button class="back-btn" onclick={() => store.closeEditor()} aria-label="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
        </button>
        <span class="editor-title">{store.editorSong.name || "New Song"}</span>
        <button class="save-btn" onclick={handleSave}>Save</button>
    </header>

    <div class="editor-body">
        <!-- Section 1: Basics -->
        <section class="section-card">
            <h3 class="section-heading">Basics</h3>

            <label class="field">
                <span class="field-label">Song name</span>
                <input
                    class="field-input"
                    value={store.editorSong.name}
                    placeholder="Song title"
                    oninput={(e) => store.updateSongField("name", e.currentTarget.value)}
                />
            </label>

            <label class="field">
                <span class="field-label">Key</span>
                <input
                    class="field-input"
                    value={store.editorSong.key}
                    placeholder="e.g. G, Am, Bb"
                    oninput={(e) => store.updateSongField("key", e.currentTarget.value)}
                />
            </label>

            <div class="toggle-row">
                <ChipToggle
                    checked={store.editorSong.cover}
                    onchange={(e) => store.updateSongField("cover", e.currentTarget.checked)}
                >Cover</ChipToggle>
                <ChipToggle
                    checked={store.editorSong.instrumental}
                    onchange={(e) => store.updateSongField("instrumental", e.currentTarget.checked)}
                >Instrumental</ChipToggle>
            </div>

            <div class="toggle-row">
                <ChipToggle
                    checked={store.editorSong.notGoodOpener}
                    onchange={(e) => store.updateSongField("notGoodOpener", e.currentTarget.checked)}
                >Not a good opener</ChipToggle>
                <ChipToggle
                    checked={store.editorSong.notGoodCloser}
                    onchange={(e) => store.updateSongField("notGoodCloser", e.currentTarget.checked)}
                >Not a good closer</ChipToggle>
            </div>

            <div class="toggle-row">
                <ChipToggle
                    checked={store.editorSong.unpracticed}
                    onchange={(e) => store.updateSongField("unpracticed", e.currentTarget.checked)}
                >Unpracticed</ChipToggle>
            </div>
        </section>

        <!-- Section 2: Members -->
        <section class="section-card">
            <h3 class="section-heading">Members</h3>

            {#each Object.entries(store.editorSong.members || {}) as [memberName, memberSetup]}
                <div class="member-card">
                    <button
                        class="member-header"
                        onclick={() => toggleMember(memberName)}
                        aria-expanded={expandedMember === memberName}
                    >
                        <span class="member-name">{memberName}</span>
                        <span class="member-instrument-summary">
                            {(memberSetup.instruments || []).map((i) => i.name).filter(Boolean).join(", ")}
                        </span>
                        <svg
                            class="chevron"
                            class:open={expandedMember === memberName}
                            width="20" height="20" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" stroke-width="2.5"
                            stroke-linecap="round" stroke-linejoin="round"
                        >
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>

                    {#if expandedMember === memberName}
                        <div class="member-body">
                            <label class="field">
                                <span class="field-label">Member name</span>
                                <input
                                    class="field-input"
                                    value={memberName}
                                    onchange={(e) => store.renameMember(memberName, e.currentTarget.value)}
                                />
                            </label>

                            {#each memberSetup.instruments as option, index}
                                <div class="instrument-card">
                                    <div class="instrument-top">
                                        <label class="field flex-1">
                                            <span class="field-label">Instrument</span>
                                            <select
                                                class="field-input"
                                                value={option.name}
                                                onchange={(e) => store.updateInstrumentOption(memberName, index, "name", e.currentTarget.value)}
                                            >
                                                <option value="">Select instrument</option>
                                                {#each availableInstruments(memberName, option) as instrument}
                                                    <option value={instrument}>{instrument}</option>
                                                {/each}
                                            </select>
                                        </label>

                                        <button
                                            class="remove-setup-btn"
                                            onclick={() => store.removeInstrumentOption(memberName, index)}
                                        >Remove</button>
                                    </div>

                                    {#if availableTunings(memberName, option).length > 0}
                                        <div class="tuning-section">
                                            <span class="field-label">Tunings</span>
                                            {#if defaultTuning(memberName, option.name)}
                                                <small class="default-note">Default: {defaultTuning(memberName, option.name)}</small>
                                            {/if}
                                            <div class="chip-row">
                                                {#each availableTunings(memberName, option) as tuning}
                                                    <ChipToggle
                                                        checked={(option.tuning || []).includes(tuning)}
                                                        onchange={() => toggleTuning(memberName, index, tuning)}
                                                    >{tuning}</ChipToggle>
                                                {/each}
                                            </div>
                                        </div>
                                    {/if}

                                    <div class="instrument-options-row">
                                        <div class="field">
                                            <span class="field-label">Capo</span>
                                            <NumberStepper
                                                value={option.capo || 0}
                                                min={0}
                                                max={12}
                                                label="Capo"
                                                onchange={(v) => store.updateInstrumentOption(memberName, index, "capo", v)}
                                            />
                                        </div>
                                        {#if availableTechniques(memberName, option).length > 0}
                                            <div class="field">
                                                <span class="field-label">Technique</span>
                                                <div class="chip-row">
                                                    <ChipToggle
                                                        checked={(option.picking || []).includes("none")}
                                                        onchange={() => store.updateInstrumentOption(memberName, index, "picking", (option.picking || []).includes("none") ? [] : ["none"])}
                                                    >None</ChipToggle>
                                                    {#each availableTechniques(memberName, option) as technique}
                                                        {@const active = (option.picking || []).includes(technique)}
                                                        <ChipToggle
                                                            checked={active}
                                                            onchange={() => store.updateInstrumentOption(memberName, index, "picking", active ? (option.picking || []).filter(t => t !== technique) : [...(option.picking || []).filter(t => t !== "none"), technique])}
                                                        >{technique}</ChipToggle>
                                                    {/each}
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/each}

                            <button
                                class="secondary-btn"
                                onclick={() => store.addInstrumentOption(memberName)}
                            >+ Add another setup</button>

                            <button
                                class="danger-text-btn"
                                onclick={() => store.removeMember(memberName)}
                            >Remove {memberName}</button>
                        </div>
                    {/if}
                </div>
            {/each}

            <button class="secondary-btn" onclick={() => store.addMember()}>+ Add member</button>
        </section>

        <!-- Bottom actions -->
        <div class="bottom-actions">
            <button class="secondary-btn full-width" onclick={() => store.duplicateSong(store.editorSong)}>Duplicate song</button>

            {#if confirmingDelete}
                <div class="delete-confirm">
                    <span class="delete-warn">Are you sure? This cannot be undone.</span>
                    <div class="delete-confirm-btns">
                        <button class="danger-btn" onclick={handleDelete}>Yes, delete</button>
                        <button class="secondary-btn" onclick={cancelDelete}>Cancel</button>
                    </div>
                </div>
            {:else}
                <button class="danger-text-btn full-width" onclick={handleDelete}>Delete song</button>
            {/if}
        </div>
    </div>
</div>

<style>
    .editor-overlay {
        position: fixed;
        inset: 0;
        z-index: 300;
        background: var(--bg, #f0f2f5);
        display: grid;
        grid-template-rows: auto 1fr;
        overflow: hidden;
    }

    .editor-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 0.75rem;
        padding-top: calc(env(safe-area-inset-top, 0px) + 0.6rem);
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(27, 49, 80, 0.1);
        min-height: 48px;
        flex-shrink: 0;
    }

    .back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 44px;
        min-height: 44px;
        border: none;
        border-radius: var(--radius-md, 12px);
        background: transparent;
        cursor: pointer;
        color: var(--ink, #182230);
        padding: 0;
        flex-shrink: 0;
        touch-action: manipulation;
    }

    .back-btn:active {
        background: rgba(0, 0, 0, 0.06);
    }

    .editor-title {
        flex: 1;
        min-width: 0;
        text-align: center;
        font-weight: 700;
        font-size: 1rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .save-btn {
        min-width: 64px;
        min-height: 44px;
        padding: 0.4rem 1rem;
        border-radius: 999px;
        border: none;
        background: var(--accent, #e15b37);
        color: #fff;
        font-weight: 700;
        font-size: 0.88rem;
        cursor: pointer;
        touch-action: manipulation;
        flex-shrink: 0;
    }

    .save-btn:active {
        opacity: 0.85;
    }

    .editor-body {
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 1rem;
        display: grid;
        gap: 1rem;
        max-width: 640px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
        padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 4rem);
    }

    .section-card {
        display: grid;
        gap: 0.85rem;
        padding: 1rem;
        border-radius: var(--radius-lg, 16px);
        background: rgba(255, 255, 255, 0.76);
        border: 1px solid rgba(27, 49, 80, 0.1);
    }

    .section-heading {
        font-size: 1rem;
        font-weight: 800;
        margin: 0;
    }

    .field {
        display: grid;
        gap: 0.35rem;
    }

    .field-label {
        font-size: 0.82rem;
        font-weight: 700;
        color: var(--ink, #182230);
    }

    .field-input {
        min-height: 2.8rem;
        padding: 0.55rem 0.75rem;
        border-radius: var(--radius-md, 12px);
        border: 1px solid rgba(27, 49, 80, 0.14);
        background: rgba(255, 255, 255, 0.92);
        font-size: 1rem;
        font: inherit;
        box-sizing: border-box;
        width: 100%;
    }

    select.field-input {
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 0.75rem center;
        padding-right: 2.2rem;
    }

    .flex-1 {
        flex: 1 1 0;
    }

    .toggle-row {
        display: flex;
        gap: 0.6rem;
        flex-wrap: wrap;
    }

    /* Member cards */
    .member-card {
        border-radius: var(--radius-md, 12px);
        border: 1px solid rgba(27, 49, 80, 0.1);
        background: rgba(248, 250, 252, 0.96);
        overflow: hidden;
    }

    .member-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.85rem 1rem;
        border: none;
        background: transparent;
        cursor: pointer;
        touch-action: manipulation;
        font: inherit;
        color: inherit;
        text-align: left;
        min-height: 3rem;
    }

    .member-header:active {
        background: rgba(0, 0, 0, 0.03);
    }

    .member-name {
        font-weight: 700;
        font-size: 0.95rem;
    }

    .member-instrument-summary {
        flex: 1;
        font-size: 0.8rem;
        color: var(--muted, #6b7a8d);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .chevron {
        flex-shrink: 0;
        transition: transform 200ms ease;
    }

    .chevron.open {
        transform: rotate(180deg);
    }

    .member-body {
        display: grid;
        gap: 0.75rem;
        padding: 0 1rem 1rem;
    }

    .instrument-card {
        display: grid;
        gap: 0.65rem;
        padding: 0.85rem;
        border-radius: var(--radius-md, 12px);
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(27, 49, 80, 0.08);
    }

    .instrument-top {
        display: flex;
        gap: 0.6rem;
        align-items: flex-end;
    }

    .instrument-options-row {
        display: flex;
        gap: 1rem;
        align-items: flex-end;
        flex-wrap: wrap;
    }

    .tuning-section {
        display: grid;
        gap: 0.35rem;
    }

    .default-note {
        color: var(--muted, #6b7a8d);
        font-size: 0.78rem;
    }

    .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }

    .remove-setup-btn {
        min-height: 2.4rem;
        padding: 0.4rem 0.7rem;
        border: none;
        border-radius: var(--radius-md, 12px);
        background: transparent;
        color: var(--danger, #d33);
        font-weight: 600;
        font-size: 0.82rem;
        cursor: pointer;
        touch-action: manipulation;
        white-space: nowrap;
        align-self: flex-end;
    }

    .remove-setup-btn:active {
        background: rgba(200, 40, 40, 0.06);
    }

    /* Buttons */
    .secondary-btn {
        min-height: 2.8rem;
        padding: 0.55rem 1rem;
        border-radius: var(--radius-md, 12px);
        border: 1px solid rgba(27, 49, 80, 0.14);
        background: rgba(255, 255, 255, 0.92);
        font-weight: 600;
        font-size: 0.88rem;
        cursor: pointer;
        touch-action: manipulation;
        color: var(--ink, #182230);
    }

    .secondary-btn:active {
        background: rgba(0, 0, 0, 0.04);
    }

    .danger-text-btn {
        min-height: 2.8rem;
        padding: 0.55rem 1rem;
        border: none;
        border-radius: var(--radius-md, 12px);
        background: transparent;
        color: var(--danger, #d33);
        font-weight: 600;
        font-size: 0.88rem;
        cursor: pointer;
        touch-action: manipulation;
    }

    .danger-text-btn:active {
        background: rgba(200, 40, 40, 0.06);
    }

    .danger-btn {
        min-height: 2.8rem;
        padding: 0.55rem 1rem;
        border: none;
        border-radius: var(--radius-md, 12px);
        background: var(--danger, #d33);
        color: #fff;
        font-weight: 700;
        font-size: 0.88rem;
        cursor: pointer;
        touch-action: manipulation;
    }

    .danger-btn:active {
        opacity: 0.85;
    }

    .full-width {
        width: 100%;
    }

    .bottom-actions {
        display: grid;
        gap: 0.6rem;
        padding-top: 0.5rem;
    }

    .delete-confirm {
        display: grid;
        gap: 0.5rem;
        padding: 1rem;
        border-radius: var(--radius-md, 12px);
        background: rgba(200, 40, 40, 0.05);
        border: 1px solid rgba(200, 40, 40, 0.15);
    }

    .delete-warn {
        font-weight: 600;
        font-size: 0.88rem;
        color: var(--danger, #d33);
    }

    .delete-confirm-btns {
        display: flex;
        gap: 0.5rem;
    }
</style>
