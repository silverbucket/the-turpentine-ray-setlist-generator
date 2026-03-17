import { DEFAULT_APP_CONFIG, blankSong, normalizeAppConfig, normalizeSongRecord } from "../defaults.js";
import { CONFIG_SECTIONS } from "../config-meta.js";
import { scoreFixedOrder } from "../generator.js";
import { clone, deepMerge, formatDelimitedList, getByPath, nowIso, parseDelimitedList, setByPath, titleForBand, tryParseJson, uid } from "../utils.js";
import GeneratorWorker from "../generator.worker.js?worker";

const STORAGE_PREFIX = "setlist-generator";
const MAX_SAVED_SETS = 5;

// Scope localStorage keys per user so accounts don't leak data
function scopedKey(base, userAddress) {
    if (!userAddress) return `${STORAGE_PREFIX}-${base}`;
    // Simple hash to keep the key short
    let h = 0;
    for (let i = 0; i < userAddress.length; i++) {
        h = ((h << 5) - h + userAddress.charCodeAt(i)) | 0;
    }
    return `${STORAGE_PREFIX}-${base}-${(h >>> 0).toString(36)}`;
}

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function createAppStore(repo) {
    // ---- per-user localStorage scoping ----
    let currentUserAddress = "";
    function storageKey(base) { return scopedKey(base, currentUserAddress); }

    // ---- core state ----
    let songs = $state([]);
    let appConfig = $state(null);
    let bootstrapMeta = $state(null);
    let generatedSetlist = $state(null);
    let isGenerating = $state(false);
    let setlistLocked = $state(false);
    let setlistSaved = $state(false);
    let pendingRollConfirm = $state(false);
    let savedSetlists = $state([]);

    // ---- connection ----
    let connectionStatus = $state("disconnected");
    let connectAddress = $state("");

    // ---- ui ----
    let activeView = $state("roll");
    let loadError = $state("");
    let busyMessage = $state("");
    let toastMessages = $state([]);
    let showFirstRunPrompt = $state(false);
    let firstRunBandName = $state("");

    // ---- sync ----
    let syncIndicatorVisible = $state(false);
    let syncStatusLabel = $state("All changes saved");
    let syncActiveCount = 0;
    let syncIndicatorTimer = null;

    // ---- generation options (loaded properly on connect via loadUserLocalData) ----
    let generationOptions = $state(defaultGenerationOptions(DEFAULT_APP_CONFIG));

    // ---- song editor ----
    let editorSong = $state(null);
    let selectedSongId = $state("");
    let editReturnView = $state("");
    let songSearch = $state("");
    let songFilter = $state("all");

    // ---- band editing ----
    let expandedBandMember = $state("");
    let newMemberName = $state("");
    let newInstrumentByMember = $state({});
    let newTuningByInstrument = $state({});
    let newTechniqueByInstrument = $state({});

    // ---- import/export ----
    let importMode = $state("skip");
    let importFile = $state(null);


    // ---- advanced config sub-view ----
    let bandSubView = $state("main"); // "main" | "advanced" | "member-edit"
    let editingMemberName = $state("");

    // ---- derived ----
    let appTitle = $derived(titleForBand(appConfig?.bandName));
    let emptyCatalog = $derived(connectionStatus === "connected" && songs.length === 0);
    let bandMemberEntries = $derived(
        Object.entries(appConfig?.band?.members || {}).sort(([a], [b]) => a.localeCompare(b))
    );
    let availableMemberNames = $derived(buildAvailableMemberNames());
    let memberInstrumentChoicesByMember = $derived(buildMemberInstrumentChoicesByMember());
    let memberTuningChoicesByMember = $derived(buildMemberTuningChoicesByMember());
    let defaultTuningByMemberInstrument = $derived(buildDefaultTuningByMemberInstrument());
    let allInstrumentNamesList = $derived(buildAllInstrumentNames());
    let instrumentTypeCount = $derived(allInstrumentNamesList.length);
    let visibleSongs = $derived(computeVisibleSongs());

    // ---- helpers ----

    function defaultGenerationOptions(config = appConfig) {
        const source = config || DEFAULT_APP_CONFIG;
        return {
            count: source.general?.count || 15,
            beamWidth: source.general?.beamWidth || 20,
            maxCovers: source.general?.limits?.covers || 0,
            maxInstrumentals: source.general?.limits?.instrumentals || 0,
            seed: "",
            randomness: {
                temperature: source.general?.randomness?.temperature || 0.85,
                finalChoicePool: source.general?.randomness?.finalChoicePool || 12
            },
            show: {
                members: clone(source.show?.members || {})
            }
        };
    }

    function buildAvailableMemberNames() {
        const names = new Set([
            ...Object.keys(appConfig?.band?.members || {}),
            ...Object.keys(generationOptions.show?.members || {}),
            ...songs.flatMap((song) => Object.keys(song.members || {}))
        ]);
        return Array.from(names).sort();
    }

    function buildMemberInstrumentChoicesByMember() {
        return availableMemberNames.reduce((result, memberName) => {
            const fromSongs = songs.flatMap((song) =>
                (song.members?.[memberName]?.instruments || []).map((o) => o.name)
            );
            const fromConfig = generationOptions.show?.members?.[memberName]?.allowedInstruments || [];
            const fromBand = (appConfig?.band?.members?.[memberName]?.instruments || []).map((i) => i.name);
            result[memberName] = Array.from(new Set([...fromBand, ...fromSongs, ...fromConfig].filter(Boolean))).sort();
            return result;
        }, {});
    }

    function buildMemberTuningChoicesByMember() {
        return availableMemberNames.reduce((result, memberName) => {
            result[memberName] = (memberInstrumentChoicesByMember[memberName] || []).reduce((ir, instrumentName) => {
                const fromBand = (appConfig?.band?.members?.[memberName]?.instruments || [])
                    .find((i) => i.name === instrumentName)?.tunings || [];
                const fromConfig = generationOptions.show?.members?.[memberName]?.allowedTunings?.[instrumentName] || [];
                ir[instrumentName] = Array.from(new Set([...fromBand, ...fromConfig].filter(Boolean))).sort();
                return ir;
            }, {});
            return result;
        }, {});
    }

    function buildDefaultTuningByMemberInstrument() {
        return availableMemberNames.reduce((result, memberName) => {
            result[memberName] = (appConfig?.band?.members?.[memberName]?.instruments || []).reduce((ir, instrument) => {
                ir[instrument.name] = instrument.defaultTuning || "";
                return ir;
            }, {});
            return result;
        }, {});
    }

    function buildAllInstrumentNames() {
        const names = new Set();
        Object.values(memberInstrumentChoicesByMember || {}).forEach((instruments) => {
            (instruments || []).forEach((name) => names.add(name));
        });
        return Array.from(names).sort();
    }

    function songIncompleteReasons(song) {
        const bandMembers = appConfig?.band?.members || {};
        const memberNames = Object.keys(bandMembers);
        if (memberNames.length === 0) return [];
        const songMembers = song.members || {};
        const reasons = [];
        for (const name of memberNames) {
            const memberSetup = songMembers[name];
            if (!memberSetup) { reasons.push(`${name}: not set up`); continue; }
            const instruments = memberSetup.instruments || [];
            if (instruments.length === 0) { reasons.push(`${name}: needs instrument`); continue; }
            for (const inst of instruments) {
                if (!inst.name) { reasons.push(`${name}: instrument not selected`); continue; }
                const bandInst = (bandMembers[name].instruments || []).find((i) => i.name === inst.name);
                if (bandInst && (bandInst.techniques || []).length > 0 && (!Array.isArray(inst.picking) || inst.picking.length === 0)) {
                    reasons.push(`${name}: ${inst.name} needs technique`);
                }
            }
        }
        return reasons;
    }

    function isSongIncomplete(song) {
        return songIncompleteReasons(song).length > 0;
    }

    function computeVisibleSongs() {
        const query = songSearch.trim().toLowerCase();
        return songs.filter((song) => {
            if (songFilter === "covers" && !song.cover) return false;
            if (songFilter === "instrumentals" && !song.instrumental) return false;
            if (songFilter === "originals" && song.cover) return false;
            if (songFilter === "incomplete" && !isSongIncomplete(song)) return false;
            if (songFilter === "unpracticed" && !song.unpracticed) return false;
            if (!query) return true;
            return [song.name, song.key, ...Object.keys(song.members || {})]
                .join(" ").toLowerCase().includes(query);
        });
    }

    function loadStoredGenerationOptions() {
        const fallback = defaultGenerationOptions(DEFAULT_APP_CONFIG);
        if (typeof localStorage === "undefined") return fallback;
        const stored = tryParseJson(localStorage.getItem(storageKey("ui-options")), null);
        return stored ? deepMerge(fallback, stored) : fallback;
    }

    function persistGenerationOptions() {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(storageKey("ui-options"), JSON.stringify(generationOptions));
    }

    // Strip deprecated "energy" field and energy-related notes from saved setlist songs
    function stripEnergy(sets) {
        if (!Array.isArray(sets)) return sets;
        return sets.map((s) => ({
            ...s,
            songs: (s.songs || []).map((song) => {
                const { energy, ...rest } = song;
                return {
                    ...rest,
                    transitionNotes: (rest.transitionNotes || []).filter((n) => !/energy/i.test(n)),
                    contextNotes: (rest.contextNotes || []).filter((n) => !/energy/i.test(n)),
                };
            }),
        }));
    }

    function loadSavedSetlists() {
        if (typeof localStorage === "undefined") return [];
        return stripEnergy(tryParseJson(localStorage.getItem(storageKey("saved-sets")), []) || []);
    }

    function persistSavedSetlists() {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(storageKey("saved-sets"), JSON.stringify(savedSetlists));
    }

    function loadCurrentSetlist() {
        if (typeof localStorage === "undefined") return null;
        return tryParseJson(localStorage.getItem(storageKey("current-set")), null);
    }

    function loadCurrentSetlistLocked() {
        if (typeof localStorage === "undefined") return false;
        const data = tryParseJson(localStorage.getItem(storageKey("current-set")), null);
        return data?._locked || false;
    }

    function persistCurrentSetlist() {
        if (typeof localStorage === "undefined") return;
        if (generatedSetlist) {
            localStorage.setItem(storageKey("current-set"), JSON.stringify({ ...generatedSetlist, _locked: setlistLocked }));
        } else {
            localStorage.removeItem(storageKey("current-set"));
        }
    }

    // Remove any un-scoped legacy localStorage keys so they can't leak between accounts
    function clearUnscopedLocalStorage() {
        if (typeof localStorage === "undefined") return;
        localStorage.removeItem("setlist-generator-ui-options");
        localStorage.removeItem("setlist-generator-saved-sets");
        localStorage.removeItem("setlist-generator-current-set");
    }

    // Clear the current user's scoped localStorage keys (called on disconnect)
    function clearUserLocalStorage() {
        if (typeof localStorage === "undefined" || !currentUserAddress) return;
        localStorage.removeItem(storageKey("ui-options"));
        localStorage.removeItem(storageKey("saved-sets"));
        localStorage.removeItem(storageKey("current-set"));
    }

    // Load all per-user localStorage data (called on connect when we know the user)
    function loadUserLocalData() {
        clearUnscopedLocalStorage();
        savedSetlists = loadSavedSetlists();
        const current = loadCurrentSetlist();
        const locked = current?._locked || false;
        generatedSetlist = locked ? current : null;
        setlistLocked = locked;
        setlistSaved = false;
        generationOptions = loadStoredGenerationOptions();
    }

    // ---- toast ----
    function addToast(message, tone = "info") {
        const id = uid("toast");
        toastMessages = [...toastMessages, { id, message, tone }];
        const duration = tone === "danger" ? 8000 : 6000;
        setTimeout(() => {
            toastMessages = toastMessages.filter((t) => t.id !== id);
        }, duration);
    }

    // ---- sync indicators ----
    function beginSync(label = "Syncing") {
        syncActiveCount += 1;
        syncStatusLabel = label;
        syncIndicatorVisible = true;
        if (syncIndicatorTimer) {
            clearTimeout(syncIndicatorTimer);
            syncIndicatorTimer = null;
        }
    }

    function endSync(nextLabel = "All changes saved") {
        syncActiveCount = Math.max(0, syncActiveCount - 1);
        if (syncActiveCount > 0) return;
        syncStatusLabel = nextLabel;
        if (syncIndicatorTimer) clearTimeout(syncIndicatorTimer);
        syncIndicatorTimer = setTimeout(() => {
            syncIndicatorVisible = false;
            syncIndicatorTimer = null;
        }, 1000);
    }

    async function withSync(label, callback) {
        beginSync(label);
        try {
            return await callback();
        } finally {
            endSync();
        }
    }

    // ---- navigation ----
    function syncRouteFromHash() {
        const next = window.location.hash.replace(/^#\/?/, "") || "roll";
        const allowed = ["roll", "saved", "songs", "band", "help"];
        activeView = allowed.includes(next) ? next : "roll";
    }

    function navigate(view) {
        window.location.hash = `/${view}`;
    }

    // ---- connection ----
    async function connectStorage() {
        if (!connectAddress.trim()) {
            addToast("Put in a remoteStorage address first.", "danger");
            return;
        }
        connectionStatus = "connecting";
        loadError = "";
        repo.connect(connectAddress.trim());
    }

    function disconnectStorage() {
        repo.disconnect();
    }

    // ---- data loading ----
    async function reloadAll({ quiet = false } = {}) {
        try {
            busyMessage = quiet ? "" : "Loading your songs...";
            loadError = "";
            const data = await repo.loadAll();
            songs = data.songs.map(normalizeSongRecord);
            bootstrapMeta = data.bootstrap;
            appConfig = data.config ? normalizeAppConfig(data.config) : null;

            if (!appConfig) {
                showFirstRunPrompt = true;
                firstRunBandName = "";
                navigate("roll");
                generationOptions = defaultGenerationOptions(DEFAULT_APP_CONFIG);
                persistGenerationOptions();
                return;
            }

            showFirstRunPrompt = false;
            generationOptions = deepMerge(defaultGenerationOptions(appConfig), generationOptions || {});
            persistGenerationOptions();
        } catch (error) {
            loadError = error?.message || "Could not load remote data.";
            addToast(loadError, "danger");
        } finally {
            busyMessage = "";
        }
    }

    async function finishFirstRun() {
        const bandName = firstRunBandName.trim();
        if (!bandName) {
            addToast("Your band needs a name.", "danger");
            return;
        }
        try {
            busyMessage = "Setting up...";
            appConfig = await withSync("Setting up", () => repo.ensureConfig(bandName));
            generationOptions = defaultGenerationOptions(appConfig);
            persistGenerationOptions();
            showFirstRunPrompt = false;
            addToast(`Welcome, ${bandName}.`);
        } catch (error) {
            addToast(error?.message || "Could not save your band name.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    // ---- generation ----
    function validateConstraintMinimums(result) {
        const memberConstraints = generationOptions.show?.members || {};
        for (const [memberName, constraints] of Object.entries(memberConstraints)) {
            const allowed = constraints.allowedInstruments || [];
            const minPerInst = constraints.minSongsPerInstrument ?? 2;
            if (allowed.length >= 2) {
                const counts = {};
                allowed.forEach((inst) => { counts[inst] = 0; });
                (result.songs || []).forEach((song) => {
                    const inst = song.performance?.[memberName]?.instrument;
                    if (inst && inst in counts) counts[inst]++;
                });
                if (Object.values(counts).some((c) => c < minPerInst)) return false;
            }
            const allowedTunings = constraints.allowedTunings || {};
            const minPerTuning = constraints.minSongsPerTuning || {};
            for (const [instName, tunings] of Object.entries(allowedTunings)) {
                const minT = minPerTuning[instName] ?? 2;
                if (tunings.length >= 2) {
                    const counts = {};
                    tunings.forEach((t) => { counts[t] = 0; });
                    (result.songs || []).forEach((song) => {
                        const perf = song.performance?.[memberName];
                        if (perf?.instrument === instName && perf.tuning && perf.tuning in counts) counts[perf.tuning]++;
                    });
                    if (Object.values(counts).some((c) => c < minT)) return false;
                }
            }
        }
        return true;
    }

    function requestRoll() {
        if (isGenerating) return;
        if (setlistLocked) {
            pendingRollConfirm = true;
            return;
        }
        generate();
    }

    function confirmRoll() {
        pendingRollConfirm = false;
        setlistLocked = false;
        generate();
    }

    function cancelRoll() {
        pendingRollConfirm = false;
    }

    function generate() {
        if (isGenerating) return;
        if (!songs.length) {
            addToast("Can't roll with no songs! Add a few first.", "danger");
            navigate("songs");
            return;
        }
        const eligibleSongs = songs.filter((s) => !s.unpracticed);
        if (!eligibleSongs.length) {
            addToast("Every song is unpracticed. Time to rehearse!", "danger");
            return;
        }

        isGenerating = true;
        const optionsList = [clone(generationOptions)];

        const worker = new GeneratorWorker();
        worker.postMessage({
            songs: clone(eligibleSongs),
            config: clone(appConfig || DEFAULT_APP_CONFIG),
            optionsList
        });
        worker.onmessage = (event) => {
            const { type, result } = event.data;
            if (type !== "done") return;
            worker.terminate();
            isGenerating = false;
            if (!result) {
                addToast(randomFrom([
                    "The generator tripped over a cable.",
                    "Something went sideways. Blame the bassist.",
                    "Critical fumble — try again?",
                ]), "danger");
                return;
            }
            generatedSetlist = result;
            setlistLocked = false;
            setlistSaved = false;
            persistCurrentSetlist();
            if (!validateConstraintMinimums(result)) {
                addToast("Close enough! Some constraints bent but didn't break.", "warning");
            }
            const n = generatedSetlist.songs.length;
            addToast(randomFrom([
                `🎲 The dice have spoken. ${n} songs.`,
                `${n} songs, rolled fresh. No refunds.`,
                `Behold: ${n} tracks of pure destiny.`,
                `${n} songs. Trust the roll.`,
                `The rock gods have decided. ${n} songs.`,
            ]));
        };
        worker.onerror = (err) => {
            worker.terminate();
            isGenerating = false;
            addToast(randomFrom([
                "The generator tripped over a cable.",
                "Something went sideways. Blame the bassist.",
                "Critical fumble — try again?",
            ]), "danger");
        };
    }

    function lockSetlist() {
        if (!generatedSetlist) return;
        if (setlistLocked) return;
        setlistLocked = true;
        persistCurrentSetlist();
        addToast(randomFrom([
            "Setlist locked in. No take-backs.",
            "It's canon now.",
            "Sealed. This one's going on stage.",
        ]));
    }

    function saveCurrentSetlist() {
        if (!generatedSetlist) {
            console.warn("[Set Roll] saveCurrentSetlist: no generatedSetlist");
            return;
        }
        const currentSaved = savedSetlists || [];
        const songNames = generatedSetlist.songs.map(s => s.name || s.title || "?");
        const funNames = [
            "The Unhinged Encore", "Chaos Theory Vol. " + (currentSaved.length + 1),
            "No Refunds", "The One That Slaps", "Certified Banger",
            "Tuesday Night Special", "Blame the Dice", "Accidentally Perfect",
            "The Hot Mess Express", "Trust the Process"
        ];
        const entry = {
            id: uid("set"),
            name: funNames[currentSaved.length % funNames.length],
            savedAt: nowIso(),
            summary: clone(generatedSetlist.summary),
            songs: clone(generatedSetlist.songs),
            songNames,
            seed: generatedSetlist.seed,
            songCount: generatedSetlist.songs.length
        };
        savedSetlists = [entry, ...currentSaved].slice(0, MAX_SAVED_SETS);
        persistSavedSetlists();
        setlistSaved = true;
        console.log("[Set Roll] saved setlist:", entry.name, entry.id, "total saved:", savedSetlists.length);
    }

    function removeSavedSetlist(id) {
        savedSetlists = savedSetlists.filter((s) => s.id !== id);
        persistSavedSetlists();
    }

    function updateSavedSetlist(id, fields) {
        savedSetlists = savedSetlists.map((s) => s.id === id ? { ...s, ...fields } : s);
        persistSavedSetlists();
    }

    function loadSavedSetlist(id) {
        const saved = savedSetlists.find((s) => s.id === id);
        if (!saved) return;
        generatedSetlist = {
            songs: clone(saved.songs),
            summary: clone(saved.summary),
            seed: saved.seed,
        };
        setlistLocked = true;
        persistCurrentSetlist();
        addToast(`Loaded ${saved.songs?.length || 0}-song set.`);
    }

    function reorderSetlistSong(fromIndex, toIndex) {
        if (!generatedSetlist) return;
        const songList = clone(generatedSetlist.songs);
        const [moved] = songList.splice(fromIndex, 1);
        songList.splice(toIndex, 0, moved);
        const rescored = scoreFixedOrder(songList, appConfig);
        generatedSetlist = { ...generatedSetlist, songs: rescored.songs, summary: rescored.summary, _reordered: true };
        persistCurrentSetlist();
    }

    // ---- generation options ----
    function updateGenerationField(path, value) {
        generationOptions = setByPath(generationOptions, path, value);
        persistGenerationOptions();
    }

    function toggleListValue(path, value) {
        const current = getByPath(generationOptions, path, []);
        const next = current.includes(value)
            ? current.filter((e) => e !== value)
            : current.concat(value);
        updateGenerationField(path, next);
    }

    function ensureMemberShowConfig(memberName) {
        if (generationOptions.show?.members?.[memberName]) return;
        generationOptions = setByPath(generationOptions, `show.members.${memberName}`, {
            allowedInstruments: [],
            allowedTunings: {}
        });
        persistGenerationOptions();
    }


    // ---- song editor ----
    function openNewSong() {
        const song = blankSong();
        const bandMembers = appConfig?.band?.members || {};
        Object.entries(bandMembers).forEach(([name, config]) => {
            const defaultInstName = config.defaultInstrument || "";
            const defaultInst = (config.instruments || []).find((i) => i.name === defaultInstName);
            const inst = defaultInst
                ? { name: defaultInst.name, tuning: defaultInst.defaultTuning ? [defaultInst.defaultTuning] : [], capo: 0, picking: defaultInst.defaultTechnique ? [defaultInst.defaultTechnique] : [] }
                : { name: "", tuning: [], capo: 0, picking: [] };
            song.members[name] = { instruments: [inst] };
        });
        editorSong = song;
        selectedSongId = "";
    }

    function openSong(song) {
        editorSong = normalizeSongRecord(song);
        selectedSongId = editorSong.id;
    }

    function closeEditor() {
        const returnTo = editReturnView;
        editorSong = null;
        selectedSongId = "";
        editReturnView = "";
        if (returnTo) navigate(returnTo);
    }

    function updateEditor(mutator) {
        const next = clone(editorSong);
        mutator(next);
        editorSong = next;
    }

    function updateSongField(key, value) {
        updateEditor((s) => { s[key] = value; });
    }

    function renameMember(prev, next) {
        const clean = next.trim();
        if (!clean || clean === prev) return;
        updateEditor((song) => {
            const entries = Object.entries(song.members || {});
            const rebuilt = {};
            entries.forEach(([name, val]) => { rebuilt[name === prev ? clean : name] = val; });
            song.members = rebuilt;
        });
    }

    function addMember(memberName) {
        updateEditor((song) => {
            let name = memberName;
            if (!name) {
                const base = `member${Object.keys(song.members || {}).length + 1}`;
                name = base;
                let c = 1;
                while (song.members[name]) { c++; name = `${base}-${c}`; }
            }
            if (song.members[name]) return; // already in this song
            // Seed instruments from band config if this member exists there
            const bandMember = appConfig?.band?.members?.[name];
            if (bandMember && (bandMember.instruments || []).length > 0) {
                const defaultInst = bandMember.defaultInstrument || bandMember.instruments[0]?.name || "";
                const inst = bandMember.instruments.find((i) => i.name === defaultInst) || bandMember.instruments[0];
                const defaultTuning = inst?.defaultTuning;
                const defaultTechnique = inst?.defaultTechnique;
                song.members[name] = {
                    instruments: [{
                        name: inst.name,
                        tuning: defaultTuning ? [defaultTuning] : [],
                        capo: 0,
                        picking: defaultTechnique ? [defaultTechnique] : []
                    }]
                };
            } else {
                song.members[name] = { instruments: [{ name: "", tuning: [], capo: 0, picking: [] }] };
            }
        });
    }

    function removeMember(memberName) {
        updateEditor((song) => { delete song.members[memberName]; });
    }

    function addInstrumentOption(memberName) {
        updateEditor((song) => {
            song.members[memberName].instruments.push({
                name: "", tuning: [], capo: 0, picking: []
            });
        });
    }

    function removeInstrumentOption(memberName, index) {
        updateEditor((song) => { song.members[memberName].instruments.splice(index, 1); });
    }

    function instrumentConfigFor(memberName, instrumentName) {
        return (appConfig?.band?.members?.[memberName]?.instruments || [])
            .find((i) => i.name === instrumentName) || null;
    }

    function updateInstrumentOption(memberName, index, key, value) {
        updateEditor((song) => {
            const option = song.members[memberName].instruments[index];
            option[key] = value;
            if (key === "name") {
                const instConfig = instrumentConfigFor(memberName, value);
                const defaultTuning = instConfig?.defaultTuning || "";
                option.tuning = defaultTuning ? [defaultTuning] : [];
                option.picking = instConfig?.defaultTechnique ? [instConfig.defaultTechnique] : [];
            }
        });
    }

    async function saveSong() {
        if (!editorSong?.name.trim()) {
            addToast("Songs need names.", "danger");
            return;
        }
        try {
            busyMessage = `Saving "${editorSong.name}"...`;
            const saved = await withSync("Saving song", () => repo.putSong({
                ...editorSong, updatedAt: nowIso()
            }));
            songs = songs.filter((s) => s.id !== saved.id).concat(saved).sort((a, b) => a.name.localeCompare(b.name));

            // Sync member names and instruments from the song into band config
            let configDirty = false;
            let nextConfig = clone(appConfig) || { band: { members: {} } };
            if (!nextConfig.band) nextConfig.band = {};
            if (!nextConfig.band.members) nextConfig.band.members = {};

            for (const [memberName, memberSetup] of Object.entries(saved.members || {})) {
                if (!nextConfig.band.members[memberName]) {
                    nextConfig.band.members[memberName] = { instruments: [] };
                    configDirty = true;
                }
                const bandMember = nextConfig.band.members[memberName];
                if (!bandMember.instruments) bandMember.instruments = [];
                for (const inst of (memberSetup.instruments || [])) {
                    if (!inst.name) continue;
                    const existing = bandMember.instruments.find((i) => i.name === inst.name);
                    if (!existing) {
                        bandMember.instruments.push({
                            name: inst.name, tunings: [], defaultTuning: "",
                            techniques: [], defaultTechnique: ""
                        });
                        configDirty = true;
                    }
                    // Sync tunings that appear in songs but not in band config
                    const bandInst = bandMember.instruments.find((i) => i.name === inst.name);
                    for (const tuning of (inst.tuning || [])) {
                        if (tuning && !(bandInst.tunings || []).includes(tuning)) {
                            if (!bandInst.tunings) bandInst.tunings = [];
                            bandInst.tunings.push(tuning);
                            if (!bandInst.defaultTuning) bandInst.defaultTuning = tuning;
                            configDirty = true;
                        }
                    }
                }
            }
            if (configDirty) {
                await persistConfigEdit(nextConfig);
            }

            closeEditor();
            addToast(`Saved "${saved.name}".`);
        } catch (error) {
            addToast(error?.message || "Could not save.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    function duplicateSong(song) {
        const copy = normalizeSongRecord({
            ...clone(song), id: uid("song"), name: `${song.name} (Copy)`,
            createdAt: nowIso(), updatedAt: nowIso()
        });
        editorSong = copy;
        selectedSongId = "";
        addToast(`Duplicated "${song.name}".`);
    }

    async function deleteSong(song) {
        if (!window.confirm(`Delete "${song.name}"?`)) return;
        try {
            busyMessage = `Deleting "${song.name}"...`;
            await withSync("Removing song", () => repo.deleteSong(song.id));
            songs = songs.filter((e) => e.id !== song.id);
            if (editorSong?.id === song.id) closeEditor();
            addToast(`Deleted "${song.name}".`);
        } catch (error) {
            addToast(error?.message || "Could not delete.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    async function deleteAllData() {
        if (!window.confirm("This will delete ALL songs, band config, and saved setlists. This cannot be undone.\n\nAre you sure?")) return;
        if (!window.confirm("Really? Everything will be gone forever.")) return;
        try {
            busyMessage = "Deleting everything...";
            // Delete all songs from RS
            for (const song of songs) {
                await repo.deleteSong(song.id);
            }
            // Delete config from RS so first-run triggers on reload
            await repo.deleteConfig();
            // Clear local state
            appConfig = null;
            songs = [];
            generatedSetlist = null;
            setlistLocked = false;
            setlistSaved = false;
            savedSetlists = [];
            persistSavedSetlists();
            persistCurrentSetlist();
            if (editorSong) closeEditor();
            // Trigger first-run experience
            showFirstRunPrompt = true;
            firstRunBandName = "";
            navigate("roll");
            generationOptions = defaultGenerationOptions(DEFAULT_APP_CONFIG);
            persistGenerationOptions();
            addToast("All data deleted. Name your band to start fresh.");
        } catch (error) {
            addToast(error?.message || "Could not delete.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    // ---- config ----
    function configFieldValue(config, field) {
        const value = getByPath(config, field.path);
        if (field.type === "list") return formatDelimitedList(value);
        return value;
    }

    function updateConfigField(fieldOrPath, rawValue) {
        if (!appConfig) return;
        // Accept either a field object { path, type } or a plain path string
        if (typeof fieldOrPath === "string") {
            appConfig = setByPath(appConfig, fieldOrPath, rawValue);
            return;
        }
        const field = fieldOrPath;
        let next = rawValue;
        if (field.type === "number") next = Number(rawValue);
        else if (field.type === "boolean") next = Boolean(rawValue);
        else if (field.type === "list") next = parseDelimitedList(rawValue);
        appConfig = setByPath(appConfig, field.path, next);
    }

    async function saveConfig() {
        if (!appConfig) return;
        try {
            busyMessage = "Saving config...";
            const nextConfig = normalizeAppConfig({ ...clone(appConfig), updatedAt: nowIso() });
            appConfig = await withSync("Saving settings", () => repo.putConfig(nextConfig));
            generationOptions = deepMerge(defaultGenerationOptions(appConfig), generationOptions);
            persistGenerationOptions();
            addToast("Settings saved.");
        } catch (error) {
            addToast(error?.message || "Could not save config.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    async function persistConfigEdit(nextConfig, errorMessage = "Could not save config.") {
        const normalized = normalizeAppConfig({ ...clone(nextConfig), updatedAt: nowIso() });
        appConfig = normalized;
        try {
            appConfig = await withSync("Saving settings", () => repo.putConfig(normalized));
            generationOptions = deepMerge(defaultGenerationOptions(appConfig), generationOptions);
            persistGenerationOptions();
            return true;
        } catch (error) {
            addToast(error?.message || errorMessage, "danger");
            return false;
        }
    }

    // ---- band members ----
    async function addBandMember() {
        const clean = newMemberName.trim();
        if (!clean) { addToast("Name the member first.", "danger"); return; }
        if (bandMemberEntries.some(([n]) => n === clean)) { addToast("Already exists.", "danger"); return; }
        const nextConfig = setByPath(appConfig, `band.members.${clean}`, { instruments: [] });
        if (await persistConfigEdit(nextConfig, "Could not add member.")) {
            expandedBandMember = clean;
            newMemberName = "";
            addToast(`Added "${clean}".`);
        }
    }

    async function renameBandMember(oldName, newName) {
        const clean = newName.trim();
        if (!clean || clean === oldName || bandMemberEntries.some(([n]) => n === clean)) return;
        const rebuilt = {};
        Object.entries(appConfig.band.members).forEach(([n, v]) => { rebuilt[n === oldName ? clean : n] = v; });
        if (await persistConfigEdit(setByPath(appConfig, "band.members", rebuilt))) {
            if (expandedBandMember === oldName) expandedBandMember = clean;
            addToast(`Renamed "${oldName}" to "${clean}".`);
        }
    }

    function songsUsingMember(memberName) {
        return songs.filter((s) => s.members && memberName in s.members);
    }

    function songsUsingInstrument(memberName, instrumentName) {
        return songs.filter((s) =>
            (s.members?.[memberName]?.instruments || []).some((i) => i.name === instrumentName)
        );
    }

    function songsUsingTuning(memberName, instrumentName, tuning) {
        return songs.filter((s) =>
            (s.members?.[memberName]?.instruments || []).some((i) =>
                i.name === instrumentName && (i.tuning || []).includes(tuning)
            )
        );
    }

    function songsUsingTechnique(memberName, instrumentName, technique) {
        return songs.filter((s) =>
            (s.members?.[memberName]?.instruments || []).some((i) =>
                i.name === instrumentName && (Array.isArray(i.picking) ? i.picking : []).includes(technique)
            )
        );
    }

    async function removeBandMember(memberName) {
        const usedIn = songsUsingMember(memberName);
        if (usedIn.length > 0) {
            const names = usedIn.slice(0, 5).map((s) => s.name).join(", ");
            const extra = usedIn.length > 5 ? ` and ${usedIn.length - 5} more` : "";
            if (!window.confirm(
                `"${memberName}" is referenced in ${usedIn.length} song${usedIn.length === 1 ? "" : "s"}: ${names}${extra}.\n\nRemoving this member from the band config won't change existing songs, but new setlists won't account for their setup.\n\nAre you sure?`
            )) return;
        } else {
            if (!window.confirm(`Remove "${memberName}" from the band?`)) return;
        }
        const rebuilt = clone(appConfig.band.members);
        delete rebuilt[memberName];
        if (await persistConfigEdit(setByPath(appConfig, "band.members", rebuilt))) {
            if (expandedBandMember === memberName) expandedBandMember = "";
            addToast(`Removed "${memberName}".`);
        }
    }

    async function addBandMemberInstrument(memberName) {
        const draft = (newInstrumentByMember[memberName] || "").trim();
        if (!draft) { addToast("Type an instrument name first.", "danger"); return; }
        const current = appConfig.band.members[memberName].instruments || [];
        if (current.some((i) => i.name === draft)) { addToast("Already on this member.", "danger"); return; }
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`, current.concat({ name: draft, tunings: [], defaultTuning: "", techniques: [], defaultTechnique: "" }));
        if (await persistConfigEdit(next)) {
            newInstrumentByMember = { ...newInstrumentByMember, [memberName]: "" };
            addToast(`Added ${draft} for ${memberName}.`);
        }
    }

    async function removeBandMemberInstrument(memberName, instrumentName) {
        const usedIn = songsUsingInstrument(memberName, instrumentName);
        if (usedIn.length > 0) {
            const names = usedIn.slice(0, 5).map((s) => s.name).join(", ");
            const extra = usedIn.length > 5 ? ` and ${usedIn.length - 5} more` : "";
            if (!window.confirm(
                `"${instrumentName}" for ${memberName} is used in ${usedIn.length} song${usedIn.length === 1 ? "" : "s"}: ${names}${extra}.\n\nRemoving it from the band config won't change existing songs, but the instrument won't appear as a choice for new songs.\n\nAre you sure?`
            )) return;
        } else {
            if (!window.confirm(`Remove "${instrumentName}" from ${memberName}?`)) return;
        }
        const current = appConfig.band.members[memberName].instruments || [];
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`, current.filter((i) => i.name !== instrumentName));
        if (await persistConfigEdit(next)) addToast(`Removed ${instrumentName} from ${memberName}.`);
    }

    function tuningDraftKey(memberName, instrumentName) {
        return `${memberName}::${instrumentName}`;
    }

    // Ensure a member and instrument exist in band config (creates them if missing)
    async function ensureBandInstrument(memberName, instrumentName) {
        if (!memberName || !instrumentName || !appConfig) return;
        let dirty = false;
        let next = clone(appConfig);
        if (!next.band) next.band = {};
        if (!next.band.members) next.band.members = {};
        if (!next.band.members[memberName]) {
            next.band.members[memberName] = { instruments: [] };
            dirty = true;
        }
        const member = next.band.members[memberName];
        if (!member.instruments) member.instruments = [];
        if (!member.instruments.find((i) => i.name === instrumentName)) {
            member.instruments.push({ name: instrumentName, tunings: [], defaultTuning: "", techniques: [], defaultTechnique: "" });
            dirty = true;
        }
        if (dirty) await persistConfigEdit(next);
    }

    async function addTuningChoice(memberName, instrumentName) {
        const draftKey = tuningDraftKey(memberName, instrumentName);
        const clean = (newTuningByInstrument[draftKey] || "").trim();
        if (!clean) { addToast("Type a tuning name first.", "danger"); return; }
        await ensureBandInstrument(memberName, instrumentName);
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const current = currentInstruments.find((i) => i.name === instrumentName);
        if ((current?.tunings || []).includes(clean)) { addToast("Already exists.", "danger"); return; }
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`,
            currentInstruments.map((i) => i.name !== instrumentName ? i : { ...i, tunings: (i.tunings || []).concat(clean) })
        );
        if (await persistConfigEdit(next)) {
            newTuningByInstrument = { ...newTuningByInstrument, [draftKey]: "" };
            addToast(`Added "${clean}" to ${instrumentName}.`);
        }
        return clean;
    }

    async function removeTuningChoice(memberName, instrumentName, tuning) {
        const usedIn = songsUsingTuning(memberName, instrumentName, tuning);
        if (usedIn.length > 0) {
            const names = usedIn.slice(0, 5).map((s) => s.name).join(", ");
            const extra = usedIn.length > 5 ? ` and ${usedIn.length - 5} more` : "";
            if (!window.confirm(
                `"${tuning}" tuning for ${memberName}'s ${instrumentName} is used in ${usedIn.length} song${usedIn.length === 1 ? "" : "s"}: ${names}${extra}.\n\nRemoving it won't change existing songs, but the tuning won't appear as a choice for new songs.\n\nAre you sure?`
            )) return;
        }
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`,
            currentInstruments.map((i) => i.name !== instrumentName ? i : {
                ...i, tunings: (i.tunings || []).filter((t) => t !== tuning),
                defaultTuning: i.defaultTuning === tuning ? "" : (i.defaultTuning || "")
            })
        );
        if (await persistConfigEdit(next)) addToast(`Removed "${tuning}" from ${instrumentName}.`);
    }

    async function setMemberDefaultInstrument(memberName, instrumentName) {
        const next = setByPath(appConfig, `band.members.${memberName}.defaultInstrument`, instrumentName);
        if (await persistConfigEdit(next)) {
            addToast(instrumentName ? `Default instrument set to "${instrumentName}".` : `Cleared default instrument.`);
        }
    }

    async function setInstrumentDefaultTuning(memberName, instrumentName, defaultTuning) {
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`,
            currentInstruments.map((i) => i.name !== instrumentName ? i : { ...i, defaultTuning })
        );
        if (await persistConfigEdit(next)) {
            addToast(defaultTuning ? `Default set to "${defaultTuning}".` : `Cleared default tuning.`);
        }
    }

    function techniqueDraftKey(memberName, instrumentName) {
        return `${memberName}::${instrumentName}::tech`;
    }

    async function addTechniqueChoice(memberName, instrumentName) {
        const draftKey = techniqueDraftKey(memberName, instrumentName);
        const clean = (newTechniqueByInstrument[draftKey] || "").trim();
        if (!clean) { addToast("Type a technique name first.", "danger"); return; }
        await ensureBandInstrument(memberName, instrumentName);
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const current = currentInstruments.find((i) => i.name === instrumentName);
        if ((current?.techniques || []).includes(clean)) { addToast("Already exists.", "danger"); return; }
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`,
            currentInstruments.map((i) => i.name !== instrumentName ? i : { ...i, techniques: (i.techniques || []).concat(clean) })
        );
        if (await persistConfigEdit(next)) {
            newTechniqueByInstrument = { ...newTechniqueByInstrument, [draftKey]: "" };
            addToast(`Added "${clean}" technique to ${instrumentName}.`);
        }
        return clean;
    }

    async function removeTechniqueChoice(memberName, instrumentName, technique) {
        const usedIn = songsUsingTechnique(memberName, instrumentName, technique);
        if (usedIn.length > 0) {
            const names = usedIn.slice(0, 5).map((s) => s.name).join(", ");
            const extra = usedIn.length > 5 ? ` and ${usedIn.length - 5} more` : "";
            if (!window.confirm(
                `"${technique}" technique for ${memberName}'s ${instrumentName} is used in ${usedIn.length} song${usedIn.length === 1 ? "" : "s"}: ${names}${extra}.\n\nRemoving it won't change existing songs, but the technique won't appear as a choice for new songs.\n\nAre you sure?`
            )) return;
        }
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`,
            currentInstruments.map((i) => i.name !== instrumentName ? i : {
                ...i, techniques: (i.techniques || []).filter((t) => t !== technique),
                defaultTechnique: i.defaultTechnique === technique ? "" : (i.defaultTechnique || "")
            })
        );
        if (await persistConfigEdit(next)) addToast(`Removed "${technique}" technique from ${instrumentName}.`);
    }

    async function setInstrumentDefaultTechnique(memberName, instrumentName, defaultTechnique) {
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const next = setByPath(appConfig, `band.members.${memberName}.instruments`,
            currentInstruments.map((i) => i.name !== instrumentName ? i : { ...i, defaultTechnique })
        );
        if (await persistConfigEdit(next)) {
            addToast(defaultTechnique ? `Default technique set to "${defaultTechnique}".` : `Cleared default technique.`);
        }
    }

    // ---- set arc / order rules ----
    function orderRuleValue(config, slotId, fieldName) {
        const rules = getByPath(config, `general.order.${slotId}`, []);
        const match = rules.find(([name]) => name === fieldName);
        return match ? match[1] : null;
    }

    function orderToggleValue(config, slotId, fieldName) {
        const value = orderRuleValue(config, slotId, fieldName);
        if (value === true) return "yes";
        if (value === false) return "no";
        return "either";
    }

    function setOrderToggle(slotId, fieldName, value) {
        if (value === "either") { setOrderRule(slotId, fieldName, null); return; }
        setOrderRule(slotId, fieldName, value === "yes");
    }

    function setOrderRule(slotId, fieldName, nextValue) {
        const rules = clone(getByPath(appConfig, `general.order.${slotId}`, []))
            .filter(([name]) => name !== fieldName);
        if (nextValue !== null && nextValue !== undefined) rules.push([fieldName, nextValue]);
        appConfig = setByPath(appConfig, `general.order.${slotId}`, rules);
    }

    // ---- import/export ----
    function buildExportPayload() {
        const currentSaved = savedSetlists || [];
        return {
            app: "setlist-generator", schemaVersion: 2, exportedAt: nowIso(),
            songs: songs.map(normalizeSongRecord),
            config: clone(appConfig),
            savedSetlists: stripEnergy(clone(currentSaved)),
            meta: {
                bandName: appConfig?.bandName || "",
                songCount: songs.length,
                savedSetlistCount: currentSaved.length,
            }
        };
    }

    function exportAllData() {
        const payload = buildExportPayload();
        const safeName = (appConfig?.bandName || "band-setlist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "band-setlist";
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${safeName}-data.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        addToast("Exported the whole catalog.");
    }

    function normalizeImportPayload(payload) {
        if (Array.isArray(payload)) {
            return { payloadType: "songs-array", songs: payload.map(normalizeSongRecord), config: null };
        }
        if (payload && Array.isArray(payload.songs)) {
            return {
                payloadType: "full-export",
                songs: payload.songs.map(normalizeSongRecord),
                config: payload.config ? normalizeAppConfig({
                    ...clone(payload.config), bandName: payload.config.bandName || appConfig?.bandName || "", updatedAt: nowIso()
                }) : null,
                savedSetlists: Array.isArray(payload.savedSetlists) ? stripEnergy(payload.savedSetlists) : null,
            };
        }
        if (payload && payload.general && payload.show && payload.props) {
            return {
                payloadType: "config-object", songs: [],
                config: normalizeAppConfig({ ...clone(payload), bandName: payload.bandName || appConfig?.bandName || "", updatedAt: nowIso() })
            };
        }
        throw new Error("Unsupported JSON format.");
    }

    async function importFromFile() {
        if (!importFile) { addToast("Choose a JSON file first.", "danger"); return; }
        try {
            busyMessage = "Importing...";
            const text = await importFile.text();
            const payload = JSON.parse(text);
            const existing = new Map(songs.map((s) => [s.id, s]));
            const imported = normalizeImportPayload(payload);
            let ws = 0;

            await withSync("Importing data", async () => {
                for (const s of imported.songs) {
                    if (importMode === "skip" && existing.has(s.id)) continue;
                    await repo.putSong(s); ws++;
                }
                if (imported.config && (importMode === "overwrite" || !appConfig)) {
                    await repo.putConfig(imported.config);
                }
                bootstrapMeta = await repo.putBootstrapMeta({
                    source: "uploaded-json", payloadType: imported.payloadType, mode: importMode,
                    fileName: importFile?.name || null, importedSongs: ws
                });
            });

            // Restore saved setlists and current setlist from full exports
            if (imported.savedSetlists && imported.savedSetlists.length > 0) {
                savedSetlists = imported.savedSetlists;
                persistSavedSetlists();
            }
            await reloadAll({ quiet: true });
            const parts = [`${ws} song${ws === 1 ? "" : "s"}`];
            if (imported.savedSetlists?.length) parts.push(`${imported.savedSetlists.length} saved setlist${imported.savedSetlists.length === 1 ? "" : "s"}`);
            addToast(`Imported ${parts.join(", ")}.`);
        } catch (error) {
            addToast(error?.message || "Import failed.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    // ---- performance summary ----
    function performanceSummary(performance) {
        return Object.keys(performance || {}).sort().map((member) => {
            const setup = performance[member];
            const details = [];
            if (setup.instrument) details.push(setup.instrument);
            if (setup.tuning) details.push(setup.tuning);
            if (setup.capo) details.push(`capo ${setup.capo}`);
            const techniques = Array.isArray(setup.picking) ? setup.picking : (setup.picking ? [setup.picking] : []);
            if (techniques.length) details.push(techniques.join(", "));
            return `${member}: ${details.join(", ") || "default"}`;
        }).join(" | ");
    }

    // ---- init ----
    function init() {
        syncRouteFromHash();
        window.addEventListener("hashchange", syncRouteFromHash);

        repo.on("connected", async () => {
            connectionStatus = "connected";
            connectAddress = repo.getUserAddress() || connectAddress;
            currentUserAddress = connectAddress;
            loadUserLocalData();
            await reloadAll();
        });

        repo.on("disconnected", () => {
            connectionStatus = "disconnected";
            clearUserLocalStorage();
            clearUnscopedLocalStorage();
            currentUserAddress = "";
            songs = [];
            appConfig = null;
            generatedSetlist = null;
            setlistLocked = false;
            setlistSaved = false;
            savedSetlists = [];
            showFirstRunPrompt = false;
            selectedSongId = "";
            editorSong = null;
        });

        repo.on("error", (error) => {
            connectionStatus = "disconnected";
            loadError = error?.message || "remoteStorage error.";
            addToast(loadError, "danger");
        });

        repo.onChange(async (event) => {
            if (connectionStatus === "connected" && event?.origin !== "window") {
                beginSync(event?.origin === "remote" ? "Pulling remote changes" : "Syncing");
                try { await reloadAll({ quiet: true }); }
                finally { endSync(); }
            }
        });

        return () => {
            window.removeEventListener("hashchange", syncRouteFromHash);
            if (syncIndicatorTimer) clearTimeout(syncIndicatorTimer);
        };
    }

    return {
        // state (getters)
        get songs() { return songs; },


        get appConfig() { return appConfig; },
        get generatedSetlist() { return generatedSetlist; },
        get isGenerating() { return isGenerating; },
        get setlistLocked() { return setlistLocked; },
        get setlistSaved() { return setlistSaved; },
        get pendingRollConfirm() { return pendingRollConfirm; },
        get savedSetlists() { return savedSetlists; },
        get connectionStatus() { return connectionStatus; },
        get connectAddress() { return connectAddress; },
        set connectAddress(v) { connectAddress = v; },
        get activeView() { return activeView; },
        get loadError() { return loadError; },
        get busyMessage() { return busyMessage; },
        get toastMessages() { return toastMessages; },
        get showFirstRunPrompt() { return showFirstRunPrompt; },
        get firstRunBandName() { return firstRunBandName; },
        set firstRunBandName(v) { firstRunBandName = v; },
        get syncIndicatorVisible() { return syncIndicatorVisible; },
        get syncStatusLabel() { return syncStatusLabel; },
        get syncActivelyRunning() { return syncActiveCount > 0; },
        get generationOptions() { return generationOptions; },
        get editorSong() { return editorSong; },
        get selectedSongId() { return selectedSongId; },
        get songSearch() { return songSearch; },
        set songSearch(v) { songSearch = v; },
        get songFilter() { return songFilter; },
        set songFilter(v) { songFilter = v; },
        get expandedBandMember() { return expandedBandMember; },
        set expandedBandMember(v) { expandedBandMember = v; },
        get newMemberName() { return newMemberName; },
        set newMemberName(v) { newMemberName = v; },
        get newInstrumentByMember() { return newInstrumentByMember; },
        set newInstrumentByMember(v) { newInstrumentByMember = v; },
        get newTuningByInstrument() { return newTuningByInstrument; },
        set newTuningByInstrument(v) { newTuningByInstrument = v; },
        get newTechniqueByInstrument() { return newTechniqueByInstrument; },
        set newTechniqueByInstrument(v) { newTechniqueByInstrument = v; },
        get importMode() { return importMode; },
        set importMode(v) { importMode = v; },
        get importFile() { return importFile; },
        set importFile(v) { importFile = v; },


        get bandSubView() { return bandSubView; },
        set bandSubView(v) { bandSubView = v; },
        get editingMemberName() { return editingMemberName; },
        set editingMemberName(v) { editingMemberName = v; },

        // derived
        get appTitle() { return appTitle; },
        get emptyCatalog() { return emptyCatalog; },
        get bandMemberEntries() { return bandMemberEntries; },
        get availableMemberNames() { return availableMemberNames; },
        get memberInstrumentChoicesByMember() { return memberInstrumentChoicesByMember; },
        get memberTuningChoicesByMember() { return memberTuningChoicesByMember; },
        get defaultTuningByMemberInstrument() { return defaultTuningByMemberInstrument; },
        get allInstrumentNamesList() { return allInstrumentNamesList; },
        get instrumentTypeCount() { return instrumentTypeCount; },
        get visibleSongs() { return visibleSongs; },
        isSongIncomplete,
        songIncompleteReasons,
        get incompleteSongCount() { return songs.filter((s) => isSongIncomplete(s)).length; },
        get unpracticedSongCount() { return songs.filter((s) => s.unpracticed).length; },

        // actions
        init,
        navigate,
        connectStorage,
        disconnectStorage,
        finishFirstRun,
        requestRoll,
        confirmRoll,
        cancelRoll,
        lockSetlist,
        saveCurrentSetlist,
        removeSavedSetlist,
        updateSavedSetlist,
        loadSavedSetlist,
        reorderSetlistSong,
        updateGenerationField,
        toggleListValue,
        ensureMemberShowConfig,


        openNewSong,
        openSong,
        closeEditor,
        get editReturnView() { return editReturnView; },
        set editReturnView(v) { editReturnView = v; },
        updateSongField,
        renameMember,
        addMember,
        removeMember,
        addInstrumentOption,
        removeInstrumentOption,
        updateInstrumentOption,
        saveSong,
        duplicateSong,
        deleteSong,
        deleteAllData,
        configFieldValue,
        updateConfigField,
        saveConfig,
        addBandMember,
        renameBandMember,
        removeBandMember,
        addBandMemberInstrument,
        removeBandMemberInstrument,
        addTuningChoice,
        removeTuningChoice,
        setMemberDefaultInstrument,
        setInstrumentDefaultTuning,
        addTechniqueChoice,
        removeTechniqueChoice,
        setInstrumentDefaultTechnique,
        techniqueDraftKey,
        tuningDraftKey,
        orderToggleValue,
        setOrderToggle,
        exportAllData,
        importFromFile,
        performanceSummary,
        addToast,
        songsUsingMember,
        songsUsingInstrument,
        songsUsingTuning,
        songsUsingTechnique,

        // constants
        CONFIG_SECTIONS,
    };
}
