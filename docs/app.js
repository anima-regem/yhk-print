import {BrowserPrinter} from "./bluetooth.js";
import {render} from "./raster.js";

const byID = id => document.getElementById(id);
const text = byID("text");
const size = byID("size");
const image = byID("image");
const canvas = byID("preview");
const empty = byID("empty");
const printButton = byID("print");
const connectButton = byID("connect");
const clearButton = byID("clear");
const installButton = byID("install");
const dropArea = byID("drop-area");
const message = byID("message");
const pairing = byID("pairing");
const keyInput = byID("key");
const relaySetup = byID("relay-setup");
const canUseBluetooth = typeof navigator.bluetooth?.requestDevice === "function";

let photo = null;
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
  if (!busy) announce("Printer disconnected. Connect again when you’re ready.");
});

function announce(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function updateButtons() {
  printButton.disabled = busy || loadingImage || raster === null || !connection;
  clearButton.disabled = busy || (!text.value && !photo && !loadingImage);
  connectButton.disabled = busy || checkingRelay;
  text.disabled = size.disabled = image.disabled = byID("remove").disabled = busy;
}

function setConnection(name = "") {
  connection = name;
  byID("connection").classList.toggle("connected", Boolean(name));
  const needsRelay = !checkingRelay && !relay && !canUseBluetooth;
  const status = checkingRelay ? "Checking connection…" : needsRelay ? "Mac relay required" : "Disconnected";
  byID("connection-label").textContent = name ? `${name} · Connected` : `YHK-7314 · ${status}`;
  connectButton.textContent = name ? "Disconnect" : needsRelay ? "Set up Mac relay" : "Connect printer";
  relaySetup.hidden = !needsRelay;
  updateButtons();
}

function updatePreview() {
  raster = null;
  if (text.value.trim() || photo) {
    try {
      raster = render(canvas, text.value.trim(), photo, Number(size.value));
    } catch (error) {
      announce(error.message, true);
    }
  }
  empty.hidden = raster !== null;
  canvas.hidden = raster === null;
  updateButtons();
}

function clearImage() {
  imageRevision += 1;
  loadingImage = false;
  photo = null;
  image.value = "";
  byID("file-row").hidden = true;
}

async function loadImage(file) {
  if (!file || busy) return;
  const revision = ++imageRevision;
  if (file.size > 20 * 1024 * 1024) {
    loadingImage = false;
    announce("Choose an image no larger than 20 MB.", true);
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
    byID("file-name").textContent = file.name;
    byID("file-row").hidden = false;
    announce("");
  } catch {
    if (revision === imageRevision) announce("Could not open that image. Try a PNG, JPEG, or another format your browser supports.", true);
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
  announce("Checking the printer through your Mac…");
  try {
    await relayRequest("status", {});
    setConnection("YHK-7314 via Mac");
    announce("");
  } catch (error) {
    announce(error.message, true);
  } finally {
    busy = false;
    updateButtons();
  }
}

connectButton.addEventListener("click", async () => {
  if (connection) {
    if (!relay) direct.disconnect();
    setConnection();
    announce("");
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
  announce("Choose your YHK printer in the Bluetooth picker.");
  try {
    setConnection(await direct.connect());
    announce("");
  } catch (error) {
    announce(error.name === "NotFoundError" ? "No printer selected." : error.message, true);
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

printButton.addEventListener("click", async () => {
  if (!raster || !connection || busy) return;
  busy = true;
  updateButtons();
  announce("Checking printer status…");
  try {
    if (relay) {
      let binary = "";
      for (const byte of raster) binary += String.fromCharCode(byte);
      announce("Sending through your Mac… Keep this page open.");
      await relayRequest("print", {raster: btoa(binary)});
    } else {
      await direct.print(raster, progress => {
        const percent = Math.round(progress * 100);
        announce(percent === 100 ? "Finishing the print job…" : `Sending slip · ${percent}%`);
      });
    }
    announce("Print data sent. Check the paper.");
  } catch (error) {
    announce(error.message, true);
  } finally {
    busy = false;
    updateButtons();
  }
});

text.addEventListener("input", () => { announce(""); updatePreview(); });
size.addEventListener("change", () => { announce(""); updatePreview(); });
image.addEventListener("change", () => loadImage(image.files[0]));
byID("remove").addEventListener("click", () => { clearImage(); announce(""); updatePreview(); });
clearButton.addEventListener("click", () => {
  text.value = "";
  clearImage();
  announce("");
  updatePreview();
  text.focus();
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
