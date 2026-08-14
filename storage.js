import { emptyState, migrateState, validateBackup } from './domain.js';

const DB_NAME = 'meu-financeiro';
const STORE = 'app';
const STATE_KEY = 'state';
let databasePromise;

function database() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function operation(mode, callback) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function migrateLegacy() {
  for (const key of ['mcf_v3', 'mcf_v2', 'mcf']) {
    const value = localStorage.getItem(key);
    if (!value) continue;
    try {
      const migrated = migrateState(JSON.parse(value));
      await saveState(migrated);
      localStorage.setItem(`${key}_migrated`, new Date().toISOString());
      return migrated;
    } catch (error) {
      console.warn('Falha ao migrar banco legado', error);
    }
  }
  return null;
}

export async function loadState() {
  const stored = await operation('readonly', store => store.get(STATE_KEY));
  if (stored) {
    const migrated = migrateState(stored);
    if (stored.version !== migrated.version || !Array.isArray(stored.members) || !stored.household) {
      await operation('readwrite', store => store.put(migrated, STATE_KEY));
    }
    return migrated;
  }
  return await migrateLegacy() || emptyState();
}

export async function saveState(state) {
  const safe = migrateState(state);
  await operation('readwrite', store => store.put(safe, STATE_KEY));
  return safe;
}

export async function clearState() {
  await operation('readwrite', store => store.delete(STATE_KEY));
  return emptyState();
}

export function exportBackup(state) {
  return JSON.stringify({
    ...migrateState(state),
    backupVersion: 5,
    exportedAt: new Date().toISOString(),
    app: 'Meu Financeiro Família'
  }, null, 2);
}

export function importBackup(text) {
  if (text.length > 10_000_000) throw new Error('O arquivo é grande demais.');
  return validateBackup(JSON.parse(text));
}
