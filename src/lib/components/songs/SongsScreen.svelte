<script>
    import { getContext } from "svelte";
    import SongEditor from "./SongEditor.svelte";

    const store = getContext("app");

    const TYPE_FILTERS = [
        { id: "all", label: "All" },
        { id: "originals", label: "Originals" },
        { id: "covers", label: "Covers" },
        { id: "instrumentals", label: "Instrumentals" },
    ];

    const STATUS_FILTERS = [
        { id: "incomplete", label: "Incomplete", countKey: "incompleteSongCount" },
        { id: "unpracticed", label: "Unpracticed", countKey: "unpracticedSongCount" },
    ];

    function memberSummary(song) {
        return Object.entries(song.members || {})
            .map(([name, setup]) => {
                const instruments = (setup.instruments || [])
                    .map((i) => i.name)
                    .filter(Boolean)
                    .join(", ");
                return instruments ? `${name}: ${instruments}` : name;
            })
            .join(" | ");
    }
</script>

<div class="songs-screen">
    <header class="screen-header">
        <h2>Songs ({store.songs.length})</h2>
        <button class="primary add-btn" onclick={() => store.openNewSong()}>+ Add</button>
    </header>

    <input
        class="search-input"
        type="search"
        placeholder="Search songs..."
        value={store.songSearch}
        oninput={(e) => (store.songSearch = e.currentTarget.value)}
    />

    <div class="filter-row">
        <div class="status-filters">
            {#each STATUS_FILTERS as sf}
                {@const count = store[sf.countKey]}
                {#if count > 0}
                    <button
                        class="status-chip"
                        class:active={store.songFilter === sf.id}
                        onclick={() => (store.songFilter = store.songFilter === sf.id ? "all" : sf.id)}
                    >{sf.label} <span class="status-count">{count}</span></button>
                {/if}
            {/each}
        </div>
        <div class="type-segmented">
            {#each TYPE_FILTERS as filter}
                <button
                    class="seg-btn"
                    class:active={store.songFilter === filter.id}
                    onclick={() => (store.songFilter = filter.id)}
                >{filter.label}</button>
            {/each}
        </div>
    </div>

    {#if store.emptyCatalog}
        <div class="empty-state">
            <p class="empty-title">Crickets...</p>
            <p class="empty-sub">Your song list is lonelier than a drummer's social life. Tap "+ Add" to fix that.</p>
        </div>
    {:else if store.visibleSongs.length === 0}
        <div class="empty-state">
            <p class="empty-title">Nope, nothing</p>
            <p class="empty-sub">Either your search is too picky or your catalog needs more songs.</p>
        </div>
    {:else}
        <ul class="song-list">
            {#each store.visibleSongs as song (song.id)}
                <li>
                    <button class="song-row" onclick={() => store.openSong(song)}>
                        <div class="song-content">
                            <div class="song-top">
                                <span class="song-name">{song.name || "Untitled"}</span>
                                {#if song.unpracticed}
                                    <span class="pill warn">unpracticed</span>
                                {/if}
                                {#if store.isSongIncomplete(song)}
                                    <span class="pill warn" title={store.songIncompleteReasons(song).join(", ")}>incomplete</span>
                                {/if}
                                {#if song.cover}
                                    <span class="pill">cover</span>
                                {/if}
                                {#if song.instrumental}
                                    <span class="pill">instrumental</span>
                                {/if}
                            </div>
                            {#if memberSummary(song)}
                                <div class="song-members">{memberSummary(song)}</div>
                            {/if}
                            {#if store.songIncompleteReasons(song).length > 0}
                                <div class="incomplete-reasons">
                                    {#each store.songIncompleteReasons(song) as reason}
                                        <span class="incomplete-reason">{reason}</span>
                                    {/each}
                                </div>
                            {/if}
                            {#if song.key}
                                <div class="song-key">Key: {song.key}</div>
                            {/if}
                        </div>
                        <svg class="row-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}

    {#if store.editorSong}
        <SongEditor />
    {/if}
</div>

<style>
    .songs-screen {
        display: grid;
        gap: 0.75rem;
        padding: 1rem;
        max-width: 640px;
        margin: 0 auto;
    }

    .screen-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .screen-header h2 {
        font-size: 1.4rem;
        font-weight: 800;
        margin: 0;
    }

    .add-btn {
        min-height: 2.6rem;
        padding: 0.5rem 1.1rem;
        border-radius: 999px;
        font-weight: 700;
        font-size: 0.9rem;
        border: none;
        background: var(--accent, #e15b37);
        color: #fff;
        cursor: pointer;
        touch-action: manipulation;
    }

    .add-btn:active {
        opacity: 0.85;
    }

    .search-input {
        width: 100%;
        min-height: 2.8rem;
        padding: 0.6rem 0.9rem;
        border-radius: var(--radius-md, 12px);
        border: 1px solid rgba(27, 49, 80, 0.14);
        background: rgba(255, 255, 255, 0.92);
        font-size: 1rem;
        box-sizing: border-box;
    }

    .filter-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        align-items: center;
    }

    .status-filters {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
    }

    .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.35rem 0.7rem;
        border-radius: 999px;
        border: 1px solid rgba(200, 120, 40, 0.3);
        background: rgba(255, 180, 60, 0.08);
        font-size: 0.8rem;
        font-weight: 600;
        color: #b07020;
        cursor: pointer;
        touch-action: manipulation;
        min-height: 2.2rem;
    }

    .status-chip.active {
        background: rgba(255, 160, 40, 0.2);
        border-color: rgba(200, 120, 40, 0.5);
    }

    .status-count {
        font-size: 0.72rem;
        font-weight: 700;
        opacity: 0.7;
    }

    .type-segmented {
        display: inline-flex;
        border-radius: var(--radius-md, 12px);
        overflow: hidden;
        border: 1px solid rgba(27, 49, 80, 0.14);
        flex-shrink: 0;
    }

    .seg-btn {
        min-height: 2.4rem;
        padding: 0.4rem 0.7rem;
        border: none;
        background: rgba(248, 250, 252, 0.96);
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        touch-action: manipulation;
        color: var(--ink, #182230);
        border-right: 1px solid rgba(27, 49, 80, 0.1);
    }

    .seg-btn:last-child {
        border-right: none;
    }

    .seg-btn.active {
        background: var(--accent-soft, rgba(225, 91, 55, 0.12));
        color: var(--accent-strong, #c64724);
    }

    .empty-state {
        padding: 3rem 1rem;
        text-align: center;
    }

    .empty-title {
        font-size: 1.1rem;
        font-weight: 700;
        margin: 0 0 0.4rem;
    }

    .empty-sub {
        color: var(--muted, #6b7a8d);
        margin: 0;
    }

    .song-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.5rem;
    }

    .song-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        text-align: left;
        padding: 0.85rem 1rem;
        border-radius: var(--radius-md, 12px);
        border: 1px solid rgba(27, 49, 80, 0.1);
        background: rgba(255, 255, 255, 0.82);
        cursor: pointer;
        touch-action: manipulation;
        min-height: 3.2rem;
        font: inherit;
        color: inherit;
        -webkit-tap-highlight-color: transparent;
    }

    .song-content {
        flex: 1;
        min-width: 0;
        display: grid;
        gap: 0.25rem;
    }

    .row-chevron {
        flex-shrink: 0;
        color: var(--muted, #6b7a8d);
    }

    .song-row:active {
        background: rgba(225, 91, 55, 0.06);
    }

    .song-top {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex-wrap: wrap;
    }

    .song-name {
        font-weight: 700;
        font-size: 1rem;
    }

    .pill {
        display: inline-flex;
        align-items: center;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 600;
        background: rgba(27, 49, 80, 0.07);
        color: var(--muted, #6b7a8d);
    }

    .pill.warn {
        background: rgba(255, 160, 40, 0.15);
        color: #b07020;
    }

    .song-members {
        font-size: 0.82rem;
        color: var(--muted, #6b7a8d);
        line-height: 1.3;
    }

    .song-key {
        font-size: 0.78rem;
        color: var(--muted, #6b7a8d);
    }

    .incomplete-reasons {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem 0.5rem;
    }

    .incomplete-reason {
        font-size: 0.75rem;
        color: #b07020;
        font-weight: 600;
    }
</style>
