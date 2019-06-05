const config = require("../config.json");
const Songs = require("./songs.js");
const songs = new Songs();

function Generator() {
    this._list = [];
    this._tuningChanges = 0;
    this._curSong = {};
}

Generator.prototype.setList = function (numSongs) {
    for (let i = 1; i <= numSongs; i++) {
        const orderLabel = this._findOrderLabel(i, numSongs);
        if (config.order[orderLabel]) {
            this._curSong = songs.removeBy(...config.order[orderLabel]);
            this._list.push(this._curSong);
        } else {
            this._curSong = songs.removeRandom();
            this._list.push(this._curSong);
        }
    }
    return this._list;
}

Generator.prototype._findOrderLabel = function (pos, total) {
    if (pos === 1) {
        return "first";
    } else if (pos === 2) {
        return "second";
    } else if (pos === total - 1) {
        return "penultimate";
    } else if (pos === total) {
        return "last";
    }
    return undefined;
}


module.exports = Generator;