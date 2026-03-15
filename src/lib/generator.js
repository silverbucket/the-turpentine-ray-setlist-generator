import { clone, deepMerge, toArray } from "./utils.js";

function clampInteger(value, fallback, minimum) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    return Math.max(minimum, parsed);
}


function clampFloat(value, fallback, minimum) {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
        return fallback;
    }
    return Math.max(minimum, parsed);
}


function merge(left, right) {
    return Object.assign({}, left, right);
}


function createRng(seed) {
    let state = (seed >>> 0) || 1;
    return function nextRandom() {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}


function cartesianProduct(groups) {
    return groups.reduce((product, group) => {
        const result = [];
        product.forEach((base) => {
            group.forEach((entry) => {
                result.push(base.concat(entry));
            });
        });
        return result;
    }, [[]]);
}


function zeroMap(keys) {
    return keys.reduce((result, key) => {
        result[key] = 0;
        return result;
    }, {});
}


function compareStates(left, right) {
    const leftRank = left.rankScore === undefined ? left.score : left.rankScore;
    const rightRank = right.rankScore === undefined ? right.score : right.rankScore;
    if (leftRank !== rightRank) {
        return leftRank - rightRank;
    }
    if (left.coverCount !== right.coverCount) {
        return left.coverCount - right.coverCount;
    }
    if (left.instrumentalCount !== right.instrumentalCount) {
        return left.instrumentalCount - right.instrumentalCount;
    }
    const leftNames = left.items.map((item) => item.name).join("|");
    const rightNames = right.items.map((item) => item.name).join("|");
    return leftNames.localeCompare(rightNames);
}


class SongsCatalog {
    constructor(list = []) {
        this._songs = clone(list);
    }

    all() {
        return clone(this._songs);
    }

    expandVariants(song, showConstraints = {}) {
        const members = song.members || {};
        const entries = Object.entries(members).sort(([left], [right]) => {
            return left.localeCompare(right);
        });

        if (!entries.length) {
            return [this._buildVariant(song, {})];
        }

        const options = entries.map(([memberName, memberSetup]) => {
            const instruments = this._normalizeInstrumentOptions(
                memberSetup,
                showConstraints.members && showConstraints.members[memberName]
            );

            if (!instruments.length) {
                return [];
            }

            return instruments.flatMap((instrumentSetup) => {
                const tunings = toArray(instrumentSetup.tuning);
                const tuningOptions = tunings.length ? tunings : [null];
                return tuningOptions.map((tuning) => ({
                    member: memberName,
                    instrument: instrumentSetup.name || instrumentSetup.instrument,
                    tuning,
                    capo: instrumentSetup.capo || 0,
                    picking: Boolean(instrumentSetup.picking)
                }));
            });
        });

        if (options.some((group) => !group.length)) {
            return [];
        }

        return cartesianProduct(options).map((combo) => {
            const performance = {};

            combo.forEach((entry) => {
                performance[entry.member] = {
                    instrument: entry.instrument,
                    tuning: entry.tuning,
                    capo: entry.capo,
                    picking: entry.picking
                };
            });

            return this._buildVariant(song, performance);
        });
    }

    _normalizeInstrumentOptions(memberSetup, memberConstraints) {
        const allowedInstruments = toArray(memberConstraints && memberConstraints.allowedInstruments);
        const allowedTunings = (memberConstraints && memberConstraints.allowedTunings) || {};
        const options = Array.isArray(memberSetup.instruments)
            ? memberSetup.instruments.slice()
            : (memberSetup.instrument ? [memberSetup.instrument] : []);

        return options.filter((option) => {
            const instrumentName = option.name || option.instrument;
            const optionTunings = toArray(option.tuning);

            if (allowedInstruments.length && allowedInstruments.indexOf(instrumentName) < 0) {
                return false;
            }

            if (!allowedTunings[instrumentName]) {
                return true;
            }

            const validTunings = toArray(allowedTunings[instrumentName]);
            if (!optionTunings.length) {
                return true;
            }

            return optionTunings.some((tuning) => validTunings.indexOf(tuning) >= 0);
        }).map((option) => {
            const instrumentName = option.name || option.instrument;
            const constrainedOption = clone(option);

            if (allowedTunings[instrumentName]) {
                const validTunings = toArray(allowedTunings[instrumentName]);
                const optionTunings = toArray(option.tuning);
                const filteredTunings = optionTunings.filter((tuning) => validTunings.indexOf(tuning) >= 0);

                if (filteredTunings.length) {
                    constrainedOption.tuning = filteredTunings;
                }
            }

            return constrainedOption;
        });
    }

    _buildVariant(song, performance) {
        return {
            id: String(song.id),
            name: song.name,
            energy: song.energy || 2,
            cover: Boolean(song.cover),
            instrumental: Boolean(song.instrumental),
            key: song.key || null,
            performance
        };
    }
}


class SetList {
    constructor(songs, config, options = {}) {
        this._config = config || {};
        this._songs = new SongsCatalog(songs);
        this._propNames = Object.keys(this._config.props || {});
        this._propConfig = this._config.props || {};
        this._weights = merge(DEFAULT_WEIGHTS, this._config.general?.weighting || {});
        this._options = this._normalizeOptions(options);
        this._show = deepMerge(this._config.show || {}, this._options.show || {});
        this._seed = this._normalizeSeed(this._options.seed);
        this._rng = createRng(this._seed);
        this._randomness = merge(DEFAULT_RANDOMNESS, this._config.general?.randomness || {});
        this._randomness = merge(this._randomness, this._options.randomness || {});
        this._catalog = this._songs.all().filter((song) => {
            return this._songs.expandVariants(song, this._show).length > 0;
        });
        this._songBiasById = this._buildSongBiases(this._catalog);
        this._count = Math.min(this._options.count, this._catalog.length);
        this._list = [];
        this._summary = {
            score: 0,
            covers: 0,
            instrumentals: 0,
            changes: zeroMap(this._propNames)
        };
        this._build();
    }

    _normalizeOptions(options) {
        if (typeof options === "number") {
            options = { count: options };
        }

        const limits = this._config.general?.limits || {};
        const normalized = merge({
            count: this._config.general?.count || 15,
            beamWidth: this._config.general?.beamWidth || 64,
            maxCovers: limits.covers || 2,
            maxInstrumentals: limits.instrumentals || 2
        }, options || {});

        normalized.count = clampInteger(normalized.count, this._config.general?.count || 15, 1);
        normalized.beamWidth = clampInteger(normalized.beamWidth, this._config.general?.beamWidth || 64, 1);
        normalized.maxCovers = clampInteger(normalized.maxCovers, limits.covers || 2, 0);
        normalized.maxInstrumentals = clampInteger(normalized.maxInstrumentals, limits.instrumentals || 2, 0);
        normalized.show = deepMerge(this._config.show || {}, normalized.show || {});
        return normalized;
    }

    _normalizeSeed(seed) {
        if (seed === undefined || seed === null || seed === "") {
            return Math.floor(Date.now() + (Math.random() * 1000000));
        }
        const parsed = Number.parseInt(seed, 10);
        if (Number.isNaN(parsed)) {
            let hashed = 0;
            String(seed).split("").forEach((char) => {
                hashed = ((hashed << 5) - hashed) + char.charCodeAt(0);
                hashed |= 0;
            });
            return hashed >>> 0;
        }
        return parsed >>> 0;
    }

    _randomJitter(amount) {
        const magnitude = clampFloat(amount, 0, 0);
        if (!magnitude) {
            return 0;
        }
        return (this._rng() - 0.5) * 2 * magnitude;
    }

    _shuffle(items) {
        const list = items.slice();
        for (let index = list.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(this._rng() * (index + 1));
            const temp = list[index];
            list[index] = list[swapIndex];
            list[swapIndex] = temp;
        }
        return list;
    }

    _buildSongBiases(songs) {
        const magnitude = clampFloat(this._randomness.songBias, 3, 0);
        return songs.reduce((result, song) => {
            result[song.id] = this._randomJitter(magnitude);
            return result;
        }, {});
    }

    _songBias(songId) {
        return this._songBiasById[songId] || 0;
    }

    _initialState() {
        return {
            items: [],
            usedIds: {},
            score: 0,
            coverCount: 0,
            instrumentalCount: 0,
            energyStreak: 0,
            lastEnergy: null,
            rankScore: 0,
            propChangeCounts: zeroMap(this._propNames),
            propStreaks: zeroMap(this._propNames),
            changeTotals: zeroMap(this._propNames)
        };
    }

    _build() {
        let states = [this._initialState()];
        const catalog = this._randomness.shuffleCatalog ? this._shuffle(this._catalog) : this._catalog.slice();

        for (let position = 1; position <= this._count; position += 1) {
            const nextStates = [];

            states.forEach((state) => {
                catalog.forEach((song) => {
                    if (state.usedIds[song.id]) {
                        return;
                    }

                    const nextState = this._buildNextState(state, song, position);
                    if (nextState) {
                        nextStates.push(nextState);
                    }
                });
            });

            if (!nextStates.length) {
                break;
            }

            nextStates.sort(compareStates);
            states = this._selectBeamStates(nextStates);
        }

        const best = this._pickFinalState(states);
        const diversifiedItems = this._diversifyCompatibleRuns(best.items);
        const finalized = this._finalizeItems(diversifiedItems);
        this._list = finalized.items;
        this._summary = finalized.summary;
    }

    _selectBeamStates(nextStates) {
        if (nextStates.length <= this._options.beamWidth) {
            return nextStates.slice();
        }

        const multiplier = clampInteger(this._randomness.beamChoicePoolMultiplier, 6, 1);
        const poolSize = Math.min(nextStates.length, this._options.beamWidth * multiplier);
        const pool = nextStates.slice(0, poolSize);
        const selected = [];
        const lastSongCounts = {};
        const temperature = clampFloat(this._randomness.beamTemperature, 1.1, 0.01);
        const maxStatesPerLastSong = clampInteger(this._randomness.maxStatesPerLastSong, 24, 1);

        while (pool.length && selected.length < this._options.beamWidth) {
            const bestRank = pool[0].rankScore === undefined ? pool[0].score : pool[0].rankScore;
            const weights = pool.map((state) => {
                const rank = state.rankScore === undefined ? state.score : state.rankScore;
                return Math.exp(-(rank - bestRank) / temperature);
            });
            const total = weights.reduce((sum, weight) => sum + weight, 0);
            let target = this._rng() * total;
            let chosenIndex = pool.length - 1;

            for (let index = 0; index < pool.length; index += 1) {
                target -= weights[index];
                if (target <= 0) {
                    chosenIndex = index;
                    break;
                }
            }

            const chosen = pool.splice(chosenIndex, 1)[0];
            const lastItem = chosen.items[chosen.items.length - 1];
            const lastSongId = lastItem ? lastItem.id : "none";
            const used = lastSongCounts[lastSongId] || 0;

            if (used >= maxStatesPerLastSong) {
                continue;
            }

            lastSongCounts[lastSongId] = used + 1;
            selected.push(chosen);
        }

        if (selected.length < this._options.beamWidth) {
            const fallback = nextStates.filter((state) => selected.indexOf(state) < 0);
            while (fallback.length && selected.length < this._options.beamWidth) {
                selected.push(fallback.shift());
            }
        }

        return selected.sort(compareStates);
    }

    _pickFinalState(states) {
        if (!states.length) {
            return this._initialState();
        }

        const ordered = states.slice().sort((left, right) => {
            if (left.score !== right.score) {
                return left.score - right.score;
            }
            return compareStates(left, right);
        });
        const poolSize = clampInteger(this._randomness.finalChoicePool, 12, 1);
        const pool = ordered.slice(0, poolSize);

        if (pool.length === 1) {
            return pool[0];
        }

        const bestScore = pool[0].score;
        const temperature = clampFloat(this._randomness.temperature, 0.85, 0.01);
        const weights = pool.map((state) => {
            return Math.exp(-(state.score - bestScore) / temperature);
        });
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let target = this._rng() * total;

        for (let index = 0; index < pool.length; index += 1) {
            target -= weights[index];
            if (target <= 0) {
                return pool[index];
            }
        }

        return pool[pool.length - 1];
    }

    _diversifyCompatibleRuns(items) {
        const result = items.slice();

        for (let start = 0; start < result.length;) {
            const signature = this._performanceSignature(result[start].performance);
            let end = start + 1;

            while (end < result.length && this._performanceSignature(result[end].performance) === signature) {
                end += 1;
            }

            if ((end - start) > 1) {
                const reordered = this._reorderRun(result.slice(start, end), start + 1);
                for (let index = 0; index < reordered.length; index += 1) {
                    result[start + index] = reordered[index];
                }
            }

            start = end;
        }

        return result;
    }

    _reorderRun(runItems, startPosition) {
        const remaining = runItems.slice();
        const ordered = [];
        const temperature = clampFloat(this._randomness.blockShuffleTemperature, 1.4, 0.01);

        for (let offset = 0; offset < runItems.length; offset += 1) {
            const position = startPosition + offset;
            const ranked = remaining.map((item) => {
                const distance = Math.abs(item.energy - this._targetEnergy(position)) * this._weights.energyTarget;
                const score = distance + this._songBias(item.id);
                return { item, score };
            }).sort((left, right) => left.score - right.score);

            const bestScore = ranked[0].score;
            const weights = ranked.map((entry) => Math.exp(-(entry.score - bestScore) / temperature));
            const total = weights.reduce((sum, weight) => sum + weight, 0);
            let target = this._rng() * total;
            let chosenIndex = ranked.length - 1;

            for (let index = 0; index < ranked.length; index += 1) {
                target -= weights[index];
                if (target <= 0) {
                    chosenIndex = index;
                    break;
                }
            }

            const chosen = ranked[chosenIndex].item;
            ordered.push(chosen);
            remaining.splice(remaining.indexOf(chosen), 1);
        }

        return ordered;
    }

    _performanceSignature(performance) {
        return Object.keys(performance).sort().map((member) => {
            const setup = performance[member];
            return [
                member,
                setup.instrument || "",
                setup.tuning || "",
                String(setup.capo || 0),
                String(Boolean(setup.picking))
            ].join("|");
        }).join("::");
    }

    _finalizeItems(items) {
        let state = this._initialState();
        const finalizedItems = [];

        items.forEach((item, index) => {
            const position = index + 1;
            const variant = {
                id: item.id,
                name: item.name,
                energy: item.energy,
                cover: item.cover,
                instrumental: item.instrumental,
                key: item.key,
                performance: item.performance
            };
            const prevItem = finalizedItems[finalizedItems.length - 1] || null;
            const propTransition = this._scoreConfiguredProps(prevItem, variant);
            const nextPropState = this._advancePropState(state, propTransition.changes, prevItem);
            const positionScore = this._scorePosition(variant, position);
            const context = this._scoreContext(state, variant);
            const transitionScore = propTransition.score + this._scoreEnergyJump(prevItem, variant);
            const incrementalScore = transitionScore + positionScore.score + context.score + this._songBias(variant.id);

            const finalized = {
                id: variant.id,
                name: variant.name,
                energy: variant.energy,
                cover: variant.cover,
                instrumental: variant.instrumental,
                key: variant.key,
                performance: variant.performance,
                position,
                incrementalScore,
                cumulativeScore: state.score + incrementalScore,
                transitionNotes: propTransition.notes.concat(this._energyJumpNotes(prevItem, variant)),
                positionNotes: positionScore.notes,
                contextNotes: context.notes,
                propChanges: propTransition.changes
            };

            finalizedItems.push(finalized);
            state = {
                items: finalizedItems.slice(),
                usedIds: merge(state.usedIds, { [variant.id]: true }),
                score: state.score + incrementalScore,
                rankScore: state.score + incrementalScore,
                coverCount: state.coverCount + Number(Boolean(variant.cover)),
                instrumentalCount: state.instrumentalCount + Number(Boolean(variant.instrumental)),
                energyStreak: context.energyStreak,
                lastEnergy: variant.energy,
                propChangeCounts: nextPropState.propChangeCounts,
                propStreaks: nextPropState.propStreaks,
                changeTotals: nextPropState.changeTotals
            };
        });

        return {
            items: finalizedItems,
            summary: {
                score: state.score,
                covers: state.coverCount,
                instrumentals: state.instrumentalCount,
                changes: state.changeTotals
            }
        };
    }

    _buildNextState(state, song, position) {
        const nextCoverCount = state.coverCount + Number(Boolean(song.cover));
        const nextInstrumentalCount = state.instrumentalCount + Number(Boolean(song.instrumental));

        if (nextCoverCount > this._options.maxCovers) {
            return null;
        }
        if (nextInstrumentalCount > this._options.maxInstrumentals) {
            return null;
        }

        const bestVariant = this._findBestVariant(state, song, position);
        if (!bestVariant) {
            return null;
        }

        return {
            items: state.items.concat(bestVariant.item),
            usedIds: merge(state.usedIds, { [song.id]: true }),
            score: state.score + bestVariant.item.incrementalScore,
            rankScore: state.score + bestVariant.item.incrementalScore + this._randomJitter(this._randomness.stateJitter),
            coverCount: nextCoverCount,
            instrumentalCount: nextInstrumentalCount,
            energyStreak: bestVariant.energyStreak,
            lastEnergy: bestVariant.item.energy,
            propChangeCounts: bestVariant.propChangeCounts,
            propStreaks: bestVariant.propStreaks,
            changeTotals: bestVariant.changeTotals
        };
    }

    _findBestVariant(state, song, position) {
        const prevItem = state.items[state.items.length - 1] || null;
        let best = null;

        this._songs.expandVariants(song, this._show).forEach((variant) => {
            const propTransition = this._scoreConfiguredProps(prevItem, variant);
            if (!this._isAllowedByPropRules(state, propTransition.changes, prevItem, position)) {
                return;
            }

            const nextPropState = this._advancePropState(state, propTransition.changes, prevItem);
            const positionScore = this._scorePosition(variant, position);
            const context = this._scoreContext(state, variant);
            const transitionScore = propTransition.score + this._scoreEnergyJump(prevItem, variant);
            const incrementalScore = transitionScore + positionScore.score + context.score + this._songBias(variant.id);
            const exploratoryScore = incrementalScore + this._randomJitter(this._randomness.variantJitter);
            const signature = this._variantSignature(variant);

            if (!best || exploratoryScore < best.explorationScore || (
                exploratoryScore === best.explorationScore && signature < best.signature
            )) {
                best = {
                    signature,
                    explorationScore: exploratoryScore,
                    energyStreak: context.energyStreak,
                    propChangeCounts: nextPropState.propChangeCounts,
                    propStreaks: nextPropState.propStreaks,
                    changeTotals: nextPropState.changeTotals,
                    item: {
                        id: variant.id,
                        name: variant.name,
                        energy: variant.energy,
                        cover: variant.cover,
                        instrumental: variant.instrumental,
                        key: variant.key,
                        performance: variant.performance,
                        position,
                        incrementalScore,
                        cumulativeScore: state.score + incrementalScore,
                        transitionNotes: propTransition.notes.concat(this._energyJumpNotes(prevItem, variant)),
                        positionNotes: positionScore.notes,
                        contextNotes: context.notes,
                        propChanges: propTransition.changes
                    }
                };
            }
        });

        return best;
    }

    _scoreConfiguredProps(prevItem, nextVariant) {
        const changes = {};
        const notes = [];
        let score = 0;

        this._propNames.forEach((propName) => {
            const change = this._detectPropChange(prevItem, nextVariant, propName, this._propConfig[propName]);
            changes[propName] = change;
            if (change.changed) {
                score += change.magnitude * this._getPropWeight(propName);
                Array.prototype.push.apply(notes, change.notes);
            }
        });

        return { score, notes, changes };
    }

    _detectPropChange(prevItem, nextVariant, propName, rule) {
        if (!prevItem) {
            return {
                changed: false,
                magnitude: 0,
                notes: []
            };
        }

        const kind = rule.kind || this._inferPropKind(propName);
        if (kind === "instrumentSet") {
            return this._detectInstrumentSetChange(prevItem, nextVariant);
        }
        if (kind === "instrumentDelta") {
            return this._detectInstrumentValueChange(prevItem, nextVariant, rule, true);
        }
        if (kind === "instrumentBoolean") {
            return this._detectInstrumentValueChange(prevItem, nextVariant, rule, false, true);
        }
        return this._detectInstrumentValueChange(prevItem, nextVariant, rule, false, false);
    }

    _inferPropKind(propName) {
        if (propName === "instruments") {
            return "instrumentSet";
        }
        if (propName === "capo") {
            return "instrumentDelta";
        }
        if (propName === "picking") {
            return "instrumentBoolean";
        }
        return "instrumentField";
    }

    _detectInstrumentValueChange(prevItem, nextVariant, rule, scaleByDelta, coerceBoolean) {
        const field = rule.field;
        const notes = [];
        let magnitude = 0;
        const sharedMembers = Object.keys(prevItem.performance).filter((member) => {
            return Object.prototype.hasOwnProperty.call(nextVariant.performance, member);
        }).sort();

        sharedMembers.forEach((member) => {
            const prevValue = prevItem.performance[member][field];
            const nextValue = nextVariant.performance[member][field];
            const left = coerceBoolean ? Boolean(prevValue) : this._normalizeValue(prevValue);
            const right = coerceBoolean ? Boolean(nextValue) : this._normalizeValue(nextValue);

            if (left === right) {
                return;
            }

            const amount = scaleByDelta ? Math.abs((prevValue || 0) - (nextValue || 0)) : 1;
            if (!amount) {
                return;
            }

            magnitude += amount;
            notes.push(`${member} ${field} ${this._displayValue(prevValue)} -> ${this._displayValue(nextValue)}`);
        });

        return {
            changed: magnitude > 0,
            magnitude,
            notes
        };
    }

    _detectInstrumentSetChange(prevItem, nextVariant) {
        const members = new Set([
            ...Object.keys(prevItem.performance),
            ...Object.keys(nextVariant.performance)
        ]);
        const notes = [];
        let magnitude = 0;

        Array.from(members).sort().forEach((member) => {
            const previous = prevItem.performance[member];
            const next = nextVariant.performance[member];

            if (!previous || !next) {
                magnitude += 1;
                notes.push(`${member} instrument on/off`);
                return;
            }

            if (previous.instrument !== next.instrument) {
                magnitude += 1;
                notes.push(`${member} instrument ${previous.instrument} -> ${next.instrument}`);
            }
        });

        return {
            changed: magnitude > 0,
            magnitude,
            notes
        };
    }

    _normalizeValue(value) {
        if (value === undefined || value === null) {
            return "";
        }
        return String(value);
    }

    _displayValue(value) {
        if (value === undefined || value === null || value === "") {
            return "default";
        }
        return String(value);
    }

    _getPropWeight(propName) {
        const rule = this._propConfig[propName] || {};
        const weightKey = rule.weightKey || propName;
        return this._weights[weightKey] || 0;
    }

    _isAllowedByPropRules(state, propChanges, prevItem, position) {
        const isLastSong = position === this._count;

        for (let index = 0; index < this._propNames.length; index += 1) {
            const propName = this._propNames[index];
            const rule = this._propConfig[propName] || {};
            const change = propChanges[propName];

            if (!change.changed || !prevItem) {
                continue;
            }
            if (rule.maxChanges !== undefined && state.propChangeCounts[propName] >= rule.maxChanges) {
                return false;
            }
            if (isLastSong && rule.allowChangeOnLastSong) {
                continue;
            }
            if (rule.minStreak !== undefined && state.propStreaks[propName] < rule.minStreak) {
                return false;
            }
        }

        return true;
    }

    _advancePropState(state, propChanges, prevItem) {
        const propChangeCounts = clone(state.propChangeCounts);
        const propStreaks = clone(state.propStreaks);
        const changeTotals = clone(state.changeTotals);

        this._propNames.forEach((propName) => {
            const change = propChanges[propName];
            if (!prevItem) {
                propStreaks[propName] = 1;
                return;
            }

            if (change.changed) {
                propChangeCounts[propName] += 1;
                propStreaks[propName] = 1;
                changeTotals[propName] += change.magnitude;
                return;
            }

            propStreaks[propName] += 1;
        });

        return {
            propChangeCounts,
            propStreaks,
            changeTotals
        };
    }

    _scoreEnergyJump(prevItem, nextVariant) {
        if (!prevItem) {
            return 0;
        }
        if (Math.abs(prevItem.energy - nextVariant.energy) > 1) {
            return this._weights.bigEnergyJump;
        }
        return 0;
    }

    _energyJumpNotes(prevItem, nextVariant) {
        if (!prevItem) {
            return [];
        }
        if (Math.abs(prevItem.energy - nextVariant.energy) > 1) {
            return [`energy jump ${prevItem.energy} -> ${nextVariant.energy}`];
        }
        return [];
    }

    _scorePosition(song, position) {
        const notes = [];
        let score = Math.abs(song.energy - this._targetEnergy(position)) * this._weights.energyTarget;
        const orderLabel = this._findOrderLabel(position);
        const orderRules = (this._config.general?.order && this._config.general.order[orderLabel]) || [];

        if (score > 0) {
            notes.push(`energy target ${this._targetEnergy(position).toFixed(1)}`);
        }

        orderRules.forEach(([name, expected]) => {
            const accepted = Array.isArray(expected) ? expected : [expected];
            const actual = song[name] === undefined ? false : song[name];

            if (accepted.indexOf(actual) < 0) {
                score += this._weights.positionMiss;
                notes.push(`${orderLabel} wants ${name}=${accepted.join("/")}`);
            }
        });

        if (song.cover && position <= 2) {
            score += this._weights.earlyCover;
            notes.push("cover held back from the opener");
        }

        if (song.instrumental && position <= 2) {
            score += this._weights.earlyInstrumental;
            notes.push("instrumental held back from the opener");
        }

        return { score, notes };
    }

    _scoreContext(state, variant) {
        const notes = [];
        let score = 0;
        let energyStreak = 1;

        if (state.lastEnergy === variant.energy) {
            score += this._weights.repeatEnergy;
            energyStreak = state.energyStreak + 1;
            notes.push(`repeat energy ${variant.energy}`);
        }

        if (energyStreak >= 3) {
            score += (energyStreak - 2) * this._weights.energyStreak;
            notes.push(`energy streak ${energyStreak}`);
        }

        return { score, notes, energyStreak };
    }

    _targetEnergy(position) {
        const ratio = position / this._count;
        if (ratio <= 0.2) {
            return 1.5;
        }
        if (ratio <= 0.5) {
            return 2;
        }
        if (ratio <= 0.75) {
            return 2.5;
        }
        return 3;
    }

    _findOrderLabel(position) {
        if (position === 1) {
            return "first";
        }
        if (position === 2) {
            return "second";
        }
        if (position === this._count - 1) {
            return "penultimate";
        }
        if (position === this._count) {
            return "last";
        }
        return undefined;
    }

    _variantSignature(variant) {
        const parts = [variant.name];
        Object.keys(variant.performance).sort().forEach((member) => {
            const setup = variant.performance[member];
            parts.push([
                member,
                setup.instrument || "",
                setup.tuning || "",
                String(setup.capo || 0),
                String(Boolean(setup.picking))
            ].join("|"));
        });
        return parts.join("|");
    }

    toJSON() {
        return {
            options: this._options,
            seed: this._seed,
            summary: this._summary,
            songs: this._list
        };
    }
}


const DEFAULT_WEIGHTS = {
    positionMiss: 8,
    energyTarget: 3,
    repeatEnergy: 2,
    energyStreak: 4,
    bigEnergyJump: 3,
    earlyCover: 6,
    earlyInstrumental: 4
};

const DEFAULT_RANDOMNESS = {
    variantJitter: 1.5,
    stateJitter: 1,
    finalChoicePool: 12,
    temperature: 0.85,
    shuffleCatalog: true,
    songBias: 3,
    beamChoicePoolMultiplier: 6,
    beamTemperature: 1.1,
    maxStatesPerLastSong: 24,
    blockShuffleTemperature: 1.4
};


export function generateSetlist(songs, config, options = {}) {
    const generator = new SetList(songs, config, options);
    return generator.toJSON();
}
