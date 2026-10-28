// Fichas de teoría y modo «Tricky questions». Sin DOM (se prueba con `node --test`).
// - Las preguntas con la etiqueta `trap` son las trampas típicas del examen: el modo «Tricky
//   questions» practica solo esas, de todas las secciones o de una.
// - Los ejemplos de las fichas se ejecutan con «Run this code» (js/views/runner-panel.js), que
//   trabaja con preguntas: cada ejemplo se presenta como una «pregunta» mínima { id, code, type }.
// Formato de las fichas: tools/schema.md («Teoría»).

export const TRAP_TAG = "trap";

export function isTrap(question) {
  return Array.isArray(question?.tags) && question.tags.includes(TRAP_TAG);
}

// Preguntas trampa de varios bancos (listas de preguntas), en orden de sección y, dentro de
// cada sección, en el orden del archivo. `section` (opcional): solo las de esa sección.
export function trapQuestions(banks, section = null) {
  return banks
    .flat()
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => isTrap(q) && (section === null || q.section === section))
    .sort((a, b) => a.q.section - b.q.section || a.i - b.i)
    .map(({ q }) => q);
}

// Cuántas preguntas trampa hay por sección: Map(sección → número). Solo las secciones con alguna.
export function trapCounts(banks) {
  const counts = new Map();
  for (const q of banks.flat()) {
    if (isTrap(q)) counts.set(q.section, (counts.get(q.section) || 0) + 1);
  }
  return counts;
}

// Alcance del modo «Tricky questions» según la ruta: #/tricky (todas) o #/tricky/2 (sección 2).
// Devuelve null (todas), el número de sección o undefined si el parámetro no es válido.
export function trickyScope(param) {
  if (param === undefined || param === null || param === "") return null;
  const n = Number(param);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : undefined;
}

// Ejemplos ejecutables de una ficha, en el orden en que aparecen (primero los apartados y después
// las trampas). Cada uno: { key, kind, index, item, example, question }.
// - key: "blocks-0", "traps-2"… (lo usa ?debug&run= y el botón de cada ejemplo);
// - question: { id, code, type } para «Run this code»; el id es único en toda la app.
export function sheetExamples(sheet) {
  const out = [];
  for (const kind of ["blocks", "traps"]) {
    (sheet?.[kind] || []).forEach((item, index) => {
      const example = item?.example;
      if (!example || typeof example.code !== "string") return;
      const key = `${kind}-${index}`;
      out.push({
        key, kind, index, item, example,
        question: { id: `theory-s${sheet.section}-${key}`, code: example.code, type: "output" },
      });
    });
  }
  return out;
}

// Ejemplo de una ficha por su clave, o null.
export function findExample(sheet, key) {
  return sheetExamples(sheet).find((e) => e.key === key) || null;
}

// Lo que se espera del ejemplo: { output, errorType }. `output`: lo que muestra la consola (null si
// no se indica); `errorType`: el error que lanza al final (null si no lanza ninguno).
export function expectedResult(example) {
  const output = typeof example?.output === "string" ? example.output : null;
  const errorType = example?.errorType || null;
  return output === null && !errorType ? null : { output, errorType };
}
