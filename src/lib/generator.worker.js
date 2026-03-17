import { generateSetlist } from "./generator.js";

self.onmessage = function (event) {
    const { songs, config, optionsList } = event.data;
    let best = null;

    for (let i = 0; i < optionsList.length; i++) {
        const result = generateSetlist(songs, config, optionsList[i]);
        if (!best || result.summary.score < best.summary.score) {
            best = result;
        }
        // Post progress so the UI knows we're still working
        self.postMessage({ type: "progress", attempt: i + 1, total: optionsList.length });
    }

    self.postMessage({ type: "done", result: best });
};
