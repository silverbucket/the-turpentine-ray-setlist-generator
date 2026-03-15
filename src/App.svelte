<script>
    import { onMount } from "svelte";
    import { DEFAULT_APP_CONFIG, blankPreset, blankSong, normalizeAppConfig, normalizePresetRecord, normalizeSongRecord } from "./lib/defaults.js";
    import { CONFIG_SECTIONS } from "./lib/config-meta.js";
    import { generateSetlist } from "./lib/generator.js";
    import { createRemoteStorageRepository } from "./lib/remotestorage.js";
    import SongEditorForm from "./lib/components/SongEditorForm.svelte";
    import { clone, deepMerge, formatDelimitedList, getByPath, nowIso, parseDelimitedList, setByPath, titleForBand, tryParseJson, uid } from "./lib/utils.js";

    const repo = createRemoteStorageRepository();
    const STORAGE_KEY = "setlist-generator-ui-options";
    const ORDER_SLOTS = [
        { id: "first", label: "Opening song" },
        { id: "second", label: "Second song" },
        { id: "penultimate", label: "Second-to-last song" },
        { id: "last", label: "Closing song" }
    ];
    const ENERGY_OPTIONS = [1, 2, 3];

    let activeView = "generate";
    let songs = [];
    let presets = [];
    let appConfig = null;
    let bootstrapMeta = null;
    let generatedSetlist = null;
    let loadError = "";
    let busyMessage = "";
    let connectionStatus = "disconnected";
    let connectAddress = "";
    let firstRunBandName = "";
    let showFirstRunPrompt = false;
    let editorSong = null;
    let selectedSongId = "";
    let toastMessages = [];
    let presetDraft = blankPreset(defaultGenerationOptions());
    let quickPresetName = "";
    let importMode = "skip";
    let importFile = null;
    let songSearch = "";
    let songFilter = "all";
    let newMemberName = "";
    let newInstrumentByMember = {};
    let newTuningByInstrument = {};
    let expandedBandMember = "";
    let settingsSection = "overview";
    let showPlannerControls = false;
    let showAdvancedPlannerControls = false;
    let syncIndicatorVisible = false;
    let syncStatusLabel = "All changes saved";
    let syncActiveCount = 0;
    let syncIndicatorTimer = null;

    let generationOptions = loadStoredGenerationOptions();

    let appViewEntries = [];
    let currentViewEntry = null;
    let settingSectionEntries = [];
    let bandMemberEntries = [];
    let memberInstrumentChoicesByMember = {};
    let memberTuningChoicesByMember = {};
    let defaultTuningByMemberInstrument = {};
    let allInstrumentNamesList = [];
    let visibleSongs = [];
    let availableMemberNames = [];
    let instrumentTypeCount = 0;
    let identityGeneratorSections = [];
    let weightsRandomnessSections = [];
    let propSections = [];

    $: appTitle = titleForBand(appConfig?.bandName);
    $: document.title = appTitle;
    $: emptyCatalog = connectionStatus === "connected" && songs.length === 0;
    $: appViewEntries = appViews();
    $: currentViewEntry = appViewEntries.find((view) => view.id === activeView) || appViewEntries[0];
    $: settingSectionEntries = settingSections();
    $: bandMemberEntries = Object.entries(appConfig?.band?.members || {}).sort(([left], [right]) => left.localeCompare(right));
    $: visibleSongs = currentSongs(songs, songSearch, songFilter);
    $: availableMemberNames = buildAvailableMemberNames(appConfig, generationOptions, songs);
    $: memberInstrumentChoicesByMember = buildMemberInstrumentChoicesByMember(appConfig, generationOptions, songs);
    $: memberTuningChoicesByMember = buildMemberTuningChoicesByMember(appConfig, generationOptions, availableMemberNames, memberInstrumentChoicesByMember);
    $: defaultTuningByMemberInstrument = buildDefaultTuningByMemberInstrument(appConfig, availableMemberNames);
    $: allInstrumentNamesList = buildAllInstrumentNames(memberInstrumentChoicesByMember);
    $: instrumentTypeCount = allInstrumentNamesList.length;
    $: identityGeneratorSections = sectionsByIds(["identity", "generator"]);
    $: weightsRandomnessSections = sectionsByIds(["weights", "randomness"]);
    $: propSections = sectionsByIds(["props"]);

    onMount(() => {
        syncRouteFromHash();
        window.addEventListener("hashchange", syncRouteFromHash);

        repo.on("connected", async () => {
            connectionStatus = "connected";
            connectAddress = repo.getUserAddress() || connectAddress;
            addToast(`Connected to ${connectAddress || "remoteStorage"}.`);
            await reloadAll();
        });

        repo.on("disconnected", () => {
            connectionStatus = "disconnected";
            songs = [];
            presets = [];
            appConfig = null;
            generatedSetlist = null;
            showFirstRunPrompt = false;
            selectedSongId = "";
            editorSong = null;
            addToast("Disconnected. The rehearsal space is now offline.");
        });

        repo.on("error", (error) => {
            connectionStatus = "disconnected";
            loadError = error?.message || "remoteStorage complained in a vague but concerning way.";
            addToast(loadError, "danger");
        });

        repo.onChange(async (event) => {
            if (connectionStatus === "connected" && event?.origin !== "window") {
                beginSync(event?.origin === "remote" ? "Pulling remote changes" : "Syncing changes");
                try {
                    await reloadAll({ quiet: true });
                } finally {
                    endSync();
                }
            }
        });

        return () => {
            window.removeEventListener("hashchange", syncRouteFromHash);
            if (syncIndicatorTimer) {
                window.clearTimeout(syncIndicatorTimer);
            }
        };
    });

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

    function buildAvailableMemberNames(config = appConfig, options = generationOptions, songList = songs) {
        const names = new Set([
            ...Object.keys(config?.band?.members || {}),
            ...Object.keys(options.show?.members || {}),
            ...songList.flatMap((song) => Object.keys(song.members || {}))
        ]);

        return Array.from(names).sort();
    }

    function buildMemberInstrumentChoicesByMember(config = appConfig, options = generationOptions, songList = songs) {
        return buildAvailableMemberNames(config, options, songList).reduce((result, memberName) => {
            const fromSongs = songList.flatMap((song) => {
                return (song.members?.[memberName]?.instruments || []).map((option) => option.name);
            });
            const fromConfig = options.show?.members?.[memberName]?.allowedInstruments || [];
            const fromBand = (config?.band?.members?.[memberName]?.instruments || []).map((instrument) => instrument.name);
            result[memberName] = Array.from(new Set([...fromBand, ...fromSongs, ...fromConfig].filter(Boolean))).sort();
            return result;
        }, {});
    }

    function buildMemberTuningChoicesByMember(
        config = appConfig,
        options = generationOptions,
        memberNames = availableMemberNames,
        instrumentChoicesByMember = memberInstrumentChoicesByMember
    ) {
        return memberNames.reduce((result, memberName) => {
            result[memberName] = (instrumentChoicesByMember[memberName] || []).reduce((instrumentResult, instrumentName) => {
                const fromBand = (config?.band?.members?.[memberName]?.instruments || [])
                    .find((instrument) => instrument.name === instrumentName)?.tunings || [];
                const fromConfig = options.show?.members?.[memberName]?.allowedTunings?.[instrumentName] || [];
                instrumentResult[instrumentName] = Array.from(new Set([...fromBand, ...fromConfig].filter(Boolean))).sort();
                return instrumentResult;
            }, {});
            return result;
        }, {});
    }

    function buildAllInstrumentNames(instrumentChoicesByMember = memberInstrumentChoicesByMember) {
        const names = new Set();
        Object.values(instrumentChoicesByMember || {}).forEach((instruments) => {
            (instruments || []).forEach((instrumentName) => names.add(instrumentName));
        });
        return Array.from(names).sort();
    }

    function buildDefaultTuningByMemberInstrument(config = appConfig, memberNames = availableMemberNames) {
        return memberNames.reduce((result, memberName) => {
            result[memberName] = (config?.band?.members?.[memberName]?.instruments || []).reduce((instrumentResult, instrument) => {
                instrumentResult[instrument.name] = instrument.defaultTuning || "";
                return instrumentResult;
            }, {});
            return result;
        }, {});
    }

    function ensureMemberShowConfig(memberName) {
        if (generationOptions.show?.members?.[memberName]) {
            return;
        }

        generationOptions = setByPath(generationOptions, `show.members.${memberName}`, {
            allowedInstruments: [],
            allowedTunings: {}
        });
        persistGenerationOptions();
    }

    function loadStoredGenerationOptions() {
        const fallback = defaultGenerationOptions(DEFAULT_APP_CONFIG);
        if (typeof localStorage === "undefined") {
            return fallback;
        }
        const stored = tryParseJson(localStorage.getItem(STORAGE_KEY), null);
        return stored ? deepMerge(fallback, stored) : fallback;
    }

    function persistGenerationOptions() {
        if (typeof localStorage === "undefined") {
            return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(generationOptions));
    }

    function syncRouteFromHash() {
        const next = window.location.hash.replace(/^#\/?/, "") || "generate";
        const allowed = ["generate", "songs", "presets", "settings"];
        activeView = allowed.includes(next) ? next : "generate";
    }

    function navigate(view) {
        window.location.hash = `/${view}`;
    }

    function addToast(message, tone = "info") {
        const id = uid("toast");
        toastMessages = toastMessages.concat({ id, message, tone });
        window.setTimeout(() => {
            toastMessages = toastMessages.filter((toast) => toast.id !== id);
        }, 4200);
    }

    function beginSync(label = "Syncing remoteStorage") {
        syncActiveCount += 1;
        syncStatusLabel = label;
        syncIndicatorVisible = true;
        if (syncIndicatorTimer) {
            window.clearTimeout(syncIndicatorTimer);
            syncIndicatorTimer = null;
        }
    }

    function endSync(nextLabel = "All changes saved") {
        syncActiveCount = Math.max(0, syncActiveCount - 1);
        if (syncActiveCount > 0) {
            return;
        }

        syncStatusLabel = nextLabel;
        if (syncIndicatorTimer) {
            window.clearTimeout(syncIndicatorTimer);
        }
        syncIndicatorTimer = window.setTimeout(() => {
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

    async function connectStorage() {
        if (!connectAddress.trim()) {
            addToast("Put in a remoteStorage address first.", "danger");
            return;
        }

        connectionStatus = "connecting";
        loadError = "";
        repo.connect(connectAddress.trim());
    }

    async function disconnectStorage() {
        repo.disconnect();
    }

    async function reloadAll({ quiet = false } = {}) {
        try {
            busyMessage = quiet ? "" : "Loading your songs, presets, and assorted good intentions...";
            loadError = "";
            const data = await repo.loadAll();
            songs = data.songs;
            presets = data.presets;
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
            addToast("Your band needs a name, even if it is temporary and ridiculous.", "danger");
            return;
        }

        try {
            busyMessage = "Putting your name on the rehearsal binder...";
            appConfig = await withSync("Setting up remoteStorage", () => repo.ensureConfig(bandName));
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

    function currentSongs(songList = songs, search = songSearch, filter = songFilter) {
        const query = search.trim().toLowerCase();

        return songList.filter((song) => {
            if (filter === "covers" && !song.cover) {
                return false;
            }
            if (filter === "instrumentals" && !song.instrumental) {
                return false;
            }
            if (filter === "originals" && song.cover) {
                return false;
            }
            if (!query) {
                return true;
            }

            return [
                song.name,
                song.key,
                ...Object.keys(song.members || {})
            ].join(" ").toLowerCase().includes(query);
        });
    }

    function openNewSong() {
        editorSong = blankSong();
        selectedSongId = "";
        navigate("songs");
    }

    function openSong(song) {
        editorSong = normalizeSongRecord(song);
        selectedSongId = editorSong.id;
        navigate("songs");
    }

    function toggleSongEditor(song) {
        if (editorSong?.id === song.id) {
            closeEditor();
            return;
        }

        openSong(song);
    }

    function toggleBandMemberEditor(memberName) {
        expandedBandMember = expandedBandMember === memberName ? "" : memberName;
    }

    function updateSongField(key, value) {
        updateEditor((song) => {
            song[key] = value;
        });
    }

    function duplicateSong(song) {
        const copy = normalizeSongRecord({
            ...clone(song),
            id: uid("song"),
            name: `${song.name} (Copy)`,
            createdAt: nowIso(),
            updatedAt: nowIso()
        });
        editorSong = copy;
        selectedSongId = "";
        navigate("songs");
        addToast(`Duplicated "${song.name}" so you can get weird with it.`);
    }

    function closeEditor() {
        editorSong = null;
        selectedSongId = "";
    }

    function updateEditor(mutator) {
        const nextSong = clone(editorSong);
        mutator(nextSong);
        editorSong = nextSong;
    }

    function renameMember(previousName, nextName) {
        const clean = nextName.trim();
        if (!clean || clean === previousName) {
            return;
        }

        updateEditor((song) => {
            const entries = Object.entries(song.members || {});
            const rebuilt = {};
            entries.forEach(([memberName, value]) => {
                rebuilt[memberName === previousName ? clean : memberName] = value;
            });
            song.members = rebuilt;
        });
    }

    function addMember() {
        updateEditor((song) => {
            const base = `member${Object.keys(song.members || {}).length + 1}`;
            let name = base;
            let counter = 1;
            while (song.members[name]) {
                counter += 1;
                name = `${base}-${counter}`;
            }
            song.members[name] = {
                instruments: []
            };
        });
    }

    function removeMember(memberName) {
        updateEditor((song) => {
            delete song.members[memberName];
        });
    }

    function addInstrumentOption(memberName) {
        updateEditor((song) => {
            song.members[memberName].instruments.push({
                name: "",
                tuning: [],
                capo: 0,
                picking: false
            });
        });
    }

    function removeInstrumentOption(memberName, index) {
        updateEditor((song) => {
            song.members[memberName].instruments.splice(index, 1);
        });
    }

    function updateInstrumentOption(memberName, index, key, value) {
        updateEditor((song) => {
            const option = song.members[memberName].instruments[index];
            option[key] = value;
            if (key === "name") {
                const defaultTuning = instrumentConfigFor(memberName, value)?.defaultTuning || "";
                option.tuning = defaultTuning ? [defaultTuning] : [];
            }
        });
    }

    async function saveSong() {
        if (!editorSong?.name.trim()) {
            addToast("Songs work better when they have names.", "danger");
            return;
        }

        try {
            busyMessage = `Saving "${editorSong.name}"...`;
            const saved = await withSync("Saving song", () => repo.putSong({
                ...editorSong,
                updatedAt: nowIso()
            }));
            songs = songs.filter((song) => song.id !== saved.id).concat(saved).sort((left, right) => left.name.localeCompare(right.name));
            closeEditor();
            addToast(`Saved "${saved.name}".`);
        } catch (error) {
            addToast(error?.message || "Could not save the song.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    async function deleteSong(song) {
        const approved = window.confirm(`Delete "${song.name}"? This is the dangerous little trash button.`);
        if (!approved) {
            return;
        }

        try {
            busyMessage = `Deleting "${song.name}"...`;
            await withSync("Removing song", () => repo.deleteSong(song.id));
            songs = songs.filter((entry) => entry.id !== song.id);
            if (editorSong?.id === song.id) {
                closeEditor();
            }
            addToast(`Deleted "${song.name}".`);
        } catch (error) {
            addToast(error?.message || "Could not delete the song.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    function updateGenerationField(path, value) {
        generationOptions = setByPath(generationOptions, path, value);
        persistGenerationOptions();
    }

    function toggleListValue(path, value) {
        const current = getByPath(generationOptions, path, []);
        const next = current.includes(value)
            ? current.filter((entry) => entry !== value)
            : current.concat(value);
        updateGenerationField(path, next);
    }

    function applyPreset(preset) {
        generationOptions = deepMerge(defaultGenerationOptions(appConfig), clone(preset.options || {}));
        persistGenerationOptions();
        navigate("generate");
        addToast(`Loaded preset "${preset.name}".`);
    }

    async function savePresetFromCurrent() {
        if (!presetDraft.name.trim()) {
            addToast("Presets need names too. Preferably not just 'good one'.", "danger");
            return;
        }

        try {
            busyMessage = `Saving preset "${presetDraft.name}"...`;
            const saved = await withSync("Saving preset", () => repo.putPreset({
                ...presetDraft,
                options: clone(generationOptions),
                updatedAt: nowIso()
            }));
            presets = presets.filter((preset) => preset.id !== saved.id).concat(saved).sort((left, right) => left.name.localeCompare(right.name));
            presetDraft = blankPreset(generationOptions);
            addToast(`Saved preset "${saved.name}".`);
        } catch (error) {
            addToast(error?.message || "Could not save the preset.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    async function saveQuickPreset() {
        const name = quickPresetName.trim();
        if (!name) {
            addToast("Give the preset a name first.", "danger");
            return;
        }

        const existing = presets.find((preset) => preset.name.trim().toLowerCase() === name.toLowerCase());
        const base = existing
            ? normalizePresetRecord(existing)
            : blankPreset(generationOptions);

        try {
            busyMessage = `${existing ? "Updating" : "Saving"} preset "${name}"...`;
            const saved = await withSync("Saving preset", () => repo.putPreset({
                ...base,
                name,
                options: clone(generationOptions),
                updatedAt: nowIso()
            }));
            presets = presets.filter((preset) => preset.id !== saved.id).concat(saved).sort((left, right) => left.name.localeCompare(right.name));
            quickPresetName = "";
            addToast(`${existing ? "Updated" : "Saved"} preset "${saved.name}".`);
        } catch (error) {
            addToast(error?.message || "Could not save the preset.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    async function deletePreset(preset) {
        const approved = window.confirm(`Delete preset "${preset.name}"?`);
        if (!approved) {
            return;
        }

        try {
            busyMessage = `Deleting preset "${preset.name}"...`;
            await withSync("Removing preset", () => repo.deletePreset(preset.id));
            presets = presets.filter((entry) => entry.id !== preset.id);
            addToast(`Deleted preset "${preset.name}".`);
        } catch (error) {
            addToast(error?.message || "Could not delete the preset.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    function startPresetEdit(preset) {
        presetDraft = normalizePresetRecord(preset);
        navigate("presets");
    }

    function updatePresetField(key, value) {
        presetDraft = {
            ...presetDraft,
            [key]: value
        };
    }

    function resetPresetDraft() {
        presetDraft = blankPreset(generationOptions);
    }

    function generate() {
        if (!songs.length) {
            addToast("Add a few songs first, unless the plan is to play pure silence.", "danger");
            navigate("songs");
            return;
        }

        try {
            generatedSetlist = generateSetlist(songs, appConfig || DEFAULT_APP_CONFIG, generationOptions);
            addToast(`Generated ${generatedSetlist.songs.length} songs with seed ${generatedSetlist.seed}.`);
            navigate("generate");
        } catch (error) {
            addToast(error?.message || "The generator faceplanted.", "danger");
        }
    }

    function configFieldValue(config, field) {
        const value = getByPath(config, field.path);
        if (field.type === "list") {
            return formatDelimitedList(value);
        }
        return value;
    }

    function updateConfigField(field, rawValue) {
        if (!appConfig) {
            return;
        }

        let nextValue = rawValue;
        if (field.type === "number") {
            nextValue = Number(rawValue);
        } else if (field.type === "boolean") {
            nextValue = Boolean(rawValue);
        } else if (field.type === "list") {
            nextValue = parseDelimitedList(rawValue);
        }

        appConfig = setByPath(appConfig, field.path, nextValue);
    }

    async function saveConfig() {
        if (!appConfig) {
            return;
        }

        try {
            busyMessage = "Saving config...";
            const nextConfig = normalizeAppConfig({
                ...clone(appConfig),
                updatedAt: nowIso()
            });
            appConfig = await withSync("Saving settings", () => repo.putConfig(nextConfig));
            generationOptions = deepMerge(defaultGenerationOptions(appConfig), generationOptions);
            persistGenerationOptions();
            addToast("Saved config. The knobs have been officially twiddled.");
        } catch (error) {
            addToast(error?.message || "Could not save config.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    async function persistConfigEdit(nextConfig, errorMessage = "Could not save config.") {
        const normalized = normalizeAppConfig({
            ...clone(nextConfig),
            updatedAt: nowIso()
        });
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

    function orderRuleValue(config, slotId, fieldName) {
        const rules = getByPath(config, `general.order.${slotId}`, []);
        const match = rules.find(([name]) => name === fieldName);
        return match ? match[1] : null;
    }

    function selectedEnergies(config, slotId) {
        const value = orderRuleValue(config, slotId, "energy");
        if (Array.isArray(value)) {
            return value;
        }
        if (value === null || value === undefined) {
            return [];
        }
        return [value];
    }

    function toggleOrderEnergy(slotId, energy) {
        const current = selectedEnergies(appConfig, slotId);
        const next = current.includes(energy)
            ? current.filter((entry) => entry !== energy)
            : current.concat(energy).sort();
        setOrderRule(slotId, "energy", next.length ? next : null);
    }

    function orderToggleValue(config, slotId, fieldName) {
        const value = orderRuleValue(config, slotId, fieldName);
        if (value === true) {
            return "yes";
        }
        if (value === false) {
            return "no";
        }
        return "either";
    }

    function setOrderToggle(slotId, fieldName, value) {
        if (value === "either") {
            setOrderRule(slotId, fieldName, null);
            return;
        }
        setOrderRule(slotId, fieldName, value === "yes");
    }

    function setOrderRule(slotId, fieldName, nextValue) {
        const rules = clone(getByPath(appConfig, `general.order.${slotId}`, []))
            .filter(([name]) => name !== fieldName);

        if (nextValue !== null && nextValue !== undefined) {
            rules.push([fieldName, nextValue]);
        }

        appConfig = setByPath(appConfig, `general.order.${slotId}`, rules);
    }

    function settingSections() {
        return [
            {
                id: "overview",
                label: "Overview",
                description: "Band identity and the broad defaults."
            },
            {
                id: "band",
                label: "Band Setup",
                description: "Members, their instruments, and allowed tunings."
            },
            {
                id: "generator",
                label: "Generator",
                description: "Set length, limits, and search behavior."
            },
            {
                id: "transitions",
                label: "Transitions",
                description: "How allergic the generator is to swaps and changes."
            },
            {
                id: "import",
                label: "Import / Export",
                description: "Backup, restore, and move the catalog around."
            }
        ];
    }

    function appViews() {
        return [
            {
                id: "generate",
                eyebrow: "Plan The Night",
                label: "Generate",
                title: "Generate a Setlist",
                description: "Tune the show constraints and roll a fresh set."
            },
            {
                id: "songs",
                eyebrow: "Catalog Builder",
                label: "Songs",
                title: "Songs",
                description: "Add, edit, and organize every playable song."
            },
            {
                id: "presets",
                eyebrow: "Reusable Modes",
                label: "Presets",
                title: "Presets",
                description: "Save favorite show setups so you can reuse them fast."
            },
            {
                id: "settings",
                eyebrow: "Control Room",
                label: "Settings",
                title: "Settings",
                description: "Define the band, the rules, and the app behavior."
            }
        ];
    }

    function sectionsByIds(ids) {
        return CONFIG_SECTIONS.filter((section) => ids.includes(section.id));
    }

    function tuningDraftKey(memberName, instrumentName) {
        return `${memberName}::${instrumentName}`;
    }

    function instrumentConfigFor(memberName, instrumentName, config = appConfig) {
        return (config?.band?.members?.[memberName]?.instruments || []).find((instrument) => instrument.name === instrumentName) || null;
    }

    async function setInstrumentDefaultTuning(memberName, instrumentName, defaultTuning) {
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const nextConfig = setByPath(
            appConfig,
            `band.members.${memberName}.instruments`,
            currentInstruments.map((instrument) => {
                if (instrument.name !== instrumentName) {
                    return instrument;
                }

                return {
                    ...instrument,
                    defaultTuning
                };
            })
        );
        const saved = await persistConfigEdit(nextConfig, "Could not save the default tuning.");
        if (!saved) {
            return;
        }
        addToast(defaultTuning ? `Set ${instrumentName} default to "${defaultTuning}".` : `Cleared the default tuning for ${instrumentName}.`);
    }

    async function addBandMember() {
        const clean = newMemberName.trim();
        if (!clean) {
            addToast("Give the band member a name first.", "danger");
            return;
        }
        if (bandMemberEntries.some(([memberName]) => memberName === clean)) {
            addToast("That member already exists.", "danger");
            return;
        }

        const nextConfig = setByPath(appConfig, `band.members.${clean}`, {
            instruments: []
        });
        const saved = await persistConfigEdit(nextConfig, "Could not save the new band member.");
        if (!saved) {
            return;
        }
        expandedBandMember = clean;
        newMemberName = "";
        addToast(`Added "${clean}" to the band.`);
    }

    async function renameBandMember(oldName, newName) {
        const clean = newName.trim();
        if (!clean || clean === oldName || bandMemberEntries.some(([memberName]) => memberName === clean)) {
            return;
        }

        const rebuilt = {};
        Object.entries(appConfig.band.members).forEach(([memberName, value]) => {
            rebuilt[memberName === oldName ? clean : memberName] = value;
        });
        const nextConfig = setByPath(appConfig, "band.members", rebuilt);
        const saved = await persistConfigEdit(nextConfig, "Could not rename the band member.");
        if (!saved) {
            return;
        }
        if (expandedBandMember === oldName) {
            expandedBandMember = clean;
        }
        addToast(`Renamed "${oldName}" to "${clean}".`);
    }

    async function removeBandMember(memberName) {
        const rebuilt = clone(appConfig.band.members);
        delete rebuilt[memberName];
        const nextConfig = setByPath(appConfig, "band.members", rebuilt);
        const saved = await persistConfigEdit(nextConfig, "Could not remove the band member.");
        if (!saved) {
            return;
        }
        if (expandedBandMember === memberName) {
            expandedBandMember = "";
        }
        addToast(`Removed "${memberName}" from the band.`);
    }

    async function addBandMemberInstrument(memberName) {
        const draft = (newInstrumentByMember[memberName] || "").trim();
        if (!draft) {
            addToast("Type an instrument name first.", "danger");
            return;
        }

        const current = appConfig.band.members[memberName].instruments || [];
        if (current.some((instrument) => instrument.name === draft)) {
            addToast("That instrument is already on this member.", "danger");
            return;
        }

        const nextConfig = setByPath(appConfig, `band.members.${memberName}.instruments`, current.concat({
            name: draft,
            tunings: [],
            defaultTuning: ""
        }));
        const saved = await persistConfigEdit(nextConfig, "Could not add the instrument.");
        if (!saved) {
            return;
        }
        newInstrumentByMember = {
            ...newInstrumentByMember,
            [memberName]: ""
        };
        addToast(`Added ${draft} for ${memberName}.`);
    }

    async function removeBandMemberInstrument(memberName, instrumentName) {
        const current = appConfig.band.members[memberName].instruments || [];
        const nextConfig = setByPath(
            appConfig,
            `band.members.${memberName}.instruments`,
            current.filter((instrument) => instrument.name !== instrumentName)
        );
        const saved = await persistConfigEdit(nextConfig, "Could not remove the instrument.");
        if (!saved) {
            return;
        }
        addToast(`Removed ${instrumentName} from ${memberName}.`);
    }

    async function addTuningChoice(memberName, instrumentName) {
        const draftKey = tuningDraftKey(memberName, instrumentName);
        const clean = (newTuningByInstrument[draftKey] || "").trim();
        if (!clean) {
            addToast("Type a tuning name first.", "danger");
            return;
        }

        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const currentInstrument = currentInstruments.find((instrument) => instrument.name === instrumentName);
        const currentTunings = currentInstrument?.tunings || [];
        if (currentTunings.includes(clean)) {
            addToast("That tuning already exists for this instrument.", "danger");
            return;
        }

        const nextConfig = setByPath(
            appConfig,
            `band.members.${memberName}.instruments`,
            currentInstruments.map((instrument) => {
                if (instrument.name !== instrumentName) {
                    return instrument;
                }

                return {
                    ...instrument,
                    tunings: currentTunings.concat(clean)
                };
            })
        );
        const saved = await persistConfigEdit(nextConfig, "Could not save the tuning change.");
        if (!saved) {
            return;
        }
        newTuningByInstrument = {
            ...newTuningByInstrument,
            [draftKey]: ""
        };
        addToast(`Added "${clean}" to ${instrumentName}.`);
    }

    async function removeTuningChoice(memberName, instrumentName, tuning) {
        const currentInstruments = appConfig.band.members?.[memberName]?.instruments || [];
        const nextConfig = setByPath(
            appConfig,
            `band.members.${memberName}.instruments`,
            currentInstruments.map((instrument) => {
                if (instrument.name !== instrumentName) {
                    return instrument;
                }

                return {
                    ...instrument,
                    tunings: (instrument.tunings || []).filter((entry) => entry !== tuning),
                    defaultTuning: instrument.defaultTuning === tuning ? "" : (instrument.defaultTuning || "")
                };
            })
        );
        const saved = await persistConfigEdit(nextConfig, "Could not save the tuning change.");
        if (!saved) {
            return;
        }
        addToast(`Removed "${tuning}" from ${instrumentName}.`);
    }

    async function readJsonFile(file) {
        if (!file) {
            return null;
        }

        const text = await file.text();
        return JSON.parse(text);
    }

    function normalizeImportPayload(payload) {
        if (Array.isArray(payload)) {
            return {
                payloadType: "songs-array",
                songs: payload.map((song) => normalizeSongRecord(song)),
                presets: [],
                config: null
            };
        }

        if (payload && Array.isArray(payload.songs)) {
            return {
                payloadType: "full-export",
                songs: payload.songs.map((song) => normalizeSongRecord(song)),
                presets: Array.isArray(payload.presets)
                    ? payload.presets.map((preset) => normalizePresetRecord(preset))
                    : [],
                config: payload.config
                    ? normalizeAppConfig({
                        ...clone(payload.config),
                        bandName: payload.config.bandName || appConfig?.bandName || firstRunBandName || "",
                        updatedAt: nowIso()
                    })
                    : null
            };
        }

        if (payload && payload.general && payload.show && payload.props) {
            return {
                payloadType: "config-object",
                songs: [],
                presets: [],
                config: normalizeAppConfig({
                    ...clone(payload),
                    bandName: payload.bandName || appConfig?.bandName || firstRunBandName || "",
                    updatedAt: nowIso()
                })
            };
        }

        throw new Error("Unsupported JSON. Expected an app export payload, songs array, or config object.");
    }

    function buildExportPayload() {
        return {
            app: "setlist-generator",
            schemaVersion: 1,
            exportedAt: nowIso(),
            songs: clone(songs),
            presets: clone(presets),
            config: clone(appConfig),
            meta: {
                bandName: appConfig?.bandName || "",
                songCount: songs.length,
                presetCount: presets.length
            }
        };
    }

    function exportAllData() {
        const payload = buildExportPayload();
        const safeName = (appConfig?.bandName || "band-setlist")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "band-setlist";
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${safeName}-data.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        addToast("Exported the whole catalog as one JSON payload.");
    }

    async function importFromFile() {
        try {
            if (!importFile) {
                addToast("Choose a JSON file first.", "danger");
                return;
            }

            busyMessage = "Importing your uploaded JSON...";
            const existingById = new Map(songs.map((song) => [song.id, song]));
            const existingPresetsById = new Map(presets.map((preset) => [preset.id, preset]));
            const imported = normalizeImportPayload(await readJsonFile(importFile));
            let writtenSongs = 0;
            let writtenPresets = 0;

            await withSync("Importing data", async () => {
                for (const importedSong of imported.songs) {
                    if (importMode === "skip" && existingById.has(importedSong.id)) {
                        continue;
                    }
                    await repo.putSong(importedSong);
                    writtenSongs += 1;
                }

                for (const importedPreset of imported.presets) {
                    if (importMode === "skip" && existingPresetsById.has(importedPreset.id)) {
                        continue;
                    }
                    await repo.putPreset(importedPreset);
                    writtenPresets += 1;
                }

                if (imported.config && (importMode === "overwrite" || !appConfig)) {
                    await repo.putConfig(imported.config);
                }

                bootstrapMeta = await repo.putBootstrapMeta({
                    source: "uploaded-json",
                    payloadType: imported.payloadType,
                    mode: importMode,
                    fileName: importFile?.name || null,
                    importedSongs: writtenSongs,
                    importedPresets: writtenPresets
                });
            });

            await reloadAll({ quiet: true });
            addToast(`Imported ${writtenSongs} song${writtenSongs === 1 ? "" : "s"} and ${writtenPresets} preset${writtenPresets === 1 ? "" : "s"}.`);
        } catch (error) {
            addToast(error?.message || "Import failed.", "danger");
        } finally {
            busyMessage = "";
        }
    }

    function performanceSummary(performance) {
        return Object.keys(performance || {}).sort().map((member) => {
            const setup = performance[member];
            const details = [];
            if (setup.instrument) {
                details.push(setup.instrument);
            }
            if (setup.tuning) {
                details.push(setup.tuning);
            }
            if (setup.capo) {
                details.push(`capo ${setup.capo}`);
            }
            if (setup.picking) {
                details.push("picked");
            }
            return `${member}: ${details.join(", ") || "default"}`;
        }).join(" | ");
    }
</script>

<svelte:head>
    <title>{appTitle}</title>
</svelte:head>

{#if connectionStatus !== "connected"}
    <main class="connect-shell">
        <section class="connect-card taped">
            <p class="eyebrow">Band Tech, But A Little Goofy</p>
            <h1>{appTitle}</h1>
            <p class="lede">
                Hook this thing up to remoteStorage and it will keep your songs, presets, and lovingly over-tuned opinions somewhere safer than a napkin.
            </p>

            <label class="field">
                <span>remoteStorage address</span>
                <input
                    bind:value={connectAddress}
                    placeholder="you@example.com"
                    autocomplete="off"
                />
            </label>

            <button class="primary" on:click={connectStorage} disabled={connectionStatus === "connecting"}>
                {connectionStatus === "connecting" ? "Connecting..." : "Connect Storage"}
            </button>

            {#if loadError}
                <p class="error-copy">{loadError}</p>
            {/if}

            <div class="connect-notes">
                <p>Normal first run: connect, name the band, add songs, generate a setlist, pretend it was obvious all along.</p>
                <p>Optional weird path: upload your own songs/config JSON later if you already have data lying around.</p>
            </div>
        </section>
    </main>
{:else}
    <div class="app-shell">
        <aside class="sidebar taped">
            <div class="brand-block">
                <div class="brand-copy">
                    <p class="eyebrow">Setlist HQ</p>
                    <h1>{appTitle}</h1>
                </div>
                <div class="status-row">
                    <span class="status-pill">
                        <span class="status-dot"></span>
                        {connectAddress || "connected"}
                    </span>
                    {#if syncIndicatorVisible}
                        <span class="status-pill syncing">
                            <span class="sync-spinner"></span>
                            {syncStatusLabel}
                        </span>
                    {/if}
                </div>
            </div>

            <nav class="nav-stack">
                {#each appViewEntries as view (view.id)}
                    <button
                        class={`nav-card ${activeView === view.id ? "active" : ""}`}
                        on:click={() => navigate(view.id)}
                    >
                        <span class="nav-eyebrow">{view.eyebrow}</span>
                        <strong>{view.label}</strong>
                        <small>{view.description}</small>
                    </button>
                {/each}
            </nav>

            <div class="sidebar-footer">
                <button class="ghost" on:click={disconnectStorage}>Disconnect Storage</button>
            </div>
        </aside>

        <main class="main-panel">
            <header class="page-top">
                <div>
                    <p class="eyebrow">{currentViewEntry?.eyebrow}</p>
                    <h2>{currentViewEntry?.title}</h2>
                    <p class="muted page-subtitle">{currentViewEntry?.description}</p>
                </div>

                <div class="page-status">
                    {#if syncIndicatorVisible}
                        <div class="busy-chip sync-chip">
                            <span class="sync-spinner"></span>
                            {syncStatusLabel}
                        </div>
                    {/if}
                    {#if busyMessage}
                        <div class="busy-chip">{busyMessage}</div>
                    {/if}
                </div>
            </header>

            {#if activeView === "generate"}
                <section class="generate-layout">
                    <div class="generate-top">
                    <article class="panel taped planner-panel">
                        <div class="planner-hero">
                            <div>
                                <p class="eyebrow">Quick Roll</p>
                            </div>
                        </div>

                        <div class="planner-inline">
                            <label class="field planner-count">
                                <span>Song count</span>
                                <input type="number" min="1" max="60" value={generationOptions.count} on:input={(event) => updateGenerationField("count", Number(event.currentTarget.value))} />
                            </label>
                            <button class="primary planner-roll" on:click={generate}>Roll Setlist</button>
                        </div>
                    </article>

                    <article class="panel taped planner-controls-panel">
                        <section class="planner-controls">
                            <div class="planner-controls-head">
                                <div class="section-copy planner-copy">
                                    <p class="eyebrow">Controls</p>
                                    <h3>Controls</h3>
                                    <p>These shape the generator every time you roll. Change them here when you want to steer harder.</p>
                                </div>
                                <button
                                    class={`secondary planner-controls-toggle ${showPlannerControls ? "active" : ""}`}
                                    on:click={() => showPlannerControls = !showPlannerControls}
                                >
                                    {showPlannerControls ? "Hide Controls" : "Show Controls"}
                                </button>
                            </div>

                            {#if showPlannerControls}
                                <div class="form-grid planner-form-grid">
                                    <label class="field">
                                        <span>Max covers</span>
                                        <input type="number" min="0" max="20" value={generationOptions.maxCovers} on:input={(event) => updateGenerationField("maxCovers", Number(event.currentTarget.value))} />
                                        <small>Caps how many covers can show up in one setlist.</small>
                                    </label>
                                    <label class="field">
                                        <span>Max instrumentals</span>
                                        <input type="number" min="0" max="20" value={generationOptions.maxInstrumentals} on:input={(event) => updateGenerationField("maxInstrumentals", Number(event.currentTarget.value))} />
                                        <small>Keeps the generator from wandering too far into instrumental territory.</small>
                                    </label>
                                </div>

                                <div class="checkbox-block">
                                    {#each availableMemberNames as memberName (memberName)}
                                        <details class="member-constraint control-drawer">
                                            <summary>
                                                <div>
                                                    <p class="field-title">{memberName}</p>
                                                    <p class="muted helper-copy">Limit instruments and tunings for tonight’s show.</p>
                                                </div>
                                                <span class="summary-chip compact">Show details</span>
                                            </summary>

                                            <div class="drawer-body">
                                                <div>
                                                    <p class="field-title">{memberName} can bring</p>
                                                    <div class="chip-row">
                                                        {#each memberInstrumentChoicesByMember[memberName] || [] as instrument (instrument)}
                                                            <label class="chip-toggle">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(generationOptions.show.members?.[memberName]?.allowedInstruments || []).includes(instrument)}
                                                                    on:change={() => {
                                                                        ensureMemberShowConfig(memberName);
                                                                        toggleListValue(`show.members.${memberName}.allowedInstruments`, instrument);
                                                                    }}
                                                                />
                                                                <span>{instrument}</span>
                                                            </label>
                                                        {/each}
                                                    </div>
                                                </div>

                                                {#each memberInstrumentChoicesByMember[memberName] || [] as instrument (instrument)}
                                                    <div>
                                                        <p class="field-title">{memberName} {instrument} tunings</p>
                                                        <div class="chip-row">
                                                            {#each memberTuningChoicesByMember[memberName]?.[instrument] || [] as tuning (tuning)}
                                                                <label class="chip-toggle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={(generationOptions.show.members?.[memberName]?.allowedTunings?.[instrument] || []).includes(tuning)}
                                                                        on:change={() => {
                                                                            ensureMemberShowConfig(memberName);
                                                                            toggleListValue(`show.members.${memberName}.allowedTunings.${instrument}`, tuning);
                                                                        }}
                                                                    />
                                                                    <span>{tuning}</span>
                                                                </label>
                                                            {/each}
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        </details>
                                    {/each}
                                </div>

                                <div class="mini-panel">
                                    <div>
                                        <p class="eyebrow">Preset Loader</p>
                                        <p class="muted">Load one of your saved show setups if tonight already has a personality.</p>
                                    </div>
                                    <div class="preset-row">
                                        <select on:change={(event) => {
                                            const preset = presets.find((entry) => entry.id === event.currentTarget.value);
                                            if (preset) {
                                                applyPreset(preset);
                                            }
                                        }}>
                                            <option value="">Load a preset...</option>
                                            {#each presets as preset (preset.id)}
                                                <option value={preset.id}>{preset.name}</option>
                                            {/each}
                                        </select>
                                        <button class="secondary" on:click={() => navigate("presets")}>Manage Presets</button>
                                    </div>
                                </div>

                                <div class="mini-panel">
                                    <div>
                                        <p class="eyebrow">Save As Preset</p>
                                        <p class="muted">Save the current controls as a reusable preset. Reusing a name updates the existing one.</p>
                                    </div>
                                    <div class="preset-row">
                                        <input
                                            value={quickPresetName}
                                            placeholder="Friday room, no covers"
                                            on:input={(event) => quickPresetName = event.currentTarget.value}
                                        />
                                        <button class="secondary" on:click={saveQuickPreset}>Save Preset</button>
                                    </div>
                                </div>

                                <section class="planner-advanced">
                                    <button
                                        class={`ghost planner-advanced-toggle ${showAdvancedPlannerControls ? "active" : ""}`}
                                        on:click={() => showAdvancedPlannerControls = !showAdvancedPlannerControls}
                                    >
                                        {showAdvancedPlannerControls ? "Hide Advanced Controls" : "Show Advanced Controls"}
                                    </button>

                                    {#if showAdvancedPlannerControls}
                                        <div>
                                            <p class="muted">
                                                These are the fiddly bits for when you want to tune the generator itself instead of just the show.
                                            </p>
                                            <div class="form-grid planner-form-grid">
                                                <label class="field">
                                                    <span>Beam width</span>
                                                    <input type="number" min="1" max="2048" value={generationOptions.beamWidth} on:input={(event) => updateGenerationField("beamWidth", Number(event.currentTarget.value))} />
                                                    <small>How many possible setlists survive each search step. Bigger is smarter, slower, and more opinionated.</small>
                                                </label>
                                                <label class="field">
                                                    <span>Seed</span>
                                                    <input value={generationOptions.seed} placeholder="Leave blank for chaos" on:input={(event) => updateGenerationField("seed", event.currentTarget.value)} />
                                                    <small>Use a seed if you want a repeatable result. Leave it blank if you want the app to surprise you.</small>
                                                </label>
                                                <label class="field">
                                                    <span>Final temperature</span>
                                                    <input type="number" min="0.01" max="10" step="0.05" value={generationOptions.randomness.temperature} on:input={(event) => updateGenerationField("randomness.temperature", Number(event.currentTarget.value))} />
                                                    <small>Higher values pick from a wider range of good endings instead of the absolute neatest one.</small>
                                                </label>
                                                <label class="field">
                                                    <span>Final choice pool</span>
                                                    <input type="number" min="1" max="100" value={generationOptions.randomness.finalChoicePool} on:input={(event) => updateGenerationField("randomness.finalChoicePool", Number(event.currentTarget.value))} />
                                                    <small>How many solid final candidates the app keeps before choosing one.</small>
                                                </label>
                                            </div>
                                        </div>
                                    {/if}
                                </section>
                            {/if}
                        </section>
                    </article>
                    </div>

                    <article class="panel results-panel">
                        <div class="panel-header">
                            <div>
                                <p class="eyebrow">Latest Result</p>
                                <h3>Setlist</h3>
                            </div>
                            {#if generatedSetlist}
                                <span class="summary-chip">seed {generatedSetlist.seed}</span>
                            {/if}
                        </div>

                        {#if !generatedSetlist}
                            <div class="empty-state">
                                <h4>No setlist yet</h4>
                                <p>Press the button and let the algorithm audition its latest personality.</p>
                            </div>
                        {:else}
                            <div class="summary-row">
                                <div class="summary-box">
                                    <strong>{generatedSetlist.songs.length}</strong>
                                    <span>songs</span>
                                </div>
                                <div class="summary-box">
                                    <strong>{generatedSetlist.summary.score.toFixed(1)}</strong>
                                    <span>score</span>
                                </div>
                                <div class="summary-box">
                                    <strong>{generatedSetlist.summary.covers}</strong>
                                    <span>covers</span>
                                </div>
                                <div class="summary-box">
                                    <strong>{generatedSetlist.summary.instrumentals}</strong>
                                    <span>instrumentals</span>
                                </div>
                            </div>

                            <ol class="setlist">
                                {#each generatedSetlist.songs as song}
                                    <li>
                                        <div class="song-card taped slim">
                                            <div class="song-card-head">
                                                <div>
                                                    <h4>{song.position}. {song.name}</h4>
                                                    <p>Energy {song.energy}{song.key ? ` | key ${song.key}` : ""}</p>
                                                </div>
                                                <div class="score-pill">+{song.incrementalScore.toFixed(1)}</div>
                                            </div>
                                            <p class="setup-line">{performanceSummary(song.performance)}</p>
                                            {#if song.transitionNotes.length || song.contextNotes.length || song.positionNotes.length}
                                                <p class="note-line">
                                                    {[...song.transitionNotes, ...song.contextNotes, ...song.positionNotes].join("; ")}
                                                </p>
                                            {/if}
                                        </div>
                                    </li>
                                {/each}
                            </ol>
                        {/if}
                    </article>
                </section>
            {/if}

            {#if activeView === "songs"}
                <section class="songs-layout single">
                    <article class="panel taped">
                        <div class="panel-header">
                            <div>
                                <p class="eyebrow">Catalog</p>
                                <h3>{songs.length} Song{songs.length === 1 ? "" : "s"}</h3>
                            </div>
                            <button class="primary" on:click={openNewSong}>Add Song</button>
                        </div>

                        <div class="form-grid">
                            <label class="field">
                                <span>Search songs</span>
                                <input bind:value={songSearch} placeholder="Name, key, member..." />
                            </label>
                            <label class="field">
                                <span>Filter</span>
                                <select bind:value={songFilter}>
                                    <option value="all">Everything</option>
                                    <option value="originals">Originals only</option>
                                    <option value="covers">Covers only</option>
                                    <option value="instrumentals">Instrumentals only</option>
                                </select>
                            </label>
                        </div>

                        {#if editorSong && !selectedSongId}
                            <section class="song-row expanded">
                                <div class="song-row-summary">
                                    <div>
                                        <h4>New Song</h4>
                                        <p class="muted">Create it right here, save it, and it joins the list immediately.</p>
                                    </div>
                                </div>
                                <SongEditorForm
                                    song={editorSong}
                                    instrumentChoicesByMember={memberInstrumentChoicesByMember}
                                    tuningChoicesByMemberInstrument={memberTuningChoicesByMember}
                                    defaultTuningByMemberInstrument={defaultTuningByMemberInstrument}
                                    onSongFieldChange={updateSongField}
                                    onRenameMember={renameMember}
                                    onAddMember={addMember}
                                    onRemoveMember={removeMember}
                                    onAddInstrumentOption={addInstrumentOption}
                                    onRemoveInstrumentOption={removeInstrumentOption}
                                    onUpdateInstrumentOption={updateInstrumentOption}
                                    onSave={saveSong}
                                    onDuplicate={() => duplicateSong(editorSong)}
                                    onClose={closeEditor}
                                />
                            </section>
                        {/if}

                        {#if emptyCatalog}
                            <div class="empty-state loud">
                                <h4>The catalog is gloriously empty</h4>
                                <p>That is normal. Most bands start with no data and a dream.</p>
                                <div class="empty-actions">
                                    <button class="primary" on:click={openNewSong}>Add Song</button>
                                    <button class="secondary" on:click={() => navigate("settings")}>Import JSON</button>
                                </div>
                            </div>
                        {:else}
                            <div class="song-list">
                                {#each visibleSongs as song (song.id)}
                                    <article class={`song-row ${editorSong?.id === song.id ? "expanded" : ""}`}>
                                        <div class="song-row-summary">
                                            <div>
                                                <h4>{song.name}</h4>
                                                <p>Energy {song.energy}{song.cover ? " | cover" : ""}{song.instrumental ? " | instrumental" : ""}</p>
                                                <p class="muted">{Object.keys(song.members || {}).join(", ")}</p>
                                            </div>
                                            <div class="row-actions">
                                                <button class={`ghost ${editorSong?.id === song.id ? "active" : ""}`} on:click={() => toggleSongEditor(song)}>
                                                    {editorSong?.id === song.id ? "Done" : "Edit"}
                                                </button>
                                                <button class="ghost" on:click={() => duplicateSong(song)}>Duplicate</button>
                                                <button class="ghost danger" on:click={() => deleteSong(song)}>Delete</button>
                                            </div>
                                        </div>

                                        {#if editorSong?.id === song.id}
                                            <SongEditorForm
                                                song={editorSong}
                                                instrumentChoicesByMember={memberInstrumentChoicesByMember}
                                                tuningChoicesByMemberInstrument={memberTuningChoicesByMember}
                                                defaultTuningByMemberInstrument={defaultTuningByMemberInstrument}
                                                onSongFieldChange={updateSongField}
                                                onRenameMember={renameMember}
                                                onAddMember={addMember}
                                                onRemoveMember={removeMember}
                                                onAddInstrumentOption={addInstrumentOption}
                                                onRemoveInstrumentOption={removeInstrumentOption}
                                                onUpdateInstrumentOption={updateInstrumentOption}
                                                onSave={saveSong}
                                                onDuplicate={() => duplicateSong(editorSong)}
                                                onClose={closeEditor}
                                            />
                                        {/if}
                                    </article>
                                {/each}
                            </div>
                        {/if}
                    </article>
                </section>
            {/if}

            {#if activeView === "presets"}
                <section class="panel-grid">
                    <article class="panel taped">
                        <div class="panel-header">
                            <div>
                                <p class="eyebrow">Preset Workshop</p>
                                <h3>{presetDraft.id ? "Save Current Settings" : "New Preset"}</h3>
                            </div>
                        </div>

                        <div class="form-grid">
                            <label class="field">
                                <span>Preset name</span>
                                <input value={presetDraft.name} placeholder="Friday basement marathon" on:input={(event) => updatePresetField("name", event.currentTarget.value)} />
                            </label>
                            <label class="field">
                                <span>Tags</span>
                                <input value={formatDelimitedList(presetDraft.tags)} on:input={(event) => updatePresetField("tags", parseDelimitedList(event.currentTarget.value))} placeholder="rowdy, short, no-D" />
                            </label>
                            <label class="field wide">
                                <span>Notes</span>
                                <textarea rows="4" value={presetDraft.notes} on:input={(event) => updatePresetField("notes", event.currentTarget.value)} placeholder="Why this preset exists, or a small threat."></textarea>
                            </label>
                        </div>

                        <div class="editor-actions">
                            <button class="primary" on:click={savePresetFromCurrent}>Save Preset From Current Generate Settings</button>
                            <button class="secondary" on:click={resetPresetDraft}>Reset Draft</button>
                        </div>
                    </article>

                    <article class="panel taped">
                        <div class="panel-header">
                            <div>
                                <p class="eyebrow">Saved Presets</p>
                                <h3>{presets.length} Preset{presets.length === 1 ? "" : "s"}</h3>
                            </div>
                        </div>

                        {#if !presets.length}
                            <div class="empty-state">
                                <h4>No presets yet</h4>
                                <p>Generate a few good ideas, then bottle one before it escapes.</p>
                            </div>
                        {:else}
                            <div class="song-list">
                                {#each presets as preset (preset.id)}
                                    <article class="song-row">
                                        <div>
                                            <h4>{preset.name}</h4>
                                            <p>{preset.notes || "No notes. Very mysterious."}</p>
                                            <p class="muted">{preset.tags.join(", ")}</p>
                                        </div>
                                        <div class="row-actions">
                                            <button class="ghost" on:click={() => applyPreset(preset)}>Load</button>
                                            <button class="ghost" on:click={() => startPresetEdit(preset)}>Edit Draft</button>
                                            <button class="ghost danger" on:click={() => deletePreset(preset)}>Delete</button>
                                        </div>
                                    </article>
                                {/each}
                            </div>
                        {/if}
                    </article>
                </section>
            {/if}

            {#if activeView === "settings"}
                <section class="settings-layout">
                    <aside class="panel taped settings-nav">
                        <div class="settings-nav-copy">
                            <p class="eyebrow">Settings</p>
                            <h3>Make It Behave</h3>
                            <p class="muted">Shorter sections, less spelunking, fewer mysterious controls.</p>
                        </div>

                        <div class="settings-summary">
                            <div class="summary-box compact-box">
                                <strong>{songs.length}</strong>
                                <span>songs</span>
                            </div>
                            <div class="summary-box compact-box">
                                <strong>{instrumentTypeCount}</strong>
                                <span>instrument types</span>
                            </div>
                        </div>

                        <nav class="settings-tabs">
                            {#each settingSectionEntries as section (section.id)}
                                <button
                                    class={`settings-tab ${settingsSection === section.id ? "active" : ""}`}
                                    on:click={() => settingsSection = section.id}
                                >
                                    <span>{section.label}</span>
                                    <small>{section.description}</small>
                                </button>
                            {/each}
                        </nav>
                    </aside>

                    <article class="panel taped settings-main">
                        {#if settingsSection === "overview"}
                            <div class="settings-panel-head">
                                <p class="eyebrow">Overview</p>
                                <h3>Band Identity and Defaults</h3>
                                <p class="muted">The high-level setup you reach for most often.</p>
                            </div>

                            {#each identityGeneratorSections as section}
                                <section class="settings-section">
                                    <div class="section-copy">
                                        <h4>{section.title}</h4>
                                        <p>{section.intro}</p>
                                    </div>
                                    <div class="settings-fields">
                                        {#each section.fields as field}
                                            <label class="field wide">
                                                <span>{field.label}</span>
                                                {#if field.type === "boolean"}
                                                    <div class="field checkbox nested">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(configFieldValue(appConfig, field))}
                                                            on:change={(event) => updateConfigField(field, event.currentTarget.checked)}
                                                        />
                                                        <span>Enabled</span>
                                                    </div>
                                                {:else}
                                                    <input
                                                        type={field.type === "number" ? "number" : "text"}
                                                        min={field.min}
                                                        max={field.max}
                                                        step={field.step}
                                                        value={configFieldValue(appConfig, field)}
                                                        on:input={(event) => updateConfigField(field, event.currentTarget.value)}
                                                    />
                                                {/if}
                                                <small>{field.description}</small>
                                            </label>
                                        {/each}
                                    </div>
                                </section>
                            {/each}
                        {/if}

                        {#if settingsSection === "band"}
                            <div class="settings-panel-head">
                                <p class="eyebrow">Band Setup</p>
                                <h3>Members, Instruments, Tunings</h3>
                                <p class="muted">This is the catalog vocabulary. Song editing becomes much cleaner once this is dialed in.</p>
                            </div>

                            <section class="settings-section">
                                <div class="section-copy">
                                    <h4>Band Members</h4>
                                    <p>Define who is in the band, which instruments each person can play, and the tuning choices for each instrument.</p>
                                </div>
                                <div class="settings-fields">
                                    <div class="field wide band-member-add-panel">
                                        <span>Add band member</span>
                                    <div class="editor-actions">
                                            <input bind:value={newMemberName} placeholder="Sam, Alex, Jules..." />
                                            <button class="secondary" on:click={addBandMember}>Add Member</button>
                                        </div>
                                        <small>Member names are reusable across the whole catalog and setlist generator.</small>
                                    </div>

                                    {#each bandMemberEntries as [memberName, memberConfig] (memberName)}
                                        <section class={`band-member-row ${expandedBandMember === memberName ? "expanded" : ""}`}>
                                            <div class="band-member-summary">
                                                <div class="band-member-summary-copy">
                                                    <strong>{memberName}</strong>
                                                    <small>{(memberConfig.instruments || []).map((instrument) => instrument.name).join(", ") || "No instruments yet"}</small>
                                                </div>
                                                <button
                                                    class={`ghost ${expandedBandMember === memberName ? "active" : ""}`}
                                                    on:click={() => toggleBandMemberEditor(memberName)}
                                                >
                                                    {expandedBandMember === memberName ? "Done" : "Edit"}
                                                </button>
                                            </div>

                                            {#if expandedBandMember === memberName}
                                                <div class="band-member-editor">
                                                    <div class="member-head">
                                                        <input
                                                            value={memberName}
                                                            on:change={(event) => renameBandMember(memberName, event.currentTarget.value)}
                                                        />
                                                        <button class="ghost danger" on:click={() => removeBandMember(memberName)}>Remove</button>
                                                    </div>

                                                    <div class="editor-actions">
                                                        <input
                                                            value={newInstrumentByMember[memberName] || ""}
                                                            placeholder={`Add an instrument for ${memberName}`}
                                                            on:input={(event) => newInstrumentByMember = { ...newInstrumentByMember, [memberName]: event.currentTarget.value }}
                                                        />
                                                        <button class="secondary" on:click={() => addBandMemberInstrument(memberName)}>Add Instrument</button>
                                                    </div>

                                                    <div class="instrument-library-list">
                                                        {#each memberConfig.instruments || [] as instrumentConfig (instrumentConfig.name)}
                                                            <details class="instrument-library" open>
                                                                <summary class="instrument-library-summary">
                                                                    <div>
                                                                        <strong>{instrumentConfig.name}</strong>
                                                                        <small>{instrumentConfig.defaultTuning ? `Default: ${instrumentConfig.defaultTuning}` : "No default tuning set"}</small>
                                                                    </div>
                                                                    <button type="button" class="chip-x" on:click|preventDefault|stopPropagation={() => removeBandMemberInstrument(memberName, instrumentConfig.name)}>Remove</button>
                                                                </summary>

                                                                <div class="tuning-library">
                                                                    <label class="field">
                                                                        <span>Default tuning</span>
                                                                        <select
                                                                            value={instrumentConfig.defaultTuning || ""}
                                                                            on:change={(event) => setInstrumentDefaultTuning(memberName, instrumentConfig.name, event.currentTarget.value)}
                                                                        >
                                                                            <option value="">No default</option>
                                                                            {#each instrumentConfig.tunings || [] as tuning (tuning)}
                                                                                <option value={tuning}>{tuning}</option>
                                                                            {/each}
                                                                        </select>
                                                                        <small>The song editor will only use this if you explicitly chose this instrument.</small>
                                                                    </label>

                                                                    <div>
                                                                        <p class="field-title">Tunings for {instrumentConfig.name}</p>
                                                                        <p class="muted helper-copy">Keep this list tight so the song editor stays typo-proof and compact.</p>
                                                                        <div class="tuning-list">
                                                                            {#each instrumentConfig.tunings || [] as tuning (tuning)}
                                                                                <div class="tuning-row">
                                                                                    <span class="chip-static">{tuning}</span>
                                                                                    <button
                                                                                        type="button"
                                                                                        class="ghost danger tuning-remove"
                                                                                        on:click|preventDefault|stopPropagation={() => removeTuningChoice(memberName, instrumentConfig.name, tuning)}
                                                                                    >
                                                                                        Remove
                                                                                    </button>
                                                                                </div>
                                                                            {/each}
                                                                        </div>
                                                                        <div class="editor-actions compact-actions">
                                                                            <input
                                                                                value={newTuningByInstrument[tuningDraftKey(memberName, instrumentConfig.name)] || ""}
                                                                                placeholder={`Add a tuning for ${instrumentConfig.name}`}
                                                                                on:input={(event) => newTuningByInstrument = { ...newTuningByInstrument, [tuningDraftKey(memberName, instrumentConfig.name)]: event.currentTarget.value }}
                                                                            />
                                                                            <button class="secondary" on:click={() => addTuningChoice(memberName, instrumentConfig.name)}>Add Tuning</button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </details>
                                                        {/each}
                                                    </div>
                                                </div>
                                            {/if}
                                        </section>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        {#if settingsSection === "generator"}
                            <div class="settings-panel-head">
                                <p class="eyebrow">Generator</p>
                                <h3>Search and Randomness</h3>
                                <p class="muted">How long the set should be, how hard the search works, and how much inspiration-vs-order you want.</p>
                            </div>

                            {#each weightsRandomnessSections as section}
                                <section class="settings-section">
                                    <div class="section-copy">
                                        <h4>{section.title}</h4>
                                        <p>{section.intro}</p>
                                    </div>
                                    <div class="settings-fields">
                                        {#each section.fields as field}
                                            <label class="field wide">
                                                <span>{field.label}</span>
                                                {#if field.type === "boolean"}
                                                    <div class="field checkbox nested">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(configFieldValue(appConfig, field))}
                                                            on:change={(event) => updateConfigField(field, event.currentTarget.checked)}
                                                        />
                                                        <span>Enabled</span>
                                                    </div>
                                                {:else}
                                                    <input
                                                        type={field.type === "number" ? "number" : "text"}
                                                        min={field.min}
                                                        max={field.max}
                                                        step={field.step}
                                                        value={configFieldValue(appConfig, field)}
                                                        on:input={(event) => updateConfigField(field, event.currentTarget.value)}
                                                    />
                                                {/if}
                                                <small>{field.description}</small>
                                            </label>
                                        {/each}
                                    </div>
                                </section>
                            {/each}
                        {/if}

                        {#if settingsSection === "transitions"}
                            <div class="settings-panel-head">
                                <p class="eyebrow">Transitions</p>
                                <h3>Setup Changes and Set Arc</h3>
                                <p class="muted">Tell the generator how long to stay put before changing things, plus what the opener and closer should feel like.</p>
                            </div>

                            {#each propSections as section}
                                <section class="settings-section">
                                    <div class="section-copy">
                                        <h4>{section.title}</h4>
                                        <p>{section.intro}</p>
                                    </div>
                                    <div class="settings-fields">
                                        {#each section.fields as field}
                                            <label class="field wide">
                                                <span>{field.label}</span>
                                                {#if field.type === "boolean"}
                                                    <div class="field checkbox nested">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(configFieldValue(appConfig, field))}
                                                            on:change={(event) => updateConfigField(field, event.currentTarget.checked)}
                                                        />
                                                        <span>Enabled</span>
                                                    </div>
                                                {:else}
                                                    <input
                                                        type={field.type === "number" ? "number" : "text"}
                                                        min={field.min}
                                                        max={field.max}
                                                        step={field.step}
                                                        value={configFieldValue(appConfig, field)}
                                                        on:input={(event) => updateConfigField(field, event.currentTarget.value)}
                                                    />
                                                {/if}
                                                <small>{field.description}</small>
                                            </label>
                                        {/each}
                                    </div>
                                </section>
                            {/each}

                            <section class="settings-section">
                                <div class="section-copy">
                                    <h4>Set Arc</h4>
                                    <p>Set the vibe for the opener, closer, and the songs around them without touching JSON.</p>
                                </div>
                                <div class="settings-fields">
                                    {#each ORDER_SLOTS as slot}
                                        <section class="member-constraint">
                                            <h5>{slot.label}</h5>
                                            <div class="field">
                                                <span>Preferred energy</span>
                                                <div class="chip-row">
                                                    {#each ENERGY_OPTIONS as energy}
                                                        <label class="chip-toggle">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedEnergies(appConfig, slot.id).includes(energy)}
                                                                on:change={() => toggleOrderEnergy(slot.id, energy)}
                                                            />
                                                            <span>{energy}</span>
                                                        </label>
                                                    {/each}
                                                </div>
                                            </div>
                                            <label class="field">
                                                <span>Cover preference</span>
                                                <select
                                                    value={orderToggleValue(appConfig, slot.id, "cover")}
                                                    on:change={(event) => setOrderToggle(slot.id, "cover", event.currentTarget.value)}
                                                >
                                                    <option value="either">No preference</option>
                                                    <option value="no">Originals only</option>
                                                    <option value="yes">Covers allowed</option>
                                                </select>
                                            </label>
                                            <label class="field">
                                                <span>Instrumental preference</span>
                                                <select
                                                    value={orderToggleValue(appConfig, slot.id, "instrumental")}
                                                    on:change={(event) => setOrderToggle(slot.id, "instrumental", event.currentTarget.value)}
                                                >
                                                    <option value="either">No preference</option>
                                                    <option value="no">Not instrumental</option>
                                                    <option value="yes">Instrumental allowed</option>
                                                </select>
                                            </label>
                                        </section>
                                    {/each}
                                </div>
                            </section>
                        {/if}

                        {#if settingsSection === "import"}
                            <div class="settings-panel-head">
                                <p class="eyebrow">Import / Export</p>
                                <h3>Backups and Transfer</h3>
                                <p class="muted">Export everything into one payload, then re-import the same thing later if you need to restore or migrate.</p>
                            </div>

                            <section class="settings-section">
                                <div class="section-copy">
                                    <h4>JSON Import</h4>
                                    <p>Legacy songs arrays and config objects still work too, but the full export payload is the cleanest path.</p>
                                </div>
                                <div class="settings-fields">
                                    <label class="field">
                                        <span>Import JSON file</span>
                                        <input type="file" accept="application/json,.json" on:change={(event) => importFile = event.currentTarget.files?.[0] || null} />
                                        <small>{importFile ? importFile.name : "Choose an exported app payload, songs array, or config object."}</small>
                                    </label>
                                    <label class="field">
                                        <span>Import mode</span>
                                        <select bind:value={importMode}>
                                            <option value="skip">Skip existing IDs</option>
                                            <option value="overwrite">Overwrite matching IDs</option>
                                        </select>
                                    </label>
                                    <div class="editor-actions">
                                        <button class="secondary" on:click={importFromFile}>Import JSON</button>
                                        <button class="primary" on:click={exportAllData}>Export Everything</button>
                                    </div>
                                </div>
                            </section>
                        {/if}

                        <div class="settings-savebar">
                            <button class="primary" on:click={saveConfig}>Save Settings</button>
                        </div>
                    </article>
                </section>
            {/if}

            {#if loadError}
                <div class="banner error-copy">{loadError}</div>
            {/if}
        </main>
    </div>
{/if}

{#if showFirstRunPrompt}
    <div class="modal-backdrop">
        <div class="modal taped">
            <p class="eyebrow">First Run</p>
            <h3>Name The Band</h3>
            <p>
                This creates the initial config so the app stops calling you a generic band. A cruel but fair system.
            </p>
            <label class="field">
                <span>Band name</span>
                <input bind:value={firstRunBandName} placeholder="Your Band Name" />
            </label>
            <button class="primary" on:click={finishFirstRun}>Save Band Name</button>
        </div>
    </div>
{/if}

<div class="toast-stack" aria-live="polite">
    {#each toastMessages as toast (toast.id)}
        <div class={`toast ${toast.tone}`}>{toast.message}</div>
    {/each}
</div>

<style>
    .connect-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
    }

    .connect-card,
    .panel,
    .song-card,
    .modal,
    .sidebar {
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow);
        backdrop-filter: blur(18px);
    }

    .taped::before,
    .slim::before {
        display: none;
    }

    .connect-card {
        width: min(100%, 700px);
        padding: 2rem;
        display: grid;
        gap: 1.1rem;
    }

    .eyebrow {
        margin: 0;
        color: var(--accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    p {
        margin: 0;
    }

    h1,
    h2,
    h3 {
        letter-spacing: -0.04em;
        line-height: 1.05;
    }

    h1 {
        font-size: clamp(2rem, 4vw, 2.85rem);
    }

    h2 {
        font-size: clamp(1.7rem, 3vw, 2.4rem);
    }

    h3 {
        font-size: 1.22rem;
    }

    .muted,
    small {
        color: var(--muted);
    }

    .lede,
    .connect-notes {
        color: var(--muted);
    }

    .connect-notes {
        display: grid;
        gap: 0.4rem;
    }

    .app-shell {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        gap: 1rem;
        padding: 1rem;
    }

    .sidebar {
        position: sticky;
        top: 1rem;
        height: calc(100vh - 2rem);
        padding: 1rem;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 1rem;
    }

    .brand-block,
    .brand-copy {
        display: grid;
        gap: 0.45rem;
    }

    .status-row,
    .page-status {
        display: flex;
        gap: 0.55rem;
        align-items: center;
        flex-wrap: wrap;
    }

    .status-pill,
    .busy-chip,
    .summary-chip,
    .score-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        min-height: 2.25rem;
        padding: 0.45rem 0.8rem;
        border-radius: 999px;
        border: 1px solid rgba(27, 49, 80, 0.08);
        background: rgba(255, 255, 255, 0.76);
        color: var(--ink);
        box-shadow: var(--shadow-soft);
        font-size: 0.88rem;
        font-weight: 700;
    }

    .summary-chip,
    .score-pill,
    .sync-chip,
    .status-pill.syncing {
        background: var(--accent-soft);
        color: var(--accent-strong);
        border-color: var(--accent-line);
    }

    .summary-chip.compact {
        min-height: 2rem;
        padding: 0.3rem 0.65rem;
        box-shadow: none;
    }

    .status-dot {
        width: 0.65rem;
        height: 0.65rem;
        border-radius: 999px;
        background: var(--success);
        box-shadow: 0 0 0 0.2rem rgba(31, 143, 97, 0.14);
    }

    .sync-spinner {
        width: 0.9rem;
        height: 0.9rem;
        border-radius: 999px;
        border: 2px solid rgba(225, 91, 55, 0.2);
        border-top-color: currentColor;
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
    }

    .nav-stack {
        display: grid;
        gap: 0.65rem;
        align-content: start;
    }

    .nav-card {
        display: grid;
        gap: 0.2rem;
        justify-items: start;
        width: 100%;
        padding: 0.9rem 1rem;
        text-align: left;
        border-radius: var(--radius-lg);
        background: rgba(255, 255, 255, 0.52);
        border: 1px solid transparent;
    }

    .nav-eyebrow {
        color: var(--accent);
        font-size: 0.66rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
    }

    .nav-card strong {
        font-size: 0.98rem;
    }

    .nav-card small {
        line-height: 1.35;
    }

    .nav-card.active {
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,247,251,0.94));
        border-color: var(--accent-line);
        box-shadow: 0 14px 28px rgba(23, 33, 48, 0.08);
    }

    .sidebar-footer {
        margin-top: auto;
    }

    .main-panel {
        display: grid;
        gap: 1rem;
        min-width: 0;
    }

    .page-top {
        position: sticky;
        top: 0;
        z-index: 4;
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 1rem;
        padding: 0.35rem 0.25rem 0;
        background: linear-gradient(180deg, rgba(247, 248, 252, 0.92), rgba(247, 248, 252, 0.72), transparent);
        backdrop-filter: blur(10px);
    }

    .page-subtitle {
        max-width: 52ch;
        margin-top: 0.35rem;
    }

    .panel,
    .settings-main,
    .settings-nav {
        padding: 1.1rem;
    }

    .panel-grid,
    .songs-layout,
    .settings-layout,
    .generate-top {
        display: grid;
        gap: 1rem;
    }

    .panel-grid {
        grid-template-columns: minmax(0, 1fr) minmax(320px, 430px);
    }

    .songs-layout.single,
    .generate-layout {
        grid-template-columns: 1fr;
    }

    .generate-top {
        grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
        align-items: start;
    }

    .settings-layout {
        grid-template-columns: 280px minmax(0, 1fr);
        align-items: start;
    }

    .panel-header,
    .song-card-head,
    .preset-row,
    .row-actions,
    .editor-actions,
    .member-head,
    .inline-header,
    .planner-controls-head,
    .planner-inline,
    .song-row-summary,
    .band-member-summary,
    .instrument-library-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.8rem;
    }

    .row-actions,
    .editor-actions,
    .status-row,
    .page-status {
        flex-wrap: wrap;
    }

    .song-row-summary,
    .band-member-summary,
    .instrument-library-summary {
        align-items: flex-start;
    }

    .planner-panel,
    .planner-controls,
    .planner-advanced,
    .settings-main,
    .settings-section,
    .settings-fields,
    .song-list,
    .checkbox-block,
    .setlist,
    .band-member-editor,
    .instrument-library-list,
    .tuning-library {
        display: grid;
        gap: 0.95rem;
    }

    .settings-nav {
        position: sticky;
        top: 1rem;
        display: grid;
        gap: 1rem;
    }

    .settings-nav-copy,
    .settings-panel-head,
    .section-copy {
        display: grid;
        gap: 0.35rem;
    }

    .settings-summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.7rem;
    }

    .summary-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 0.75rem;
        margin-bottom: 0.8rem;
    }

    .summary-box {
        padding: 0.9rem;
        border-radius: var(--radius-lg);
        background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(243,246,251,0.9));
        border: 1px solid rgba(27, 49, 80, 0.08);
        display: grid;
        gap: 0.2rem;
        justify-items: center;
        text-align: center;
    }

    .summary-box strong {
        font-size: 1.22rem;
    }

    .compact-box {
        padding: 0.85rem 0.6rem;
    }

    .settings-tabs {
        display: grid;
        gap: 0.55rem;
    }

    .settings-tab {
        display: grid;
        gap: 0.2rem;
        width: 100%;
        text-align: left;
        padding: 0.82rem 0.95rem;
        border-radius: var(--radius-lg);
        background: rgba(255,255,255,0.56);
        border: 1px solid transparent;
    }

    .settings-tab.active {
        border-color: var(--accent-line);
        background: rgba(255,255,255,0.95);
        box-shadow: var(--shadow-soft);
    }

    .settings-tab span {
        font-weight: 700;
    }

    .field {
        display: grid;
        gap: 0.38rem;
        color: var(--muted);
    }

    .field > span,
    .field-title {
        color: var(--ink);
        font-weight: 700;
    }

    .field-title {
        margin: 0 0 0.2rem;
    }

    .field.checkbox {
        display: flex;
        align-items: center;
        gap: 0.55rem;
    }

    .field.checkbox.nested {
        padding: 0.7rem 0.9rem;
        border-radius: var(--radius-md);
        background: rgba(247, 249, 253, 0.9);
        border: 1px solid rgba(27, 49, 80, 0.08);
    }

    .field.wide,
    .settings-section,
    .results-panel {
        grid-column: 1 / -1;
    }

    .form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.9rem;
    }

    input,
    select,
    textarea {
        width: 100%;
        min-height: 2.9rem;
        padding: 0.82rem 0.95rem;
        border-radius: var(--radius-md);
        border: 1px solid rgba(27, 49, 80, 0.14);
        background: rgba(255,255,255,0.92);
        color: var(--ink);
        transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }

    textarea {
        min-height: 6.2rem;
        resize: vertical;
    }

    input:focus,
    select:focus,
    textarea:focus {
        outline: none;
        border-color: var(--accent-line);
        box-shadow: 0 0 0 0.22rem rgba(225, 91, 55, 0.14);
        background: rgba(255,255,255,0.98);
    }

    button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 2.8rem;
        padding: 0.78rem 0.95rem;
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        background: rgba(255,255,255,0.84);
        color: var(--ink);
        font-weight: 800;
        line-height: 1;
        transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
        touch-action: manipulation;
    }

    button:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 20px rgba(27, 39, 58, 0.1);
    }

    button:active {
        transform: translateY(1px) scale(0.99);
        box-shadow: none;
    }

    button:focus-visible {
        outline: none;
        box-shadow: 0 0 0 0.22rem rgba(225, 91, 55, 0.16);
    }

    button[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
    }

    button.primary {
        color: #fff;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        border-color: rgba(0,0,0,0.04);
    }

    button.secondary,
    button.active {
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(242,245,250,0.94));
        border-color: rgba(27, 49, 80, 0.1);
    }

    button.ghost {
        background: rgba(255,255,255,0.48);
        border-color: rgba(27, 49, 80, 0.08);
    }

    button.danger,
    .error-copy {
        color: var(--danger);
    }

    .planner-panel,
    .planner-controls-panel,
    .song-row,
    .mini-panel,
    .member-constraint,
    .band-member-row,
    .member-card,
    .instrument-option {
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: rgba(255,255,255,0.7);
        box-shadow: var(--shadow-soft);
    }

    .planner-panel {
        min-height: 100%;
        padding: 1.25rem;
        background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,247,252,0.95));
    }

    .planner-inline {
        align-items: end;
        padding: 1rem;
        border-radius: var(--radius-lg);
        background: linear-gradient(140deg, rgba(255,255,255,0.98), rgba(244,247,252,0.94));
        border: 1px solid rgba(27, 49, 80, 0.08);
    }

    .planner-count {
        flex: 1 1 0;
    }

    .planner-roll {
        min-width: 180px;
    }

    .planner-controls-panel {
        padding: 1.1rem;
    }

    .control-drawer {
        padding: 0.2rem;
    }

    .control-drawer summary,
    .instrument-library summary {
        list-style: none;
        cursor: pointer;
    }

    .control-drawer summary::-webkit-details-marker,
    .instrument-library summary::-webkit-details-marker {
        display: none;
    }

    .control-drawer summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.9rem;
    }

    .drawer-body {
        display: grid;
        gap: 0.95rem;
        padding: 0 0.9rem 0.9rem;
    }

    .song-row {
        display: grid;
        gap: 1rem;
        padding: 1rem;
        transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }

    .song-row.expanded,
    .band-member-row.expanded,
    .instrument-library[open] {
        background: linear-gradient(180deg, rgba(255,248,244,0.98), rgba(255,252,249,0.98));
        border-color: var(--accent-line);
        box-shadow: 0 18px 36px rgba(225, 91, 55, 0.12);
    }

    .song-row-summary > div:first-child,
    .band-member-summary-copy {
        display: grid;
        gap: 0.22rem;
        min-width: 0;
    }

    .song-row-summary h4,
    .band-member-summary-copy strong {
        font-size: 1rem;
    }

    .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
    }

    .chip-toggle,
    .chip-static {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        min-height: 2.1rem;
        padding: 0.48rem 0.78rem;
        border-radius: 999px;
        background: rgba(246,248,252,0.95);
        border: 1px solid rgba(27, 49, 80, 0.1);
        color: var(--ink);
    }

    .chip-x {
        min-height: auto;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--muted);
        box-shadow: none;
    }

    .chip-x:hover,
    .chip-x:active {
        transform: none;
        box-shadow: none;
        color: var(--accent);
    }

    .mini-panel,
    .instrument-library {
        padding: 0.95rem;
    }

    .instrument-library {
        display: grid;
        gap: 0.85rem;
        background: rgba(247, 249, 253, 0.9);
    }

    .instrument-library-summary div {
        display: grid;
        gap: 0.18rem;
    }

    .tuning-list {
        display: grid;
        gap: 0.55rem;
    }

    .tuning-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
    }

    .compact-actions {
        align-items: end;
    }

    .settings-section {
        padding-top: 0.9rem;
        border-top: 1px solid rgba(27, 49, 80, 0.08);
    }

    .settings-savebar {
        display: flex;
        justify-content: flex-end;
        padding-top: 0.4rem;
    }

    .setlist {
        padding-left: 1.15rem;
        margin: 0;
    }

    .song-card {
        padding: 1rem;
        border-radius: var(--radius-lg);
        background: rgba(255,255,255,0.78);
    }

    .setup-line,
    .note-line {
        color: var(--muted);
        line-height: 1.45;
    }

    .empty-state {
        min-height: 220px;
        display: grid;
        place-items: center;
        gap: 0.6rem;
        text-align: center;
        padding: 1.5rem;
        color: var(--muted);
    }

    .empty-state.loud {
        min-height: 300px;
    }

    .empty-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        justify-content: center;
    }

    .banner {
        padding: 0.95rem 1rem;
        border-radius: var(--radius-md);
        background: rgba(153, 47, 32, 0.08);
        border: 1px solid rgba(153, 47, 32, 0.14);
    }

    .modal-backdrop {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 1rem;
        background: rgba(30, 38, 52, 0.28);
        backdrop-filter: blur(8px);
    }

    .modal {
        width: min(100%, 480px);
        padding: 1.4rem;
    }

    .toast-stack {
        position: fixed;
        right: 1rem;
        bottom: 1rem;
        display: grid;
        gap: 0.65rem;
        width: min(360px, calc(100vw - 2rem));
        z-index: 20;
    }

    .toast {
        background: rgba(18, 27, 39, 0.95);
        color: #fff;
        border-radius: var(--radius-md);
        padding: 0.88rem 1rem;
        box-shadow: 0 18px 34px rgba(18, 27, 39, 0.24);
        animation: toast-in 180ms ease;
    }

    .toast.danger {
        background: rgba(122, 36, 24, 0.96);
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    @keyframes toast-in {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @media (max-width: 1180px) {
        .app-shell,
        .settings-layout,
        .generate-top,
        .panel-grid {
            grid-template-columns: 1fr;
        }

        .sidebar,
        .settings-nav {
            position: static;
            height: auto;
        }
    }

    @media (max-width: 860px) {
        .app-shell {
            padding: 0.75rem;
        }

        .sidebar {
            padding: 0.85rem;
        }

        .nav-stack {
            display: flex;
            overflow-x: auto;
            gap: 0.65rem;
            padding-bottom: 0.2rem;
        }

        .nav-card {
            min-width: 220px;
            flex: 0 0 220px;
        }

        .page-top,
        .panel-header,
        .planner-inline,
        .planner-controls-head,
        .song-row-summary,
        .band-member-summary,
        .preset-row,
        .member-head,
        .instrument-library-summary {
            flex-direction: column;
            align-items: stretch;
        }

        .form-grid,
        .settings-summary {
            grid-template-columns: 1fr;
        }

        .row-actions,
        .editor-actions,
        .empty-actions,
        .page-status {
            width: 100%;
        }

        .row-actions > button,
        .editor-actions > button,
        .empty-actions > button {
            flex: 1 1 160px;
        }

        .settings-tabs {
            display: flex;
            overflow-x: auto;
            gap: 0.6rem;
            padding-bottom: 0.2rem;
        }

        .settings-tab {
            min-width: 180px;
            flex: 0 0 180px;
        }
    }

    @media (max-width: 640px) {
        .connect-shell,
        .app-shell {
            padding: 0.65rem;
        }

        .connect-card,
        .panel,
        .sidebar,
        .modal {
            border-radius: 22px;
        }

        .planner-roll,
        .planner-count,
        .status-pill,
        .busy-chip {
            width: 100%;
        }

        .summary-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .toast-stack {
            right: 0.7rem;
            left: 0.7rem;
            width: auto;
        }
    }
</style>
