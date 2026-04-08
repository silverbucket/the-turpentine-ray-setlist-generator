import { createMigrator } from "rs-migrate";

export const migrator = createMigrator({ versionField: "schemaVersion" });

// --- config ---
migrator.register({
    version: 2, // existing schemaVersion is 1
    collection: "config",
    description:
        "Remove band.members and show.members (moved to individual member files)",
    transform(doc) {
        if (doc.band) delete doc.band.members;
        if (doc.show) delete doc.show.members;
        return doc;
    },
});

// --- setlists ---
migrator.register({
    version: 1,
    collection: "setlists",
    description: "Normalize saved setlist shape for remoteStorage",
    transform(doc) {
        doc.songs = doc.songs || [];
        doc.songNames =
            doc.songNames || doc.songs.map((s) => s.name || s.title || "?");
        doc.songCount = doc.songCount || doc.songs.length;
        doc.savedAt = doc.savedAt || doc.createdAt || "";
        return doc;
    },
});
