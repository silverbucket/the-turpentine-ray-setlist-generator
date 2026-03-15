const config = require("../config.json");
const Songs = require("./songs.js");


const DEFAULT_OPTIONS = {
    count: config.general.count || 15,
    beamWidth: config.general.beamWidth || 64,
    maxCovers: (config.general.limits && config.general.limits.covers) || 2,
    maxInstrumentals: (config.general.limits && config.general.limits.instrumentals) || 2
};

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
    shuffleCatalog: true
};


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


function deepMerge(left, right) {
    const base = clone(left || {});
    Object.keys(right || {}).forEach((key) => {
        const leftValue = base[key];
        const rightValue = right[key];

        if (
            leftValue &&
            rightValue &&
            typeof leftValue === "object" &&
            typeof rightValue === "object" &&
            !Array.isArray(leftValue) &&
            !Array.isArray(rightValue)
        ) {
            base[key] = deepMerge(leftValue, rightValue);
            return;
        }

        base[key] = clone(rightValue);
    });
    return base;
}


function clone(value) {
    return JSON.parse(JSON.stringify(value));
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


function SetList(options = {}) {
    this._songs = new Songs();
    this._propNames = Object.keys(config.props || {});
    this._propConfig = config.props || {};
    this._weights = merge(DEFAULT_WEIGHTS, config.general.weighting || {});
    this._options = this._normalizeOptions(options);
    this._show = deepMerge(config.show || {}, this._options.show || {});
    this._seed = this._normalizeSeed(this._options.seed);
    this._rng = createRng(this._seed);
    this._randomness = merge(DEFAULT_RANDOMNESS, config.general.randomness || {});
    this._randomness = merge(this._randomness, this._options.randomness || {});
    this._catalog = this._songs.all().filter((song) => {
        return this._songs.expandVariants(song, this._show).length > 0;
    });
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


SetList.prototype._normalizeOptions = function (options) {
    if (typeof options === "number") {
        options = { count: options };
    }

    const normalized = merge(DEFAULT_OPTIONS, options || {});
    normalized.count = clampInteger(normalized.count, DEFAULT_OPTIONS.count, 1);
    normalized.beamWidth = clampInteger(normalized.beamWidth, DEFAULT_OPTIONS.beamWidth, 1);
    normalized.maxCovers = clampInteger(normalized.maxCovers, DEFAULT_OPTIONS.maxCovers, 0);
    normalized.maxInstrumentals = clampInteger(normalized.maxInstrumentals, DEFAULT_OPTIONS.maxInstrumentals, 0);
    normalized.seed = normalized.seed;
    normalized.show = deepMerge(config.show || {}, normalized.show || {});

    return normalized;
};


SetList.prototype._normalizeSeed = function (seed) {
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
};


SetList.prototype._randomJitter = function (amount) {
    const magnitude = clampFloat(amount, 0, 0);
    if (!magnitude) {
        return 0;
    }
    return (this._rng() - 0.5) * 2 * magnitude;
};


SetList.prototype._shuffle = function (items) {
    const list = items.slice();

    for (let index = list.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(this._rng() * (index + 1));
        const temp = list[index];
        list[index] = list[swapIndex];
        list[swapIndex] = temp;
    }

    return list;
};


SetList.prototype._initialState = function () {
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
};


SetList.prototype._build = function () {
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
        states = nextStates.slice(0, this._options.beamWidth);
    }

    const best = this._pickFinalState(states);
    this._list = best.items;
    this._summary = {
        score: best.score,
        covers: best.coverCount,
        instrumentals: best.instrumentalCount,
        changes: best.changeTotals
    };
};


SetList.prototype._pickFinalState = function (states) {
    if (!states.length) {
        return this._initialState();
    }

    const ordered = states.slice().sort((left, right) => {
        if (left.score !== right.score) {
            return left.score - right.score;
        }
        return compareStates(left, right);
    });
    const poolSize = clampInteger(this._randomness.finalChoicePool, DEFAULT_RANDOMNESS.finalChoicePool, 1);
    const pool = ordered.slice(0, poolSize);

    if (pool.length === 1) {
        return pool[0];
    }

    const bestScore = pool[0].score;
    const temperature = clampFloat(this._randomness.temperature, DEFAULT_RANDOMNESS.temperature, 0.01);
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
};


SetList.prototype._buildNextState = function (state, song, position) {
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
};


SetList.prototype._findBestVariant = function (state, song, position) {
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
        const incrementalScore = transitionScore + positionScore.score + context.score;
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
};


SetList.prototype._scoreConfiguredProps = function (prevItem, nextVariant) {
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
};


SetList.prototype._detectPropChange = function (prevItem, nextVariant, propName, rule) {
    if (!prevItem) {
        return {
            changed: false,
            magnitude: 0,
            notes: []
        };
    }

    const kind = rule.kind || this._inferPropKind(propName);

    if (kind === "instrumentSet") {
        return this._detectInstrumentSetChange(prevItem, nextVariant, rule);
    }

    if (kind === "instrumentDelta") {
        return this._detectInstrumentValueChange(prevItem, nextVariant, rule, true);
    }

    if (kind === "instrumentBoolean") {
        return this._detectInstrumentValueChange(prevItem, nextVariant, rule, false, true);
    }

    return this._detectInstrumentValueChange(prevItem, nextVariant, rule, false, false);
};


SetList.prototype._inferPropKind = function (propName) {
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
};


SetList.prototype._detectInstrumentValueChange = function (prevItem, nextVariant, rule, scaleByDelta, coerceBoolean) {
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

        const amount = scaleByDelta
            ? Math.abs((prevValue || 0) - (nextValue || 0))
            : 1;

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
};


SetList.prototype._detectInstrumentSetChange = function (prevItem, nextVariant, rule) {
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
};


SetList.prototype._normalizeValue = function (value) {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
};


SetList.prototype._displayValue = function (value) {
    if (value === undefined || value === null || value === "") {
        return "default";
    }
    return String(value);
};


SetList.prototype._getPropWeight = function (propName) {
    const rule = this._propConfig[propName] || {};
    const weightKey = rule.weightKey || propName;
    return this._weights[weightKey] || 0;
};


SetList.prototype._isAllowedByPropRules = function (state, propChanges, prevItem, position) {
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
};


SetList.prototype._advancePropState = function (state, propChanges, prevItem) {
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
};


SetList.prototype._scoreEnergyJump = function (prevItem, nextVariant) {
    if (!prevItem) {
        return 0;
    }
    if (Math.abs(prevItem.energy - nextVariant.energy) > 1) {
        return this._weights.bigEnergyJump;
    }
    return 0;
};


SetList.prototype._energyJumpNotes = function (prevItem, nextVariant) {
    if (!prevItem) {
        return [];
    }
    if (Math.abs(prevItem.energy - nextVariant.energy) > 1) {
        return [`energy jump ${prevItem.energy} -> ${nextVariant.energy}`];
    }
    return [];
};


SetList.prototype._scorePosition = function (song, position) {
    const notes = [];
    let score = Math.abs(song.energy - this._targetEnergy(position)) * this._weights.energyTarget;
    const orderLabel = this._findOrderLabel(position);
    const orderRules = (config.general.order && config.general.order[orderLabel]) || [];

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
};


SetList.prototype._scoreContext = function (state, variant) {
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
};


SetList.prototype._targetEnergy = function (position) {
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
};


SetList.prototype._findOrderLabel = function (position) {
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
};


SetList.prototype._variantSignature = function (variant) {
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
};


SetList.prototype.toJSON = function () {
    return {
        options: this._options,
        seed: this._seed,
        summary: this._summary,
        songs: this._list
    };
};


SetList.prototype.print = function () {
    console.log(`- total songs: ${this._list.length}`);
    console.log(`- total score: ${this._summary.score.toFixed(1)}`);
    console.log(`- covers: ${this._summary.covers}`);
    console.log(`- instrumentals: ${this._summary.instrumentals}`);

    this._propNames.forEach((propName) => {
        const rule = this._propConfig[propName] || {};
        console.log(`- ${rule.summaryLabel || propName}: ${this._summary.changes[propName]}`);
    });

    console.log();

    this._list.forEach((item, index) => {
        const setup = Object.keys(item.performance).sort().map((member) => {
            const performance = item.performance[member];
            const details = [];

            if (performance.instrument) {
                details.push(performance.instrument);
            }
            if (performance.tuning) {
                details.push(performance.tuning);
            }
            if (performance.capo) {
                details.push(`capo ${performance.capo}`);
            }
            if (performance.picking) {
                details.push("picked");
            }
            if (!details.length) {
                details.push("default");
            }

            return `${member}: ${details.join(", ")}`;
        });

        const notes = item.transitionNotes
            .concat(item.contextNotes)
            .concat(item.positionNotes);

        console.log(`${index + 1}. ${item.name} [energy ${item.energy}]`);
        console.log(`   setup: ${setup.join(" | ")}`);
        if (notes.length) {
            console.log(`   notes: ${notes.join("; ")}`);
        }
        console.log(`   score: +${item.incrementalScore.toFixed(1)} (total ${item.cumulativeScore.toFixed(1)})`);
        console.log();
    });
};


module.exports = SetList;
