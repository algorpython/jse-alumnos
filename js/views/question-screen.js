// Pantalla de una pregunta con su corrección (como ../maquetas/02_pregunta.png). La usan
// «Practice by topic» (js/views/practice.js) y el repaso de «My mistakes» (js/views/mistakes.js):
// cada una le pasa los textos de la cabecera, los enlaces de navegación y qué hacer al corregir.
//
// ctx = {
//   question, item: { selected, result, srs },   // lo elegido, la corrección y el aviso del repaso
//   view: { peek },                              // tarjeta del otro idioma abierta o no
//   kicker, title,                               // cabecera
//   back: { href, label },                       // enlace de la izquierda
//   next: { href, label }, skipHref,             // «Next»/«Finish» tras corregir y «Skip» antes
//   retry,                                       // muestra «Try again» si se falla
//   feedbackExtra,                               // HTML opcional tras la explicación (p. ej., enlace a la teoría)
//   onCheck(question, result) → resultado de srs.reviewAnswer (guarda la respuesta)
// }

import { langSwitch, bindLangSwitch } from "./shell.js";
import { questionStem, optionList, feedbackPanel, peekPanel, typeLabel } from "./question.js";
import { toggleOption, canCheck, grade, chooseCount, isMultiple } from "../engine/questions.js";
import { MASTERY, reviewAnswer } from "../srs.js";
import { now } from "../clock.js";
import { showFirstTip } from "./glossary-tips.js";
import { runnerToggle, runnerPanel, bindRunner, runState, openRunner, closeRunner } from "./runner-panel.js";
import { t, getLang } from "../i18n.js";

// Aviso del repaso espaciado tras corregir (resultado de srs.reviewAnswer). "" si no hay nada que decir.
export function srsNote(outcome) {
  if (!outcome?.event) return "";
  let text;
  if (outcome.event === "added") text = t("srs.added");
  else if (outcome.event === "reset") text = t("srs.reset");
  else if (outcome.event === "promoted") text = t("srs.promoted", { count: outcome.card.streak, total: MASTERY, days: outcome.days });
  else if (outcome.event === "mastered") text = t("srs.mastered", { total: MASTERY });
  else return "";
  return `<p class="note purple srs-note">${text}</p>`;
}

// Pinta la pregunta. `focus`: qué enfocar después ({ option }, { result } o { peek }).
export function renderQuestionScreen(main, ctx, focus = null) {
  const { question: q, item: it, view } = ctx;
  const lang = getLang();
  const other = lang === "en" ? "es" : "en";
  const need = chooseCount(q);
  const ready = canCheck(q, it.selected);

  const peek = view.peek ? peekPanel(q, { lang: other, answered: Boolean(it.result) }) : "";
  const right = it.result
    ? feedbackPanel(q, it.result, {
      lang,
      extra: srsNote(it.srs) + (ctx.feedbackExtra || "") + peek,
      retry: ctx.retry && !it.result.correct,
      runner: { toggle: runnerToggle(q, view), panel: runnerPanel(q, view) },
    })
    : `<p class="note purple q-hint">${t("question.hint")}</p>${peek}`;

  // El botón de la traducción se escribe siempre en español («Ver en español» / «Ver en
  // inglés»): es para alumnos hispanohablantes, así que lleva lang="es" en los dos idiomas.
  main.innerHTML = `
    <header class="top">
      <div>
        <p class="small">${ctx.kicker}</p>
        <h1 class="q-title">${ctx.title}
          <span class="chip purple">${typeLabel(q)}</span></h1>
      </div>
      <div class="q-tools">
        <button type="button" class="btn ghost" data-action="peek" aria-pressed="${view.peek}" lang="es">${t("question.peekShow")}</button>
        ${langSwitch()}
      </div>
    </header>

    <div class="q-layout">
      <section class="q-main" aria-label="${t("question.questionLabel")}">
        ${questionStem(q, { lang, selected: it.selected })}
        ${optionList(q, { lang, selected: it.selected, result: it.result })}
        ${!it.result && isMultiple(q) ? `<p class="small" aria-live="polite">${t("question.selectedCount", { count: it.selected.length, n: need })}</p>` : ""}
      </section>

      <section class="q-side" aria-label="${t("question.sideLabel")}">
        ${right}
        <nav class="q-nav" aria-label="${t("question.navLabel")}">
          <a class="btn ghost" href="${ctx.back.href}">${ctx.back.label}</a>
          <div class="q-nav-end">
            ${it.result
              ? `<a class="btn primary" href="${ctx.next.href}">${ctx.next.label}</a>`
              : `<a class="btn ghost" href="${ctx.skipHref}">${t("question.skip")}</a>
                 <button type="button" class="btn primary" data-action="check"${ready ? "" : ' aria-disabled="true"'}>${t("question.check")}</button>`}
          </div>
        </nav>
      </section>
    </div>`;
  bindLangSwitch(main);
  if (it.result) bindRunner(main, q, view);

  const rerender = (nextFocus) => renderQuestionScreen(main, ctx, nextFocus);

  main.querySelector(".q-layout").addEventListener("click", (e) => {
    const opt = e.target.closest("button[data-option]");
    if (opt && !it.result) {
      it.selected = toggleOption(q, it.selected, opt.dataset.option);
      rerender({ option: opt.dataset.option });
      return;
    }
    const action = e.target.closest("button[data-action]")?.dataset.action;
    if (action === "check") {
      if (!canCheck(q, it.selected)) return;
      it.result = grade(q, it.selected);
      it.srs = ctx.onCheck(q, it.result);
      rerender({ result: true });
    } else if (action === "retry") {
      it.selected = [];
      it.result = null;
      it.srs = null;
      if (runState(q, view)) closeRunner(view);
      rerender({ option: q.options[0].id });
    } else if (action === "run-toggle") {
      if (runState(q, view)) closeRunner(view);
      else openRunner(q, view);
      rerender({ runToggle: true });
    }
  });
  main.querySelector('[data-action="peek"]').addEventListener("click", () => {
    view.peek = !view.peek;
    rerender({ peek: true });
  });

  if (focus?.option) main.querySelector(`[data-option="${CSS.escape(focus.option)}"]`)?.focus();
  else if (focus?.result) main.querySelector("#q-result")?.focus();
  else if (focus?.peek) main.querySelector('[data-action="peek"]')?.focus();
  else if (focus?.runToggle) main.querySelector('[data-action="run-toggle"]')?.focus();
  if (view.tip) showFirstTip(main);
}

// Solo con ?debug (para screens.ps1): `pick=C` marca opciones, `check` corrige sin guardar y
// `peek` abre la tarjeta del otro idioma, `tip` deja abierto el tooltip del primer término del glosario
// y `run` abre el panel «Run this code» (sin ejecutar nada: eso lo prueba tools/live.mjs).
export function applyDebug(question, it, view, query, store) {
  if (query.has("pick")) it.selected = query.get("pick").split(",").filter((id) => question.options.some((o) => o.id === id));
  if (query.has("check") && canCheck(question, it.selected)) {
    it.result = grade(question, it.selected);
    // Aviso del repaso calculado sobre una copia: no se guarda nada.
    it.srs = reviewAnswer(store.get(), question, it.result.correct, now());
  }
  if (query.has("peek")) view.peek = true;
  view.tip = query.has("tip");
  if (query.has("run") && it.result && !runState(question, view)) openRunner(question, view);
}
