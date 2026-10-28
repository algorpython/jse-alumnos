// Índice ligero del contenido (data/index.json, tarea 8.2). Sin DOM: se prueba con `node --test`.
//
// Las pantallas de resumen (inicio, «Practice by topic», «Progress», listas de ejercicios y de
// proyectos, portada de los simulacros, fichas de teoría) solo necesitan contar: qué preguntas,
// ejercicios y trampas hay en cada sección, los minutos de lectura de cada ficha y los pasos de cada
// proyecto. Con el índice (unos pocos KB) no hace falta descargar los bancos enteros (≈ 1,6 MB).
//
// - No se guarda en el proyecto: lo genera tools/publicar.mjs en dist/data/index.json y, en local,
//   tools/serve.mjs lo calcula al vuelo a partir de los JSON de la carpeta de datos. Así nunca se
//   queda desfasado. Si no está (otra forma de servir la app), js/data.js lo construye en el
//   navegador con esta misma función, cargando los bancos enteros (lo de antes de la 8.2).
// - Formato: tools/schema.md («Índice del contenido»).
//
// Las vistas no leen el índice directamente: summaryFromIndex() lo convierte en «resúmenes» con la
// forma de las preguntas, ejercicios y proyectos (solo los campos que usan los cálculos de resumen:
// id, section, tags, readingMinutes, steps…), y los motores (dashboard, sectionStats, trapQuestions,
// projectProgress, planMock().ok…) funcionan igual con ellos.

import { isTrap, TRAP_TAG } from "./theory.js";

export const INDEX_FORMAT = 1;

// Campos de un proyecto que necesitan el catálogo (#/projects) y el panel de inicio.
const PROJECT_FIELDS = ["id", "number", "level", "title", "summary", "basedOn"];

const ids = (list) => (Array.isArray(list) ? list.map((x) => x.id) : []);

// Construye el índice. Las listas van en el orden de `sections` (como devuelven los loaders).
// - questionBanks / exerciseBanks: preguntas y ejercicios de cada sección ([] si no hay);
// - theorySheets: ficha de cada sección (null si no hay);
// - mockBank: banco exclusivo de simulacros; projects: proyectos que existen, en orden.
export function buildIndex({ sections, questionBanks = [], exerciseBanks = [], theorySheets = [], mockBank = [], projects = [] }) {
  return {
    format: INDEX_FORMAT,
    sections: sections.map((s, i) => {
      const questions = questionBanks[i] || [];
      const sheet = theorySheets[i] || null;
      return {
        id: s.id,
        questions: ids(questions),
        traps: questions.filter(isTrap).map((q) => q.id),
        exercises: ids(exerciseBanks[i]),
        theory: sheet ? { readingMinutes: sheet.readingMinutes } : null,
      };
    }),
    mock: (mockBank || []).map((q) => ({ id: q.id, section: q.section })),
    projects: (projects || []).map((p) => ({
      ...Object.fromEntries(PROJECT_FIELDS.filter((k) => k in p).map((k) => [k, p[k]])),
      steps: (p.steps || []).map((s) => ({ id: s.id, lang: s.lang })),
    })),
  };
}

// ¿Tiene la forma de un índice que esta versión de la app sabe leer?
export function isValidIndex(index) {
  return Boolean(index) && index.format === INDEX_FORMAT
    && Array.isArray(index.sections) && Array.isArray(index.mock) && Array.isArray(index.projects)
    && index.sections.every((s) => Number.isInteger(s?.id) && Array.isArray(s.questions)
      && Array.isArray(s.traps) && Array.isArray(s.exercises));
}

// Resúmenes para las vistas, en el orden de `sections` (las secciones que no están en el índice
// salen vacías). Devuelve { questionBanks, exerciseBanks, theory, mockBank, projects }:
// - questionBanks[i]: [{ id, section, tags }] (tags es ["trap"] o []);
// - exerciseBanks[i]: [{ id, section }]; theory[i]: { readingMinutes } o null;
// - mockBank: [{ id, section }]; projects: [{ id, number, level, title, summary, basedOn, steps }].
export function summaryFromIndex(index, sections) {
  const byId = new Map(index.sections.map((s) => [s.id, s]));
  const questionBanks = [];
  const exerciseBanks = [];
  const theory = [];
  for (const { id } of sections) {
    const entry = byId.get(id);
    const traps = new Set(entry?.traps || []);
    questionBanks.push((entry?.questions || []).map((q) => ({ id: q, section: id, tags: traps.has(q) ? [TRAP_TAG] : [] })));
    exerciseBanks.push((entry?.exercises || []).map((e) => ({ id: e, section: id })));
    theory.push(entry?.theory || null);
  }
  return {
    questionBanks,
    exerciseBanks,
    theory,
    mockBank: index.mock.map((q) => ({ ...q })),
    projects: index.projects.map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s })) })),
  };
}

// Dónde está cada pregunta: Map(id → número de sección) para las de práctica y "mock" para las del
// banco exclusivo. Sirve para cargar solo los bancos que contienen unas preguntas concretas.
export function questionHomes(index) {
  const homes = new Map();
  for (const s of index.sections) for (const id of s.questions) homes.set(id, s.id);
  for (const q of index.mock) homes.set(q.id, "mock");
  return homes;
}
