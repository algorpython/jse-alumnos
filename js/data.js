// Carga de los datos de contenido (data/*.json) con fetch. Cada archivo se pide una sola vez (caché
// en memoria) y solo cuando una pantalla lo necesita (carga perezosa, 8.2):
// - las pantallas de resumen usan loadSummary() (el índice ligero data/index.json, unos KB);
// - las que enseñan preguntas cargan solo los bancos de esas preguntas (loadQuestions(sección),
//   loadQuestionsById(ids)).
// - Si el banco de una sección aún no existe (404), la sección se trata como vacía: el
//   contenido llega por tareas (fase 6 y 7) y la app tiene que funcionar mientras tanto.
// - Con ?debug, `?data=tests/fixtures/engine` carga los datos de otra carpeta del proyecto
//   (lo usan smoke.ps1 y screens.ps1 para probar pantallas con datos de prueba).

import { buildIndex, isValidIndex, summaryFromIndex, questionHomes } from "./engine/content-index.js";

const params = new URLSearchParams(globalThis.location?.search || "");
const override = params.has("debug") && /^tests\/fixtures\/[\w-]+$/.test(params.get("data") || "")
  ? params.get("data")
  : null;

export const DATA_DIR = override || "data";

const cache = new Map();

// Lee un JSON de la carpeta de datos. `optional`: devuelve `fallback` si no existe (404).
async function getJson(path, { optional = false, fallback = null } = {}) {
  if (!cache.has(path)) {
    cache.set(path, (async () => {
      const res = await fetch(`${DATA_DIR}/${path}`);
      if (res.status === 404 && optional) return fallback;
      if (!res.ok) throw new Error(`Couldn't load ${DATA_DIR}/${path} (${res.status})`);
      return res.json();
    })());
    // Si falla, se olvida para poder reintentar.
    cache.get(path).catch(() => cache.delete(path));
  }
  return cache.get(path);
}

// Secciones del temario (data/sections.json), ordenadas por id.
export async function loadSections() {
  const data = await getJson("sections.json");
  return [...data.sections].sort((a, b) => a.id - b.id);
}

// Glosario técnico EN↔ES (data/glossary.json). [] si aún no hay.
export async function loadGlossary() {
  return getJson("glossary.json", { optional: true, fallback: [] });
}

// Preguntas de práctica de una sección (data/questions/sN.json). [] si aún no hay.
export async function loadQuestions(section) {
  return getJson(`questions/s${section}.json`, { optional: true, fallback: [] });
}

// Ejercicios de código de una sección (data/exercises/sN.json). [] si aún no hay.
export async function loadExercises(section) {
  return getJson(`exercises/s${section}.json`, { optional: true, fallback: [] });
}

// Ficha de teoría y trampas de una sección (data/theory/sN.json). null si aún no hay.
export async function loadTheory(section) {
  return getJson(`theory/s${section}.json`, { optional: true, fallback: null });
}

// Banco exclusivo de los simulacros (data/mock/mock-bank.json). [] si aún no hay.
export async function loadMockBank() {
  return getJson("mock/mock-bank.json", { optional: true, fallback: [] });
}

// Proyectos de «Course review» (data/projects/p1.json … p6.json). Los que aún no existen no se
// incluyen: el contenido llega por tareas (5.2 y 7.7–7.11).
export const PROJECT_COUNT = 6;

// Un proyecto por su número (1–6). null si no existe.
export async function loadProject(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1 || n > PROJECT_COUNT) return null;
  return getJson(`projects/p${n}.json`, { optional: true, fallback: null });
}

// Todos los proyectos que existen, en orden.
export async function loadProjects() {
  const all = await Promise.all(Array.from({ length: PROJECT_COUNT }, (_, i) => loadProject(i + 1)));
  return all.filter(Boolean).sort((a, b) => a.number - b.number);
}

// ---------------------------------------------------------------------------
// Índice ligero (js/engine/content-index.js) y cargas por id
// ---------------------------------------------------------------------------

let indexPromise = null;

// El índice del contenido: index.json de la carpeta de datos (lo genera tools/publicar.mjs y, en
// local, tools/serve.mjs lo calcula al vuelo). Si no está o no es de este formato, se construye aquí
// cargando los bancos enteros (más lento, pero la app funciona igual con cualquier servidor estático).
export function loadIndex() {
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        const index = await getJson("index.json", { optional: true, fallback: null });
        if (isValidIndex(index)) return index;
      } catch {
        // Sin índice: se construye abajo.
      }
      return buildIndexFromBanks();
    })();
    // Si falla, se olvida para poder reintentar.
    indexPromise.catch(() => { indexPromise = null; });
  }
  return indexPromise;
}

async function buildIndexFromBanks() {
  // Sin sections.json (p. ej., los datos de prueba del catálogo de proyectos) el índice sigue
  // sirviendo para los proyectos; las pantallas que necesitan las secciones fallan al pedirlas.
  const sections = await loadSections().catch(() => []);
  const [questionBanks, exerciseBanks, theorySheets, mockBank, projects] = await Promise.all([
    Promise.all(sections.map((s) => loadQuestions(s.id))),
    Promise.all(sections.map((s) => loadExercises(s.id))),
    Promise.all(sections.map((s) => loadTheory(s.id))),
    loadMockBank(),
    loadProjects(),
  ]);
  return buildIndex({ sections, questionBanks, exerciseBanks, theorySheets, mockBank, projects });
}

// Resumen del contenido para las pantallas que solo cuentan (ver summaryFromIndex en
// js/engine/content-index.js): { sections, questionBanks, exerciseBanks, theory, mockBank, projects }.
export async function loadSummary() {
  const [sections, index] = await Promise.all([loadSections(), loadIndex()]);
  return { sections, ...summaryFromIndex(index, sections) };
}

// Solo los proyectos del resumen (el catálogo no necesita las secciones).
export async function loadProjectSummaries() {
  return summaryFromIndex(await loadIndex(), []).projects;
}

// Las preguntas completas con esos ids, de la práctica o del banco de simulacros: Map(id → pregunta).
// Solo se descargan los bancos donde están. Los ids que ya no existen (contenido retirado) no salen.
export async function loadQuestionsById(ids) {
  const list = [...ids];
  if (!list.length) return new Map();
  const homes = questionHomes(await loadIndex());
  const needed = new Set(list.map((id) => homes.get(id)).filter((h) => h !== undefined));
  const banks = await Promise.all([...needed].map((h) => (h === "mock" ? loadMockBank() : loadQuestions(h))));
  const wanted = new Set(list);
  const byId = new Map();
  for (const q of banks.flat()) if (wanted.has(q.id)) byId.set(q.id, q);
  return byId;
}
