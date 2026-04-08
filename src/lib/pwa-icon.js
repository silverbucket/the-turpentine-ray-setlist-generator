import { darkenHex } from "./utils.js";

export function generateDieSvgString(color) {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
        `<path fill="${color}" d="M256 66L420.5 161 256 256 91.5 161Z"/>` +
        `<path fill="${darkenHex(color, 0.78)}" d="M91.5 161L256 256 256 446 91.5 351Z"/>` +
        `<path fill="${darkenHex(color, 0.62)}" d="M256 256L420.5 161 420.5 351 256 446Z"/>` +
        `<path fill="none" stroke="#000" stroke-width="2.5" stroke-opacity=".1" stroke-linejoin="round" d="M256 66L420.5 161 420.5 351 256 446 91.5 351 91.5 161Z"/>` +
        `<path stroke="#000" stroke-width="2" stroke-opacity=".08" d="M256 256L91.5 161M256 256L420.5 161M256 256L256 446"/>` +
        `<ellipse cx="256" cy="113.5" rx="18" ry="10" fill="#fff"/>` +
        `<ellipse cx="338.25" cy="161" rx="18" ry="10" fill="#fff"/>` +
        `<ellipse cx="256" cy="161" rx="18" ry="10" fill="#fff"/>` +
        `<ellipse cx="173.75" cy="161" rx="18" ry="10" fill="#fff"/>` +
        `<ellipse cx="256" cy="208.5" rx="18" ry="10" fill="#fff"/>` +
        `<ellipse cx="132.6" cy="232" rx="13" ry="16" fill="#ebebeb"/>` +
        `<ellipse cx="173.8" cy="303" rx="13" ry="16" fill="#ebebeb"/>` +
        `<ellipse cx="214.9" cy="374" rx="13" ry="16" fill="#ebebeb"/>` +
        `<ellipse cx="338.3" cy="303" rx="13" ry="16" fill="#d9d9d9"/>` +
        `</svg>`
    );
}

function svgToPngDataUrl(svgString, size) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, size, size);
            resolve(canvas.toDataURL("image/png"));
        };
        img.src = `data:image/svg+xml,${encodeURIComponent(svgString)}`;
    });
}

function upsertLink(rel, attrs) {
    let el = document.querySelector(`link[rel="${rel}"]`);
    if (!el) {
        el = document.createElement("link");
        el.rel = rel;
        document.head.appendChild(el);
    }
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function upsertMeta(name, content) {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
        el = document.createElement("meta");
        el.name = name;
        document.head.appendChild(el);
    }
    el.content = content;
}

let prevManifestUrl = null;

export async function updatePwaIcons(dieColor) {
    const svg = generateDieSvgString(dieColor);

    const [png180, png192, png512] = await Promise.all([
        svgToPngDataUrl(svg, 180),
        svgToPngDataUrl(svg, 192),
        svgToPngDataUrl(svg, 512),
    ]);

    upsertLink("apple-touch-icon", { href: png180 });

    const manifest = {
        name: "Setlist Roller",
        short_name: "Setlist Roller",
        start_url: ".",
        display: "standalone",
        background_color: "#1a1a1e",
        theme_color: dieColor,
        icons: [
            { src: png192, sizes: "192x192", type: "image/png" },
            { src: png512, sizes: "512x512", type: "image/png" },
        ],
    };

    if (prevManifestUrl) URL.revokeObjectURL(prevManifestUrl);
    prevManifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    upsertLink("manifest", { href: prevManifestUrl });

    upsertMeta("theme-color", dieColor);
}
