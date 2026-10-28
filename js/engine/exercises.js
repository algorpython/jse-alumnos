// Lógica de los ejercicios de código (sin DOM: se prueba con node --test).
// - gradeRun: convierte lo que devuelve runSnippet(código, { tests }) (js/engine/runner.js) en el
//   resultado de cada test: pasa, falla (con lo obtenido), error o sin ejecutar por tiempo límite.
// - recordCheck / saveDraft: guardan en el progreso (state.exercises[id]) el código del alumno, los
//   intentos y si está resuelto. `solved` es el campo que cuenta el resumen de «Progress»
//   (summarize en js/store.js).
// - startIndex / sectionStats: por qué ejercicio empezar y cuántos hay resueltos en una sección.

import { showValue } from "./runner.js";

// Etiqueta de un test { call, expected }: «isEven(4) → true». Los tests { output } no tienen
// etiqueta de una línea: la pantalla muestra la salida esperada en un bloque.
export function testLabel(test) {
  return test.call !== undefined ? `${test.call} → ${showValue(test.expected)}` : null;
}

// Resultado de cada test tras ejecutar. `output`: lo que devuelve runSnippet con `tests`.
// status: "pass" | "fail" (got = lo obtenido) | "error" (la llamada del test lanza un error)
//         | "blocked" (el código lanza un error antes de los tests: no se evalúa ninguno)
//         | "timeout" (no ha llegado a ejecutarse) | "unsupported" (el navegador no puede ejecutar).
export function gradeRun(exercise, output) {
  const tests = exercise.tests;
  const results = tests.map((test, i) => {
    if (output.unsupported) return { status: "unsupported" };
    const r = output.tests?.[i];
    if (!r) return { status: "timeout" };
    if (r.pass) return { status: "pass" };
    if (r.blocked) return { status: "blocked", error: r.error };
    if (r.error) return { status: "error", error: r.error };
    return { status: "fail", got: r.got ?? "" };
  });
  const passed = results.filter((r) => r.status === "pass").length;
  return {
    results,
    passed,
    total: tests.length,
    allPassed: passed === tests.length,
    timedOut: Boolean(output.timedOut),
    unsupported: Boolean(output.unsupported),
  };
}

// Entrada del ejercicio en el progreso (la crea si no existe).
function entry(state, id) {
  if (!state.exercises[id] || typeof state.exercises[id] !== "object") state.exercises[id] = {};
  return state.exercises[id];
}

// Guarda el código que está escribiendo el alumno (para seguir otro día donde lo dejó).
export function saveDraft(state, id, code) {
  entry(state, id).code = String(code);
}

// Guarda una comprobación («Check»). Una vez resuelto, el ejercicio sigue contando como resuelto
// aunque después se cambie el código y falle (lo que cuenta es haberlo conseguido).
export function recordCheck(state, exercise, grade, code, now = new Date()) {
  const e = entry(state, exercise.id);
  e.code = String(code);
  e.attempts = (Number.isInteger(e.attempts) ? e.attempts : 0) + 1;
  e.lastPassed = grade.passed;
  e.total = grade.total;
  e.lastAt = now.toISOString();
  if (grade.allPassed && !e.solved) {
    e.solved = true;
    e.solvedAt = now.toISOString();
  }
  e.solved = Boolean(e.solved);
  return e;
}

// Marca que el alumno ha abierto la solución (solo informativo: no cambia `solved`).
export function recordSolutionSeen(state, id) {
  entry(state, id).sawSolution = true;
}

// Primer ejercicio sin resolver de la lista (o el primero si están todos resueltos).
export function startIndex(exercises, saved = {}) {
  const i = exercises.findIndex((ex) => !saved[ex.id]?.solved);
  return i >= 0 ? i : 0;
}

// Ejercicios de una sección: cuántos hay, cuántos se han intentado y cuántos están resueltos.
export function sectionStats(exercises, saved = {}) {
  let tried = 0;
  let solved = 0;
  for (const ex of exercises) {
    const e = saved[ex.id];
    if (!e) continue;
    if (e.solved) solved++;
    if (e.solved || e.attempts) tried++;
  }
  return { total: exercises.length, tried, solved };
}

// Qué enseña «Coding exercises» de una sección (tarea 9.1):
// - "list": tiene ejercicios (se muestran con normalidad, aunque la sección lleve noExercises);
// - "concepts": no tiene ninguno y sections.json la marca con `noExercises: true` (sección de
//   conceptos, sin ejercicios por diseño: se practica con las preguntas y la ficha de teoría);
// - "soon": no tiene ninguno todavía (contenido a medias o datos de prueba vacíos).
export function exerciseMode(section, total) {
  if (total > 0) return "list";
  return section?.noExercises === true ? "concepts" : "soon";
}
