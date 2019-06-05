const songList = require("../songs.json");

function shuffle(array) {
    var currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {

        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }

    return array;
}

function Songs() {
    this._list = shuffle(songList);
}

Songs.prototype.listNames = function () {
    let result = [];
    this._list.forEach((song) => {
        result.push(song.name);
    });
    return result;
}

Songs.prototype.getCount = function () {
    return this._list.length;
}

Songs.prototype.listNamesBy = function (criteria) {
    const [key, value] = criteria;
    let result = [];
    this._list.forEach((song) => {
        if (song[key] === value) {
            result.push(song.name);
        }
    });
    return result;
}

Songs.prototype.removeBy = function (criteria) {
    const pos = this._positionBy(criteria);
    return this._list.splice(pos, 1);
}

Songs.prototype.getBy = function (criteria) {
    const pos = this._positionBy(critera);
    return this._list[pos];
}

Songs.prototype._positionBy = function (criteria) {
    const [key, value] = criteria;
    for (let i = 0; i < this._list.length -1; i++) {
        if (this._list[i][key] === value) {
            return i;
        }
    };
}

Songs.prototype.add = function (song) {
    this._list.push(song);
}

module.exports = Songs;
