// Pantalla «Practice by topic» (como ../maquetas/02_pregunta.png).
// - #/practice: lista de secciones con lo respondido en cada una, el enlace a la ficha de teoría
//   de cada sección (#/theory/N) y, arriba, el acceso al modo «Tricky questions» (#/tricky).
// - #/practice/2?n=7: pregunta 7 de la sección 2. Se elige, se corrige con «Check answer» y
//   aparecen la explicación, el porqué de cada opción incorrecta y la referencia al curso.
//   Cada respuesta corregida se guarda en el progreso (state.answers) y, si se falla, entra en
//   el repaso espaciado de «My mistakes» (state.srs, js/srs.js).
// - #/practice/2?n=done: final de la sección con el resumen de esta tanda.
// La sesión (lo elegido y corregido en cada pregunta) vive en memoria mientras la pestaña
// está abierta: así «Previous» y el botón EN/ES no borran lo que el alumno acaba de hacer.
// Solo con ?debug: `pick=C` marca opciones y `check` corrige sin guardar (para screens.ps1),
// y `peek` abre la tarjeta del otro idioma.

import { bindLangSwitch, pageHeader } from "./shell.js";
import { pick } from "./question.js";
import { renderQuestionScreen, applyDebug } from "./question-screen.js";
import { loadSections, loadQuestions, loadSummary } from "../data.js";
import { trapQuestions } from "../engine/theory.js";
import { recordAnswer, startIndex, sectionStats } from "../engine/questions.js";
import { reviewAnswer } from "../srs.js";
import { now } from "../clock.js";
import { escapeHtml } from "../engine/format.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(location.search).has("debug");

// Sesión por sección: Map(sección → { items: Map(id → { selected, result, srs }), peek })
const sessions = new Map();
function session(section) {
  if (!sessions.has(section)) sessions.set(section, { items: new Map(), peek: false });
  return sessions.get(section);
}
function item(sess, id) {
  if (!sess.items.has(id)) sess.items.set(id, { selected: [], result: null, srs: null });
  return sess.items.get(id);
}

function loading(main) {
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("practice.loading")}</p>`);
}

function loadError(main) {
  if (!main.isConnected) return;
  main.innerHTML = `${pageHeader({ title: t("titles.practice") })}
    <p class="note purple" role="alert">${t("practice.loadError")}</p>`;
  bindLangSwitch(main);
}

// ---------------------------------------------------------------------------
// Lista de secciones
// ---------------------------------------------------------------------------

export function renderTopics(main, store) {
  main.innerHTML = pageHeader({ title: t("titles.practice"), sub: t("practice.sub") });
  bindLangSwitch(main);
  loading(main);
  (async () => {
    // Totales, trampas y minutos de lectura: le basta el índice ligero.
    const { sections, questionBanks: banks, theory: sheets } = await loadSummary();
    if (!main.isConnected) return;
    const lang = getLang();
    const answers = store.get().answers;
    const cards = sections.map((s, i) => {
      const st = sectionStats(banks[i], answers);
      const pct = st.total ? Math.round((st.answered / st.total) * 100) : 0;
      const action = !st.total
        ? `<span class="chip">${t("practice.soon")}</span>`
        : `<a class="btn ${st.answered ? "ghost" : "primary"}" href="#/practice/${s.id}" aria-describedby="topic-${s.id}">${t(st.answered ? "practice.continue" : "practice.start")}</a>`;
      // Ficha de teoría de la sección (si ya existe), con sus minutos de lectura.
      const theory = sheets[i]
        ? `<a class="btn ghost topic-theory" href="#/theory/${s.id}" aria-describedby="topic-${s.id}">${t("practice.theory", { n: sheets[i].readingMinutes })}</a>`
        : "";
      return `
        <li class="card topic">
          <p class="small">${t("practice.sectionN", { n: s.id })}</p>
          <h2 id="topic-${s.id}">${escapeHtml(pick(s.title, lang))}</h2>
          <p class="small topic-count">${!st.total
            ? t("practice.countNone")
            : st.answered
              ? t("practice.count", { answered: st.answered, total: st.total, correct: st.correct })
              : t("practice.countNew", { total: st.total })}</p>
          ${st.total ? `<div class="bar" aria-hidden="true"><i style="width: ${pct}%"></i></div>` : ""}
          <div class="topic-action">${action}${theory}</div>
        </li>`;
    }).join("");
    main.querySelector('[role="status"]')?.remove();
    main.insertAdjacentHTML("beforeend", `${trickyBanner(trapQuestions(banks).length)}<ul class="topics">${cards}</ul>`);
  })().catch(() => loadError(main));
}

// Tarjeta morada del modo «Tricky questions» (las preguntas con la etiqueta `trap`). "" si no hay.
function trickyBanner(count) {
  if (!count) return "";
  return `
    <section class="card m-cta tricky-banner" aria-labelledby="tricky-banner-title">
      <div class="tricky-banner-text">
        <p class="m-kicker">${t("practice.trickyKicker")}</p>
        <h2 id="tricky-banner-title">${count === 1 ? t("practice.trickyOne") : t("practice.trickyMany", { count })}</h2>
        <p class="m-cta-text">${t("practice.trickyText")}</p>
      </div>
      <a class="btn lime" href="#/tricky">${t("practice.trickyButton")}</a>
    </section>`;
}

// ---------------------------------------------------------------------------
// Pregunta de una sección
// ---------------------------------------------------------------------------

export function renderSection(main, store, params, query) {
  const sectionId = Number(params.section);
  loading(main);
  (async () => {
    const sections = await loadSections();
    const section = sections.find((s) => s.id === sectionId);
    const questions = section ? await loadQuestions(sectionId) : [];
    if (!main.isConnected) return;
    if (!section) return simplePage(main, t("titles.practice"), t("practice.noSection"));
    if (!questions.length) {
      return simplePage(main, sectionKicker(section), t("practice.empty"));
    }
    const sess = session(sectionId);
    const n = query.get("n");
    if (n === "done") return renderDone(main, section, questions, sess);
    let index = Number.parseInt(n, 10) - 1;
    if (!(index >= 0 && index < questions.length)) {
      index = startIndex(questions, store.get().answers);
    }
    if (DEBUG) applyDebug(questions[index], item(sess, questions[index].id), sess, query, store);
    renderQuestion(main, store, { section, questions, index, sess });
  })().catch(() => loadError(main));
}

function sectionKicker(section) {
  return t("practice.kicker", { n: section.id, title: pick(section.title, getLang()) });
}

function simplePage(main, title, text) {
  main.innerHTML = `${pageHeader({ title })}
    <section class="card placeholder"><p>${text}</p></section>`;
  bindLangSwitch(main);
}

function questionHref(sectionId, n) {
  return `#/practice/${sectionId}?n=${n}`;
}

// Pinta la pregunta `index` con la pantalla común (js/views/question-screen.js).
function renderQuestion(main, store, ctx) {
  const { section, questions, index, sess } = ctx;
  const q = questions[index];
  const isLast = index === questions.length - 1;
  const nextHref = isLast ? `#/practice/${section.id}?n=done` : questionHref(section.id, index + 2);
  renderQuestionScreen(main, {
    question: q,
    item: item(sess, q.id),
    view: sess,
    kicker: sectionKicker(section),
    title: t("practice.questionOf", { n: index + 1, total: questions.length }),
    back: index > 0
      ? { href: questionHref(section.id, index), label: t("question.prev") }
      : { href: "#/practice", label: t("practice.back") },
    next: { href: nextHref, label: t(isLast ? "question.finish" : "question.next") },
    skipHref: nextHref,
    retry: true,
    // Guarda la respuesta y la pasa al repaso espaciado (si se falla, entra en «My mistakes»).
    onCheck(question, result) {
      let outcome = null;
      store.update((s) => {
        recordAnswer(s, question, result, now());
        outcome = reviewAnswer(s, question, result.correct, now());
      });
      return outcome;
    },
  });
}

// ---------------------------------------------------------------------------
// Final de la sección
// ---------------------------------------------------------------------------

// Resumen de la ronda («1 question» en singular, como en el repaso de My mistakes).
function doneText(answered, correct) {
  if (!answered) return t("practice.doneNone");
  if (answered === 1) return t("practice.doneTextOne", { correct });
  return t("practice.doneText", { answered, correct });
}

function renderDone(main, section, questions, sess) {
  const done = questions.map((q) => sess.items.get(q.id)?.result).filter(Boolean);
  const correct = done.filter((r) => r.correct).length;
  main.innerHTML = `
    ${pageHeader({ kicker: sectionKicker(section), title: t("practice.doneTitle", { n: section.id }) })}
    <section class="card done-card">
      <p>${doneText(done.length, correct)}</p>
      <div class="done-actions">
        <a class="btn primary" href="#/practice/${section.id}?n=1" data-action="again">${t("practice.again")}</a>
        <a class="btn ghost" href="#/practice">${t("practice.toTopics")}</a>
      </div>
    </section>`;
  bindLangSwitch(main);
  // Empezar de nuevo limpia la sesión de esta sección (el progreso guardado se queda).
  main.querySelector('[data-action="again"]').addEventListener("click", () => {
    sessions.delete(section.id);
  });
}
