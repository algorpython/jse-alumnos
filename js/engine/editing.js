// Ediciones del editor de código (sin DOM: se prueba con node --test).
// Cada función recibe el texto y la selección y devuelve el cambio que hay que hacer:
// { from, to, text, selStart, selEnd }: sustituir value[from..to) por `text` y dejar la
// selección en [selStart, selEnd). js/views/code-editor.js lo aplica al <textarea>.

export const INDENT = "  "; // 2 espacios, como el código del curso y de tools/schema.md

function lineStartOf(value, pos) {
  return value.lastIndexOf("\n", pos - 1) + 1;
}

// Tab (outdent = false) y Mayús+Tab (outdent = true).
// - Tab sin selección: inserta 2 espacios donde está el cursor.
// - Tab con selección: sangra todas las líneas tocadas por la selección.
// - Mayús+Tab: quita hasta 2 espacios (o un tabulador) del principio de cada línea tocada.
export function indentEdit(value, start, end, outdent = false) {
  if (!outdent && start === end) {
    return { from: start, to: end, text: INDENT, selStart: start + INDENT.length, selEnd: start + INDENT.length };
  }
  const from = lineStartOf(value, start);
  // Si la selección acaba justo al principio de una línea, esa línea no se toca.
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  let to = value.indexOf("\n", last);
  if (to < 0) to = value.length;
  const lines = value.slice(from, to).split("\n");

  let firstDelta = 0;
  let total = 0;
  const changed = lines.map((line, i) => {
    let delta;
    let next;
    if (outdent) {
      const m = /^( {1,2}|\t)/.exec(line);
      delta = m ? -m[0].length : 0;
      next = line.slice(-delta);
    } else {
      // Las líneas vacías de una selección no se sangran (no dejan espacios sueltos).
      delta = line.length || lines.length === 1 ? INDENT.length : 0;
      next = delta ? INDENT + line : line;
    }
    if (i === 0) firstDelta = delta;
    total += delta;
    return next;
  });
  const text = changed.join("\n");
  // El cursor (o el principio de la selección) se mueve con su línea, sin salirse de ella.
  const selStart = Math.max(from, start + firstDelta);
  const selEnd = start === end ? selStart : Math.max(selStart, end + total);
  return { from, to, text, selStart, selEnd };
}

// Intro: salto de línea con la misma sangría que la línea actual, y un nivel más si la línea
// acaba en «{», «[» o «(». Si el cursor está justo antes del cierre («{|}»), el cierre baja a
// su propia línea con la sangría original.
export function newlineEdit(value, start, end) {
  const from = lineStartOf(value, start);
  const indent = /^[ \t]*/.exec(value.slice(from, start))[0];
  const before = value.slice(from, start).trimEnd();
  const opens = /[{[(]$/.test(before);
  const inner = opens ? indent + INDENT : indent;
  const closes = opens && /^[}\])]/.test(value.slice(end));
  const text = "\n" + inner + (closes ? "\n" + indent : "");
  const caret = start + 1 + inner.length;
  return { from: start, to: end, text, selStart: caret, selEnd: caret };
}

// Aplica un cambio a un texto (lo usan los tests; en el navegador se aplica al textarea).
export function applyEdit(value, edit) {
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}
