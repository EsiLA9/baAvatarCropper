"use strict";

const presetPackFilename = "background-presets.zip";
const presetPackFormat = "ba-avatar-background-presets";

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
  const { guides, packs } = await response.json();
  const valid = (entries, folder) => (Array.isArray(entries) ? entries : []).filter((entry) =>
    typeof entry?.path === "string" && entry.path.startsWith(`${folder}/`) &&
    !entry.path.includes("\\") && entry.path.split("/").every((part) => part && part !== "." && part !== "..") &&
    typeof entry.revision === "string");
  return { guides: valid(guides, "reference-images"), packs: valid(packs, "background-packs") };
}

function projectAssetUrl({ path, revision }) {
  const url = new URL(path.split("/").map(encodeURIComponent).join("/"), document.baseURI);
  if (revision) url.searchParams.set("v", revision);
  return url;
}

async function fetchProjectAsset(entry) {
  return fetch(projectAssetUrl(entry), { cache: entry.revision ? "force-cache" : "no-cache" });
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
