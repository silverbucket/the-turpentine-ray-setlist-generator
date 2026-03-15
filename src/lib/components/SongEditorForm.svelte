<script>
export let song;
export let instrumentChoicesByMember = {};
export let tuningChoicesByMemberInstrument = {};
export let defaultTuningByMemberInstrument = {};
export let onSongFieldChange = () => {};
    export let onRenameMember = () => {};
    export let onAddMember = () => {};
    export let onRemoveMember = () => {};
    export let onAddInstrumentOption = () => {};
    export let onRemoveInstrumentOption = () => {};
    export let onUpdateInstrumentOption = () => {};
export let onSave = () => {};
export let onDuplicate = () => {};
export let onClose = () => {};

    const ENERGY_OPTIONS = [
        { value: 1, label: "1", note: "chill" },
        { value: 2, label: "2", note: "mid" },
        { value: 3, label: "3", note: "lively" }
    ];

    function availableTunings(choicesByMemberInstrument, memberName, option) {
        const instrumentName = option?.name || "";
        return Array.from(new Set([
            ...(choicesByMemberInstrument?.[memberName]?.[instrumentName] || []),
            ...((option && option.tuning) || [])
        ]));
    }

    function availableInstruments(choicesByMember, memberName, option) {
        return Array.from(new Set([
            ...(choicesByMember?.[memberName] || []),
            option?.name
        ].filter(Boolean)));
    }

    function toggleTuning(memberName, index, tuning) {
        const current = song.members[memberName].instruments[index].tuning || [];
        const next = current.includes(tuning)
            ? current.filter((entry) => entry !== tuning)
            : current.concat(tuning);

        onUpdateInstrumentOption(memberName, index, "tuning", next);
    }

    function instrumentDefault(memberName, instrumentName) {
        return defaultTuningByMemberInstrument?.[memberName]?.[instrumentName] || "";
    }
</script>

<div class="inline-editor">
    <section class="editor-section">
        <div class="section-copy">
            <h4>Song basics</h4>
            <p>Name it, set the energy, and flag whether it is a cover or instrumental.</p>
        </div>

        <div class="form-grid">
            <label class="field wide">
                <span>Song name</span>
                <input value={song.name} placeholder="Song title" on:input={(event) => onSongFieldChange("name", event.currentTarget.value)} />
            </label>
            <label class="field">
                <span>Energy</span>
                <div class="energy-picker" role="radiogroup" aria-label="Song energy">
                    {#each ENERGY_OPTIONS as option}
                        <label class={`energy-chip ${song.energy === option.value ? "active" : ""}`}>
                            <input
                                type="radio"
                                name={`energy-${song.id}`}
                                checked={song.energy === option.value}
                                on:change={() => onSongFieldChange("energy", option.value)}
                            />
                            <span>{option.label}</span>
                            <small>{option.note}</small>
                        </label>
                    {/each}
                </div>
            </label>
            <label class="field">
                <span>Key</span>
                <input value={song.key} placeholder="Optional" on:input={(event) => onSongFieldChange("key", event.currentTarget.value)} />
            </label>
            <div class="toggle-group wide">
                <label class="field checkbox pill-toggle">
                    <input type="checkbox" checked={song.cover} on:change={(event) => onSongFieldChange("cover", event.currentTarget.checked)} />
                    <span>Cover</span>
                </label>
                <label class="field checkbox pill-toggle">
                    <input type="checkbox" checked={song.instrumental} on:change={(event) => onSongFieldChange("instrumental", event.currentTarget.checked)} />
                    <span>Instrumental</span>
                </label>
            </div>
        </div>
    </section>

    <section class="editor-section member-stack">
        <div class="inline-header">
            <div class="section-copy">
                <h4>Who plays what</h4>
                <p>Each band member gets one or more playable setup options for this song.</p>
            </div>
            <button class="secondary" on:click={onAddMember}>Add Member</button>
        </div>

        {#each Object.entries(song.members || {}) as [memberName, memberSetup]}
            <section class="member-card">
                <div class="member-head">
                    <div class="member-title">
                        <span class="member-label">Band member</span>
                        <input
                            value={memberName}
                            on:change={(event) => onRenameMember(memberName, event.currentTarget.value)}
                        />
                    </div>
                    <button class="ghost danger" on:click={() => onRemoveMember(memberName)}>Remove</button>
                </div>

                {#each memberSetup.instruments as option, index}
                    <div class="instrument-option">
                        <div class="instrument-row">
                            <label class="field">
                                <span>Instrument</span>
                                <select
                                    value={option.name}
                                    on:change={(event) => onUpdateInstrumentOption(memberName, index, "name", event.currentTarget.value)}
                                >
                                    <option value="">Select instrument</option>
                                    {#each availableInstruments(instrumentChoicesByMember, memberName, option) as instrument}
                                        <option value={instrument}>{instrument}</option>
                                    {/each}
                                </select>
                            </label>
                            <label class="field narrow">
                                <span>Capo</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={option.capo || 0}
                                    on:input={(event) => onUpdateInstrumentOption(memberName, index, "capo", Number(event.currentTarget.value))}
                                />
                            </label>
                            <label class="field checkbox compact simple-toggle">
                                <input
                                    type="checkbox"
                                    checked={Boolean(option.picking)}
                                    on:change={(event) => onUpdateInstrumentOption(memberName, index, "picking", event.currentTarget.checked)}
                                />
                                <span>Picked</span>
                            </label>
                            <button class="ghost danger align-end" on:click={() => onRemoveInstrumentOption(memberName, index)}>Remove setup</button>
                        </div>

                        <div class="tuning-picker">
                            <span>Allowed tunings</span>
                            {#if instrumentDefault(memberName, option.name)}
                                <small class="default-note">Default for this instrument: {instrumentDefault(memberName, option.name)}</small>
                            {/if}
                            <div class="chip-row">
                                {#each availableTunings(tuningChoicesByMemberInstrument, memberName, option) as tuning}
                                    <label class="chip-toggle">
                                        <input
                                            type="checkbox"
                                            checked={(option.tuning || []).includes(tuning)}
                                            on:change={() => toggleTuning(memberName, index, tuning)}
                                        />
                                        <span>{tuning}</span>
                                    </label>
                                {/each}
                            </div>
                        </div>
                    </div>
                {/each}

                <button class="secondary" on:click={() => onAddInstrumentOption(memberName)}>Add Another Setup</button>
            </section>
        {/each}
    </section>

    <div class="editor-actions">
        <button class="primary" on:click={onSave}>Save Song</button>
        <button class="secondary" on:click={onDuplicate}>Duplicate</button>
        <button class="ghost" on:click={onClose}>Close</button>
    </div>
</div>

<style>
    .inline-editor,
    .member-stack {
        display: grid;
        gap: 0.95rem;
    }

    .editor-section,
    .member-card,
    .instrument-option {
        display: grid;
        gap: 0.85rem;
    }

    .editor-section {
        padding: 1rem;
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.76);
        border: 1px solid rgba(27, 49, 80, 0.1);
    }

    .section-copy {
        display: grid;
        gap: 0.3rem;
    }

    .section-copy p {
        color: var(--muted);
    }

    .form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.85rem;
    }

    .field {
        display: grid;
        gap: 0.38rem;
    }

    .field > span {
        font-weight: 700;
        color: var(--ink);
    }

    .field.checkbox {
        display: flex;
        align-items: center;
        gap: 0.55rem;
    }

    .field.checkbox.compact {
        align-self: end;
    }

    .field.wide {
        grid-column: 1 / -1;
    }

    .field.narrow {
        max-width: 110px;
    }

    .toggle-group {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
    }

    .energy-picker {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.6rem;
    }

    .energy-chip {
        display: grid;
        justify-items: center;
        gap: 0.15rem;
        padding: 0.75rem 0.6rem;
        border-radius: var(--radius-md);
        border: 1px solid rgba(27, 49, 80, 0.12);
        background: rgba(248, 250, 252, 0.98);
        cursor: pointer;
        transition: border-color 140ms ease, background 140ms ease, transform 140ms ease, box-shadow 140ms ease;
    }

    .energy-chip input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
    }

    .energy-chip span {
        font-weight: 800;
        font-size: 1rem;
    }

    .energy-chip small {
        color: var(--muted);
    }

    .energy-chip.active {
        background: rgba(255, 246, 242, 0.98);
        border-color: rgba(225, 91, 55, 0.32);
        transform: translateY(-1px);
        box-shadow: 0 10px 18px rgba(225, 91, 55, 0.1);
    }

    .pill-toggle {
        padding: 0.75rem 0.95rem;
        border-radius: 999px;
        border: 1px solid rgba(27, 49, 80, 0.12);
        background: rgba(248, 250, 252, 0.96);
    }

    .inline-header,
    .member-head,
    .editor-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
    }

    .member-head {
        align-items: end;
    }

    .member-title {
        display: grid;
        gap: 0.35rem;
        flex: 1 1 0;
    }

    .member-label {
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--accent);
    }

    .instrument-option {
        padding: 0.9rem;
        border-radius: var(--radius-md);
        background: rgba(248, 250, 252, 0.96);
        border: 1px solid rgba(27, 49, 80, 0.08);
    }

    .instrument-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 120px 140px auto;
        gap: 0.75rem;
        align-items: end;
    }

    .align-end {
        align-self: end;
    }

    .tuning-picker {
        grid-column: 1 / -1;
        display: grid;
        gap: 0.5rem;
    }

    .default-note {
        margin-top: -0.15rem;
        color: var(--muted);
    }

    .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
    }

    @media (max-width: 820px) {
        .form-grid,
        .instrument-row {
            grid-template-columns: 1fr;
        }

        .inline-header,
        .member-head,
        .editor-actions {
            flex-direction: column;
            align-items: stretch;
        }
    }
</style>
