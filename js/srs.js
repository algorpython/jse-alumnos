// Repaso espaciado de errores («My mistakes»). No toca el DOM: se prueba con `node --test`
// pasando el reloj (`now`) a cada función.
//
// Reglas (decisión del cliente, CLAUDE.md):
// - Una pregunta fallada entra en el repaso y vuelve al día siguiente.
// - Cada acierto en su día de repaso la aplaza: después del 1.º, 3 días; después del 2.º, 7 días.
// - Con 3 aciertos seguidos en el repaso queda dominada y deja de salir.
// - Si se falla otra vez (aunque estuviera dominada), vuelve al principio: mañana y 0 aciertos.
// - Un acierto antes de su día (p. ej., en «Practice by topic» justo después de fallarla o con
//   «Try again») no cuenta: así cada acierto demuestra que se recuerda pasados los días.
//
// Cada pregunta del repaso es una tarjeta en `state.srs[id]`:
// { section, streak, due, lapses, addedAt, lastAt, masteredAt? }
// - streak: aciertos seguidos en el repaso (0–3). Con MASTERY aciertos, due = null y masteredAt.
// - due: día del próximo repaso ("AAAA-MM-DD", hora local del alumno).
// - lapses: cuántas veces se ha fallado.

// Días hasta el próximo repaso según los aciertos seguidos: 0 → mañana, 1 → 3 días, 2 → 7 días.
export const INTERVALS = [1, 3, 7];
export const MASTERY = 3;

const pad = (n) => String(n).padStart(2, "0");

// Día local de una fecha: "AAAA-MM-DD". Se usa el día del alumno, no el UTC, para que
// «mañana» cambie a medianoche en su reloj.
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Suma días a un "AAAA-MM-DD" (se calcula en UTC para no depender del cambio de hora).
export function addDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Días de `from` a `to` (los dos "AAAA-MM-DD"); negativo si `to` es anterior.
export function daysBetween(from, to) {
  const toUtc = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

export function isMastered(card) {
  return Boolean(card) && card.streak >= MASTERY;
}

// ¿Toca repasarla hoy (o ya tocaba)?
export function isDue(card, now = new Date()) {
  return Boolean(card) && !isMastered(card) && typeof card.due === "string" && card.due <= dayKey(now);
}

// Registra una respuesta en el repaso. Modifica `state.srs` y devuelve lo que ha pasado:
// { event, card } con event =
//   "added"    fallada por primera vez: entra en el repaso (vuelve mañana)
//   "reset"    ya estaba y se ha vuelto a fallar: vuelve mañana con 0 aciertos
//   "promoted" acierto en su día: vuelve dentro de `days` días (card.streak aciertos)
//   "mastered" tercer acierto seguido: dominada
//   "early"    acierto antes de su día: no cambia nada
//   null       acierto de una pregunta que no está en el repaso (o ya dominada)
export function reviewAnswer(state, question, correct, now = new Date()) {
  if (!state.srs) state.srs = {};
  const today = dayKey(now);
  const stamp = now.toISOString();
  const card = state.srs[question.id];

  if (!correct) {
    const next = {
      section: question.section,
      streak: 0,
      due: addDays(today, INTERVALS[0]),
      lapses: (card?.lapses || 0) + 1,
      addedAt: card?.addedAt || stamp,
      lastAt: stamp,
    };
    state.srs[question.id] = next;
    return { event: card ? "reset" : "added", card: { ...next }, days: INTERVALS[0] };
  }

  if (!card || isMastered(card)) return { event: null, card: card ? { ...card } : null };
  if (!isDue(card, now)) return { event: "early", card: { ...card } };

  const streak = card.streak + 1;
  const next = { ...card, section: question.section ?? card.section, streak, lastAt: stamp };
  if (streak >= MASTERY) {
    next.due = null;
    next.masteredAt = stamp;
    state.srs[question.id] = next;
    return { event: "mastered", card: { ...next } };
  }
  next.due = addDays(today, INTERVALS[streak]);
  state.srs[question.id] = next;
  return { event: "promoted", card: { ...next }, days: INTERVALS[streak] };
}

// Ordena las tarjetas: primero las que llevan más tiempo esperando; a igualdad, por id.
function byDue([idA, a], [idB, b]) {
  return (a.due || "").localeCompare(b.due || "") || idA.localeCompare(idB, "en", { numeric: true });
}

// Reparte las tarjetas en tres listas de [id, tarjeta]:
// due (toca hoy), upcoming (más adelante, la más próxima primero) y mastered (dominadas).
// Ignora entradas dañadas (sin `due` válido y sin dominar).
export function groupCards(srs = {}, now = new Date()) {
  const due = [];
  const upcoming = [];
  const mastered = [];
  for (const entry of Object.entries(srs)) {
    const card = entry[1];
    if (!card || typeof card !== "object") continue;
    if (isMastered(card)) mastered.push(entry);
    else if (typeof card.due !== "string") continue;
    else if (isDue(card, now)) due.push(entry);
    else upcoming.push(entry);
  }
  due.sort(byDue);
  upcoming.sort(byDue);
  mastered.sort(([idA, a], [idB, b]) => (b.masteredAt || "").localeCompare(a.masteredAt || "") || idA.localeCompare(idB, "en", { numeric: true }));
  return { due, upcoming, mastered };
}

// Ids de las preguntas que tocan hoy, en el orden en que se repasan.
export function dueIds(srs = {}, now = new Date()) {
  return groupCards(srs, now).due.map(([id]) => id);
}

// Resumen para la pantalla «My mistakes» (y el panel de inicio):
// { due, upcoming, mastered, total, next: { day, inDays, count } | null }
// `next` es el próximo día con repasos pendientes (si hoy no queda ninguno, el siguiente).
export function srsSummary(srs = {}, now = new Date()) {
  const { due, upcoming, mastered } = groupCards(srs, now);
  let next = null;
  if (upcoming.length) {
    const day = upcoming[0][1].due;
    next = {
      day,
      inDays: daysBetween(dayKey(now), day),
      count: upcoming.filter(([, c]) => c.due === day).length,
    };
  }
  return {
    due: due.length,
    upcoming: upcoming.length,
    mastered: mastered.length,
    total: due.length + upcoming.length + mastered.length,
    next,
  };
}
