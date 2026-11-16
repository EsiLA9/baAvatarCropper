"use strict";

const width = 404;
const height = 456;
const frozenMargin = 20;
const frozenParameters = { blur: 0, scale: 1, x: 0, y: 0 };
const backgroundImportParameters = { blur: 8, scale: 1.5, x: 0, y: 0 };
const characterImportScale = 3.7;
const byId = (id) => document.getElementById(id);
const stage = byId("stage");
const stageContext = stage.getContext("2d");
const stageWidth = stage.width;
const stageHeight = stage.height;
const kivoContext = byId("kivoImage").getContext("2d");
const kivoName = byId("kivoName");
const kivoCaption = byId("kivoCaption");
const previewTabs = [byId("editTab"), byId("kivoTab"), byId("libraryTab")];
const kivoPanel = byId("kivoPanel");
const libraryView = byId("libraryView");
const libraryGrid = byId("backgroundLibrary");
const collapseLocalBackgrounds = byId("collapseLocalBackgrounds");
const packLibrary = byId("packLibrary");
const packSort = byId("packSort");
const packDirection = byId("packDirection");
const selectAllBackgrounds = byId("selectAllBackgrounds");
const selectLocalBackgrounds = byId("selectLocalBackgrounds");
const restoreProjectPacks = byId("restoreProjectPacks");
const frameX = (stageWidth - width) / 2;
const frameY = (stageHeight - height) / 2;
const presetSelect = byId("preset");
const download = byId("download");
const lock = byId("backgroundLock");
const scaleInput = byId("scale");
const scaleRange = byId("scaleRange");
const scaleRangeBand = byId("scaleRangeBand");
const blurInput = byId("blur");
const showGuide = byId("showGuide");
const chooseGuide = byId("chooseGuide");
const guideDialog = byId("guideDialog");
const guideChoices = byId("guideChoices");
const simpleGuideId = "project-guide:reference-images/简单参考线.png";
const guidePreviewUrls = [];
const removeGuide = byId("removeGuide");
const opacity = byId("opacity");
const freezeBackground = byId("freezeBackground");
const copyToLocal = byId("copyToLocal");
const exportBackgrounds = byId("exportBackgrounds");
const exportBackgroundDialog = byId("exportBackgroundDialog");

function canvas(w, h) {
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

const composition = canvas(width, height);
const compositeContext = composition.getContext("2d");
const blurred = canvas(width, height);
const blurredContext = blurred.getContext("2d");
const previewBackground = canvas(1, 1);
const previewBackgroundContext = previewBackground.getContext("2d");
const padding = canvas(1, 1);
const paddingContext = padding.getContext("2d");

// Replace these demo entries with same-origin image URLs and the team's approved parameters.
const builtIn = [
  { id: "blue", name: "晴空渐变（示例）", colors: ["#29669d", "#86d7ed", "#f0faff"], blur: 12, scale: 1.12, x: 0, y: 0 },
  { id: "dusk", name: "暮色渐变（示例）", colors: ["#283768", "#837bb3", "#fac6af"], blur: 16, scale: 1.18, x: 0, y: 0 },
];
const solid = { id: "solid", name: "默认纯色", color: "#eef3f9", blur: 0, scale: 1, x: 0, y: 0 };
const presets = new Map([solid, ...builtIn].map((preset) => [preset.id, preset]));
const images = new Map();
const builtInWork = {};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const status = (message) => { byId("status").textContent = message; };
const background = { image: null, blur: 12, scale: 1, x: 0, y: 0 };
const character = { image: null, name: "", scale: 1, x: 0, y: 0 };
let guide = null;
let selected = background;
let backgroundRevision = 0;
let renderedBackgroundRevision = -1;
let previewBackgroundRevision = -1;
let pendingFrame = 0;
let backgroundRequest = 0;
let characterRequest = 0;
const guides = new Map();
const backgroundPacks = new Map();
const packagePreferences = new Map();
const selectedBackgrounds = new Set();
const projectGuideChecks = new Map();
let guideId = "";
let guideRequest = 0;
let activeId = solid.id;
let activeTab = previewTabs[0];
let database;
let restoring = true;
let saveTimer = 0;
let savingBackground = false;
let scaleInputOrigin = null;
let exportingBackgrounds = false;
const pendingRecords = new Map();
const deleting = new Set();


function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ba-avatar-cropper", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("素材库被其他页面占用"));
  });
}

function readRecords() {
  return new Promise((resolve, reject) => {
    const request = database.transaction("assets").objectStore("assets").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeRecords(records, removed = []) {
  if (!database) throw new Error("无法访问本地素材库");
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("assets", "readwrite");
    const assets = transaction.objectStore("assets");
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    for (const record of records) assets.put(record);
    for (const id of removed) assets.delete(id);
  });
}

function transformOf({ scale, x, y }) {
  return { scale, x, y };
}

function backgroundParameters({ scale, x, y, blur }) {
  return { scale, x, y, blur };
}

function queueRecord(record) {
  pendingRecords.set(record.id, { ...record });
}

async function saveWorkspace() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (restoring) return false;
  const queued = [...pendingRecords.values()].filter((record) => !deleting.has(record.id));
  const workspace = {
    id: "workspace", activeId, tab: activeTab.id, selected: selected === character ? "character" : "background",
    lock: lock.checked, guideId, showGuide: showGuide.checked, opacity: opacity.value, kivoName: kivoName.value,
    builtInWork, packagePreferences: [...packagePreferences], localBackgroundsCollapsed: libraryGrid.hidden,
    packSort: packSort.value, packDirection: packDirection.value,
    character: { name: character.name, ...transformOf(character) },
  };
  try {
    await writeRecords([...queued, workspace]);
    for (const record of queued) {
      if (pendingRecords.get(record.id) === record) pendingRecords.delete(record.id);
    }
    byId("storageStatus").textContent = "";
    return true;
  } catch {
    byId("storageStatus").textContent = "本地保存失败。当前页面仍可使用，请检查站点存储空间。";
    return false;
  }
}

function queueSave() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWorkspace, 400);
}

function rememberBackground() {
  const preset = presets.get(activeId);
  const working = backgroundParameters(background);
  const previous = preset.working ?? builtInWork[activeId] ?? preset;
  if (preset !== solid && Object.keys(working).some((key) => working[key] !== previous[key])) {
    if (preset.local) {
      preset.working = working;
      queueRecord(preset);
      const entry = libraryEntries.get(preset.id);
      if (entry) queueThumbnails(entry);
    } else {
      builtInWork[activeId] = working;
    }
    queueSave();
  }
  refreshBackgroundState();
}

window.addEventListener("pagehide", () => { if (saveTimer) void saveWorkspace(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden && saveTimer) void saveWorkspace();
});

function demoImage(colors) {
  const image = canvas(960, 640);
  const context = image.getContext("2d");
  const gradient = context.createLinearGradient(0, 80, 850, 610);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.57, colors[1]);
  gradient.addColorStop(1, colors[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, image.width, image.height);
  context.fillStyle = "#ffffff33";
  context.fillRect(0, 432, image.width, 100);
  context.beginPath();
  context.arc(635, 200, 100, 0, Math.PI * 2);
  context.fill();
  return image;
}

async function decode(blob) {
  const image = await createImageBitmap(blob);
  if (!image.width || !image.height) {
    image.close();
    throw new Error("图片尺寸无效");
  }
  return image;
}

function initialScale(layer) {
  if (!layer.image || layer.frozen) return 1;
  const fit = layer === character ? Math.min : Math.max;
  return fit(width / layer.image.width, height / layer.image.height);
}

function rect(layer) {
  const scale = initialScale(layer) * layer.scale;
  const w = layer.image.width * scale;
  const h = layer.image.height * scale;
  return { x: (width - w) / 2 + layer.x, y: (height - h) / 2 + layer.y, w, h };
}

function setTransform(layer, scale, x, y, preserveScaleInput = false) {
  layer.scale = clamp(scale, layer === background ? 1 : 0.05, 8);
  const { w, h } = rect(layer);
  const limitX = Math.max(0, (w + (layer === background ? -width : width)) / 2);
  const limitY = Math.max(0, (h + (layer === background ? -height : height)) / 2);
  layer.x = clamp(x, -limitX, limitX);
  layer.y = clamp(y, -limitY, limitY);
  if (layer === background) {
    backgroundRevision += 1;
    rememberBackground();
  } else {
    queueSave();
    queueThumbnails();
  }
  refreshControls(preserveScaleInput);
  scheduleRender();
}

function drawLayer(context, layer, offsetX, offsetY) {
  if (!layer.image) return;
  const { x, y, w, h } = rect(layer);
  context.imageSmoothingQuality = "high";
  context.drawImage(layer.image, offsetX + x, offsetY + y, w, h);
}

function renderBackground(layer = background, context = blurredContext, margin = 0) {
  const { width: pixelWidth, height: pixelHeight } = context.canvas;
  const scaleX = pixelWidth / (width + 2 * margin);
  const scaleY = pixelHeight / (height + 2 * margin);
  const blur = layer.blur * scaleX;
  context.clearRect(0, 0, pixelWidth, pixelHeight);
  if (!layer.image) return;
  if (!blur && !margin) {
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    drawLayer(context, layer, 0, 0);
    context.resetTransform();
    return;
  }

  // Extend the edge pixels when the source ends inside the blur's padding.
  const pad = Math.ceil(blur * 4);
  const w = pixelWidth + pad * 2;
  const h = pixelHeight + pad * 2;
  padding.width = w;
  padding.height = h;
  const offsetX = pad + margin * scaleX;
  const offsetY = pad + margin * scaleY;
  paddingContext.setTransform(scaleX, 0, 0, scaleY, offsetX, offsetY);
  drawLayer(paddingContext, layer, 0, 0);
  paddingContext.resetTransform();
  const bounds = rect(layer);
  const left = clamp(Math.ceil(bounds.x * scaleX + offsetX), 0, w - 1);
  const top = clamp(Math.ceil(bounds.y * scaleY + offsetY), 0, h - 1);
  const right = clamp(Math.floor((bounds.x + bounds.w) * scaleX + offsetX), left + 1, w);
  const bottom = clamp(Math.floor((bounds.y + bounds.h) * scaleY + offsetY), top + 1, h);
  paddingContext.imageSmoothingEnabled = false;
  if (left) paddingContext.drawImage(padding, left, top, 1, bottom - top, 0, top, left, bottom - top);
  if (right < w) paddingContext.drawImage(padding, right - 1, top, 1, bottom - top, right, top, w - right, bottom - top);
  if (top) paddingContext.drawImage(padding, 0, top, w, 1, 0, 0, w, top);
  if (bottom < h) paddingContext.drawImage(padding, 0, bottom - 1, w, 1, 0, bottom, w, h - bottom);

  if (blur) context.filter = `blur(${blur}px)`;
  context.drawImage(padding, -pad, -pad);
  context.filter = "none";
}

function renderComposition() {
  if (renderedBackgroundRevision !== backgroundRevision) {
    renderBackground();
    renderedBackgroundRevision = backgroundRevision;
  }
  compositeContext.clearRect(0, 0, width, height);
  compositeContext.drawImage(blurred, 0, 0);
  drawLayer(compositeContext, character, 0, 0);
}

function drawGuide(context, x, y, scale = 1) {
  if (!showGuide.checked || !guide) return;
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.globalAlpha = Number(opacity.value) / 100;
  context.drawImage(guide, 0, 0);
  context.restore();
}

function drawCard(context, image) {
  const { width: cardWidth, height: cardHeight } = context.canvas;
  const scale = cardHeight / height;
  const x = (cardWidth - width * scale) / 2;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, cardWidth, cardHeight);
  context.drawImage(image, x, 0, width * scale, cardHeight);
}

function scheduleRender() {
  if (pendingFrame || activeTab === previewTabs[2]) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    if (activeTab === previewTabs[2]) return;
    const bounds = stage.getBoundingClientRect();
    const pixelWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
    const pixelHeight = Math.max(1, Math.round(bounds.height * devicePixelRatio));
    if (stage.width !== pixelWidth) stage.width = pixelWidth;
    if (stage.height !== pixelHeight) stage.height = pixelHeight;
    const scaleX = pixelWidth / stageWidth;
    const scaleY = pixelHeight / stageHeight;
    stageContext.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    stageContext.clearRect(0, 0, stageWidth, stageHeight);
    drawLayer(stageContext, background, frameX, frameY);
    drawLayer(stageContext, character, frameX, frameY);
    stageContext.fillStyle = "#182840a3";
    stageContext.fillRect(0, 0, stageWidth, stageHeight);
    if (!kivoPanel.hidden) {
      renderComposition();
      const card = kivoContext.canvas;
      const bounds = kivoPanel.getBoundingClientRect();
      const pixelWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
      const pixelHeight = Math.max(1, Math.round(bounds.height * devicePixelRatio));
      if (card.width !== pixelWidth) card.width = pixelWidth;
      if (card.height !== pixelHeight) card.height = pixelHeight;
      drawCard(kivoContext, composition);
      const scale = card.height / height;
      drawGuide(kivoContext, (card.width - width * scale) / 2, 0, scale);
      return;
    }
    const cropWidth = Math.max(1, Math.round(width * scaleX));
    const cropHeight = Math.max(1, Math.round(height * scaleY));
    if (previewBackgroundRevision !== backgroundRevision ||
        previewBackground.width !== cropWidth || previewBackground.height !== cropHeight) {
      previewBackground.width = cropWidth;
      previewBackground.height = cropHeight;
      renderBackground(background, previewBackgroundContext);
      previewBackgroundRevision = backgroundRevision;
    }
    stageContext.save();
    stageContext.beginPath();
    stageContext.rect(frameX, frameY, width, height);
    stageContext.clip();
    stageContext.clearRect(frameX, frameY, width, height);
    stageContext.imageSmoothingQuality = "high";
    stageContext.drawImage(previewBackground, frameX, frameY, width, height);
    drawLayer(stageContext, character, frameX, frameY);
    drawGuide(stageContext, frameX, frameY);
    stageContext.restore();
    stageContext.strokeStyle = "#f1f8ff";
    stageContext.lineWidth = 2;
    stageContext.strokeRect(frameX - 1, frameY - 1, width + 2, height + 2);
  });
}

function switchPreview(tab) {
  activeTab = tab;
  for (const button of previewTabs) {
    const active = button === tab;
    button.setAttribute("aria-selected", active);
    button.tabIndex = active ? 0 : -1;
  }
  kivoPanel.hidden = tab !== previewTabs[1];
  const inLibrary = tab === previewTabs[2];
  byId("stageView").setAttribute("aria-labelledby", inLibrary ? previewTabs[0].id : tab.id);
  byId("stageView").parentElement.hidden = inLibrary;
  byId("stageHint").hidden = inLibrary;
  libraryView.hidden = !inLibrary;
  download.hidden = inLibrary;
  if (inLibrary) renderLibrary();
  scheduleRender();
  queueSave();
}

for (const [index, tab] of previewTabs.entries()) {
  tab.addEventListener("click", () => switchPreview(tab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const last = previewTabs.length - 1;
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const target = previewTabs[event.key === "Home" ? 0 : event.key === "End" ? last
      : (index + step + previewTabs.length) % previewTabs.length];
    event.preventDefault();
    switchPreview(target);
    target.focus();
  });
}
window.addEventListener("resize", scheduleRender);

function canEdit(layer) {
  return Boolean(layer.image) && (layer !== background || (activeId !== solid.id && !layer.frozen && !lock.checked));
}

function refreshControls(preserveScaleInput = false) {
  const editable = canEdit(selected);
  stage.dataset.editable = editable;
  byId("transform").disabled = !editable;
  const percentage = selected.image ? (selected.scale * 100).toFixed(1) : "";
  scaleInput.min = selected === background ? 100 : 5;
  if (!preserveScaleInput) {
    scaleInput.value = percentage;
    scaleInputOrigin = null;
  }
  const [min, max] = selected === background ? [100, 200] : [400, 500];
  scaleRange.min = min;
  scaleRange.max = max;
  scaleRange.value = clamp(Number(percentage), min, max);
  const outside = selected.image && (Number(percentage) < min || Number(percentage) > max);
  scaleRangeBand.textContent = `${min}%–${max}%${outside ? "（超出范围）" : ""}`;
  byId("x").value = selected.image ? Math.round(selected.x) : "";
  byId("y").value = selected.image ? Math.round(selected.y) : "";
  lock.disabled = Boolean(background.frozen);
  blurInput.disabled = !canEdit(background);
  blurInput.value = background.blur;
  byId("blurValue").value = `${background.blur} px`;
  byId("opacityValue").value = `${opacity.value}%`;
  opacity.disabled = !showGuide.checked;
  download.disabled = !background.image || !character.image;
  byId("stageHint").textContent = editable ? "拖拽移动 · 滚轮缩放"
    : selected === character ? "导入角色图后可调整"
    : activeId === solid.id ? "上传背景图后可调整" : background.frozen ? "背景已固化" : "背景已锁定";
}

function selectLayer(layer) {
  selected = layer;
  document.querySelector(`[name=layer][value=${layer === background ? "background" : "character"}]`).checked = true;
  refreshControls();
  queueSave();
}

function refreshOptions() {
  presetSelect.replaceChildren(...[...presets.values()].map((preset) => new Option(preset.name, preset.id)));
  presetSelect.value = activeId;
}

function backgroundState(preset) {
  if (preset === solid) return "当前使用默认纯色，请上传背景图。";
  if (preset.packageId) {
    const pack = backgroundPacks.get(preset.packageId);
    return `${pack.hosted ? "项目包" : "背景包"} · ${pack.name}${preset.frozen ? " · 已固化" : ""}`;
  }
  if (preset.frozen) return "已固化";
  if (!preset.local) return "网站内置";
  return "修改会自动保存。";
}

function refreshBackgroundState() {
  const preset = presets.get(activeId);
  byId("backgroundState").textContent = preset ? backgroundState(preset) : "";
  const hasBackground = Boolean(background.image) && preset !== solid;
  freezeBackground.hidden = !hasBackground || Boolean(preset?.frozen);
  copyToLocal.hidden = !hasBackground || Boolean(preset?.local);
  freezeBackground.disabled = savingBackground;
  copyToLocal.disabled = savingBackground;
}

function replaceImage(layer, image) {
  if (layer.image !== image) layer.image?.close?.();
  layer.image = image;
}

function setBackground(image, preset) {
  activeId = preset.id;
  replaceImage(background, image);
  background.frozen = Boolean(preset.frozen);
  const params = preset.frozen ? frozenParameters : preset.working ?? builtInWork[preset.id] ?? preset;
  background.blur = params.blur;
  presetSelect.value = activeId;
  setTransform(background, params.scale, params.x, params.y);
}

function pngBlob(image) {
  return new Promise((resolve, reject) => {
    image.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成 PNG")), "image/png");
  });
}

function bakeBackground(layer) {
  const image = canvas(width + 2 * frozenMargin, height + 2 * frozenMargin);
  renderBackground(layer, image.getContext("2d"), frozenMargin);
  return image;
}

async function backgroundBlob(preset) {
  if (preset.imageId) return images.get(preset.imageId);
  if (preset.packedImage) return (await preset.packedImage.async("blob")).slice(0, undefined, preset.mimeType);
  const definition = preset.local ? presets.get(preset.source) : preset;
  if (definition.colors) return pngBlob(demoImage(definition.colors));
  const response = await fetch(definition.url);
  if (!response.ok) throw new Error("无法读取内置背景图");
  return response.blob();
}

async function backgroundImage(preset) {
  if (preset === solid) {
    const image = canvas(width, height);
    const context = image.getContext("2d");
    context.fillStyle = solid.color;
    context.fillRect(0, 0, width, height);
    return image;
  }
  const definition = preset.local && !preset.imageId ? presets.get(preset.source) : preset;
  if (definition?.colors) return demoImage(definition.colors);
  const image = await decode(await backgroundBlob(preset));
  if (preset.frozen && (image.width !== width + 2 * frozenMargin || image.height !== height + 2 * frozenMargin)) {
    image.close();
    throw new Error("固化背景尺寸无效");
  }
  return image;
}

async function usePreset(preset, tab) {
  const request = ++backgroundRequest;
  try {
    const image = await backgroundImage(preset);
    if (request !== backgroundRequest || deleting.has(preset.id) || !presets.has(preset.id)) {
      image.close?.();
      return false;
    }
    setBackground(image, preset);
    if (tab) {
      switchPreview(tab);
      tab.focus();
    }
    void saveWorkspace();
    status(preset === solid ? "请上传新背景图。" : `已应用背景「${preset.name}」`);
    return true;
  } catch {
    if (request === backgroundRequest) {
      presetSelect.value = activeId;
      status("无法读取此背景预设，请选择其他预设或重新导入。");
    }
    return false;
  }
}

function libraryPresets() {
  const available = [...presets.values()];
  return [...available.filter((preset) => preset.local && !deleting.has(preset.id)).reverse(),
    ...available.filter((preset) => preset.packageId)];
}

async function useFallbackBackground() {
  const first = libraryPresets()[0] ?? solid;
  const request = backgroundRequest + 1;
  const opened = await usePreset(first);
  if (!opened && first !== solid && backgroundRequest === request) return usePreset(solid);
  return opened;
}

function onFile(id, handle) {
  byId(id).addEventListener("change", (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    if (files.length) handle(event.target.multiple ? files : files[0]);
  });
}

function registerBackgroundAsset(blob) {
  const id = `image:${crypto.randomUUID()}`;
  images.set(id, blob);
  queueRecord({ id, blob });
  return id;
}

onFile("backgroundFile", async (files) => {
  const request = ++backgroundRequest;
  const validFiles = [];
  let firstImage;
  for (const file of files) {
    const image = await decode(file).catch(() => null);
    if (!image) continue;
    validFiles.push(file);
    if (!firstImage) firstImage = image;
    else image.close();
  }
  if (!firstImage) {
    if (request === backgroundRequest) status("无法读取背景图，请尝试 PNG、JPEG 或 WebP。");
    return;
  }

  const drafts = validFiles.map((file) => {
    const draft = {
      id: `local:${crypto.randomUUID()}`, local: true, imageId: registerBackgroundAsset(file),
      name: fileStem(file.name).slice(0, 40),
      working: { ...backgroundImportParameters },
    };
    queueRecord(draft);
    return draft;
  });
  const first = drafts[0];
  for (const draft of drafts.reverse()) presets.set(draft.id, draft);
  refreshOptions();
  if (request === backgroundRequest) {
    setBackground(firstImage, first);
    selectLayer(background);
    switchPreview(previewTabs[0]);
    const imported = drafts.length === 1 ? `已创建背景草稿「${first.name}」` : `已创建 ${drafts.length} 个背景草稿`;
    const failed = files.length - drafts.length;
    status(failed ? `${imported}，${failed} 张图片无法读取。` : imported);
  } else {
    firstImage.close();
    refreshLibrary();
  }
  void saveWorkspace();
});

function fileStem(name) {
  return name.replace(/\.[^.]+$/, "").trim() || "未命名";
}

onFile("characterFile", async (file) => {
  const request = ++characterRequest;
  try {
    const image = await decode(file);
    if (request !== characterRequest) return image.close();
    replaceImage(character, image);
    character.name = file.name;
    byId("characterName").textContent = file.name;
    queueRecord({ id: "role-image", blob: file });
    setTransform(character, characterImportScale, 0, 0);
    selectLayer(character);
    void saveWorkspace();
    status("已导入角色。拖拽和缩放可对齐参考图。");
  } catch {
    if (request === characterRequest) status("无法读取角色图，请尝试带透明背景的 PNG。");
  }
});

kivoName.addEventListener("input", () => {
  kivoCaption.textContent = kivoName.value.trim() || kivoName.placeholder;
  for (const entry of libraryEntries.values()) entry.caption.textContent = kivoCaption.textContent;
  queueSave();
});

function clearGuideChoices() {
  guideChoices.replaceChildren();
  for (const url of guidePreviewUrls.splice(0)) URL.revokeObjectURL(url);
}

function renderGuideChoices() {
  clearGuideChoices();
  const entries = [...guides.values()];
  const project = entries.filter((record) => record.path);
  project.sort((a, b) => Number(b.id === simpleGuideId) - Number(a.id === simpleGuideId));
  for (const [name, records] of [["项目参考图", project], ["本地参考图", entries.filter((record) => !record.path)]]) {
    if (!records.length) continue;
    const section = document.createElement("section");
    const heading = Object.assign(document.createElement("h2"), { textContent: name });
    const grid = Object.assign(document.createElement("div"), { className: "guide-grid" });
    for (const record of records) {
      const unhostedUrl = record.path ? null : URL.createObjectURL(record.blob);
      if (unhostedUrl) guidePreviewUrls.push(unhostedUrl);
      const image = Object.assign(document.createElement("img"), {
        alt: "", loading: "lazy", src: unhostedUrl ?? projectAssetUrl(record),
      });
      const button = Object.assign(document.createElement("button"), { type: "button", className: "guide-option" });
      button.setAttribute("aria-pressed", record.id === guideId);
      button.append(image, guideName(record));
      button.addEventListener("click", async () => {
        byId("guideDialogStatus").textContent = "";
        if (record.id === guideId || await selectGuide(record.id)) guideDialog.close();
      });
      grid.append(button);
    }
    section.append(heading, grid);
    guideChoices.append(section);
  }
  byId("guideDialogStatus").textContent = entries.length ? "" : "还没有参考图，请先导入。";
}

chooseGuide.addEventListener("click", () => {
  renderGuideChoices();
  guideDialog.showModal();
});
guideDialog.addEventListener("close", () => { if (!guideDialog.open) clearGuideChoices(); });

function guideName(record) {
  return record.path?.split("/").at(-1) ?? (record.blob.name || "自定义参考图");
}

async function decodeGuide(record) {
  if (!record) return null;
  let blob = record.blob;
  if (record.path) {
    const response = await fetchProjectAsset(record);
    if (!response.ok) throw new Error("无法读取项目参考图");
    blob = await response.blob();
  }
  const image = await decode(blob).catch(() => null);
  if (image?.width === width && image.height === height) return image;
  image?.close();
  return null;
}

function setGuide(id, image) {
  guide?.close();
  guideId = id;
  guide = image;
  const record = guides.get(id);
  byId("currentGuide").textContent = record ? guideName(record) : "未选择参考图";
  removeGuide.disabled = !id || Boolean(guides.get(id)?.path) || deleting.has(id);
  scheduleRender();
}

async function selectGuide(id) {
  const request = ++guideRequest;
  removeGuide.disabled = true;
  try {
    const image = id ? await decodeGuide(guides.get(id)) : null;
    if (request !== guideRequest) {
      image?.close();
      return false;
    }
    if (id && !image) throw new Error("参考图尺寸无效");
    setGuide(id, image);
    void saveWorkspace();
    return true;
  } catch {
    if (request !== guideRequest) return false;
    removeGuide.disabled = !guideId || Boolean(guides.get(guideId)?.path);
    if (guideDialog.open) byId("guideDialogStatus").textContent = "无法读取所选参考图。";
    else status("无法读取所选参考图。");
    return false;
  }
}

onFile("guideFile", async (files) => {
  const request = ++guideRequest;
  const added = [];
  let firstImage;
  for (const blob of files) {
    const image = await decodeGuide({ blob });
    if (!image) continue;
    const record = { id: `guide:${crypto.randomUUID()}`, blob };
    added.push(record);
    if (firstImage) image.close();
    else firstImage = image;
  }
  if (!added.length) {
    if (request === guideRequest) {
      removeGuide.disabled = !guideId || Boolean(guides.get(guideId)?.path) || deleting.has(guideId);
      status("未能导入参考图，请选择可读取的 404 × 456 px 图片。");
    }
    return;
  }
  for (const record of added) {
    guides.set(record.id, record);
    queueRecord(record);
  }
  if (request === guideRequest) {
    showGuide.checked = true;
    refreshControls();
    setGuide(added[0].id, firstImage);
    const skipped = files.length - added.length;
    status(skipped ? `已导入 ${added.length} 张参考图，跳过 ${skipped} 张无法读取或尺寸不符的图片。`
      : `已导入 ${added.length} 张参考图。`);
  } else {
    firstImage.close();
  }
  if (guideDialog.open) renderGuideChoices();
  void saveWorkspace();
});

removeGuide.addEventListener("click", async () => {
  const id = guideId;
  const record = guides.get(id);
  if (!record || record.path || deleting.has(id) || !confirm(`移除参考图「${guideName(record)}」？`)) return;
  deleting.add(id);
  chooseGuide.disabled = true;
  removeGuide.disabled = true;
  try {
    await writeRecords([], [id]);
    pendingRecords.delete(id);
    guides.delete(id);
    if (guideId === id) {
      setGuide("", null);
      if (guides.has(simpleGuideId)) await selectGuide(simpleGuideId);
    }
    void saveWorkspace();
    status("已移除参考图。");
  } catch {
    status("无法移除参考图，请检查浏览器存储。");
  } finally {
    deleting.delete(id);
    chooseGuide.disabled = false;
    removeGuide.disabled = !guideId || Boolean(guides.get(guideId)?.path);
  }
});

presetSelect.addEventListener("change", () => {
  const preset = presets.get(presetSelect.value);
  if (preset) usePreset(preset, libraryView.hidden ? undefined : previewTabs[1]);
});

async function saveBackgroundCopy(bake) {
  const source = presets.get(activeId);
  if (savingBackground || !source || source === solid || !background.image ||
      (bake ? source.frozen : source.local)) return;
  const request = backgroundRequest;
  const parameters = bake ? frozenParameters : backgroundParameters(background);
  const name = bake ? `${source.name.slice(0, 36)}（固化）` : source.name.slice(0, 40);
  const preset = {
    id: `local:${crypto.randomUUID()}`, local: true, name, frozen: bake || Boolean(source.frozen),
    working: { ...parameters },
  };
  let bakedImage;
  savingBackground = true;
  refreshBackgroundState();
  try {
    if (bake) {
      bakedImage = bakeBackground(background);
      preset.imageId = registerBackgroundAsset(await pngBlob(bakedImage));
    } else if (source.packageId) {
      preset.imageId = registerBackgroundAsset(await backgroundBlob(source));
    } else {
      preset.source = source.id;
    }
    presets.set(preset.id, preset);
    queueRecord(preset);
    if (request === backgroundRequest && activeId === source.id) {
      setBackground(bakedImage ?? background.image, preset);
    }
    refreshOptions();
    refreshLibrary(preset.id);
    if (await saveWorkspace()) status(`已保存${bake ? "固化" : ""}背景「${name}」`);
  } catch {
    status("无法生成背景，请重试。");
  } finally {
    savingBackground = false;
    refreshBackgroundState();
  }
}
freezeBackground.addEventListener("click", () => saveBackgroundCopy(true));
copyToLocal.addEventListener("click", () => saveBackgroundCopy(false));

document.querySelectorAll("[name=layer]").forEach((input) => {
  input.addEventListener("change", () => selectLayer(input.value === "background" ? background : character));
});
lock.addEventListener("change", () => {
  refreshControls();
  void saveWorkspace();
});

function applyScaleInput(live) {
  if (!canEdit(selected)) return;
  const value = scaleInput.valueAsNumber;
  if (!Number.isFinite(value) || (live && (value < Number(scaleInput.min) || value > Number(scaleInput.max)))) {
    if (!live) refreshControls();
    return;
  }
  // Reuse the original position when an intermediate value temporarily narrows the allowed offset.
  scaleInputOrigin ??= { x: selected.x, y: selected.y };
  setTransform(selected, value / 100, scaleInputOrigin.x, scaleInputOrigin.y, live);
}

scaleInput.addEventListener("input", () => applyScaleInput(true));
scaleInput.addEventListener("change", () => applyScaleInput(false));
scaleInput.addEventListener("blur", () => {
  if (scaleInputOrigin) applyScaleInput(false);
});
scaleRange.addEventListener("input", () => {
  if (canEdit(selected)) setTransform(selected, scaleRange.valueAsNumber / 100, selected.x, selected.y);
});

for (const id of ["x", "y"]) {
  byId(id).addEventListener("change", (event) => {
    const value = event.target.valueAsNumber;
    if (!canEdit(selected) || !Number.isFinite(value)) {
      refreshControls();
      return;
    }
    setTransform(selected, selected.scale,
      id === "x" ? value : selected.x, id === "y" ? value : selected.y);
  });
}
byId("resetTransform").addEventListener("click", () => {
  if (canEdit(selected)) setTransform(selected, 1, 0, 0);
});
blurInput.addEventListener("input", () => {
  if (!canEdit(background)) return;
  background.blur = Number(blurInput.value);
  backgroundRevision += 1;
  rememberBackground();
  refreshControls();
  scheduleRender();
});
for (const input of [showGuide, opacity]) {
  input.addEventListener("input", () => {
    refreshControls();
    scheduleRender();
    queueSave();
  });
}

function pointerPosition(event) {
  const bounds = stage.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * stageWidth / bounds.width - stageWidth / 2,
    y: (event.clientY - bounds.top) * stageHeight / bounds.height - stageHeight / 2,
  };
}

let drag = null;
stage.addEventListener("pointerdown", (event) => {
  if (drag || event.button !== 0 || !canEdit(selected)) return;
  const start = pointerPosition(event);
  drag = { id: event.pointerId, layer: selected, image: selected.image,
    offsetX: selected.x - start.x, offsetY: selected.y - start.y };
  stage.setPointerCapture(event.pointerId);
  stage.dataset.dragging = true;
});
stage.addEventListener("pointermove", (event) => {
  if (drag?.id !== event.pointerId || drag.layer.image !== drag.image || !canEdit(drag.layer)) return;
  const point = pointerPosition(event);
  setTransform(drag.layer, drag.layer.scale, point.x + drag.offsetX, point.y + drag.offsetY);
});
stage.addEventListener("lostpointercapture", (event) => {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  delete stage.dataset.dragging;
});
stage.addEventListener("wheel", (event) => {
  if (!canEdit(selected) || event.deltaY === 0 || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  const point = pointerPosition(event);
  const scale = clamp(selected.scale * (event.deltaY < 0 ? 1.08 : 1 / 1.08),
    selected === background ? 1 : 0.05, 8);
  const ratio = scale / selected.scale;
  setTransform(selected, scale, point.x + (selected.x - point.x) * ratio,
    point.y + (selected.y - point.y) * ratio);
}, { passive: false });

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

download.addEventListener("click", () => {
  if (download.hidden) return;
  renderComposition();
  const name = character.name.replace(/\.[^.]+$/, "") || "头像";
  composition.toBlob((blob) => {
    if (!blob) {
      status("生成 PNG 失败，请重试。");
      return;
    }
    downloadBlob(blob, `${name}-404x456.png`);
    status("已生成 404 × 456 PNG。");
  }, "image/png");
});

function mountPack(pack) {
  backgroundPacks.set(pack.id, pack);
  if (!packagePreferences.get(pack.id)?.hidden) {
    for (const preset of pack.entries) presets.set(preset.id, preset);
  }
}

onFile("packFiles", async (files) => {
  let added = 0;
  for (const blob of files) {
    const id = `local-pack:${crypto.randomUUID()}`;
    try {
      const pack = await readPresetPack(blob, id, fileStem(blob.name).slice(0, 60));
      pack.addedAt = Date.now();
      mountPack(pack);
      queueRecord({ id, blob, name: pack.name, addedAt: pack.addedAt });
      added += 1;
    } catch {
      // A damaged archive should not prevent the remaining files from loading.
    }
  }
  refreshOptions();
  refreshLibrary();
  const skipped = files.length - added;
  if (added) await saveWorkspace();
  status(`已载入 ${added} 个背景包${skipped ? `，跳过 ${skipped} 个无效包` : ""}。`);
});

async function renamePack(pack) {
  const name = prompt("背景包名称", pack.name)?.trim().slice(0, 60);
  if (!name || name === pack.name) return;
  pack.name = name;
  packagePreferences.set(pack.id, { ...packagePreferences.get(pack.id), name });
  refreshBackgroundState();
  refreshLibrary();
  if (await saveWorkspace()) status(`背景包已改名为「${name}」。`);
}

async function removePack(pack) {
  if (deleting.has(pack.id)) return;
  if (!pack.hosted && !confirm(`从本地图库移除背景包「${pack.name}」？需要重新载入 ZIP 才能恢复。`)) return;
  deleting.add(pack.id);
  libraryView.inert = true;
  try {
    if (pack.hosted) {
      packagePreferences.set(pack.id, { ...packagePreferences.get(pack.id), hidden: true });
    } else {
      await writeRecords([], [pack.id]);
      pendingRecords.delete(pack.id);
      backgroundPacks.delete(pack.id);
      packagePreferences.delete(pack.id);
    }
    for (const { id } of pack.entries) {
      presets.delete(id);
      selectedBackgrounds.delete(id);
      if (!pack.hosted) delete builtInWork[id];
    }
    await refreshAfterRemovingPresets();
    if (await saveWorkspace()) status(`已${pack.hosted ? "隐藏" : "移除"}「${pack.name}」。`);
  } catch {
    status("无法移除背景包，请检查浏览器存储。");
  } finally {
    deleting.delete(pack.id);
    libraryView.inert = false;
    refreshLibrary();
  }
}

restoreProjectPacks.addEventListener("click", async () => {
  for (const pack of backgroundPacks.values()) {
    const preference = packagePreferences.get(pack.id);
    if (pack.hosted && preference?.hidden) {
      packagePreferences.set(pack.id, { ...preference, hidden: false });
      mountPack(pack);
    }
  }
  refreshOptions();
  refreshLibrary();
  if (await saveWorkspace()) status("已恢复隐藏的项目包。");
});

exportBackgrounds.addEventListener("click", () => {
  if (exportingBackgrounds || exportBackgroundDialog.open || !selectedBackgrounds.size) return;
  exportBackgroundDialog.returnValue = "";
  exportBackgroundDialog.showModal();
});

exportBackgroundDialog.addEventListener("close", async () => {
  const choice = exportBackgroundDialog.returnValue;
  if (choice !== "editable" && choice !== "bake") return;
  const selected = libraryPresets().filter((preset) => selectedBackgrounds.has(preset.id));
  if (exportingBackgrounds || !selected.length) return;
  const bake = choice === "bake";
  exportingBackgrounds = true;
  exportBackgrounds.disabled = true;
  status(bake ? "正在烘焙并打包所选背景…" : "正在打包所选背景…");
  try {
    const entries = await Promise.all(selected.map(async (preset) => ({
      id: preset.id.length <= 128 ? preset.id : crypto.randomUUID(), name: preset.name,
      parameters: backgroundParameters(preset.working ?? preset),
      frozen: Boolean(preset.frozen), blob: await backgroundBlob(preset),
    })));
    if (bake) {
      for (const entry of entries) {
        if (entry.frozen) continue;
        const image = await decode(entry.blob);
        try {
          entry.blob = await pngBlob(bakeBackground({ ...entry.parameters, image }));
          entry.parameters = frozenParameters;
          entry.frozen = true;
        } finally {
          image.close();
        }
      }
    }
    const name = byId("exportPackName").value.trim();
    const filename = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\.zip$/i, "").replace(/[. ]+$/, "");
    downloadBlob(await createPresetPack(entries, name || undefined), filename ? `${filename}.zip` : presetPackFilename);
    status(`已导出 ${entries.length} 项背景。`);
  } catch {
    status("背景打包失败，请检查素材是否仍可读取。");
  } finally {
    exportingBackgrounds = false;
    refreshExportSelection();
  }
});

const libraryEntries = new Map();
const packageSelectors = new Map();
const thumbnailQueue = new Set();
let drawingThumbnails = false;
const libraryObserver = new IntersectionObserver((observations) => {
  for (const { target, isIntersecting } of observations) {
    const entry = libraryEntries.get(target.dataset.id);
    if (!entry || entry.node !== target) continue;
    entry.visible = isIntersecting;
    if (isIntersecting) queueThumbnails(entry);
    else if (entry.canvas.width !== 1) {
      entry.canvas.width = 1;
      entry.canvas.height = 1;
    }
  }
});

function queueThumbnails(entry) {
  if (libraryView.hidden) return;
  for (const item of entry ? [entry] : libraryEntries.values()) {
    if (item.visible) thumbnailQueue.add(item);
  }
  if (thumbnailQueue.size && !drawingThumbnails) {
    drawingThumbnails = true;
    requestAnimationFrame(paintThumbnail);
  }
}

async function paintThumbnail() {
  const entry = thumbnailQueue.values().next().value;
  thumbnailQueue.delete(entry);
  if (!libraryView.hidden && entry?.visible && entry.node.isConnected) {
    let image;
    try {
      image = await backgroundImage(entry.preset);
      if (!libraryView.hidden && entry.visible && entry.node.isConnected) {
        const preset = entry.preset;
        const params = preset.frozen ? frozenParameters : preset.working ?? preset;
        if (entry.canvas.width !== width) {
          entry.canvas.width = width;
          entry.canvas.height = height;
        }
        const context = entry.canvas.getContext("2d");
        renderBackground({ ...params, image, frozen: preset.frozen }, context);
        drawLayer(context, character, 0, 0);
        entry.preview.title = "";
      }
    } catch {
      entry.preview.title = "无法预览此背景";
    } finally {
      image?.close?.();
    }
  }
  if (thumbnailQueue.size && !libraryView.hidden) requestAnimationFrame(paintThumbnail);
  else drawingThumbnails = false;
}

function refreshLibrary(focusId) {
  if (libraryView.hidden) return;
  renderLibrary();
  if (focusId) (libraryEntries.get(focusId)?.open ?? previewTabs[2]).focus();
}

function syncSelection(selector, entries) {
  const count = entries.filter(({ id }) => selectedBackgrounds.has(id)).length;
  selector.checked = entries.length > 0 && count === entries.length;
  selector.indeterminate = count > 0 && count < entries.length;
  selector.disabled = entries.length === 0;
}

function refreshExportSelection() {
  const entries = libraryPresets();
  syncSelection(selectAllBackgrounds, entries);
  syncSelection(selectLocalBackgrounds, entries.filter((preset) => preset.local));
  for (const [id, selector] of packageSelectors) syncSelection(selector, backgroundPacks.get(id)?.entries ?? []);
  for (const { preset, selection } of libraryEntries.values()) selection.checked = selectedBackgrounds.has(preset.id);
  const count = entries.filter(({ id }) => selectedBackgrounds.has(id)).length;
  exportBackgrounds.disabled = exportingBackgrounds || count === 0;
  exportBackgrounds.textContent = count ? `导出所选 ZIP（${count}）` : "导出所选 ZIP";
}

function selectBackgrounds(entries, checked) {
  for (const { id } of entries) {
    if (checked) selectedBackgrounds.add(id);
    else selectedBackgrounds.delete(id);
  }
  refreshExportSelection();
}

selectAllBackgrounds.addEventListener("change", () => selectBackgrounds(libraryPresets(), selectAllBackgrounds.checked));
selectLocalBackgrounds.addEventListener("change", () =>
  selectBackgrounds(libraryPresets().filter((preset) => preset.local), selectLocalBackgrounds.checked));
collapseLocalBackgrounds.addEventListener("click", () => {
  setLibraryCollapsed(libraryGrid, collapseLocalBackgrounds, !libraryGrid.hidden);
  queueSave();
});
for (const control of [packSort, packDirection]) {
  control.addEventListener("change", () => {
    renderLibrary();
    queueSave();
  });
}

function setLibraryCollapsed(grid, button, collapsed) {
  grid.hidden = collapsed;
  button.textContent = collapsed ? "展开" : "折叠";
  button.setAttribute("aria-expanded", !collapsed);
}

function renderPackGroup(pack, nodes) {
  const section = Object.assign(document.createElement("section"), { className: "library-group" });
  const head = Object.assign(document.createElement("div"), { className: "library-head" });
  const heading = Object.assign(document.createElement("h2"), {
    textContent: pack.name,
  });
  const actions = Object.assign(document.createElement("div"), { className: "library-pack-actions" });
  const label = Object.assign(document.createElement("label"), { className: "library-select" });
  const select = Object.assign(document.createElement("input"), { type: "checkbox" });
  select.setAttribute("aria-label", `全选「${pack.name}」`);
  select.addEventListener("change", () => selectBackgrounds(pack.entries, select.checked));
  label.append(select, "全选");
  packageSelectors.set(pack.id, select);
  const rename = Object.assign(document.createElement("button"), { type: "button", textContent: "包命名" });
  rename.addEventListener("click", () => renamePack(pack));
  const remove = Object.assign(document.createElement("button"), {
    type: "button", textContent: pack.hosted ? "隐藏包" : "移除包",
  });
  remove.addEventListener("click", () => removePack(pack));
  const hint = Object.assign(document.createElement("p"), {
    className: "hint", textContent: `${pack.hosted ? "项目包" : "本地载入包"} · ${nodes.length} 项`,
  });
  const grid = Object.assign(document.createElement("div"), { className: "library-grid" });
  grid.id = `pack-grid-${encodeURIComponent(pack.id)}`;
  grid.append(...nodes);
  const collapse = Object.assign(document.createElement("button"), { type: "button" });
  collapse.setAttribute("aria-controls", grid.id);
  setLibraryCollapsed(grid, collapse, Boolean(packagePreferences.get(pack.id)?.collapsed));
  collapse.addEventListener("click", () => {
    setLibraryCollapsed(grid, collapse, !grid.hidden);
    packagePreferences.set(pack.id, { ...packagePreferences.get(pack.id), collapsed: grid.hidden });
    queueSave();
  });
  actions.append(collapse, label, rename, remove);
  head.append(heading, actions);
  section.append(head, hint, grid);
  return section;
}

function renderLibrary() {
  libraryObserver.disconnect();
  thumbnailQueue.clear();
  libraryEntries.clear();
  packageSelectors.clear();
  const ordered = libraryPresets();
  const local = [];
  const grouped = new Map();
  for (const preset of ordered) {
    const node = document.createElement("article");
    node.className = "library-entry";
    node.dataset.id = preset.id;
    node.setAttribute("aria-current", preset.id === activeId);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "library-open";
    open.setAttribute("aria-label", `打开背景「${preset.name}」`);
    open.addEventListener("click", () => usePreset(preset, previewTabs[1]));
    const preview = document.createElement("span");
    preview.className = "library-card";
    preview.setAttribute("aria-hidden", "true");
    const image = canvas(1, 1);
    const caption = document.createElement("span");
    caption.className = "library-caption";
    caption.textContent = kivoCaption.textContent;
    preview.append(image, caption);
    open.append(preview);
    const title = document.createElement(preset.local ? "button" : "span");
    title.className = "library-name";
    title.textContent = preset.name;
    if (preset.local) {
      title.type = "button";
      title.title = "双击改名";
      title.setAttribute("aria-description", "双击或按回车改名");
      title.addEventListener("dblclick", () => renameBackground(preset));
      title.addEventListener("click", (event) => {
        if (event.detail === 0) renameBackground(preset);
      });
    }
    const meta = document.createElement("div");
    meta.className = "library-meta";
    const selection = Object.assign(document.createElement("input"), { type: "checkbox" });
    selection.setAttribute("aria-label", `选择背景「${preset.name}」`);
    selection.addEventListener("change", () => selectBackgrounds([preset], selection.checked));
    meta.append(selection);
    let remove;
    if (preset.local) {
      remove = document.createElement("button");
      remove.type = "button";
      remove.className = "library-delete";
      remove.textContent = "删除";
      remove.setAttribute("aria-label", `删除背景「${preset.name}」`);
      remove.addEventListener("click", () => deleteBackground(preset));
      meta.append(remove);
    }
    node.append(open, title, meta);
    libraryEntries.set(preset.id, { node, open, title, remove, selection, canvas: image, preview, caption, preset });
    if (preset.local) local.push(node);
    else {
      if (!grouped.has(preset.packageId)) grouped.set(preset.packageId, []);
      grouped.get(preset.packageId).push(node);
    }
  }
  libraryGrid.replaceChildren(...local);
  const packs = [...backgroundPacks.values()].filter((pack) => grouped.has(pack.id));
  if (packSort.value === "name") packs.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  if (packSort.value === "date") packs.sort((a, b) => a.addedAt - b.addedAt);
  if (packDirection.value === "reverse") packs.reverse();
  packLibrary.replaceChildren(...packs.map((pack) => renderPackGroup(pack, grouped.get(pack.id))));
  byId("packSorting").hidden = !packs.length;
  restoreProjectPacks.hidden = ![...backgroundPacks.values()].some((pack) => pack.hosted && packagePreferences.get(pack.id)?.hidden);
  byId("libraryHint").textContent = local.length
    ? "双击本地背景名称可改名。"
    : "还没有本地背景，请上传背景图。";
  refreshExportSelection();
  for (const { node } of libraryEntries.values()) libraryObserver.observe(node);
}

async function renameBackground(preset) {
  if (!preset.local || deleting.has(preset.id)) return;
  const name = prompt("背景名称", preset.name)?.trim().slice(0, 40);
  if (!name || name === preset.name) return;
  preset.name = name;
  queueRecord(preset);
  refreshOptions();
  const entry = libraryEntries.get(preset.id);
  if (entry) {
    entry.title.textContent = name;
    entry.open.setAttribute("aria-label", `打开背景「${name}」`);
    entry.remove.setAttribute("aria-label", `删除背景「${name}」`);
    entry.selection.setAttribute("aria-label", `选择背景「${name}」`);
  }
  if (await saveWorkspace()) status(`背景已改名为「${name}」`);
}

async function deleteBackground(preset) {
  if (deleting.has(preset.id) || !confirm(`删除本地背景「${preset.name}」？此操作无法撤销。`)) return;
  const removed = [preset.id];
  if (preset.imageId && ![...presets.values()].some((other) => other !== preset && other.imageId === preset.imageId)) {
    removed.push(preset.imageId);
  }
  for (const id of removed) deleting.add(id);
  libraryView.inert = true;
  refreshBackgroundState();
  try {
    await writeRecords([], removed);
    for (const id of removed) {
      pendingRecords.delete(id);
      images.delete(id);
    }
    presets.delete(preset.id);
    selectedBackgrounds.delete(preset.id);
    await refreshAfterRemovingPresets();
    await saveWorkspace();
    status(activeId === solid.id ? `已删除「${preset.name}」。请上传新背景图。` : `已删除背景「${preset.name}」`);
  } catch {
    queueRecord(preset);
    status("无法删除背景，请检查浏览器存储。");
  } finally {
    for (const id of removed) deleting.delete(id);
    libraryView.inert = false;
    refreshBackgroundState();
    refreshLibrary(preset.id);
  }
}

async function refreshAfterRemovingPresets() {
  refreshOptions();
  if (!presets.has(activeId)) {
    replaceImage(background, null);
    backgroundRevision += 1;
    refreshControls();
    await useFallbackBackground();
  }
}

function restoreBackgroundRecords(assets) {
  for (const record of assets) {
    if (record.id.startsWith("image:")) images.set(record.id, record.blob);
    if (!record.id.startsWith("local:")) continue;
    if (record.local) {
      presets.set(record.id, record);
      continue;
    }
    const params = backgroundParameters(record);
    const preset = {
      id: record.id, local: true, name: record.name.replace(/（本地）$/, ""), source: record.source,
      working: params,
    };
    if (record.blob) {
      preset.imageId = `image:${record.id}`;
      images.set(preset.imageId, record.blob);
      queueRecord({ id: preset.imageId, blob: record.blob });
    }
    presets.set(preset.id, preset);
    queueRecord(preset);
  }
}

async function loadProjectGuides(entries) {
  let skipped = 0;
  let checksChanged = false;
  for (const entry of entries) {
    const id = `project-guide:${entry.path}`;
    const previous = projectGuideChecks.get(id);
    try {
      if (entry.revision !== previous?.revision) {
        const image = await decodeGuide(entry);
        projectGuideChecks.set(id, { revision: entry.revision, valid: Boolean(image) });
        image?.close();
        checksChanged = true;
      }
      if (projectGuideChecks.get(id).valid) guides.set(id, { ...entry, id });
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  if (checksChanged) queueRecord({ id: "project-guide-checks", checks: [...projectGuideChecks] });
  return skipped;
}

async function loadBackgroundPacks(files, records) {
  let skipped = 0;
  const sources = [
    ...records.filter((record) => record.id.startsWith("local-pack:") && record.blob)
      .sort((a, b) => (a.addedAt ?? a.blob.lastModified ?? 0) - (b.addedAt ?? b.blob.lastModified ?? 0)),
    { id: "project:legacy", path: presetPackFilename, name: "项目预设" },
    ...files.map((file) => ({
      ...file, id: `project-pack:${file.path}`, name: fileStem(file.path.split("/").at(-1)).slice(0, 60),
    })),
  ];
  for (const source of sources) {
    try {
      let blob = source.blob;
      let addedAt = source.addedAt ?? blob?.lastModified;
      if (source.path) {
        const response = await fetchProjectAsset(source);
        if (response.status === 404 && source.id === "project:legacy") continue;
        if (!response.ok) throw new Error("背景包无法读取");
        addedAt ??= Date.parse(response.headers.get("Last-Modified"));
        blob = await response.blob();
      }
      const pack = await readPresetPack(blob, source.id, source.name);
      pack.addedAt = Number.isFinite(addedAt) ? addedAt : 0;
      pack.hosted = Boolean(source.path);
      pack.name = packagePreferences.get(pack.id)?.name ?? pack.name;
      mountPack(pack);
    } catch {
      skipped += 1;
    }
  }
  return skipped;
}

async function restoreWorkspace() {
  const main = document.querySelector("main");
  main.inert = true;
  status("正在恢复工作台…");
  const projectIndex = readAssetIndex().catch(() => null);
  let assets = [];
  try {
    database = await openDatabase();
    assets = await readRecords();
    restoreBackgroundRecords(assets);
  } catch {
    database = null;
    byId("storageStatus").textContent = "无法读取本地工作台，仍可导入图片和导出 PNG。";
  }
  const workspace = assets.find((record) => record.id === "workspace");
  setLibraryCollapsed(libraryGrid, collapseLocalBackgrounds, Boolean(workspace?.localBackgroundsCollapsed));
  packSort.value = workspace?.packSort ?? "default";
  packDirection.value = workspace?.packDirection ?? "forward";
  for (const [id, prefs] of workspace?.packagePreferences ?? []) packagePreferences.set(id, prefs);
  for (const [id, check] of assets.find((record) => record.id === "project-guide-checks")?.checks ?? []) {
    projectGuideChecks.set(id, check);
  }
  const loadImage = async (id) => {
    const blob = assets.find((record) => record.id === id)?.blob;
    return blob ? decode(blob).catch(() => null) : null;
  };
  for (const record of assets) {
    if (record.blob && (record.id === "guide" || record.id.startsWith("guide:"))) guides.set(record.id, record);
  }
  const wantedGuideId = workspace?.guideId || (guides.has("guide") && workspace?.guideId === undefined ? "guide" : simpleGuideId);
  const index = await projectIndex;
  const [roleImage, skippedGuides, skippedPacks] = await Promise.all([
    loadImage("role-image"),
    loadProjectGuides(index?.guides ?? []),
    loadBackgroundPacks(index?.packs ?? [], assets),
  ]);
  let restoredGuideId = guides.has(wantedGuideId) ? wantedGuideId : simpleGuideId;
  let guideImage = await decodeGuide(guides.get(restoredGuideId)).catch(() => null);
  if (!guideImage && restoredGuideId !== simpleGuideId) {
    restoredGuideId = simpleGuideId;
    guideImage = await decodeGuide(guides.get(restoredGuideId)).catch(() => null);
  }
  refreshOptions();
  const wanted = presets.get(workspace?.activeId) ?? libraryPresets()[0] ?? solid;
  if (workspace) Object.assign(builtInWork, workspace.builtInWork);
  const opened = await usePreset(wanted);
  if (!opened && wanted !== solid) await useFallbackBackground();
  if (roleImage) {
    replaceImage(character, roleImage);
    const role = { ...character, ...workspace?.character };
    character.name = role.name;
    byId("characterName").textContent = role.name;
    setTransform(character, role.scale, role.x, role.y);
  }
  setGuide(guideImage ? restoredGuideId : "", guideImage);
  if (workspace) {
    lock.checked = workspace.lock;
    showGuide.checked = workspace.showGuide;
    opacity.value = workspace.opacity;
    kivoName.value = workspace.kivoName;
    kivoName.dispatchEvent(new Event("input"));
    selectLayer(workspace.selected === "character" ? character : background);
    switchPreview(previewTabs.find((tab) => tab.id === workspace.tab) ?? previewTabs[0]);
    if (opened && activeId !== solid.id) status("已恢复上次的工作台。");
  }
  const skipped = skippedGuides + skippedPacks;
  if (!index) status("无法读取项目素材目录，本地素材仍可使用。");
  else if (skipped) status(`已跳过 ${skipped} 项无法加载的参考图或背景包。`);
  refreshControls();
  refreshBackgroundState();
  scheduleRender();
  restoring = false;
  main.inert = false;
  if (database && pendingRecords.size) void saveWorkspace();
}

void restoreWorkspace();
