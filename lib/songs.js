const songList = require("../songs.json");


function shuffle(arr) {
    let currIdx = arr.length, tempVal, ranIdx;

    // while there remain elements to shuffle...
    while (0 !== currIdx) {
        // pick a remaining element.
        ranIdx = Math.floor(Math.random() * currIdx);
        currIdx -= 1;

        // swap it with the current element.
        tempVal = arr[currIdx];
        arr[currIdx] = arr[ranIdx];
        arr[ranIdx] = tempVal;
    }

    return arr;
};


function Songs() {
    this._list = shuffle(songList);
}


Songs.prototype.reset = function () {
    this._list = shuffle(songList);
};


Songs.prototype.listNames = function () {
    let result = [];
    this._list.forEach((song) => {
        result.push(song.name);
    });
    return result;
};


Songs.prototype.getCount = function () {
    return this._list.length;
};


Songs.prototype.listNamesBy = function (criteria) {
    const [key, value] = criteria;
    let result = [];
    this._list.forEach((song) => {
        if (song[key] === value) {
            result.push(song.name);
        }
    });
    return result;
};


Songs.prototype.removeRandom = function () {
    return this._list.pop();
};


Songs.prototype.removeBy = function (...criteria) {
    const pos = this._positionBy(criteria);
    if (pos < 0) { return false; }
    return this._list.splice(pos, 1)[0];
};


Songs.prototype.getBy = function (...criteria) {
    const pos = this._positionBy(criteria);
    if (pos < 0) { return false; }
    return this._list[pos];
};


Songs.prototype._positionBy = function (criteria) {
    for (let i = 0; i < this._list.length; i++) {
        if (this._criteriaMatch(this._list[i], criteria)) {
            return i;
        }
    };
    return false;
};


Songs.prototype._criteriaMatch = function (song, criteria) {
    for (let i = 0; i < criteria.length; i++) {
        let [prop, vals] = criteria[i];
        let match = false;
        if (vals instanceof Array) {
            vals = shuffle(vals);
        } else {
            vals = [ vals ];
        }
        for (let j = 0; j < vals.length; j++) {
            if (!song[prop] || song[prop] === vals[j]) {
                match = true;
                break;
            }
        }
        if (! match) {
            return false;
        }
    }
    return true;
};


Songs.prototype.add = function (song) {
    this._list.unshift(song);
};

module.exports = Songs;
