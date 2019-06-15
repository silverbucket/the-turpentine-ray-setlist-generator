const config = require("../config.json");
const Songs = require("./songs.js");
const songs = new Songs();


const MAX_ATTEMPTS = 3;


function match_keys(a1, a2) {
    // console.log(`... matching ${a1.sort()} against ${a2.sort()}`);
    let keys = [];
    for (let val of a1) {
        if (a2.indexOf(val) >= 0) {
            keys.push(val);
        }
    }
    return keys;
}


function array_diff(a1, a2) {
    let a = [], diff = [];

    for (let i = 0; i < a1.length; i++) {
        a[a1[i]] = true;
    }

    for (var i = 0; i < a2.length; i++) {
        if (a[a2[i]]) {
            delete a[a2[i]];
        } else {
            a[a2[i]] = true;
        }
    }

    for (let k in a) {
        diff.push(k);
    }

    return diff;
}


function TraverseScope(criteria) {
    let result = true;
    return function traverse(obj, proxy) {
        for (let key of Object.keys(obj)) {
            result = (!result) ? false : criteria(key, obj[key], proxy[key]);
            // console.log(`- checking ${key} [${result}]`);
            if ((typeof obj[key] === 'object') && (obj[key] !== null)) {
                if (key in proxy) {
                    traverse(obj[key], proxy[key])
                }
            }
        }
        return result;
    }
}


function SetList(numSongs) {
    this._state = {
        'changes': {},
        'streak': 0,
        'notes': {}
    };
    this._list = [];
    this._attempts = 0;
    this._numSongs = numSongs;
    this._iterateThroughSongs();
}


SetList.prototype.print = function () {
    console.log(`- total songs: ${this._list.length}`);
    for (let key in this._state['changes']) {
        console.log(`- ${key} changes: ${this._state['changes'][key]}`);
    }

    console.log();
    let count = 1;
    for (let song of this._list) {
        console.log();
        for (let key of Object.keys(this._state['notes'][song.name] || {})) {
            console.log(`    - ${key} change ${this._state['notes'][song.name][key].join(', ')}`);
        }
        console.log();
        console.log(`${count}. ${song.name}`);
        count += 1;
    }
};


SetList.prototype._iterateThroughSongs = function () {
    for (; this._list.length <= this._numSongs;) {
        const song = this._getNextSong(this._list.length + 1);
        if (! song) {
            console.log('- END OF LIST ' + this._attempts)
            this._attempts += 1;
            if (this._attempts >= songs.getCount() * MAX_ATTEMPTS) {
                return false;
            }
        } else {
            this._state['streak'] += 1;
            this._list.push(song);
        }
    }
};


SetList.prototype._getNextSong = function (pos) {
    const orderLabel = this._findOrderLabel(pos);
    if (config.general.order[orderLabel]) {
        song = songs.removeBy(...config.general.order[orderLabel]);
    } else {
        song = songs.removeRandom();
    }

    if (! song) { console.log('no song returned'); return false; }

    console.log(`song ${song.name}`);

    if (orderLabel === "first") { return song; }

    if (this._meetsCriteria(song)) {
        return song;
    } else {
        songs.add(song);
        return false;
    }
};


SetList.prototype._findOrderLabel = function (pos) {
    if (pos === 1) {
        return "first";
    } else if (pos === 2) {
        return "second";
    } else if (pos === this._numSongs - 1) {
        return "penultimate";
    } else if (pos === this._numSongs) {
        return "last";
    }
    return undefined;
};


SetList.prototype._isWithinValidRanges= function (songName, name, values) {
    if (this._state['changes'][name] >= config.props[name].maxChanges) {
        console.log(`  too many ${name} changes`);
        return false;
    } else if (this._state['streak'] < config.props[name].minStreak) {
        console.log(`  not a long enough streak (${this._state['streak']}) for ${name} change`);
        return false;
    }
    console.log(`* ${name} change [streak: ${this._state['streak']}]`);
    this._state['notes'][songName][name] = values;
    this._state['changes'][name] += 1;
    this._state['streak'] = 0;
    return true;
};


SetList.prototype._meetsCriteria = function (song) {
    let prevSong = {}
    if (this._list.length > 0) {
        prevSong = this._list[this._list.length - 1];
    }

    const traverse = TraverseScope((name, currBranch, prevBranch) => {
        if (! config.props[name]) {
            // no config present for this property
            return true;
        }
        this._state['changes'][name] = this._state['changes'][name] || 0;
        this._state['notes'][song.name] = this._state['notes'][song.name] || {};

        if (Array.isArray(currBranch)) {
            // change detection for arrays
            console.log(currBranch)
            console.log(prevBranch)
            if (match_keys(currBranch, prevBranch) > 0) {
                console.log(currBranch);
                console.log(prevBranch);
                if (this._isWithinValidRanges(song.name, name, currBranch)) {
                    // FIXME update previous song with correct tuning
                    // remove tunings which result from diffing previous and current tunings.
                    return true;
                }
                return false;
            }
        } else if ((typeof currBranch === 'object') && (currBranch !== null)) {
            // change detection for objects
            let matched = match_keys(Object.keys(currBranch), Object.keys(prevBranch));
            for (let val of config.props[name].mutuallyExclusive) {
                if (matched.length < val.length) {
                    // previous song does not contain one of these instruments
                    return this._isWithinValidRanges(song.name, name, Object.keys(currBranch));
                }
            }
        }
        // FIXME ignore strings?
        return true;
    });
    return traverse(song, prevSong);
};


module.exports = SetList;