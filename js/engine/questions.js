// Motor de preguntas: selección de opciones, corrección y registro de respuestas.
// No toca el DOM (se prueba con `node --test`). Lo usan «Practice by topic» y, más adelante,
// los simulacros (que corrigen igual pero no enseñan el resultado hasta el final).
// Formato de las preguntas: tools/schema.md.

export const TYPES = ["single", "multiple", "output", "error", "gap"];

// Cuántas opciones hay que elegir: las de `answer` en las «choose N» y 1 en el resto.
export function chooseCount(question) {
  return question.type === "multiple" ? question.answer.length : 1;
}

export function isMultiple(question) {
  return question.type === "multiple";
}

// Pulsar una opción. Devuelve la nueva selección (lista de ids en el orden de las opciones).
// - Una sola respuesta: la opción pulsada sustituye a la anterior.
// - «Choose N»: se marca o desmarca. Si ya hay N marcadas, la nueva no entra (hay que
//   desmarcar otra antes), igual que en el examen real.
export function toggleOption(question, selected, optionId) {
  if (!question.options.some((o) => o.id === optionId)) return [...selected];
  if (!isMultiple(question)) return [optionId];
  const set = new Set(selected);
  if (set.has(optionId)) set.delete(optionId);
  else if (set.size < chooseCount(question)) set.add(optionId);
  return question.options.map((o) => o.id).filter((id) => set.has(id));
}

// Se puede corregir cuando hay tantas opciones marcadas como pide la pregunta.
export function canCheck(question, selected) {
  return selected.length === chooseCount(question);
}

// Corrige. Devuelve:
// { correct, selected, answer, options: [{ id, isAnswer, picked, state }] }
// state: "right" (es correcta), "wrong" (la eligió y no lo es) o null (ni una cosa ni otra).
// Las correctas se marcan "right" aunque el alumno no las eligiera, para enseñarle cuáles eran.
export function grade(question, selected) {
  const answer = new Set(question.answer);
  const picked = new Set(selected);
  const correct = picked.size === answer.size && [...answer].every((id) => picked.has(id));
  return {
    correct,
    selected: [...selected],
    answer: [...question.answer],
    options: question.options.map((o) => {
      const isAnswer = answer.has(o.id);
      const wasPicked = picked.has(o.id);
      return { id: o.id, isAnswer, picked: wasPicked, state: isAnswer ? "right" : wasPicked ? "wrong" : null };
    }),
  };
}

// Guarda una respuesta en el progreso (`state.answers[id]`). Modifica `state`.
// Campos: lastCorrect lo lee el resumen de «Progress» (store.summarize); attempts y correct
// cuentan intentos y aciertos; lastAnswer y lastAt sirven para revisar y para el repaso (1.4).
export function recordAnswer(state, question, result, now = new Date()) {
  const prev = state.answers[question.id] || { attempts: 0, correct: 0 };
  state.answers[question.id] = {
    section: question.section,
    attempts: prev.attempts + 1,
    correct: prev.correct + (result.correct ? 1 : 0),
    lastCorrect: result.correct,
    lastAnswer: [...result.selected],
    lastAt: now.toISOString(),
  };
  return state;
}

// Por dónde empezar una sección: la primera pregunta sin responder; si están todas
// respondidas, la primera que se falló la última vez; si no, la primera.
export function startIndex(questions, answers = {}) {
  const fresh = questions.findIndex((q) => !answers[q.id]);
  if (fresh !== -1) return fresh;
  const failed = questions.findIndex((q) => answers[q.id] && !answers[q.id].lastCorrect);
  return failed === -1 ? 0 : failed;
}

// Resumen de una sección para la lista de temas: total, respondidas y acertadas (la última vez).
export function sectionStats(questions, answers = {}) {
  let answered = 0;
  let correct = 0;
  for (const q of questions) {
    const a = answers[q.id];
    if (!a) continue;
    answered++;
    if (a.lastCorrect) correct++;
  }
  return { total: questions.length, answered, correct };
}
