// Cálculos de la pantalla de resultados del simulacro (como ../maquetas/05_resultados.png).
// No toca el DOM: se prueba con `node --test`. La nota la calcula scoreMock (js/engine/mock.js)
// al terminar y se guarda en el registro (`mock.score`); aquí se prepara para pintarla:
// tiempo empleado, nota por sección, secciones en las que centrarse, comparación con el
// simulacro anterior y la lista de la revisión pregunta a pregunta.
//
// Tono (decisión del cliente, CLAUDE.md): siempre motivador. Por eso la comparación solo
// destaca lo que ha mejorado y las secciones flojas se presentan como «Focus next on…».

import { PASS_PERCENT, finishedMocks } from "./mock.js";
import { grade } from "./questions.js";

// Tiempo empleado en ms: de `startedAt` a `finishedAt`, sin pasar de la duración del simulacro
// (si se cerró por tiempo, la duración entera).
export function timeTaken(mock) {
  const start = Date.parse(mock.startedAt);
  const end = Date.parse(mock.finishedAt || mock.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const limit = Number.isFinite(mock.durationMs) ? mock.durationMs : Infinity;
  return Math.max(0, Math.min(end - start, limit));
}

// { min, sec } de una duración en ms (segundos redondeados hacia abajo).
export function splitDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { min: Math.floor(total / 60), sec: total % 60 };
}

// ¿Llega al aprobado? Sin redondear, igual que la nota global: 2 de 3 (66,7 %) no llega.
export function reachesPass(correct, total) {
  return total > 0 && correct * 100 >= PASS_PERCENT * total;
}

// Nota por sección, en el orden de `sections` y solo las que tuvieron preguntas:
// [{ id, correct, total, percent, ok }]. `ok`: llega al 70 %.
export function sectionRows(score, sections) {
  const rows = [];
  for (const { id } of sections) {
    const s = score?.bySection?.[id];
    if (!s || !s.total) continue;
    rows.push({ id, correct: s.correct, total: s.total, percent: Math.round((s.correct / s.total) * 100), ok: reachesPass(s.correct, s.total) });
  }
  return rows;
}

// Secciones en las que centrarse: las que no llegan al 70 %, de la más floja a la menos floja
// (a igualdad, la que tiene más fallos y después la de número menor).
export function focusSections(rows) {
  return rows
    .filter((r) => !r.ok)
    .sort((a, b) => a.correct / a.total - b.correct / b.total || (b.total - b.correct) - (a.total - a.correct) || a.id - b.id);
}

// La sección con menos acierto (para sugerir algo aunque todas aprueben). null si no hay filas.
export function lowestSection(rows) {
  return [...rows].sort((a, b) => a.correct / a.total - b.correct / b.total || a.id - b.id)[0] || null;
}

// Simulacro terminado justo antes de `mock` (el de número mayor por debajo del suyo), o null.
export function previousMock(state, mock) {
  const before = finishedMocks(state).filter((m) => m.number < mock.number && m.score?.total > 0);
  return before.reduce((best, m) => (!best || m.number > best.number ? m : best), null);
}

// Comparación con el simulacro anterior. null si es el primero.
// { previous: número, from, to (porcentajes), deltaCorrect, trend: "up" | "same" | "down",
//   improved: [{ id, from, to }] } — `improved`: secciones que han subido de porcentaje
// (solo las que salieron en los dos simulacros).
// Se compara el porcentaje, no los aciertos, por si los dos simulacros tienen un total distinto
// (preguntas retiradas del contenido).
export function compareWithPrevious(state, mock) {
  const prev = previousMock(state, mock);
  if (!prev || !mock.score?.total) return null;
  const pct = (s) => (s.correct / s.total) * 100;
  const now = pct(mock.score);
  const before = pct(prev.score);
  const improved = [];
  for (const [id, s] of Object.entries(mock.score.bySection || {})) {
    const p = prev.score.bySection?.[id];
    if (!s.total || !p?.total) continue;
    if (pct(s) > pct(p)) improved.push({ id: Number(id), from: Math.round(pct(p)), to: Math.round(pct(s)) });
  }
  improved.sort((a, b) => a.id - b.id);
  const diff = now - before;
  return {
    previous: prev.number,
    from: prev.score.percent,
    to: mock.score.percent,
    deltaCorrect: mock.score.correct - prev.score.correct,
    // Margen para la coma flotante: dos notas iguales no son «up» ni «down».
    trend: diff > 1e-9 ? "up" : diff < -1e-9 ? "down" : "same",
    improved,
  };
}

// Estado de una pregunta en la revisión: "right", "wrong" o "empty" (sin responder).
function statusOf(answered, correct) {
  return correct ? "right" : answered ? "wrong" : "empty";
}

// Preguntas de la revisión, en el orden del examen (número = el de la cuadrícula):
// [{ number, id, question, selected, result, status }]. Las preguntas retiradas no salen.
// filter: "all", "review" (falladas y sin responder) o "right".
export function reviewItems(mock, byId, filter = "all") {
  const out = [];
  mock.questions.forEach((id, i) => {
    const question = byId.get(id);
    if (!question) return;
    const selected = mock.answers?.[id] || [];
    const result = grade(question, selected);
    const status = statusOf(selected.length > 0, selected.length > 0 && result.correct);
    if (filter === "review" && status === "right") return;
    if (filter === "right" && status !== "right") return;
    out.push({ number: i + 1, id, question, selected, result, status });
  });
  return out;
}

// Cuántas hay de cada filtro: { all, review, right }.
export function reviewCounts(mock, byId) {
  const items = reviewItems(mock, byId);
  const right = items.filter((it) => it.status === "right").length;
  return { all: items.length, review: items.length - right, right };
}
