import { readFileSync } from "node:fs";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

export default defineConfig({
    plugins: [
        svelte(),
        VitePWA({
            registerType: "autoUpdate",
            manifest: false,
            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2}"],
                globIgnores: ["**/auth-relay.html"],
                navigateFallback: "index.html",
                navigateFallbackDenylist: [/^\/auth-relay\.html/],
            },
        }),
    ],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
        host: "0.0.0.0",
        port: 4173,
    },
});
