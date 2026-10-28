// Ficha de teoría de una sección: #/theory/2. No hay maqueta propia: usa las tarjetas, el bloque
// de código y la nota morada «Exam trap» de la styleguide, y la tarjeta morada de 01_inicio.
// - Apartados (lectura de unos 5 minutos) con un ejemplo de código cada uno: se ve el código, lo que
//   muestra (o el error que lanza) y el botón «Run this code» para probarlo y cambiarlo.
// - «Exam traps»: las trampas típicas del examen en esta sección, también con su ejemplo.
// - A la derecha, el acceso al modo «Tricky questions» de la sección y a su práctica.
// Solo un panel «Run this code» abierto a la vez; su estado vive en memoria por sección, así que
// sobrevive al cambio de idioma.
// Solo con ?debug: `run=blocks-0` abre el panel de ese ejemplo (para screens.ps1).

import { langSwitch, bindLangSwitch, pageHeader } from "./shell.js";
import { pick } from "./question.js";
import { runnerToggle, runnerPanel, bindRunner, runState, openRunner, closeRunner } from "./runner-panel.js";
import { loadSections, loadTheory, loadSummary } from "../data.js";
import { sheetExamples, findExample, expectedResult, trapQuestions } from "../engine/theory.js";
import { codeBlock, inlineText, escapeHtml } from "../engine/format.js";
import { termMarker } from "../engine/glossary.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(globalThis.location?.search || "").has("debug");

// Estado por sección: Map(sección → { run }) (el panel «Run this code» abierto).
const views = new Map();
function viewFor(section) {
  if (!views.has(section)) views.set(section, { run: null });
  return views.get(section);
}

// Texto con `código` y los términos del glosario marcados (tooltip), como en las explicaciones.
function rich(text, lang) {
  return inlineText(pick(text, lang), { terms: termMarker(lang) });
}

// Ejemplo: código, lo que muestra (o el error que lanza), botón y, si está abierto, el panel.
function exampleHtml(entry, view) {
  const expected = expectedResult(entry.example);
  // Lo que muestra (si se indica) y el error que lanza al final (si lanza alguno).
  let result = "";
  if (expected.output !== null) {
    result += `<p class="th-out-title">${t("theory.output")}</p>
       <pre class="th-out"><code>${escapeHtml(expected.output) || " "}</code></pre>`;
  }
  if (expected.errorType) {
    result += `<p class="th-out-title th-throws">${t(expected.output !== null ? "theory.thenThrows" : "theory.throws", { error: expected.errorType })}</p>`;
  }
  return `
    <div class="th-example" data-example="${entry.key}">
      ${codeBlock(entry.example.code)}
      <div class="th-result-row">
        <div class="th-result">${result}</div>
        <div class="q-run">${runnerToggle(entry.question, view)}</div>
      </div>
      ${runnerPanel(entry.question, view)}
    </div>`;
}

// HTML de la ficha (sin cabecera). `trapCount`: preguntas trampa de la sección; `allTraps`: de
// todas las secciones; `hasQuestions`: la sección ya tiene preguntas de práctica.
export function theorySheetHtml(sheet, { lang, view, trapCount = 0, allTraps = 0, hasQuestions = false }) {
  const examples = new Map(sheetExamples(sheet).map((e) => [e.key, e]));
  const blocks = sheet.blocks.map((b, i) => `
    <section class="card th-block" aria-labelledby="th-blocks-${i}">
      <h2 id="th-blocks-${i}" tabindex="-1">${inlineText(pick(b.heading, lang))}</h2>
      <p class="th-body">${rich(b.body, lang)}</p>
      ${examples.has(`blocks-${i}`) ? exampleHtml(examples.get(`blocks-${i}`), view) : ""}
    </section>`).join("");

  const traps = sheet.traps.map((tr, i) => `
    <li class="note purple th-trap" aria-labelledby="th-traps-${i}">
      <p class="th-trap-kicker">${t("theory.trapN", { n: i + 1 })}</p>
      <h3 id="th-traps-${i}">${inlineText(pick(tr.title, lang))}</h3>
      <p class="th-body">${rich(tr.body, lang)}</p>
      ${examples.has(`traps-${i}`) ? exampleHtml(examples.get(`traps-${i}`), view) : ""}
    </li>`).join("");

  // Tarjeta morada del modo «Tricky questions»: de esta sección si tiene, si no de todas.
  let cta;
  if (trapCount) {
    cta = `
      <h2 id="th-cta-title">${trapCount === 1 ? t("theory.ctaOne") : t("theory.ctaMany", { count: trapCount })}</h2>
      <p class="m-cta-text">${t("theory.ctaText")}</p>
      <a class="btn lime" href="#/tricky/${sheet.section}">${t("theory.ctaButton")}</a>`;
  } else if (allTraps) {
    cta = `
      <h2 id="th-cta-title">${t("theory.ctaSoon")}</h2>
      <p class="m-cta-text">${t("theory.ctaOtherText")}</p>
      <a class="btn lime" href="#/tricky">${t("theory.ctaAllButton")}</a>`;
  } else {
    cta = `
      <h2 id="th-cta-title">${t("theory.ctaSoon")}</h2>
      <p class="m-cta-text">${t("theory.ctaNoneText")}</p>`;
  }

  return `
    <div class="th-layout">
      <div class="th-main">
        ${blocks}
        <section class="th-traps" aria-labelledby="th-traps-title">
          <h2 id="th-traps-title" tabindex="-1">${t("theory.trapsTitle")}</h2>
          <p class="small th-traps-sub">${t("theory.trapsSub")}</p>
          <ul class="th-trap-list">${traps}</ul>
        </section>
        <section class="card th-next" aria-labelledby="th-next-title">
          <h2 id="th-next-title">${t("theory.nextTitle")}</h2>
          <p>${t(hasQuestions ? "theory.nextText" : "theory.nextSoon")}</p>
          <div class="done-actions">
            ${hasQuestions ? `<a class="btn primary" href="#/practice/${sheet.section}">${t("theory.nextButton", { n: sheet.section })}</a>` : ""}
            <a class="btn ghost" href="#/practice">${t("practice.back")}</a>
          </div>
        </section>
      </div>
      <aside class="th-side" aria-label="${t("theory.sideLabel")}">
        <section class="card m-cta th-cta" aria-labelledby="th-cta-title">
          <p class="m-kicker">${t("theory.ctaKicker")}</p>
          ${cta}
        </section>
        <nav class="card th-toc" aria-labelledby="th-toc-title">
          <h2 id="th-toc-title">${t("theory.tocTitle")}</h2>
          <ul>
            ${sheet.blocks.map((b, i) => `<li><button type="button" class="th-jump" data-jump="th-blocks-${i}">${inlineText(pick(b.heading, lang))}</button></li>`).join("")}
            <li><button type="button" class="th-jump traps" data-jump="th-traps-title">${t("theory.tocTraps", { count: sheet.traps.length })}</button></li>
          </ul>
        </nav>
      </aside>
    </div>`;
}

function loading(main) {
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("theory.loading")}</p>`);
}

function simplePage(main, title, text, kicker = "") {
  main.innerHTML = `${pageHeader({ title, kicker })}
    <section class="card placeholder"><p>${text}</p></section>`;
  bindLangSwitch(main);
}

export function renderTheory(main, store, params, query) {
  const sectionId = Number(params.section);
  loading(main);
  (async () => {
    const sections = await loadSections();
    const section = sections.find((s) => s.id === sectionId);
    if (!section) {
      if (main.isConnected) simplePage(main, t("titles.theory"), t("practice.noSection"));
      return;
    }
    // Las trampas solo se cuentan: basta el índice ligero.
    const [sheet, { questionBanks: banks }] = await Promise.all([loadTheory(sectionId), loadSummary()]);
    if (!main.isConnected) return;
    const lang = getLang();
    const kicker = t("theory.kicker", { n: section.id, title: pick(section.title, lang) });
    if (!sheet) return simplePage(main, t("titles.theory"), t("theory.empty", { n: section.id }), kicker);

    const view = viewFor(sectionId);
    if (DEBUG && query.has("run") && !view.run) {
      const entry = findExample(sheet, query.get("run"));
      if (entry) openRunner(entry.question, view);
    }
    const trapCount = trapQuestions(banks, sectionId).length;
    const allTraps = trapQuestions(banks).length;
    const hasQuestions = banks[sections.indexOf(section)].length > 0;

    const draw = (focus = null) => {
      main.innerHTML = `
        <header class="top">
          <div>
            <p class="small">${kicker}</p>
            <h1 class="th-title">${inlineText(pick(sheet.title, lang))}
              <span class="chip purple">${t("theory.minutes", { n: sheet.readingMinutes })}</span></h1>
            ${sheet.intro ? `<p class="sub">${inlineText(pick(sheet.intro, lang))}</p>` : ""}
          </div>
          ${langSwitch()}
        </header>
        ${theorySheetHtml(sheet, { lang, view, trapCount, allTraps, hasQuestions })}`;
      bindLangSwitch(main);
      const open = view.run && sheetExamples(sheet).find((e) => runState(e.question, view));
      if (open) bindRunner(main, open.question, view);
      if (focus) main.querySelector(`[data-example="${focus}"] [data-action="run-toggle"]`)?.focus();
    };

    // Abrir o cerrar «Run this code» de un ejemplo (solo uno abierto a la vez).
    main.addEventListener("click", (e) => {
      // Índice: lleva al apartado (con el foco en su título, para el teclado y el lector de pantalla).
      const jump = e.target.closest("[data-jump]");
      if (jump) {
        const target = main.querySelector(`#${jump.dataset.jump}`);
        target?.scrollIntoView({ block: "start" });
        target?.focus({ preventScroll: true });
        return;
      }
      const toggle = e.target.closest('[data-action="run-toggle"]');
      if (!toggle) return;
      const entry = findExample(sheet, toggle.closest("[data-example]")?.dataset.example);
      if (!entry) return;
      if (runState(entry.question, view)) closeRunner(view);
      else openRunner(entry.question, view);
      draw(entry.key);
    });
    draw();
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `${pageHeader({ title: t("titles.theory") })}
      <p class="note purple" role="alert">${t("theory.loadError")}</p>`;
    bindLangSwitch(main);
  });
}
