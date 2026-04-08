import { generateSetlist } from "./generator.js";

self.onmessage = (event) => {
    const { songs, config, options } = event.data;
    const result = generateSetlist(songs, config, options);
    self.postMessage({ type: "done", result });
};
