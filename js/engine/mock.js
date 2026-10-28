// Motor de los simulacros. No toca el DOM: se prueba con `node --test` pasando el reloj (`now`)
// y el generador de números aleatorios (`rng`).
//
// Reglas (decisión del cliente, CLAUDE.md):
// - 30 preguntas, 40 minutos, aprobado con el 70 %, sin feedback hasta el final.
// - Reparto por secciones según data/sections.json: el número oficial de ítems de cada bloque
//   (`items`: 3, 6, 5, 6, 6 y 4) o, si falta, su peso (`weight`). Si falta algún dato, se usan
//   pesos iguales (`provisional: true`).
// - Entre el 60 y el 70 % de las preguntas llevan código (`code`).
// - Opción C: los 4 primeros simulacros usan preguntas inéditas del banco exclusivo
//   (data/mock/mock-bank.json); después se mezclan el banco exclusivo y el de práctica.
//   Una pregunta exclusiva no se repite mientras queden exclusivas inéditas.
// - Al terminar, las preguntas respondidas mal entran en el repaso espaciado (js/srs.js).
//
// Cada simulacro es un registro de `state.mocks`:
// { number, status: "active" | "done", startedAt, endsAt, durationMs, questions: [ids],
//   quotas: { sección: n }, provisional, phase, answers: { id: [opciones] }, flagged: [ids],
//   finishedAt?, reason?: "submitted" | "timeout", score?, toReview? }

import { grade } from "./questions.js";
import { reviewAnswer } from "../srs.js";

export const MOCK_SIZE = 30;
export const MOCK_MINUTES = 40;
export const PASS_PERCENT = 70;
// Porcentaje de preguntas con código (mínimo y máximo).
export const CODE_SHARE = { min: 60, max: 70 };
// Simulacros que solo usan preguntas inéditas del banco exclusivo (opción C).
export const EXCLUSIVE_MOCKS = 4;

export function hasCode(question) {
  return typeof question?.code === "string" && question.code.trim() !== "";
}

// Cuántas preguntas con código caben en un simulacro de `size`: { min, max } (30 → 18 a 21).
export function codeRange(size = MOCK_SIZE) {
  return { min: Math.ceil((size * CODE_SHARE.min) / 100), max: Math.floor((size * CODE_SHARE.max) / 100) };
}

// Pesos de las secciones para el reparto. Si todas tienen `items` (ítems oficiales del examen),
// se usan esos: con 30 preguntas el simulacro reproduce el reparto real (3, 6, 5, 6, 6, 4), que
// los porcentajes redondeados (8, 20, 18, 21, 21, 12) no dan exacto. Si no, los `weight`; y si
// falta alguno, pesos iguales. Devuelve { weights: Map(id → peso), provisional }.
export function sectionWeights(sections) {
  const valid = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
  const all = (key) => sections.length > 0 && sections.every((s) => valid(s[key]));
  const key = all("items") ? "items" : all("weight") ? "weight" : null;
  return { provisional: !key, weights: new Map(sections.map((s) => [s.id, key ? s[key] : 1])) };
}

// Reparte `size` preguntas entre las secciones en proporción a su peso (método del resto mayor).
// `capacity` (Map id → preguntas disponibles): ninguna sección recibe más de las que tiene y lo
// que no cabe se reparte entre las demás, otra vez según su peso. Devuelve Map(id → n).
export function allocate(weights, size, capacity = null) {
  const cap = (id) => (capacity ? capacity.get(id) || 0 : Infinity);
  const quotas = new Map([...weights.keys()].map((id) => [id, 0]));
  let left = size;
  let open = [...weights.keys()].filter((id) => weights.get(id) > 0 && cap(id) > 0);
  while (left > 0 && open.length) {
    const total = open.reduce((sum, id) => sum + weights.get(id), 0);
    const shares = open.map((id) => {
      const exact = (left * weights.get(id)) / total;
      return { id, n: Math.floor(exact), rem: exact - Math.floor(exact) };
    });
    const extra = left - shares.reduce((sum, s) => sum + s.n, 0);
    [...shares].sort((a, b) => b.rem - a.rem || a.id - b.id).slice(0, extra).forEach((s) => { s.n++; });
    let given = 0;
    for (const s of shares) {
      const n = Math.min(s.n, cap(s.id) - quotas.get(s.id));
      quotas.set(s.id, quotas.get(s.id) + n);
      given += n;
    }
    left -= given;
    open = open.filter((id) => quotas.get(id) < cap(id));
    if (!given) break;
  }
  return quotas;
}

// Generador de números aleatorios con semilla (mulberry32), para los tests y el modo ?debug.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Veces que ha salido cada pregunta en los simulacros anteriores: Map(id → n).
export function mockUsage(history = []) {
  const uses = new Map();
  for (const mock of history) {
    for (const id of mock?.questions || []) uses.set(id, (uses.get(id) || 0) + 1);
  }
  return uses;
}

// Primero las que menos han salido; a igualdad, en orden aleatorio.
function leastUsed(list, uses, rng) {
  return shuffle(list, rng).sort((a, b) => (uses.get(a.id) || 0) - (uses.get(b.id) || 0));
}

// Alterna dos listas: a1, b1, a2, b2… (y luego lo que sobre de la más larga).
function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

// Prepara un simulacro nuevo. `history`: los simulacros anteriores (state.mocks).
// Devuelve { ok: true, questions: [ids], quotas, provisional, phase, codeCount, codeOk, exclusive }
// o { ok: false, reason: "not-enough", available } si no hay preguntas suficientes.
//
// Cómo elige:
// 1. Ordena las candidatas de cada sección por prioridad:
//    - fase «exclusive» (4 primeros simulacros): las exclusivas inéditas, al azar; después, solo si
//      no bastan, el resto («relleno»: práctica y, si ya no quedan inéditas, exclusivas ya vistas);
//    - fase «mixed»: alterna exclusivas (inéditas primero y luego las que menos han salido) y
//      preguntas de práctica (las que menos han salido en simulacros).
//    Mientras quede alguna exclusiva inédita, las exclusivas ya vistas no son candidatas.
// 2. Reparte las 30 plazas entre las secciones según los pesos (allocate) y toma las primeras.
// 3. Si las preguntas con código no están entre el 60 y el 70 %, cambia dentro de una misma
//    sección una sin código por una con código (o al revés), la que menos empeore la prioridad.
// 4. Desordena las 30 preguntas.
export function planMock({ sections, mockBank = [], practiceBank = [], history = [], rng = Math.random, size = MOCK_SIZE }) {
  const uses = mockUsage(history);
  const phase = history.length < EXCLUSIVE_MOCKS ? "exclusive" : "mixed";
  const sectionIds = new Set(sections.map((s) => s.id));
  const exclusive = mockBank.filter((q) => sectionIds.has(q.section));
  const practice = practiceBank.filter((q) => sectionIds.has(q.section) && !exclusive.some((e) => e.id === q.id));
  const unseen = exclusive.filter((q) => !uses.has(q.id));
  const allowSeen = unseen.length === 0;

  const lists = new Map();
  for (const { id } of sections) {
    const inSection = (q) => q.section === id;
    const fresh = shuffle(unseen.filter(inSection), rng);
    const seen = allowSeen ? leastUsed(exclusive.filter((q) => inSection(q) && uses.has(q.id)), uses, rng) : [];
    const prac = leastUsed(practice.filter(inSection), uses, rng);
    lists.set(id, phase === "exclusive" ? [...fresh, ...interleave(seen, prac)] : interleave([...fresh, ...seen], prac));
  }

  const { weights, provisional } = sectionWeights(sections);
  const capacity = new Map([...lists].map(([id, list]) => [id, list.length]));
  const available = [...capacity.values()].reduce((a, b) => a + b, 0);
  if (available < size) return { ok: false, reason: "not-enough", available };
  const quotas = allocate(weights, size, capacity);

  // Posiciones elegidas de la lista de cada sección.
  const chosen = new Map([...lists].map(([id]) => [id, new Set(Array.from({ length: quotas.get(id) }, (_, i) => i))]));
  const codeCount = () => [...chosen].reduce((n, [id, set]) => n + [...set].filter((i) => hasCode(lists.get(id)[i])).length, 0);

  // Un cambio: sale una elegida sin código (o con código) y entra la primera no elegida del otro
  // tipo de la misma sección. Se elige el cambio que menos empeora la prioridad.
  // `sameTier`: solo cambios entre inéditas o entre no inéditas (no saca una inédita para meter
  // una de relleno).
  const fresh = new Set(unseen.map((q) => q.id));
  const tier = (q) => (fresh.has(q.id) ? 0 : 1);
  function swap(wantCode, sameTier = false) {
    let best = null;
    for (const [id, list] of lists) {
      const set = chosen.get(id);
      for (const outIdx of [...set].filter((i) => hasCode(list[i]) !== wantCode).sort((a, b) => b - a)) {
        const inIdx = list.findIndex((q, i) => !set.has(i) && hasCode(q) === wantCode
          && (!sameTier || tier(q) === tier(list[outIdx])));
        if (inIdx === -1) continue;
        const cost = inIdx - outIdx;
        if (!best || cost < best.cost) best = { id, inIdx, outIdx, cost };
        break;
      }
    }
    if (!best) return false;
    chosen.get(best.id).delete(best.outIdx);
    chosen.get(best.id).add(best.inIdx);
    return true;
  }
  // Objetivo: la proporción de código de las candidatas preferidas (las inéditas en los 4 primeros,
  // si bastan), dentro del 60–70 %. Así, simulacro a simulacro, el banco exclusivo se gasta de
  // forma pareja y al último no le sobran preguntas de un tipo.
  const { min, max } = codeRange(size);
  const preferred = phase === "exclusive" && unseen.length >= size ? unseen : [...lists.values()].flat();
  const target = Math.min(max, Math.max(min, Math.round((size * preferred.filter(hasCode).length) / preferred.length)));
  while (codeCount() < target && swap(true, true));
  while (codeCount() > target && swap(false, true));
  while (codeCount() < min && swap(true));
  while (codeCount() > max && swap(false));

  const picked = [...chosen].flatMap(([id, set]) => [...set].sort((a, b) => a - b).map((i) => lists.get(id)[i]));
  const code = codeCount();
  const exclusiveIds = new Set(exclusive.map((q) => q.id));
  return {
    ok: true,
    questions: shuffle(picked, rng).map((q) => q.id),
    quotas: Object.fromEntries(quotas),
    provisional,
    phase,
    codeCount: code,
    codeOk: code >= min && code <= max,
    exclusive: picked.filter((q) => exclusiveIds.has(q.id)).length,
  };
}

// ---------------------------------------------------------------------------
// Simulacro en curso
// ---------------------------------------------------------------------------

// Empieza un simulacro con un plan de planMock. Modifica `state.mocks` y devuelve el registro.
export function startMock(state, plan, now = new Date(), { durationMs = MOCK_MINUTES * 60000 } = {}) {
  if (!Array.isArray(state.mocks)) state.mocks = [];
  const number = state.mocks.reduce((n, m) => Math.max(n, m?.number || 0), 0) + 1;
  const mock = {
    number,
    status: "active",
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + durationMs).toISOString(),
    durationMs,
    questions: [...plan.questions],
    quotas: { ...plan.quotas },
    provisional: Boolean(plan.provisional),
    phase: plan.phase,
    answers: {},
    flagged: [],
  };
  state.mocks.push(mock);
  return mock;
}

export function activeMock(state) {
  return (state.mocks || []).find((m) => m && m.status === "active") || null;
}

export function findMock(state, number) {
  return (state.mocks || []).find((m) => m && m.number === number) || null;
}

// Simulacros terminados, del más antiguo al más reciente.
export function finishedMocks(state) {
  return (state.mocks || []).filter((m) => m && m.status === "done");
}

// Milisegundos que quedan (0 si se ha acabado el tiempo).
export function timeLeft(mock, now = new Date()) {
  return Math.max(0, Date.parse(mock.endsAt) - now.getTime());
}

export function isExpired(mock, now = new Date()) {
  return timeLeft(mock, now) <= 0;
}

// "mm:ss". Se redondea hacia arriba: con 0,4 s restantes aún se ve 00:01.
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Guarda lo elegido en una pregunta (lista vacía = sin responder). Solo si el simulacro sigue abierto.
export function setMockAnswer(mock, id, selected) {
  if (mock.status !== "active" || !mock.questions.includes(id)) return mock;
  if (selected.length) mock.answers[id] = [...selected];
  else delete mock.answers[id];
  return mock;
}

// Marca o desmarca una pregunta «para revisar».
export function toggleFlag(mock, id) {
  if (mock.status !== "active" || !mock.questions.includes(id)) return mock;
  const set = new Set(mock.flagged);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  mock.flagged = mock.questions.filter((q) => set.has(q));
  return mock;
}

export function isAnswered(mock, id) {
  return Array.isArray(mock.answers[id]) && mock.answers[id].length > 0;
}

// Cifras de la cuadrícula, como en la maqueta: las marcadas se cuentan aparte (aunque estén
// respondidas), así answered + flagged + unanswered = total.
// `empty`: las que no tienen respuesta (marcadas o no), para el aviso de «Finish exam».
export function navStats(mock) {
  const flagged = new Set(mock.flagged);
  let answered = 0;
  let unanswered = 0;
  let empty = 0;
  for (const id of mock.questions) {
    const done = isAnswered(mock, id);
    if (!done) empty++;
    if (flagged.has(id)) continue;
    if (done) answered++;
    else unanswered++;
  }
  return { total: mock.questions.length, answered, flagged: flagged.size, unanswered, empty };
}

// Nota del simulacro. `byId`: Map(id → pregunta). Las preguntas que ya no existen (contenido
// retirado) no cuentan. Sin responder = fallada.
// { correct, total, percent, passed, unanswered, bySection: { sección: { correct, total } }, items }
export function scoreMock(mock, byId) {
  const items = [];
  const bySection = {};
  for (const id of mock.questions) {
    const q = byId.get(id);
    if (!q) continue;
    const selected = mock.answers[id] || [];
    const answered = selected.length > 0;
    const correct = answered && grade(q, selected).correct;
    items.push({ id, section: q.section, answered, correct });
    const sec = (bySection[q.section] ||= { correct: 0, total: 0 });
    sec.total++;
    if (correct) sec.correct++;
  }
  const total = items.length;
  const correct = items.filter((i) => i.correct).length;
  return {
    correct,
    total,
    percent: total ? Math.round((correct / total) * 100) : 0,
    // Se compara sin redondear: 20 de 30 (66,7 %) no llega al 70 %.
    passed: total > 0 && correct * 100 >= PASS_PERCENT * total,
    unanswered: items.filter((i) => !i.answered).length,
    bySection,
    items,
  };
}

// Preguntas que faltan para el aprobado (0 si ya está aprobado).
export function toPass(score) {
  return Math.max(0, Math.ceil((PASS_PERCENT * score.total) / 100) - score.correct);
}

// Termina el simulacro `number`: lo corrige, guarda la nota y pasa las respuestas al repaso
// espaciado (las respondidas mal entran en «My mistakes»; las sin responder no, porque el alumno
// no llegó a verlas o no las intentó; las acertadas cuentan como repaso si tocaban ese día).
// reason: "submitted" (botón) o "timeout" (se acabó el tiempo: termina a la hora de `endsAt`).
// Modifica `state`. Devuelve el registro o null si no hay un simulacro activo con ese número.
export function finishMock(state, number, byId, now = new Date(), reason = "submitted") {
  const mock = findMock(state, number);
  if (!mock || mock.status !== "active") return null;
  mock.status = "done";
  mock.reason = reason;
  mock.finishedAt = reason === "timeout" ? mock.endsAt : now.toISOString();
  mock.score = scoreMock(mock, byId);
  let toReview = 0;
  for (const item of mock.score.items) {
    if (!item.answered) continue;
    const outcome = reviewAnswer(state, byId.get(item.id), item.correct, now);
    if (outcome.event === "added" || outcome.event === "reset") toReview++;
  }
  mock.toReview = toReview;
  return mock;
}

// Fin por tiempo: si el simulacro activo ha agotado sus 40 minutos (también si el alumno cerró
// la pestaña y vuelve más tarde), lo termina con reason "timeout". Modifica `state`.
// Devuelve el registro terminado o null si no había nada que cerrar.
export function closeExpired(state, byId, now = new Date()) {
  const mock = activeMock(state);
  if (!mock || !isExpired(mock, now)) return null;
  return finishMock(state, mock.number, byId, now, "timeout");
}
