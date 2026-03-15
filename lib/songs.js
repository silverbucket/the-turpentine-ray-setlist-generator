const songList = require("../songs.json");


function clone(value) {
    return JSON.parse(JSON.stringify(value));
}


function toArray(value) {
    if (Array.isArray(value)) {
        return value.slice();
    }
    if (value === undefined || value === null) {
        return [];
    }
    return [value];
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


function Songs(list = songList) {
    this._songs = clone(list);
}


Songs.prototype.all = function () {
    return clone(this._songs);
};


Songs.prototype.getCount = function () {
    return this._songs.length;
};


Songs.prototype.listNames = function () {
    return this._songs.map((song) => song.name);
};


Songs.prototype.expandVariants = function (song, showConstraints = {}) {
    const members = this._normalizeMembers(song);
    const entries = Object.entries(members).sort(([left], [right]) => {
        return left.localeCompare(right);
    });

    if (!entries.length) {
        return [this._buildVariant(song, {})];
    }

    const options = entries.map(([memberName, memberSetup]) => {
        const instruments = this._normalizeInstrumentOptions(memberSetup, showConstraints.members && showConstraints.members[memberName]);
        if (!instruments.length) {
            return [];
        }
        return instruments.flatMap((instrumentSetup) => {
            const tunings = toArray(instrumentSetup.tuning);
            const tuningOptions = tunings.length ? tunings : [null];
            return tuningOptions.map((tuning) => {
                return {
                    member: memberName,
                    instrument: instrumentSetup.name || instrumentSetup.instrument,
                    tuning,
                    capo: instrumentSetup.capo || 0,
                    picking: Boolean(instrumentSetup.picking)
                };
            });
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
};


Songs.prototype._normalizeMembers = function (song) {
    if (song.members) {
        return song.members;
    }

    const members = {};
    const instruments = song.instruments || {};

    if (instruments.banjo || instruments.resonator) {
        members.nick = {
            instruments: [instruments.banjo, instruments.resonator].filter(Boolean).map((setup, index) => {
                const name = index === 0 && instruments.banjo ? "banjo" : "resonator";
                return Object.assign({ name }, setup);
            })
        };
    }

    if (instruments.guitar) {
        members.mark = {
            instruments: [
                Object.assign({ name: "guitar" }, instruments.guitar)
            ]
        };
    }

    return members;
};


Songs.prototype._normalizeInstrumentOptions = function (memberSetup, memberConstraints) {
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
};


Songs.prototype._buildVariant = function (song, performance) {
    return {
        id: song.id,
        name: song.name,
        energy: song.energy || 2,
        cover: Boolean(song.cover),
        instrumental: Boolean(song.instrumental),
        key: song.key || null,
        performance
    };
};


module.exports = Songs;
