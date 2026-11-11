let database;

function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("yhk-print", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("slips");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Browser storage is busy."));
  });
  return database;
}

export async function readRecord(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("slips").objectStore("slips").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeRecord(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("slips", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.objectStore("slips").put(value, key);
  });
}

export async function updateRecent(update) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("slips", "readwrite");
    const store = transaction.objectStore("slips");
    const request = store.get("recent");
    let recent;
    request.onsuccess = () => {
      recent = update(request.result ?? []);
      store.put(recent, "recent");
    };
    transaction.oncomplete = () => resolve(recent);
    transaction.onabort = () => reject(transaction.error);
  });
}
