// Pantalla «My mistakes»: repaso espaciado de las preguntas falladas (reglas en js/srs.js).
// No hay maqueta propia: usa las tarjetas, cifras y la tarjeta morada de 01_inicio, y la
// pantalla de pregunta de 02_pregunta para el repaso.
// - #/mistakes: mensaje motivador, cifras (toca hoy, más adelante, dominadas), la lista de
//   preguntas con su avance y cómo funciona el repaso.
// - #/mistakes/review?n=2: repaso de las preguntas que tocan hoy, una a una. La lista se fija
//   al empezar (así «Previous» y el cambio EN/ES no la alteran mientras se repasa).
// - #/mistakes/review?n=done: final del repaso con su resumen.
// Solo con ?debug: las mismas opciones `pick`, `check` y `peek` que «Practice by topic».

import { pageHeader, bindLangSwitch } from "./shell.js";
import { pick, typeLabel } from "./question.js";
import { renderQuestionScreen, applyDebug } from "./question-screen.js";
import { loadSections, loadQuestionsById } from "../data.js";
import { recordAnswer } from "../engine/questions.js";
import { groupCards, srsSummary, dueIds, reviewAnswer, daysBetween, dayKey, INTERVALS, MASTERY } from "../srs.js";
import { inlineText, escapeHtml } from "../engine/format.js";
import { now } from "../clock.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(location.search).has("debug");

// Repaso en curso: { ids, items: Map(id → { selected, result, srs }), peek }
let review = null;

function loading(main) {
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("practice.loading")}</p>`);
}

function loadError(main) {
  if (!main.isConnected) return;
  main.innerHTML = `${pageHeader({ title: t("titles.mistakes") })}
    <p class="note purple" role="alert">${t("practice.loadError")}</p>`;
  bindLangSwitch(main);
}

// Preguntas de las secciones que aparecen en el repaso: Map(id → pregunta).
// También las del banco de simulacros: los fallos de un simulacro entran en el repaso.
// Las tarjetas cuya pregunta ya no existe (contenido retirado) se ignoran.
// Solo se descargan los bancos donde están esas preguntas (con el índice ligero, js/data.js).
async function loadReviewQuestions(srs) {
  const [sections, byId] = await Promise.all([loadSections(), loadQuestionsById(Object.keys(srs))]);
  return { sections, byId };
}

// ---------------------------------------------------------------------------
// Resumen y lista
// ---------------------------------------------------------------------------

export function renderMistakes(main, store) {
  main.innerHTML = pageHeader({ title: t("titles.mistakes"), sub: t("mistakes.sub", { total: MASTERY }) });
  bindLangSwitch(main);
  loading(main);
  (async () => {
    const { srs } = store.get();
    const { sections, byId } = await loadReviewQuestions(srs);
    if (!main.isConnected) return;
    const today = now();
    // Solo cuentan las tarjetas con pregunta (las de contenido retirado no se pueden repasar).
    const known = Object.fromEntries(Object.entries(srs).filter(([id]) => byId.has(id)));
    const sum = srsSummary(known, today);
    const groups = groupCards(known, today);
    const lang = getLang();
    const sectionTitle = (id) => pick(sections.find((s) => s.id === id)?.title, lang);

    const listHtml = [
      group("due", t("mistakes.groupDue"), groups.due),
      group("upcoming", t("mistakes.groupUpcoming"), groups.upcoming),
      group("mastered", t("mistakes.groupMastered"), groups.mastered),
    ].join("");

    function group(kind, title, entries) {
      if (!entries.length) return "";
      return `
        <h3 class="m-group">${title} <span class="m-count">${entries.length}</span></h3>
        <ul class="m-list">${entries.map(([id, card]) => row(kind, byId.get(id), card)).join("")}</ul>`;
    }

    function row(kind, q, card) {
      const firstLine = (q.code || "").split("\n").find((l) => l.trim()) || "";
      return `
        <li class="m-item">
          <div class="m-text">
            <p class="small" title="${escapeHtml(sectionTitle(q.section))}">${t("practice.sectionN", { n: q.section })} · ${typeLabel(q)}</p>
            <p class="m-prompt">${inlineText(pick(q.prompt, lang))}</p>
            ${firstLine ? `<code class="m-code">${escapeHtml(firstLine.trim())}</code>` : ""}
          </div>
          <div class="m-state">
            ${dots(card.streak)}
            <span class="m-when ${kind}">${when(kind, card)}</span>
          </div>
        </li>`;
    }

    function when(kind, card) {
      if (kind === "mastered") return t("mistakes.whenMastered");
      if (kind === "due") return t("mistakes.whenNow");
      const days = daysBetween(dayKey(today), card.due);
      return days === 1 ? t("mistakes.whenTomorrow") : t("mistakes.whenDays", { days });
    }

    main.querySelector('[role="status"]')?.remove();
    // Sin errores todavía: solo el mensaje y cómo funciona (sin cifras a cero ni lista vacía).
    main.insertAdjacentHTML("beforeend", sum.total ? `
      <section class="m-stats" aria-label="${t("mistakes.statsLabel")}">
        ${stat(t("mistakes.statDue"), sum.due)}
        ${stat(t("mistakes.statUpcoming"), sum.upcoming)}
        ${stat(t("mistakes.statMastered"), sum.mastered, "ok")}
      </section>

      <div class="m-cols">
        <section class="card m-review" aria-labelledby="m-list-title">
          <h2 id="m-list-title">${t("mistakes.listTitle")}</h2>
          ${listHtml}
        </section>
        <div class="m-side">${callToAction(sum)}${howItWorks()}</div>
      </div>` : `
      <div class="m-empty">${callToAction(sum)}${howItWorks()}</div>`);
    // Empezar un repaso nuevo: se vuelve a calcular qué toca hoy.
    main.querySelector('[data-action="start"]')?.addEventListener("click", () => { review = null; });
  })().catch(() => loadError(main));
}

function stat(label, value, cls = "") {
  return `<div class="card stat"><span>${label}</span><strong class="${cls}">${value}</strong></div>`;
}

// Cómo funciona el repaso: 1 día, 3 y 7 días, dominada.
function howItWorks() {
  return `
    <section class="card m-how" aria-labelledby="m-how-title">
      <h2 id="m-how-title">${t("mistakes.howTitle")}</h2>
      <ol class="m-steps">
        <li><b>${t("mistakes.howMiss")}</b><span>${t("mistakes.howMissText", { days: INTERVALS[0] })}</span></li>
        <li><b>${t("mistakes.howRight")}</b><span>${t("mistakes.howRightText", { first: INTERVALS[1], second: INTERVALS[2] })}</span></li>
        <li><b>${t("mistakes.howMastered")}</b><span>${t("mistakes.howMasteredText", { total: MASTERY })}</span></li>
      </ol>
    </section>`;
}

// Puntos de avance hacia «dominada»: ●●○ con texto para el lector de pantalla.
function dots(streak) {
  const n = Math.min(streak || 0, MASTERY);
  const marks = Array.from({ length: MASTERY }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("");
  return `<span class="m-dots" role="img" aria-label="${t("mistakes.dotsLabel", { count: n, total: MASTERY })}">${marks}</span>`;
}

// Tarjeta morada con el mensaje motivador y el botón del repaso.
function callToAction(sum) {
  let title;
  let text;
  let action;
  if (sum.due) {
    title = sum.due === 1 ? t("mistakes.dueOne") : t("mistakes.dueMany", { count: sum.due });
    text = t("mistakes.dueText");
    action = `<a class="btn lime" href="#/mistakes/review?n=1" data-action="start">${t("mistakes.start")}</a>`;
  } else if (sum.total && sum.next) {
    title = t("mistakes.caughtUp");
    const whenText = sum.next.inDays === 1 ? t("mistakes.nextTomorrow") : t("mistakes.nextDays", { days: sum.next.inDays });
    text = `${whenText} ${sum.next.count === 1 ? t("mistakes.nextOne") : t("mistakes.nextMany", { count: sum.next.count })}`;
    action = `<a class="btn lime" href="#/practice">${t("mistakes.toPractice")}</a>`;
  } else if (sum.total) {
    title = t("mistakes.allMastered");
    text = t("mistakes.allMasteredText");
    action = `<a class="btn lime" href="#/practice">${t("mistakes.toPractice")}</a>`;
  } else {
    title = t("mistakes.emptyTitle");
    text = t("mistakes.emptyText");
    action = `<a class="btn lime" href="#/practice">${t("mistakes.toPractice")}</a>`;
  }
  return `
    <section class="card m-cta" aria-labelledby="m-cta-title">
      <p class="m-kicker">${t("mistakes.ctaKicker")}</p>
      <h2 id="m-cta-title">${title}</h2>
      <p class="m-cta-text">${text}</p>
      ${action}
    </section>`;
}

// ---------------------------------------------------------------------------
// Repaso de hoy
// ---------------------------------------------------------------------------

export function renderReview(main, store, query) {
  loading(main);
  (async () => {
    const state = store.get();
    const { sections, byId } = await loadReviewQuestions(state.srs);
    if (!main.isConnected) return;
    const n = query.get("n");
    // La lista se fija al pulsar «Start review» (que borra la anterior) o si se ha recargado la página.
    if (!review) {
      review = { ids: dueIds(state.srs, now()).filter((id) => byId.has(id)), items: new Map(), peek: false };
    }
    const questions = review.ids.map((id) => byId.get(id)).filter(Boolean);
    if (n === "done") return renderReviewDone(main, questions);
    if (!questions.length) return renderNothingDue(main);
    let index = Number.parseInt(n, 10) - 1;
    if (!(index >= 0 && index < questions.length)) index = 0;
    const q = questions[index];
    if (!review.items.has(q.id)) review.items.set(q.id, { selected: [], result: null, srs: null });
    const it = review.items.get(q.id);
    if (DEBUG) applyDebug(q, it, review, query, store);

    const isLast = index === questions.length - 1;
    const nextHref = isLast ? "#/mistakes/review?n=done" : `#/mistakes/review?n=${index + 2}`;
    const section = sections.find((s) => s.id === q.section);
    renderQuestionScreen(main, {
      question: q,
      item: it,
      view: review,
      kicker: `${t("mistakes.reviewKicker")} · ${t("practice.kicker", { n: q.section, title: pick(section?.title, getLang()) })}`,
      title: t("practice.questionOf", { n: index + 1, total: questions.length }),
      back: index > 0
        ? { href: `#/mistakes/review?n=${index}`, label: t("question.prev") }
        : { href: "#/mistakes", label: t("mistakes.back") },
      next: { href: nextHref, label: t(isLast ? "mistakes.finish" : "question.next") },
      skipHref: nextHref,
      // Sin «Try again»: un segundo intento el mismo día no cuenta para el repaso.
      retry: false,
      onCheck(question, result) {
        let outcome = null;
        store.update((s) => {
          recordAnswer(s, question, result, now());
          outcome = reviewAnswer(s, question, result.correct, now());
        });
        return outcome;
      },
    });
  })().catch(() => loadError(main));
}

function renderNothingDue(main) {
  main.innerHTML = `${pageHeader({ title: t("mistakes.reviewTitle") })}
    <section class="card done-card">
      <p>${t("mistakes.nothingDue")}</p>
      <div class="done-actions"><a class="btn primary" href="#/mistakes">${t("mistakes.back")}</a></div>
    </section>`;
  bindLangSwitch(main);
}

function renderReviewDone(main, questions) {
  const results = questions.map((q) => review.items.get(q.id)).filter((it) => it && it.result);
  const right = results.filter((it) => it.result.correct).length;
  const mastered = results.filter((it) => it.srs?.event === "mastered").length;
  let text;
  if (!results.length) text = t("mistakes.doneNone");
  else if (results.length === 1) text = t("mistakes.doneTextOne", { correct: right });
  else text = t("mistakes.doneText", { answered: results.length, correct: right });
  if (mastered) text += ` ${mastered === 1 ? t("mistakes.doneMasteredOne") : t("mistakes.doneMasteredMany", { count: mastered })}`;
  main.innerHTML = `
    ${pageHeader({ title: t("mistakes.doneTitle") })}
    <section class="card done-card">
      <p>${text}</p>
      <div class="done-actions">
        <a class="btn primary" href="#/mistakes">${t("mistakes.back")}</a>
        <a class="btn ghost" href="#/practice">${t("mistakes.toPractice")}</a>
      </div>
    </section>`;
  bindLangSwitch(main);
}
