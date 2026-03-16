import { DEFAULT_APP_CONFIG, blankSong, normalizeAppConfig, normalizeSongRecord } from "../defaults.js";
import { CONFIG_SECTIONS } from "../config-meta.js";
import { generateSetlist, scoreFixedOrder } from "../generator.js";
import { clone, deepMerge, formatDelimitedList, getByPath, nowIso, parseDelimitedList, setByPath, titleForBand, tryParseJson, uid } from "../utils.js";

const STORAGE_KEY = "setlist-generator-ui-options";
const SAVED_SETS_KEY = "setlist-generator-saved-sets";
const MAX_SAVED_SETS = 5;

export function createAppStore(repo) {
    // ---- core state ----
    let songs = $state([]);
    let appConfig = $state(null);
    let bootstrapMeta = $state(null);
    let generatedSetlist = $state(null);
    let savedSetlists = $state(loadSavedSetlists());

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

    // ---- generation options ----
    let generationOptions = $state(loadStoredGenerationOptions());

    // ---- song editor ----
    let editorSong = $state(null);
    let selectedSongId = $state("");
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
            beamWidth: source.general?.beamWidth || 512,
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

    function isSongIncomplete(song) {
        const bandMembers = appConfig?.band?.members || {};
        const memberNames = Object.keys(bandMembers);
        if (memberNames.length === 0) return false;
        const songMembers = song.members || {};
        for (const name of memberNames) {
            const memberSetup = songMembers[name];
            if (!memberSetup) return true;
            const instruments = memberSetup.instruments || [];
            if (instruments.length === 0) return true;
            for (const inst of instruments) {
                if (!inst.name) return true;
                const bandInst = (bandMembers[name].instruments || []).find((i) => i.name === inst.name);
                if (bandInst && (bandInst.techniques || []).length > 0 && (!Array.isArray(inst.picking) || inst.picking.length === 0)) return true;
            }
        }
        return false;
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
        const stored = tryParseJson(localStorage.getItem(STORAGE_KEY), null);
        return stored ? deepMerge(fallback, stored) : fallback;
    }

    function persistGenerationOptions() {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(generationOptions));
    }

    function loadSavedSetlists() {
        if (typeof localStorage === "undefined") return [];
        return tryParseJson(localStorage.getItem(SAVED_SETS_KEY), []);
    }

    function persistSavedSetlists() {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(SAVED_SETS_KEY, JSON.stringify(savedSetlists));
    }

    // ---- toast ----
    function addToast(message, tone = "info") {
        const id = uid("toast");
        toastMessages = [...toastMessages, { id, message, tone }];
        setTimeout(() => {
            toastMessages = toastMessages.filter((t) => t.id !== id);
        }, 4200);
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
        const allowed = ["roll", "songs", "band"];
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
            songs = data.songs;
            bootstrapMeta = data.bootstrap;
            appConfig = data.config ? normalizeAppConfig(data.config) : null;

            if (!appConfig) {
                showFirstRunPrompt = true;
                firstRunBandName = "";
                navigate("songs");
                generationOptions = defaultGenerationOptions(DEFAULT_APP_CONFIG);
                persistGenerationOptions();
                return;
            }

            showFirstRunPrompt = false;
            generationOptions = deepMerge(defaultGenerationOptions(appConfig), generationOptions || {});
            persistGenerationOptions();

            if (songs.length === 0) {
                navigate("songs");
            }
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

    function generate() {
        if (!songs.length) {
            addToast("Add a few songs first.", "danger");
            navigate("songs");
            return;
        }
        try {
            const eligibleSongs = songs.filter((s) => !s.unpracticed);
            if (!eligibleSongs.length) {
                addToast("All songs are marked unpracticed.", "danger");
                return;
            }
            const maxRetries = 5;
            let best = null;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const opts = attempt === 0 ? generationOptions : { ...generationOptions, seed: "" };
                const result = generateSetlist(eligibleSongs, appConfig || DEFAULT_APP_CONFIG, opts);
                if (!best || result.summary.score < best.summary.score) best = result;
                if (validateConstraintMinimums(result)) break;
                if (attempt === maxRetries - 1) {
                    addToast("Couldn't fully meet minimum constraints — showing best result.", "danger");
                }
            }
            generatedSetlist = best;
            addToast(`Generated ${generatedSetlist.songs.length} songs.`);
        } catch (error) {
            addToast(error?.message || "The generator faceplanted.", "danger");
        }
    }

    function saveCurrentSetlist() {
        if (!generatedSetlist) return;
        const entry = {
            id: uid("set"),
            savedAt: nowIso(),
            summary: clone(generatedSetlist.summary),
            songs: clone(generatedSetlist.songs),
            seed: generatedSetlist.seed,
            songCount: generatedSetlist.songs.length
        };
        savedSetlists = [entry, ...savedSetlists].slice(0, MAX_SAVED_SETS);
        persistSavedSetlists();
        addToast("Setlist saved.");
    }

    function removeSavedSetlist(id) {
        savedSetlists = savedSetlists.filter((s) => s.id !== id);
        persistSavedSetlists();
    }

    function reorderSetlistSong(fromIndex, toIndex) {
        if (!generatedSetlist) return;
        const songList = clone(generatedSetlist.songs);
        const [moved] = songList.splice(fromIndex, 1);
        songList.splice(toIndex, 0, moved);
        const rescored = scoreFixedOrder(songList, appConfig);
        generatedSetlist = { ...generatedSetlist, songs: rescored.songs, summary: rescored.summary, _reordered: true };
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
        editorSong = null;
        selectedSongId = "";
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

    function addMember() {
        updateEditor((song) => {
            const base = `member${Object.keys(song.members || {}).length + 1}`;
            let name = base;
            let c = 1;
            while (song.members[name]) { c++; name = `${base}-${c}`; }
            song.members[name] = { instruments: [] };
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

    async function addTuningChoice(memberName, instrumentName) {
        const draftKey = tuningDraftKey(memberName, instrumentName);
        const clean = (newTuningByInstrument[draftKey] || "").trim();
        if (!clean) { addToast("Type a tuning name first.", "danger"); return; }
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

    function selectedEnergies(config, slotId) {
        const value = orderRuleValue(config, slotId, "energy");
        if (Array.isArray(value)) return value;
        if (value === null || value === undefined) return [];
        return [value];
    }

    function toggleOrderEnergy(slotId, energy) {
        const current = selectedEnergies(appConfig, slotId);
        const next = current.includes(energy)
            ? current.filter((e) => e !== energy)
            : current.concat(energy).sort();
        setOrderRule(slotId, "energy", next.length ? next : null);
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
        return {
            app: "setlist-generator", schemaVersion: 1, exportedAt: nowIso(),
            songs: clone(songs), config: clone(appConfig),
            meta: { bandName: appConfig?.bandName || "", songCount: songs.length }
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
                }) : null
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
            await reloadAll({ quiet: true });
            addToast(`Imported ${ws} song${ws === 1 ? "" : "s"}.`);
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
            addToast(`Connected.`);
            await reloadAll();
        });

        repo.on("disconnected", () => {
            connectionStatus = "disconnected";
            songs = [];
            appConfig = null;
            generatedSetlist = null;
            showFirstRunPrompt = false;
            selectedSongId = "";
            editorSong = null;
            addToast("Disconnected.");
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
        get incompleteSongCount() { return songs.filter((s) => isSongIncomplete(s)).length; },
        get unpracticedSongCount() { return songs.filter((s) => s.unpracticed).length; },

        // actions
        init,
        navigate,
        connectStorage,
        disconnectStorage,
        finishFirstRun,
        generate,
        saveCurrentSetlist,
        removeSavedSetlist,
        reorderSetlistSong,
        updateGenerationField,
        toggleListValue,
        ensureMemberShowConfig,


        openNewSong,
        openSong,
        closeEditor,
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
        selectedEnergies,
        toggleOrderEnergy,
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
