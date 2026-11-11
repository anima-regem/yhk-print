import {BrowserPrinter} from "./bluetooth.js";
import {render} from "./raster.js";
import {readRecord, writeRecord, updateRecent} from "./storage.js";

const byID = id => document.getElementById(id);
const text = byID("text");
const controls = {
  size: byID("size"),
  typeface: byID("font"),
  align: byID("align"),
  brightness: byID("brightness"),
  imageWidth: byID("image-width"),
  tone: byID("tone"),
};
const image = byID("image");
const canvas = byID("preview");
const empty = byID("empty");
const paper = byID("paper");
const dimensions = byID("dimensions");
const rotate = byID("rotate");
const download = byID("download");
const draftMessage = byID("draft-message");
const historyButton = byID("history");
const historyDialog = byID("history-dialog");
const historyClose = byID("close-history");
const historyEmpty = byID("history-empty");
const historyList = byID("history-list");
const historyMessage = byID("history-message");
const printButton = byID("print");
const connectButton = byID("connect");
const clearButton = byID("clear");
const installButton = byID("install");
const dropArea = byID("drop-area");
const message = byID("message");
const connectionMessage = byID("connection-message");
const composeMessage = byID("compose-message");
const pairing = byID("pairing");
const keyInput = byID("key");
const relaySetup = byID("relay-setup");
const canUseBluetooth = typeof navigator.bluetooth?.requestDevice === "function";

let photo = null;
let photoFile = null;
let photoName = "";
let rotation = 0;
let draftRevision = 0;
let draftTimer;
let recent = [];
let raster = null;
let imageRevision = 0;
let loadingImage = false;
let connection = "";
let busy = false;
let relay = null;
let checkingRelay = location.protocol === "http:";
let relayKey = "";
let installPrompt;
const direct = new BrowserPrinter(() => {
  setConnection();
  if (!busy) announce(connectionMessage, "The printer disconnected.");
});

function announce(region, text, error = false) {
  region.textContent = text;
  region.classList.toggle("error", error);
}

function updateButtons() {
  printButton.disabled = busy || loadingImage || raster === null || !connection;
  clearButton.disabled = busy || (!text.value && !photo && !loadingImage);
  connectButton.disabled = busy || checkingRelay;
  download.disabled = busy || loadingImage || raster === null;
  historyButton.disabled = historyClose.disabled = busy;
  for (const button of historyList.querySelectorAll("button")) {
    button.disabled = busy || (button.dataset.reprint !== undefined && !connection);
  }
  for (const control of [text, image, rotate, byID("remove"), ...Object.values(controls)]) {
    control.disabled = busy;
  }
}

function setConnection(name = "") {
  connection = name;
  byID("connection").classList.toggle("connected", Boolean(name));
  const needsRelay = !checkingRelay && !relay && !canUseBluetooth;
  const status = checkingRelay ? "Checking connection" : needsRelay ? "Mac relay required" : "Disconnected";
  byID("connection-label").textContent = name ? `${name} · Connected` : `YHK-7314 · ${status}`;
  connectButton.textContent = name ? "Disconnect" : needsRelay ? "Set up Mac relay" : "Connect printer";
  relaySetup.hidden = !needsRelay;
  updateButtons();
}

function slipSettings() {
  return {
    size: Number(controls.size.value),
    typeface: controls.typeface.value,
    align: controls.align.value,
    brightness: Number(controls.brightness.value),
    imageWidth: Number(controls.imageWidth.value),
    tone: controls.tone.value,
    rotation,
  };
}

function updatePhotoLabels() {
  const brightness = Number(controls.brightness.value);
  byID("brightness-value").value = brightness > 0 ? `+${brightness}` : brightness;
  byID("image-width-value").value = `${controls.imageWidth.value}%`;
  byID("image-action").textContent = photo ? "Replace image" : "Choose an image";
  byID("image-tools").hidden = !photo;
}

function updatePreview() {
  raster = null;
  if (text.value.trim() || photo) {
    try {
      raster = render(canvas, text.value.trim(), photo, slipSettings());
    } catch (error) {
      announce(composeMessage, error.message, true);
    }
  }
  empty.hidden = raster !== null;
  canvas.hidden = raster === null;
  paper.tabIndex = raster === null ? -1 : 0;
  dimensions.hidden = raster === null;
  if (raster) dimensions.textContent = `${canvas.width} × ${canvas.height} dots`;
  updatePhotoLabels();
  updateButtons();
}

function resetPhotoSettings() {
  controls.brightness.value = "0";
  controls.imageWidth.value = "100";
  controls.tone.value = "photo";
  rotation = 0;
}

function clearImage() {
  imageRevision += 1;
  loadingImage = false;
  photo = null;
  photoFile = null;
  photoName = "";
  resetPhotoSettings();
  image.value = "";
  byID("file-row").hidden = true;
}

async function loadImage(file, restoring = false, name = file?.name || "Image") {
  if (!file || busy) return;
  if (!restoring) draftRevision += 1;
  const revision = ++imageRevision;
  if (file.size > 20 * 1024 * 1024) {
    loadingImage = false;
    announce(composeMessage, "Choose an image no larger than 20 MB.", true);
    updateButtons();
    return;
  }
  loadingImage = true;
  updateButtons();
  const url = URL.createObjectURL(file);
  const decoded = new Image();
  try {
    decoded.src = url;
    await decoded.decode();
    if (revision !== imageRevision) return;
    photo = decoded;
    photoFile = file;
    photoName = name;
    if (!restoring) resetPhotoSettings();
    byID("file-name").textContent = photoName;
    byID("file-row").hidden = false;
    if (!restoring) byID("image-tools").open = true;
    if (!restoring || draftRevision !== 0) persistDraft();
    announce(composeMessage, "");
    announce(message, "");
  } catch {
    if (revision === imageRevision) {
      announce(composeMessage, "Could not open the image. Try a PNG or JPEG.", true);
    }
  } finally {
    URL.revokeObjectURL(url);
    if (revision === imageRevision) {
      loadingImage = false;
      updatePreview();
    }
  }
}

async function relayRequest(route, payload) {
  const response = await fetch(`./api/${route}`, {
    method: "POST",
    headers: {"Authorization": `Bearer ${relayKey}`, "Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      relayKey = "";
      keyInput.value = "";
      setConnection();
    }
    throw new Error(result.message);
  }
  return result;
}

async function connectRelay() {
  busy = true;
  updateButtons();
  announce(connectionMessage, "Checking the printer through your Mac.");
  try {
    await relayRequest("status", {});
    setConnection("YHK-7314 via Mac");
    announce(connectionMessage, "");
  } catch (error) {
    announce(connectionMessage, error.message, true);
  } finally {
    busy = false;
    updateButtons();
  }
}

connectButton.addEventListener("click", async () => {
  if (connection) {
    if (!relay) direct.disconnect();
    setConnection();
    announce(connectionMessage, "");
    return;
  }
  if (relay) {
    if (relay.requiresKey && !relayKey) pairing.showModal();
    else await connectRelay();
    return;
  }
  if (!canUseBluetooth) {
    relaySetup.open = true;
    relaySetup.querySelector("summary").focus();
    return;
  }
  busy = true;
  updateButtons();
  announce(connectionMessage, "Choose your YHK printer from the Bluetooth list.");
  try {
    setConnection(await direct.connect());
    announce(connectionMessage, "");
  } catch (error) {
    announce(connectionMessage, error.name === "NotFoundError" ? "No printer selected." : error.message, true);
  } finally {
    busy = false;
    updateButtons();
  }
});

byID("pairing-form").addEventListener("submit", event => {
  event.preventDefault();
  relayKey = keyInput.value.trim();
  if (!relayKey) return;
  pairing.close();
  connectRelay();
});
byID("cancel-pairing").addEventListener("click", () => pairing.close());

async function sendSlip(job, feedback) {
  if (!connection || busy) return;
  busy = true;
  updateButtons();
  announce(feedback, "Checking printer status.");
  try {
    if (relay) {
      let binary = "";
      for (const byte of job.raster) binary += String.fromCharCode(byte);
      announce(feedback, "Sending through your Mac. Keep this page open.");
      await relayRequest("print", {raster: btoa(binary)});
    } else {
      await direct.print(job.raster, progress => {
        const percent = Math.round(progress * 100);
        announce(feedback, percent === 100 ? "Finishing the print job." : `Sent ${percent}% of the slip.`);
      });
    }

    try {
      const sent = {...job, sentAt: Date.now()};
      recent = await updateRecent(jobs => [sent, ...jobs.filter(item => item.id !== sent.id)].slice(0, 5));
      if (historyDialog.open) {
        renderHistory();
        historyClose.disabled = false;
        historyClose.focus();
      }
      announce(feedback, "Print data sent. Check the paper.");
    } catch {
      announce(feedback, "Print data sent. Check the paper. This browser could not save the job.");
    }
  } catch (error) {
    announce(feedback, error.message, true);
  } finally {
    busy = false;
    updateButtons();
  }
}

printButton.addEventListener("click", () => {
  if (!raster || loadingImage) return;
  const title = text.value.trim().split(/\r?\n/, 1)[0] || photoName || "Untitled slip";
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  sendSlip({id, title: title.slice(0, 88), raster}, message);
});

download.addEventListener("click", () => {
  if (!raster) return;
  canvas.toBlob(blob => {
    if (!blob) {
      announce(message, "Could not download the preview.", true);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "yhk-slip.png";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, "image/png");
});

function persistDraft() {
  const revision = ++draftRevision;
  const draft = {text: text.value, settings: slipSettings(), photo: photoFile, photoName};
  clearTimeout(draftTimer);
  announce(draftMessage, "");
  draftTimer = setTimeout(async () => {
    try {
      await writeRecord("draft", draft);
      if (revision === draftRevision && (draft.text.trim() || draft.photo)) announce(draftMessage, "Draft saved");
    } catch {
      if (revision === draftRevision) announce(draftMessage, "Draft could not be saved.");
    }
  }, 180);
}

async function restoreDraft() {
  try {
    const draft = await readRecord("draft");
    if (!draft || draftRevision !== 0) return;
    text.value = draft.text || "";
    for (const [name, control] of Object.entries(controls)) {
      if (draft.settings?.[name] !== undefined) control.value = draft.settings[name];
    }
    rotation = draft.settings?.rotation || 0;
    updatePreview();
    if (draft.photo) await loadImage(draft.photo, true, draft.photoName);
    if (draftRevision === 0 && (text.value.trim() || photo)) announce(draftMessage, "Draft restored");
  } catch {
    announce(draftMessage, "Draft storage is unavailable.");
  }
}

function refreshDraft() {
  announce(composeMessage, "");
  announce(message, "");
  updatePreview();
  persistDraft();
}

function renderHistory() {
  historyEmpty.hidden = recent.length > 0;
  historyList.replaceChildren();
  for (const job of recent) {
    const item = document.createElement("li");
    const description = document.createElement("div");
    description.className = "history-title";
    const name = document.createElement("strong");
    name.textContent = job.title;
    const time = document.createElement("time");
    const date = new Date(job.sentAt);
    time.dateTime = date.toISOString();
    time.textContent = date.toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
    description.append(name, time);
    const actions = document.createElement("div");
    actions.className = "actions";
    const reprint = document.createElement("button");
    reprint.type = "button";
    reprint.className = "secondary";
    reprint.textContent = "Print again";
    reprint.dataset.reprint = "";
    reprint.addEventListener("click", () => sendSlip(job, historyMessage));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${job.title} from recent prints`);
    remove.addEventListener("click", async () => {
      try {
        recent = await updateRecent(jobs => jobs.filter(item => item.id !== job.id));
        renderHistory();
        historyClose.focus();
        announce(historyMessage, "");
      } catch {
        announce(historyMessage, "Could not remove the job.", true);
      }
    });
    actions.append(reprint, remove);
    item.append(description, actions);
    historyList.append(item);
  }
  updateButtons();
}

historyButton.addEventListener("click", async () => {
  historyDialog.showModal();
  announce(historyMessage, "");
  try {
    recent = await readRecord("recent") ?? [];
    renderHistory();
    if (!connection && recent.length) announce(historyMessage, "Connect the printer to print again.");
  } catch {
    announce(historyMessage, "This browser could not load recent prints.", true);
  }
});
historyClose.addEventListener("click", () => historyDialog.close());
historyDialog.addEventListener("cancel", event => {
  if (busy) event.preventDefault();
});

text.addEventListener("input", refreshDraft);
for (const control of Object.values(controls)) {
  control.addEventListener(control.type === "range" ? "input" : "change", refreshDraft);
}
rotate.addEventListener("click", () => {
  rotation = (rotation + 90) % 360;
  refreshDraft();
});
image.addEventListener("change", () => loadImage(image.files[0]));
byID("remove").addEventListener("click", () => {
  clearImage();
  refreshDraft();
  image.focus();
});
clearButton.addEventListener("click", () => {
  text.value = "";
  clearImage();
  refreshDraft();
  text.focus();
});
document.addEventListener("paste", event => {
  if (busy) return;
  const file = Array.from(event.clipboardData?.files ?? []).find(item => item.type.startsWith("image/"));
  if (file) {
    event.preventDefault();
    loadImage(file);
  }
});
dropArea.addEventListener("dragover", event => {
  event.preventDefault();
  if (!busy) dropArea.classList.add("dragging");
});
dropArea.addEventListener("dragleave", () => dropArea.classList.remove("dragging"));
dropArea.addEventListener("drop", event => {
  event.preventDefault();
  dropArea.classList.remove("dragging");
  loadImage(event.dataTransfer.files[0]);
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  installButton.hidden = true;
});
window.addEventListener("appinstalled", () => { installButton.hidden = true; });

if (window.isSecureContext && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Offline setup failed", error));
}

// Only the local Mac server exposes relay.json.
setConnection();
restoreDraft();
if (checkingRelay) {
  fetch("./relay.json", {cache: "no-store"})
    .then(response => response.ok ? response.json() : null)
    .then(config => {
      relay = config;
      if (!relay) return;
      const key = new URLSearchParams(location.hash.slice(1)).get("key");
      if (key) relayKey = key;
    })
    .catch(() => {})
    .finally(() => {
      checkingRelay = false;
      setConnection();
    });
}
