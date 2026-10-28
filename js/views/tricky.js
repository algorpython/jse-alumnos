// Modo «Tricky questions»: practica solo las preguntas con la etiqueta `trap` (las trampas típicas
// del examen). Usa la pantalla de pregunta común (js/views/question-screen.js, como la maqueta 02).
// - #/tricky?n=2: pregunta 2 de las trampas de todas las secciones.
// - #/tricky/2?n=1: solo las de la sección 2 (se llega desde su ficha de teoría).
// - ?n=done: final de la ronda con su resumen.
// Las respuestas cuentan como práctica normal: se guardan en el progreso y, si se fallan, entran
// en el repaso espaciado de «My mistakes». Tras corregir se enlaza la ficha de teoría de la sección.
// Solo con ?debug: las mismas opciones `pick`, `check`, `peek` y `run` que «Practice by topic».

import { bindLangSwitch, pageHeader } from "./shell.js";
import { pick } from "./question.js";
import { renderQuestionScreen, applyDebug } from "./question-screen.js";
import { loadSections, loadQuestions, loadTheory, loadSummary } from "../data.js";
import { recordAnswer, startIndex } from "../engine/questions.js";
import { trapQuestions, trickyScope } from "../engine/theory.js";
import { reviewAnswer } from "../srs.js";
import { now } from "../clock.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(globalThis.location?.search || "").has("debug");

// Sesión por alcance ("all" o número de sección): { items: Map(id → { selected, result, srs }), peek }
const sessions = new Map();
function session(key) {
  if (!sessions.has(key)) sessions.set(key, { items: new Map(), peek: false });
  return sessions.get(key);
}
function item(sess, id) {
  if (!sess.items.has(id)) sess.items.set(id, { selected: [], result: null, srs: null });
  return sess.items.get(id);
}

const base = (scope) => (scope === null ? "#/tricky" : `#/tricky/${scope}`);

function simplePage(main, title, text, kicker = "") {
  main.innerHTML = `${pageHeader({ title, kicker })}
    <section class="card placeholder"><p>${text}</p></section>`;
  bindLangSwitch(main);
}

export function renderTricky(main, store, params, query) {
  const scope = trickyScope(params.section);
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("practice.loading")}</p>`);
  (async () => {
    const sections = await loadSections();
    if (scope === undefined || (scope !== null && !sections.some((s) => s.id === scope))) {
      if (main.isConnected) simplePage(main, t("titles.tricky"), t("practice.noSection"));
      return;
    }
    // Con el índice ligero se sabe qué secciones tienen trampas en este modo; solo se cargan
    // enteros los bancos de esas secciones (el resto se queda con su resumen, que basta para contar).
    const summary = (await loadSummary()).questionBanks;
    const banks = await Promise.all(sections.map((s, i) => (trapQuestions([summary[i]], scope).length ? loadQuestions(s.id) : summary[i])));
    const questions = trapQuestions(banks, scope);
    // Fichas de teoría de las secciones que salen (para enlazarlas tras corregir).
    const used = [...new Set(questions.map((q) => q.section))];
    const sheets = new Map(await Promise.all(used.map(async (id) => [id, await loadTheory(id)])));
    if (!main.isConnected) return;
    const lang = getLang();
    const sectionOf = (id) => sections.find((s) => s.id === id);
    const scopeKicker = scope === null
      ? t("tricky.kickerAll")
      : t("tricky.kickerSection", { n: scope, title: pick(sectionOf(scope).title, lang) });

    if (!questions.length) {
      const text = scope === null
        ? t("tricky.emptyAll")
        : trapQuestions(banks).length ? t("tricky.emptySection") : t("tricky.emptySectionNone", { n: scope });
      return simplePage(main, t("titles.tricky"), text, scopeKicker);
    }

    const key = scope === null ? "all" : scope;
    const sess = session(key);
    const n = query.get("n");
    if (n === "done") return renderDone(main, { scope, key, questions, sess, scopeKicker, sheets });
    let index = Number.parseInt(n, 10) - 1;
    if (!(index >= 0 && index < questions.length)) index = startIndex(questions, store.get().answers);
    const q = questions[index];
    const it = item(sess, q.id);
    if (DEBUG) applyDebug(q, it, sess, query, store);

    const isLast = index === questions.length - 1;
    const href = (k) => `${base(scope)}?n=${k}`;
    const nextHref = isLast ? href("done") : href(index + 2);
    const section = sectionOf(q.section);
    renderQuestionScreen(main, {
      question: q,
      item: it,
      view: sess,
      kicker: `${t("tricky.kicker")} · ${t("practice.kicker", { n: q.section, title: pick(section?.title, lang) })}`,
      title: t("practice.questionOf", { n: index + 1, total: questions.length }),
      back: index > 0
        ? { href: href(index), label: t("question.prev") }
        : { href: scope === null ? "#/practice" : `#/theory/${scope}`, label: t(scope === null ? "practice.back" : "tricky.backTheory") },
      next: { href: nextHref, label: t(isLast ? "question.finish" : "question.next") },
      skipHref: nextHref,
      retry: true,
      // Tras corregir: enlace a las trampas de la ficha de teoría de la sección.
      feedbackExtra: sheets.get(q.section)
        ? `<p class="note purple tricky-theory">${t("tricky.theoryLink", { n: q.section })}</p>`
        : "",
      onCheck(question, result) {
        let outcome = null;
        store.update((s) => {
          recordAnswer(s, question, result, now());
          outcome = reviewAnswer(s, question, result.correct, now());
        });
        return outcome;
      },
    });
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `${pageHeader({ title: t("titles.tricky") })}
      <p class="note purple" role="alert">${t("practice.loadError")}</p>`;
    bindLangSwitch(main);
  });
}

function renderDone(main, { scope, key, questions, sess, scopeKicker, sheets }) {
  const done = questions.map((q) => sess.items.get(q.id)?.result).filter(Boolean);
  const correct = done.filter((r) => r.correct).length;
  let text;
  if (!done.length) text = t("tricky.doneNone");
  else if (done.length === 1) text = t("tricky.doneTextOne", { correct });
  else text = t("tricky.doneText", { answered: done.length, correct });
  const theory = scope !== null && sheets.get(scope)
    ? `<a class="btn ghost" href="#/theory/${scope}">${t("tricky.backTheory")}</a>`
    : "";
  main.innerHTML = `
    ${pageHeader({ kicker: scopeKicker, title: t("tricky.doneTitle") })}
    <section class="card done-card">
      <p>${text}</p>
      <div class="done-actions">
        <a class="btn primary" href="${base(scope)}?n=1" data-action="again">${t("practice.again")}</a>
        ${theory}
        <a class="btn ghost" href="#/practice">${t("practice.toTopics")}</a>
      </div>
    </section>`;
  bindLangSwitch(main);
  // Empezar de nuevo limpia la sesión de esta ronda (el progreso guardado se queda).
  main.querySelector('[data-action="again"]').addEventListener("click", () => {
    sessions.delete(key);
  });
}
