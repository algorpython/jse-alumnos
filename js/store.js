// Progreso del alumno: un único objeto versionado que se guarda en localStorage.
// - Si localStorage no está disponible (modo privado, bloqueado, cuota llena…), se usa una
//   alternativa en memoria y `store.persistent` pasa a false para avisar en la interfaz.
// - Cada cambio de formato sube VERSION y añade una función a MIGRATIONS que pasa los datos
//   de la versión anterior a la nueva. Al cargar o importar se aplican las que falten.
// - Exportar e importar usan un JSON con cabecera (`app`, `exportedAt`) y los datos dentro.
// No toca el DOM: se puede probar con `node --test` inyectando el almacenamiento y el reloj.

export const STORAGE_KEY = "jse-practice:progress";
export const BACKUP_KEY = "jse-practice:progress:backup";
export const EXPORT_APP = "jse-practice";
export const VERSION = 1;

// Estado inicial de la versión actual. Las tareas siguientes rellenan cada apartado:
// answers (1.3), srs (1.4), exercises (2.1), mocks (3.1), projects (5.1).
export function defaultState(now = new Date()) {
  const stamp = now.toISOString();
  return {
    version: VERSION,
    createdAt: stamp,
    updatedAt: stamp,
    settings: { lang: "en" },
    answers: {},
    srs: {},
    exercises: {},
    mocks: [],
    projects: {},
  };
}

// MIGRATIONS[n] convierte datos de la versión n a la n + 1.
// La versión 0 son los datos sin campo `version` (formato previo a 1.1, por si algún
// navegador guardó algo durante las pruebas): se conservan los apartados conocidos.
export const MIGRATIONS = {
  0(old) {
    const base = defaultState();
    const pick = (key, isOk) => (isOk(old[key]) ? old[key] : base[key]);
    return {
      ...base,
      createdAt: typeof old.createdAt === "string" ? old.createdAt : base.createdAt,
      settings: { ...base.settings, ...(isPlainObject(old.settings) ? old.settings : {}) },
      answers: pick("answers", isPlainObject),
      srs: pick("srs", isPlainObject),
      exercises: pick("exercises", isPlainObject),
      mocks: pick("mocks", Array.isArray),
      projects: pick("projects", isPlainObject),
      version: 1,
    };
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Lleva unos datos a la versión `target`. Lanza un Error con `code` si no se puede.
export function migrate(data, { version = VERSION, migrations = MIGRATIONS } = {}) {
  if (!isPlainObject(data)) throw storeError("invalid", "Progress data is not an object");
  let current = data.version === undefined ? 0 : data.version;
  if (!Number.isInteger(current) || current < 0) throw storeError("invalid", "Unknown progress version");
  if (current > version) throw storeError("newer", `Progress version ${current} is newer than this app (${version})`);
  let result = data;
  while (current < version) {
    const step = migrations[current];
    if (typeof step !== "function") throw storeError("invalid", `No migration from version ${current}`);
    result = step(result);
    current += 1;
    result = { ...result, version: current };
  }
  return result;
}

// Comprueba que los apartados de la versión actual tienen el tipo esperado.
export function validate(data) {
  const objects = ["settings", "answers", "srs", "exercises", "projects"];
  const bad = objects.find((k) => k in data && !isPlainObject(data[k]))
    || ("mocks" in data && !Array.isArray(data.mocks) ? "mocks" : null);
  if (bad) throw storeError("invalid", `Progress field "${bad}" has the wrong type`);
  return data;
}

function storeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Almacenamiento en memoria con la misma interfaz que localStorage.
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

// Devuelve localStorage si se puede leer y escribir; si no, null.
export function browserStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = "jse-practice:probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

// Crea el store. Opciones (para los tests): storage, now (reloj), version y migrations.
export function createStore({ storage, now = () => new Date(), version = VERSION, migrations = MIGRATIONS } = {}) {
  let backend = storage === undefined ? browserStorage() : storage;
  let persistent = Boolean(backend);
  if (!backend) backend = memoryStorage();

  const listeners = new Set();
  let state = load();

  // Lee el progreso guardado. Si está dañado o es de una versión desconocida, guarda una
  // copia en BACKUP_KEY (para no perderlo del todo) y empieza de cero.
  function load() {
    let raw = null;
    try {
      raw = backend.getItem(STORAGE_KEY);
    } catch {
      switchToMemory();
    }
    if (raw == null) return defaultState(now());
    try {
      const data = validate(migrate(JSON.parse(raw), { version, migrations }));
      if (data.version !== safeVersion(raw)) write(data); // se guarda ya migrado
      return data;
    } catch {
      try { backend.setItem(BACKUP_KEY, raw); } catch { /* sin espacio: se pierde la copia */ }
      return defaultState(now());
    }
  }

  function safeVersion(raw) {
    try { return JSON.parse(raw).version; } catch { return undefined; }
  }

  function switchToMemory() {
    persistent = false;
    backend = memoryStorage();
  }

  // Escribe en el almacenamiento. Si falla (cuota, bloqueo), sigue en memoria sin romper la app.
  function write(data) {
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      switchToMemory();
      backend.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }

  function commit(next) {
    state = next;
    write(state);
    listeners.forEach((fn) => fn(state));
    return state;
  }

  return {
    get persistent() { return persistent; },

    // Copia del estado actual (modificarla no cambia el store).
    get() {
      return structuredClone(state);
    },

    // Cambia el estado: `fn` recibe una copia y la modifica o devuelve una nueva.
    update(fn) {
      const draft = structuredClone(state);
      const result = fn(draft);
      const next = result === undefined ? draft : result;
      return structuredClone(commit({ ...next, version, updatedAt: now().toISOString() }));
    },

    // Vuelve a leer el almacenamiento (lo usa app.js cuando otra pestaña cambia el progreso).
    reload() {
      state = load();
      listeners.forEach((fn) => fn(state));
      return structuredClone(state);
    },

    // Avisa de cada cambio. Devuelve la función para dejar de escuchar.
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // Texto JSON para descargar como copia de seguridad.
    exportJSON() {
      return JSON.stringify({ app: EXPORT_APP, exportedAt: now().toISOString(), data: state }, null, 2);
    },

    // Sustituye el progreso por el de un archivo exportado. Devuelve { ok: true } o
    // { ok: false, error } con error = "json" | "format" | "newer" | "invalid".
    // Si falla, el progreso actual no cambia.
    importJSON(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: "json" };
      }
      if (!isPlainObject(parsed) || parsed.app !== EXPORT_APP || !isPlainObject(parsed.data)) {
        return { ok: false, error: "format" };
      }
      let data;
      try {
        data = validate(migrate(parsed.data, { version, migrations }));
      } catch (err) {
        return { ok: false, error: err.code === "newer" ? "newer" : "invalid" };
      }
      const base = defaultState(now());
      commit({ ...base, ...data, settings: { ...base.settings, ...data.settings }, version });
      return { ok: true };
    },

    // Borra todo el progreso y vuelve al estado inicial (se mantiene el idioma elegido).
    reset() {
      const lang = state.settings?.lang;
      const fresh = defaultState(now());
      if (lang) fresh.settings.lang = lang;
      return structuredClone(commit(fresh));
    },
  };
}

// Resumen para la pantalla «Progress». Cada apartado lo rellenará su tarea.
export function summarize(state) {
  const answers = Object.values(state.answers || {});
  const answered = answers.length;
  const correct = answers.filter((a) => a && a.lastCorrect).length;
  return {
    answered,
    accuracy: answered ? Math.round((correct / answered) * 100) : null,
    exercises: Object.values(state.exercises || {}).filter((e) => e && e.solved).length,
    // El simulacro en curso (status "active", js/engine/mock.js) no cuenta hasta que se termina.
    mocks: (state.mocks || []).filter((m) => m && m.status !== "active").length,
    projects: Object.values(state.projects || {}).filter((p) => p && p.done).length,
  };
}
