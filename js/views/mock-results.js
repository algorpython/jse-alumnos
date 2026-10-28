// Resultados de un simulacro (como ../maquetas/05_resultados.png): #/mock/result/3.
// - Nota con el anillo, «Passed» o cuántas faltan, y la nota para aprobar.
// - «What to study next»: la sección más floja como «Focus next on…» y los botones para revisar
//   los fallos y practicar esa sección.
// - Comparación con el simulacro anterior, siempre en positivo (js/engine/mock-results.js).
// - Nota por sección: verde si llega al 70 % y morado («Focus next») si no. Sin rojo: decisión
//   del cliente, nada de semáforos que desanimen.
// - Revisión pregunta a pregunta: filtros (todas, a repasar, acertadas) y cada pregunta en un
//   <details> con lo elegido, la corrección, el porqué de cada opción incorrecta, la explicación,
//   «Run this code» y la referencia al curso.
// Solo con ?debug (capturas): `filter=review|right`, `open=3,7` (números de pregunta abiertos)
// y `run=3` (abre «Run this code» en la pregunta 3).

import { pageHeader, bindLangSwitch } from "./shell.js";
import { questionStem, optionList, pick } from "./question.js";
import { runnerToggle, runnerPanel, bindRunner, runState, openRunner, closeRunner } from "./runner-panel.js";
import { loadMockQuestions, stopTicker, mockTypeLabel } from "./mock.js";
import { PASS_PERCENT, findMock, toPass } from "../engine/mock.js";
import {
  timeTaken, splitDuration, sectionRows, focusSections, lowestSection, compareWithPrevious,
  reviewItems, reviewCounts,
} from "../engine/mock-results.js";
import { inlineText, escapeHtml } from "../engine/format.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(location.search).has("debug");
const FILTERS = [
  { id: "all", key: "mock.filterAll" },
  { id: "review", key: "mock.filterReview" },
  { id: "right", key: "mock.filterRight" },
];
// Estado de la revisión de cada simulacro (filtro, preguntas abiertas y «Run this code»):
// sobrevive al cambio de idioma, que vuelve a pintar la pantalla.
const views = new Map();

function viewFor(number) {
  if (!views.has(number)) views.set(number, { filter: "all", open: new Set(), run: null });
  return views.get(number);
}

function missing(main) {
  main.innerHTML = `${pageHeader({ title: t("titles.mock") })}
    <section class="card placeholder">
      <p>${t("mock.resultMissing")}</p>
      <div class="done-actions"><a class="btn primary" href="#/mock">${t("mock.backToMocks")}</a></div>
    </section>`;
  bindLangSwitch(main);
}

export function renderMockResult(main, store, params, query) {
  stopTicker();
  const number = Number(params.number);
  const mock = findMock(store.get(), number);
  if (!mock || mock.status !== "done" || !mock.score) return missing(main);
  main.innerHTML = pageHeader({ title: t("mock.resultsTitle") });
  bindLangSwitch(main);
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("practice.loading")}</p>`);
  (async () => {
    // Solo las preguntas de este simulacro (y los bancos donde están).
    const pool = await loadMockQuestions(mock);
    if (!main.isConnected) return;
    const view = viewFor(number);
    if (DEBUG) applyDebug(view, query, mock);
    paint(main, store, pool, number, view);
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `${pageHeader({ title: t("mock.resultsTitle") })}
      <p class="note purple" role="alert">${t("practice.loadError")}</p>`;
    bindLangSwitch(main);
  });
}

// Se aplica una sola vez por simulacro: al cambiar de idioma no se vuelve a abrir ni cerrar nada.
function applyDebug(view, query, mock) {
  if (view.debugApplied) return;
  view.debugApplied = true;
  if (FILTERS.some((f) => f.id === query.get("filter"))) view.filter = query.get("filter");
  const nums = (key) => (query.get(key) || "").split(",").map(Number).filter((n) => n >= 1 && n <= mock.questions.length);
  for (const n of nums("open")) view.open.add(mock.questions[n - 1]);
  const [runN] = nums("run");
  if (runN) view.runFor = mock.questions[runN - 1];
}

// «34 min 12 s» (o «45 s» si no llega al minuto).
function duration(ms) {
  const { min, sec } = splitDuration(ms);
  return min ? t("mock.durationMinSec", { min, sec }) : t("mock.durationSec", { sec });
}

// Une nombres con «and» / «y». En español, «y» pasa a «e» delante de «i» o «hi» («Funciones e
// Introducción…»), salvo «hie» («y hierro»).
function joinNames(lang) {
  return (acc, name, i) => {
    if (i === 0) return name;
    const and = lang === "es" && /^h?i(?!e)/i.test(name) ? " e " : t("mock.and");
    return acc + and + name;
  };
}

function sectionTitle(sections, id, lang) {
  const s = sections.find((x) => x.id === id);
  return s ? pick(s.title, lang) : t("mock.sectionN", { n: id });
}

// Anillo con el porcentaje, «Passed» o cuántas faltan, y la nota para aprobar.
function scoreCard(s) {
  const away = toPass(s);
  const need = Math.ceil((PASS_PERCENT * s.total) / 100);
  const chip = s.passed
    ? `<span class="chip green mr-chip">${t("mock.passedChip")}</span>`
    : `<span class="chip purple mr-chip">${away === 1 ? t("mock.toGoOne") : t("mock.toGo", { count: away })}</span>`;
  const message = s.passed
    ? t("mock.passedText")
    : away === 1 ? t("mock.awayTextOne") : t("mock.awayText", { count: away });
  return `
    <section class="card mr-score" aria-labelledby="mr-score-title">
      <h2 id="mr-score-title" class="visually-hidden">${t("mock.scoreTitle")}</h2>
      <div class="mr-ring${s.passed ? " ok" : ""}" style="--p: ${s.percent}%"><span>${s.percent}%</span></div>
      <div class="mr-score-text">
        ${chip}
        <p class="mr-correct">${t("mock.score", { correct: s.correct, total: s.total })}</p>
        <p class="small">${t("mock.passMarkCount", { pass: PASS_PERCENT, count: need })}</p>
        <p class="mr-message">${message}</p>
      </div>
    </section>`;
}

// «What to study next»: la sección más floja como «Focus next on…»; si todas aprueban, la de
// menos acierto para seguir mejorando.
function studyCard(rows, sections, lang, missed) {
  const focus = focusSections(rows);
  const target = focus[0] || lowestSection(rows);
  const name = (r) => sectionTitle(sections, r.id, lang);
  const stat = (r) => t("mock.sectionStat", { correct: r.correct, total: r.total, percent: r.percent });
  let text;
  if (focus.length) {
    text = t("mock.focusText", { section: name(focus[0]), stat: stat(focus[0]), pass: PASS_PERCENT });
    if (focus.length > 1) {
      const also = focus.slice(1, 3).map((r) => `${name(r)} (${t("mock.percent", { percent: r.percent })})`).reduce(joinNames(lang), "");
      text += ` ${t("mock.focusAlso", { sections: also })}`;
    }
  } else if (target && target.percent < 100) {
    text = t("mock.allPassText", { pass: PASS_PERCENT, section: name(target), stat: stat(target) });
  } else {
    text = t("mock.perfectText");
  }
  const practise = target && (focus.length || target.percent < 100)
    ? `<a class="btn ghost" href="#/practice/${target.id}" aria-label="${escapeHtml(t("mock.practiseLabel", { n: target.id, section: sectionTitle(sections, target.id, lang) }))}">${t("mock.practiseSection", { n: target.id })}</a>`
    : `<a class="btn ghost" href="#/mock">${t("mock.backToMocks")}</a>`;
  return `
    <section class="card mr-study" aria-labelledby="mr-study-title">
      <h2 id="mr-study-title">${t("mock.studyTitle")}</h2>
      <p class="mr-study-text">${text}</p>
      <div class="mr-study-actions">
        ${missed ? `<button type="button" class="btn primary" data-action="to-review">${missed === 1 ? t("mock.reviewWrongOne") : t("mock.reviewWrong", { count: missed })}</button>` : ""}
        ${practise}
      </div>
    </section>`;
}

// Comparación con el simulacro anterior (o el aviso de que es el primero).
function compareNote(cmp, sections, lang) {
  let text;
  if (!cmp) {
    text = t("mock.compareFirst");
  } else if (cmp.trend === "up") {
    const n = cmp.deltaCorrect;
    text = n > 0
      ? t(n === 1 ? "mock.compareUpOne" : "mock.compareUp", { count: n, n: cmp.previous, from: cmp.from, to: cmp.to })
      : t("mock.compareUpPercent", { n: cmp.previous, from: cmp.from, to: cmp.to });
  } else if (cmp.trend === "same") {
    text = t("mock.compareSame", { n: cmp.previous, to: cmp.to });
  } else if (cmp.improved.length) {
    const names = cmp.improved.slice(0, 2).map((r) => sectionTitle(sections, r.id, lang)).reduce(joinNames(lang), "");
    text = t("mock.compareDownImproved", { n: cmp.previous, from: cmp.from, sections: names });
  } else {
    text = t("mock.compareDown", { n: cmp.previous, from: cmp.from });
  }
  const icon = cmp?.trend === "up" ? "▲" : "★";
  return `<p class="note lime mr-compare"><span class="mr-compare-icon" aria-hidden="true">${icon}</span><span>${text}</span></p>`;
}

// Nota por sección. Las secciones que han subido respecto al simulacro anterior lo indican.
function sectionCard(rows, sections, lang, cmp) {
  const up = new Map((cmp?.improved || []).map((r) => [r.id, r]));
  const items = rows.map((r) => `
      <li class="bar-row${r.ok ? "" : " focus"}">
        <div class="lbl">
          <span>${r.id}. ${escapeHtml(sectionTitle(sections, r.id, lang))}${r.ok ? "" : ` <span class="chip lime mr-focus-chip">${t("mock.focusChip")}</span>`}</span>
          <span class="mr-row-end">${up.has(r.id) ? `<span class="mr-up"><span aria-hidden="true">▲ </span>${t("mock.sectionUp", { from: up.get(r.id).from })}</span>` : ""}<span class="mr-row-stat">${t("mock.sectionStat", { correct: r.correct, total: r.total, percent: r.percent })}</span></span>
        </div>
        <div class="bar" aria-hidden="true"><i class="${r.ok ? "ok" : "focus"}" style="width: ${r.percent}%"></i></div>
      </li>`).join("");
  return `
    <section class="card mr-sections" aria-labelledby="mr-sections-title">
      <h2 id="mr-sections-title">${t("mock.bySectionTitle")}</h2>
      <ul class="mr-bars">${items}</ul>
      <p class="small">${t("mock.bySectionLegend", { pass: PASS_PERCENT })}</p>
    </section>`;
}

// Texto corto de la línea de resumen: el enunciado y, si hay código, su primera línea.
function summaryText(q, lang) {
  const first = (q.code || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  const code = first ? ` <code class="mr-sum-code">${escapeHtml(first.length > 44 ? `${first.slice(0, 42)}…` : first)}</code>` : "";
  return `<span class="mr-sum-prompt">${inlineText(pick(q.prompt, lang))}</span>${code}`;
}

const STATUS = {
  right: { cls: "green", key: "mock.statusRight" },
  wrong: { cls: "purple", key: "mock.statusWrong" },
  empty: { cls: "", key: "mock.statusEmpty" },
};

function reviewItem(it, view, lang) {
  const q = it.question;
  const open = view.open.has(it.id);
  const st = STATUS[it.status];
  const pid = `mr-prompt-${it.number}`;
  const body = open ? `
      <div class="mr-body">
        ${questionStem(q, { lang, selected: it.selected, glossary: false, promptId: pid })}
        ${it.status === "empty" ? `<p class="note purple mr-empty">${t("mock.emptyNote")}</p>` : ""}
        ${optionList(q, { lang, selected: it.selected, result: it.result, promptId: pid })}
        <div class="note green">
          <strong>${t("question.explanation")}</strong><br>
          ${inlineText(pick(q.explanation, lang))}
          ${runnerToggle(q, view) ? `<div class="q-run">${runnerToggle(q, view)}</div>` : ""}
        </div>
        ${runnerPanel(q, view)}
        <p class="small mr-course">${t("question.course")} <code>${escapeHtml(q.courseRef || "")}</code></p>
      </div>` : "";
  return `
    <li class="mr-item ${it.status}">
      <details data-id="${escapeHtml(it.id)}"${open ? " open" : ""}>
        <summary>
          <span class="mr-num" aria-hidden="true">${it.number}</span>
          <span class="mr-sum">
            <span class="visually-hidden">${t("mock.cellLabel", { n: it.number })}. </span>
            ${summaryText(q, lang)}
            <span class="mr-sum-meta"><span class="small">${t("mock.sectionN", { n: q.section })} · ${mockTypeLabel(q)}</span></span>
          </span>
          <span class="chip ${st.cls} mr-status">${t(st.key)}</span>
        </summary>
        ${body}
      </details>
    </li>`;
}

function reviewCard(mock, pool, view, lang) {
  const counts = reviewCounts(mock, pool.byId);
  const items = reviewItems(mock, pool.byId, view.filter);
  const buttons = FILTERS.map((f) => `<button type="button" data-filter="${f.id}" aria-pressed="${view.filter === f.id}">${t(f.key, { count: counts[f.id] })}</button>`).join("");
  const inMistakes = mock.toReview
    ? `<p class="small mr-mistakes">${mock.toReview === 1 ? t("mock.toReviewOne") : t("mock.toReview", { count: mock.toReview })} <a href="#/mistakes">${t("mock.toMistakes")}</a></p>`
    : "";
  const list = items.length
    ? `<ol class="mr-list">${items.map((it) => reviewItem(it, view, lang)).join("")}</ol>`
    : `<p class="note purple">${view.filter === "right" ? t("mock.noneRight") : t("mock.noneToReview")}</p>`;
  return `
    <section class="card mr-review" aria-labelledby="mr-review-title">
      <div class="mr-review-head">
        <h2 id="mr-review-title" tabindex="-1">${t("mock.reviewTitle")}</h2>
        <div class="seg mr-filters" role="group" aria-label="${t("mock.filterLabel")}">${buttons}</div>
      </div>
      <p class="small">${t("mock.reviewIntro")}</p>
      ${inMistakes}
      ${list}
    </section>`;
}

// `focus`: { filter } (botón del filtro), { review } (título de la revisión) o { run: id }.
function paint(main, store, pool, number, view, focus = null) {
  const state = store.get();
  const mock = findMock(state, number);
  if (!mock || mock.status !== "done" || !mock.score) return missing(main);
  const lang = getLang();
  const s = mock.score;
  const rows = sectionRows(s, pool.sections);
  const cmp = compareWithPrevious(state, mock);
  const missed = reviewCounts(mock, pool.byId).review;
  // «Run this code» abierto desde ?debug&run=N (cuando la pregunta ya está pintada).
  if (view.runFor) {
    const q = pool.byId.get(view.runFor);
    if (q) {
      view.open.add(q.id);
      openRunner(q, view);
    }
    view.runFor = null;
  }
  const date = new Date(mock.finishedAt).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short" });
  const sub = mock.reason === "timeout"
    ? t("mock.usedAll", { minutes: Math.round(mock.durationMs / 60000) })
    : t("mock.completedIn", { time: duration(timeTaken(mock)) });

  main.innerHTML = `
    ${pageHeader({ kicker: t("mock.resultKicker", { n: mock.number, date }), title: t("mock.resultsTitle"), sub })}
    ${mock.reason === "timeout" ? `<p class="note lime mock-timeup">${t("mock.timeUp")}</p>` : ""}
    <div class="mr-top">
      ${scoreCard(s)}
      ${studyCard(rows, pool.sections, lang, missed)}
    </div>
    ${compareNote(cmp, pool.sections, lang)}
    ${sectionCard(rows, pool.sections, lang, cmp)}
    ${reviewCard(mock, pool, view, lang)}
    <div class="done-actions mr-end">
      <a class="btn ghost" href="#/mock">${t("mock.backToMocks")}</a>
    </div>`;
  bindLangSwitch(main);

  const repaint = (next) => paint(main, store, pool, number, view, next);
  const runQ = view.run ? pool.byId.get(view.run.id) : null;
  if (runQ && view.open.has(runQ.id)) bindRunner(main, runQ, view);

  main.querySelector('[data-action="to-review"]')?.addEventListener("click", () => {
    view.filter = "review";
    repaint({ review: true });
  });
  main.querySelector(".mr-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (!btn || btn.dataset.filter === view.filter) return;
    view.filter = btn.dataset.filter;
    repaint({ filter: view.filter });
  });
  // Abrir o cerrar una pregunta: se pinta (o se quita) su corrección.
  main.querySelectorAll(".mr-item details").forEach((d) => {
    d.addEventListener("toggle", () => {
      const id = d.dataset.id;
      if (d.open === view.open.has(id)) return;
      if (d.open) view.open.add(id);
      else {
        view.open.delete(id);
        if (view.run?.id === id) closeRunner(view);
      }
      repaint({ summary: id });
    });
  });
  main.querySelector(".mr-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-action="run-toggle"]');
    if (!btn) return;
    const id = btn.closest("details").dataset.id;
    const q = pool.byId.get(id);
    if (runState(q, view)) closeRunner(view);
    else openRunner(q, view);
    repaint({ run: id });
  });

  if (focus?.review) {
    const title = main.querySelector("#mr-review-title");
    title.scrollIntoView({ block: "start" });
    title.focus({ preventScroll: true });
  } else if (focus?.filter) {
    main.querySelector(`[data-filter="${focus.filter}"]`)?.focus();
  } else if (focus?.summary) {
    main.querySelector(`details[data-id="${CSS.escape(focus.summary)}"] > summary`)?.focus();
  } else if (focus?.run) {
    main.querySelector(`details[data-id="${CSS.escape(focus.run)}"] [data-action="run-toggle"]`)?.focus();
  }
}
