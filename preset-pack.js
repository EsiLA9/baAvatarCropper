"use strict";

const presetPackFilename = "background-presets.zip";
const presetPackFormat = "ba-avatar-background-presets";
const captionFontFilename = "方正兰亭圆简体 中粗.TTF";

async function createPresetPack(entries, name) {
  const zip = new JSZip();
  const backgrounds = entries.map(({ id, name, parameters, frozen, blob }, index) => {
    const extension = {
      "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
      "image/gif": "gif", "image/avif": "avif", "image/bmp": "bmp",
    }[blob.type] ?? "img";
    const path = `images/${index + 1}.${extension}`;
    zip.file(path, blob);
    return { id, name, path, type: blob.type, frozen, parameters };
  });
  zip.file("manifest.json", JSON.stringify({ format: presetPackFormat, version: 1, name, backgrounds }, null, 2));
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

async function readAssetIndex() {
  const response = await fetch("assets-index.json", { cache: "no-cache" });
  if (response.status === 404) return { guides: [], packs: [] };
  if (!response.ok) throw new Error("无法读取项目素材目录");
  const { guides, packs, legacyPack, font } = await response.json();
  const valid = (entries, folder) => (Array.isArray(entries) ? entries : []).filter((entry) =>
    typeof entry?.path === "string" && entry.path.startsWith(`${folder}/`) &&
    !entry.path.includes("\\") && entry.path.split("/").every((part) => part && part !== "." && part !== "..") &&
    typeof entry.revision === "string");
  const rootAsset = (entry, path) =>
    entry?.path === path && typeof entry.revision === "string" ? entry : undefined;
  return {
    guides: valid(guides, "reference-images"), packs: valid(packs, "background-packs"),
    legacyPack: rootAsset(legacyPack, presetPackFilename), font: rootAsset(font, captionFontFilename),
  };
}

function projectAssetUrl({ path, revision }) {
  const url = new URL(path.split("/").map(encodeURIComponent).join("/"), document.baseURI);
  if (revision) url.searchParams.set("v", revision);
  return url;
}

async function fetchProjectAsset(entry) {
  const url = projectAssetUrl(entry);
  if (!entry.revision) return fetch(url, { cache: "no-cache" });
  let cache;
  try {
    cache = await globalThis.caches?.open(`ba-avatar-assets:${new URL(".", document.baseURI).pathname}`);
    const hit = await cache?.match(url.href);
    if (hit) return hit;
  } catch {
    // Private browsing or storage limits can leave HTTP caching as the fallback.
  }
  const response = await fetch(url, { cache: "force-cache" });
  if (cache && response.status === 200 && !response.headers.get("Content-Type")?.startsWith("text/html")) {
    void cache.put(url.href, response.clone()).then(async () => {
      const versions = await cache.keys(url.href, { ignoreSearch: true });
      await Promise.all(versions.filter((request) => request.url !== url.href).map((request) => cache.delete(request)));
    }).catch(() => {});
  }
  return response;
}

async function readPresetPack(blob, packageId, fallbackName) {
  const zip = await JSZip.loadAsync(blob);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  if (manifest.format !== presetPackFormat || manifest.version !== 1 || !Array.isArray(manifest.backgrounds) ||
      !manifest.backgrounds.length) {
    throw new Error("不支持的背景预设包格式");
  }
  const ids = new Set();
  const entries = manifest.backgrounds.map(({ id, name, path, type, frozen, parameters }) => {
    const { blur, scale, x, y } = parameters ?? {};
    if (typeof id !== "string" || id.length > 128 || !id || ids.has(id) ||
        typeof name !== "string" || !name.trim() || name.length > 80 ||
        typeof path !== "string" || !/^images\/\d+\.[a-z0-9]+$/.test(path) || !zip.file(path) ||
        typeof frozen !== "boolean" || ![blur, scale, x, y].every(Number.isFinite) ||
        blur < 0 || blur > 40 || scale < 1 || scale > 8 ||
        (frozen && (blur !== 0 || scale !== 1 || x !== 0 || y !== 0))) {
      throw new Error("背景预设清单无效");
    }
    ids.add(id);
    return {
      id: packageId === "project:legacy" ? `project:${id}` : `${encodeURIComponent(packageId)}:${id}`,
      name, packageId, frozen, blur, scale, x, y,
      packedImage: zip.file(path), mimeType: typeof type === "string" && type.startsWith("image/") ? type : "",
    };
  });
  const name = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim().slice(0, 60) : fallbackName;
  return { id: packageId, name, entries };
}
