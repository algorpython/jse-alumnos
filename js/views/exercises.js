// Pantalla «Coding exercises» (como ../maquetas/03_ejercicio_codigo.png).
// - #/exercises: lista de secciones con los ejercicios resueltos en cada una. Una sección sin
//   ejercicios marcada con `noExercises` en sections.json (la 1, de conceptos) enlaza a sus preguntas
//   y a su ficha de teoría en vez de decir «Coming soon» (tarea 9.1; ver exerciseMode).
// - #/exercises/5?n=3: ejercicio 3 de la sección 5. A la izquierda el enunciado, los tests y las
//   pistas; a la derecha el editor (js/views/code-editor.js), la consola y los botones
//   «Show solution», «Run» (ejecuta y muestra la consola) y «Check» (ejecuta y pasa los tests).
//   Debajo, al abrirla, la solución comentada con las alternativas y los errores típicos.
// El código se ejecuta aislado con el mismo runner que «Run this code» (js/engine/runner.js:
// iframe sandbox + Web Worker con tiempo límite) y los tests se corrigen dentro del worker.
// El código del alumno y el resultado de cada «Check» se guardan en el progreso
// (state.exercises, js/engine/exercises.js). Lo demás (consola, pistas abiertas…) vive en memoria
// mientras la pestaña está abierta, así el botón EN/ES no borra nada.
// Solo con ?debug: `hints=N` abre N pistas y `solution` abre la solución (para screens.ps1).

import { bindLangSwitch, pageHeader, langSwitch, scrollMotion } from "./shell.js";
import { pick } from "./question.js";
import { consoleLines } from "./runner-panel.js";
import { editorHtml, bindEditor, replaceCode } from "./code-editor.js";
import { loadSections, loadExercises, loadSummary } from "../data.js";
import { runSnippet, RUN_TIMEOUT } from "../engine/runner.js";
import {
  gradeRun, recordCheck, saveDraft, recordSolutionSeen, startIndex, sectionStats, testLabel, exerciseMode,
} from "../engine/exercises.js";
import { now } from "../clock.js";
import { escapeHtml, inlineText, codeBlock } from "../engine/format.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(globalThis.location?.search || "").has("debug");
const FILE_NAME = "solution.js";
// Un «got» más largo que esto no cabe en la etiqueta del test: va en una línea aparte.
const SHORT_GOT = 22;

// Estado en memoria de cada ejercicio (id → estado).
const sessions = new Map();
function session(ex, store) {
  // Lo escrito siempre está guardado antes de pintar (ver flushSave), así que el progreso manda: si
  // no coincide con lo que hay en memoria, es que se ha reiniciado o importado el progreso (o se ha
  // cambiado en otra pestaña) y se empieza de nuevo con lo guardado.
  const cur = sessions.get(ex.id);
  if (cur && !cur.running && cur.code !== savedCode(ex, store)) sessions.delete(ex.id);
  if (!sessions.has(ex.id)) {
    sessions.set(ex.id, {
      id: ex.id,
      code: savedCode(ex, store),
      output: null, // última salida de Run o Check (runSnippet)
      grade: null, // último Check (gradeRun)
      running: null, // "run" | "check" | null
      hints: 0, // pistas abiertas
      solution: false, // solución abierta
    });
  }
  return sessions.get(ex.id);
}
const savedCode = (ex, store) => {
  const saved = store.get().exercises[ex.id];
  return typeof saved?.code === "string" ? saved.code : ex.starter;
};

// El código se guarda medio segundo después de dejar de escribir. Lo pendiente se guarda ya al
// salir de la pantalla y antes de volver a pintarla (cambio de idioma).
let pendingSave = null;
function flushSave() {
  const save = pendingSave;
  pendingSave = null;
  save?.();
}
globalThis.addEventListener?.("hashchange", flushSave);
globalThis.addEventListener?.("pagehide", flushSave);

function loading(main) {
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("exercises.loading")}</p>`);
}

function loadError(main) {
  if (!main.isConnected) return;
  main.innerHTML = `${pageHeader({ title: t("titles.exercises") })}
    <p class="note purple" role="alert">${t("exercises.loadError")}</p>`;
  bindLangSwitch(main);
}

function simplePage(main, title, text) {
  main.innerHTML = `${pageHeader({ title })}
    <section class="card placeholder"><p>${text}</p></section>`;
  bindLangSwitch(main);
}

// #/exercises/N de una sección de conceptos (noExercises en sections.json, tarea 9.1): en vez de
// «están en camino», se explica cómo se practica y se enlaza a sus preguntas y a su ficha.
function conceptsPage(main, section, hasQuestions, hasTheory) {
  const kicker = t("practice.kicker", { n: section.id, title: pick(section.title, getLang()) });
  main.innerHTML = `${pageHeader({ title: kicker })}
    <section class="card placeholder ex-concepts-page" aria-labelledby="ex-concepts-title">
      <h2 id="ex-concepts-title">${t("exercises.conceptsTitle")}</h2>
      <p>${t("exercises.conceptsText")}</p>
      <div class="done-actions">
        ${conceptLinks(section.id, hasQuestions, hasTheory)}
        <a class="btn ghost" href="#/exercises">${t("exercises.back")}</a>
      </div>
    </section>`;
  bindLangSwitch(main);
}

// ---------------------------------------------------------------------------
// Lista de secciones
// ---------------------------------------------------------------------------

// Enlaces de una sección de conceptos (sin ejercicios por diseño): sus preguntas y su ficha de
// teoría, si existen. `card`: id del título de la tarjeta de la lista; allí los botones llevan el
// texto corto (caben en una fila) y aria-describedby con el título (dicen de qué sección son).
export function conceptLinks(sectionId, hasQuestions, hasTheory, card = "") {
  const desc = card ? ` aria-describedby="${card}"` : "";
  const practice = t(card ? "exercises.conceptsPracticeShort" : "exercises.conceptsPractice");
  const theory = t(card ? "exercises.conceptsTheoryShort" : "exercises.conceptsTheory");
  return [
    hasQuestions ? `<a class="btn primary" href="#/practice/${sectionId}"${desc}>${practice}</a>` : "",
    hasTheory ? `<a class="btn ghost" href="#/theory/${sectionId}"${desc}>${theory}</a>` : "",
  ].join("");
}

function countText(st) {
  if (!st.total) return t("exercises.countNone");
  if (st.tried || st.solved) return t("exercises.count", { solved: st.solved, total: st.total });
  return st.total === 1 ? t("exercises.countNewOne") : t("exercises.countNew", { total: st.total });
}

export function renderExerciseTopics(main, store) {
  main.innerHTML = pageHeader({ title: t("titles.exercises"), sub: t("exercises.sub") });
  bindLangSwitch(main);
  loading(main);
  (async () => {
    // Solo cuenta: le basta el índice ligero.
    const { sections, exerciseBanks: lists, questionBanks, theory } = await loadSummary();
    if (!main.isConnected) return;
    const lang = getLang();
    const saved = store.get().exercises;
    const cards = sections.map((s, i) => {
      const st = sectionStats(lists[i], saved);
      const pct = st.total ? Math.round((st.solved / st.total) * 100) : 0;
      const started = st.tried > 0;
      const mode = exerciseMode(s, st.total);
      let action;
      if (mode === "list") {
        action = `<a class="btn ${started ? "ghost" : "primary"}" href="#/exercises/${s.id}" aria-describedby="ex-topic-${s.id}">${t(started ? "practice.continue" : "practice.start")}</a>`;
      } else if (mode === "concepts") {
        action = conceptLinks(s.id, questionBanks[i].length > 0, Boolean(theory[i]), `ex-topic-${s.id}`);
      } else {
        action = `<span class="chip">${t("practice.soon")}</span>`;
      }
      return `
        <li class="card topic${mode === "concepts" ? " ex-concepts" : ""}">
          <p class="small">${t("practice.sectionN", { n: s.id })}</p>
          <h2 id="ex-topic-${s.id}">${escapeHtml(pick(s.title, lang))}</h2>
          <p class="small topic-count">${mode === "concepts" ? t("exercises.conceptsCard") : countText(st)}</p>
          ${st.total ? `<div class="bar" aria-hidden="true"><i class="ok" style="width: ${pct}%"></i></div>` : ""}
          <div class="topic-action">${action}</div>
        </li>`;
    }).join("");
    main.querySelector('[role="status"]')?.remove();
    main.insertAdjacentHTML("beforeend", `<ul class="topics">${cards}</ul>`);
  })().catch(() => loadError(main));
}

// ---------------------------------------------------------------------------
// Ejercicio
// ---------------------------------------------------------------------------

export function renderExerciseSection(main, store, params, query) {
  flushSave();
  const sectionId = Number(params.section);
  loading(main);
  (async () => {
    const sections = await loadSections();
    const section = sections.find((s) => s.id === sectionId);
    const list = section ? await loadExercises(sectionId) : [];
    if (!main.isConnected) return;
    if (!section) return simplePage(main, t("titles.exercises"), t("exercises.noSection"));
    if (exerciseMode(section, list.length) === "concepts") {
      // Sección de conceptos: lo que dice el índice basta para saber si hay preguntas y ficha.
      const { sections: all, questionBanks, theory } = await loadSummary();
      if (!main.isConnected) return;
      const i = all.findIndex((s) => s.id === sectionId);
      return conceptsPage(main, section, questionBanks[i]?.length > 0, Boolean(theory[i]));
    }
    if (!list.length) {
      return simplePage(main, t("practice.kicker", { n: section.id, title: pick(section.title, getLang()) }), t("exercises.empty"));
    }
    let index = Number.parseInt(query.get("n"), 10) - 1;
    if (!(index >= 0 && index < list.length)) index = startIndex(list, store.get().exercises);
    const ex = list[index];
    const st = session(ex, store);
    if (DEBUG) {
      if (query.has("hints")) st.hints = Math.min(Math.max(Number.parseInt(query.get("hints"), 10) || 0, 0), ex.hints.length);
      if (query.has("solution")) st.solution = true;
    }
    renderExercise(main, store, { section, list, index, ex, st });
  })().catch(() => loadError(main));
}

const exHref = (sectionId, n) => `#/exercises/${sectionId}?n=${n}`;

// --- Piezas de la pantalla (se vuelven a pintar por separado tras ejecutar) ---

// Lo obtenido en un test que falla: en la etiqueta si es corto, debajo si no.
function failChip(got) {
  const shown = got === "" ? t("exercises.nothing") : got;
  if (!shown.includes("\n") && shown.length <= SHORT_GOT) {
    return { chip: `<span class="chip red">${t("exercises.fail", { got: shown })}</span>`, detail: "" };
  }
  return {
    chip: `<span class="chip red">${t("exercises.failShort")}</span>`,
    detail: `<div class="ex-test-detail"><span>${t("exercises.got")}</span><pre>${escapeHtml(shown)}</pre></div>`,
  };
}

function errorText(error) {
  const name = error.name ? `${error.name}: ` : "";
  const where = error.line ? ` (${t("run.line", { n: error.line })})` : "";
  return `${name}${error.message}${where}`;
}

// Lista de tests con su resultado (si se ha comprobado).
export function testsList(ex, st) {
  return ex.tests.map((test, i) => {
    const label = testLabel(test);
    const what = label !== null
      ? `<code class="ex-test-call">${escapeHtml(label)}</code>`
      : `<div class="ex-test-out"><span>${t("exercises.outputLabel")}</span><pre>${escapeHtml(test.output)}</pre></div>`;
    let chip = "";
    let detail = "";
    if (st.running === "check") {
      chip = `<span class="chip">${t("exercises.checking")}</span>`;
    } else if (st.grade) {
      const r = st.grade.results[i];
      if (r.status === "pass") chip = `<span class="chip green">${t("exercises.pass")}</span>`;
      else if (r.status === "fail") ({ chip, detail } = failChip(r.got));
      else if (r.status === "error") {
        chip = `<span class="chip red">${t("exercises.error")}</span>`;
        detail = `<div class="ex-test-detail"><pre>${escapeHtml(errorText(r.error))}</pre></div>`;
      } else if (r.status === "blocked") chip = `<span class="chip red">${t("exercises.notRun")}</span>`;
      else if (r.status === "timeout") chip = `<span class="chip red">${t("exercises.timeout")}</span>`;
      else chip = `<span class="chip">${t("exercises.notRun")}</span>`;
    }
    return `<li class="ex-test"><div class="ex-test-row">${what}${chip}</div>${detail}</li>`;
  }).join("");
}

// Etiqueta de estado de la cabecera del editor («3 / 4 tests passed»).
export function statusChip(ex, st) {
  const total = ex.tests.length;
  if (st.running === "check") return `<span class="chip">${t("exercises.checking")}</span>`;
  if (!st.grade || st.grade.unsupported) {
    return `<span class="chip">${total === 1 ? t("exercises.statusIdleOne") : t("exercises.statusIdle", { total })}</span>`;
  }
  const cls = st.grade.allPassed ? "green" : "red";
  return `<span class="chip ${cls}">${t("exercises.statusPassed", { passed: st.grade.passed, total })}</span>`;
}

// Mensaje tras comprobar (siempre en positivo). Sin comprobar: aviso si ya estaba resuelto.
export function resultNote(ex, st, saved, nextHref) {
  const g = st.grade;
  if (st.running === "check") return "";
  if (!g) {
    return saved?.solved ? `<p class="note green ex-result">${t("exercises.alreadySolved")}</p>` : "";
  }
  if (g.unsupported) return `<p class="note purple ex-result">${t("run.unsupported")}</p>`;
  if (g.allPassed) {
    const next = nextHref ? ` <a href="${nextHref}">${t("exercises.next")} →</a>` : "";
    return `<p class="note green ex-result">${t("exercises.resultSolved")}${next}</p>`;
  }
  if (g.timedOut && g.results.some((r) => r.status === "timeout")) {
    return `<p class="note purple ex-result">${t("exercises.resultTimeout", { seconds: RUN_TIMEOUT / 1000 })}</p>`;
  }
  if (g.results.some((r) => r.status === "blocked")) {
    return `<p class="note purple ex-result">${t("exercises.resultError")}</p>`;
  }
  if (g.passed === 0 && g.results.every((r) => r.status === "error")) {
    return `<p class="note purple ex-result">${t("exercises.resultCallError")}</p>`;
  }
  if (g.passed > 0) return `<p class="note purple ex-result">${t("exercises.resultSome", { passed: g.passed, total: g.total })}</p>`;
  return `<p class="note purple ex-result">${t("exercises.resultNone")}</p>`;
}

// Pistas abiertas, de menos a más ayuda, y el botón para abrir la siguiente.
export function hintsBlock(ex, st, lang) {
  const total = ex.hints.length;
  const shown = ex.hints.slice(0, st.hints).map((h, i) => `
      <div class="note lime ex-hint" id="ex-hint-${i + 1}" tabindex="-1">
        <strong>${t("exercises.hintN", { n: i + 1, total })}</strong>
        <p>${inlineText(pick(h, lang))}</p>
      </div>`).join("");
  const button = st.hints < total
    ? `<button type="button" class="btn ghost ex-hint-btn" data-action="ex-hint">${t(st.hints ? "exercises.moreHint" : "exercises.hint")}</button>`
    : "";
  return shown + button;
}

// Sin las líneas vacías del final (el bloque de código las numeraría).
const trimEnd = (code) => String(code).replace(/\s+$/, "");

// Solución comentada, otras formas de resolverlo y errores típicos.
export function solutionPanel(ex, lang) {
  const alternatives = (ex.alternatives || []).length
    ? `<h3>${t("exercises.alternatives")}</h3>${ex.alternatives.map((a) => codeBlock(trimEnd(a))).join("")}`
    : "";
  const mistakes = (ex.commonMistakes || []).length
    ? `<h3>${t("exercises.mistakes")}</h3><ul class="ex-mistakes">${ex.commonMistakes.map((m) => `<li>${inlineText(pick(m, lang))}</li>`).join("")}</ul>`
    : "";
  return `
    <section class="card ex-solution" id="ex-solution" tabindex="-1" aria-labelledby="ex-solution-title">
      <h2 id="ex-solution-title">${t("exercises.solutionTitle")}</h2>
      ${codeBlock(trimEnd(ex.solution))}
      <p class="ex-solution-text">${inlineText(pick(ex.solutionExplanation, lang))}</p>
      <p class="small">${t("exercises.solutionNote")}</p>
      ${alternatives}
      ${mistakes}
    </section>`;
}

function renderExercise(main, store, ctx, focus = null) {
  const { section, list, index, ex, st } = ctx;
  const lang = getLang();
  const isLast = index === list.length - 1;
  const nextHref = isLast ? null : exHref(section.id, index + 2);
  const saved = store.get().exercises[ex.id];
  const busy = Boolean(st.running);
  const kicker = t("exercises.kicker", { n: section.id, title: pick(section.title, lang), i: index + 1, total: list.length });

  main.innerHTML = `
    <div class="ex-screen" data-exercise="${escapeHtml(ex.id)}">
      <header class="top">
        <div>
          <p class="small">${kicker}</p>
          <h1 class="ex-title">${escapeHtml(pick(ex.title, lang))}</h1>
        </div>
        ${langSwitch()}
      </header>

      <div class="ex-layout">
        <div class="ex-left">
          <section class="card ex-task" aria-labelledby="ex-task-title">
            <h2 id="ex-task-title">${t("exercises.task")}</h2>
            <p class="ex-statement">${inlineText(pick(ex.statement, lang))}</p>
          </section>
          <section class="card ex-tests" aria-labelledby="ex-tests-title">
            <h2 id="ex-tests-title">${t("exercises.tests")}</h2>
            <ul class="ex-test-list" id="ex-tests">${testsList(ex, st)}</ul>
          </section>
          <div class="ex-hints" id="ex-hints">${hintsBlock(ex, st, lang)}</div>
        </div>

        <section class="ex-right" aria-label="${t("exercises.editorLabel")}">
          <div class="ex-file-row">
            <span class="ex-file">${FILE_NAME}</span>
            <div class="ex-file-tools">
              <button type="button" class="mini" data-action="ex-reset"${st.code === ex.starter ? ' aria-disabled="true"' : ""}>${t("exercises.reset")}</button>
              <span id="ex-status" aria-live="polite">${statusChip(ex, st)}</span>
            </div>
          </div>
          ${editorHtml({ id: "ex-code", code: st.code, label: t("exercises.codeLabel"), rows: 14, className: "ex-editor" })}
          <div class="ex-console" role="log" aria-labelledby="ex-console-title" aria-busy="${busy}">
            <p class="ex-console-title" id="ex-console-title">${t("run.console")}</p>
            <div class="ex-out" id="ex-out">${consoleLines({ running: busy, output: st.output })}</div>
          </div>
          <div id="ex-result" role="status">${resultNote(ex, st, saved, nextHref)}</div>
          <div class="ex-actions">
            <button type="button" class="btn ghost" data-action="ex-solution" aria-expanded="${st.solution}"${st.solution ? ' aria-controls="ex-solution"' : ""}>${t(st.solution ? "exercises.hideSolution" : "exercises.showSolution")}</button>
            <button type="button" class="btn ghost" data-action="ex-run"${busy ? ' aria-disabled="true"' : ""}><span aria-hidden="true">▶</span> ${t("run.run")}</button>
            <button type="button" class="btn primary" data-action="ex-check"${busy ? ' aria-disabled="true"' : ""}>${t("exercises.check")}</button>
          </div>
        </section>
      </div>

      ${st.solution ? solutionPanel(ex, lang) : ""}

      <nav class="q-nav ex-nav" aria-label="${t("exercises.navLabel")}">
        <a class="btn ghost" href="${index > 0 ? exHref(section.id, index) : "#/exercises"}">${t(index > 0 ? "exercises.prev" : "exercises.back")}</a>
        <a class="btn ghost" href="${nextHref || "#/exercises"}">${t(nextHref ? "exercises.next" : "exercises.back")}</a>
      </nav>
    </div>`;
  bindLangSwitch(main);

  const area = main.querySelector("#ex-code");
  let saveTimer = null;
  const saveCode = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (pendingSave === saveCode) pendingSave = null;
    const code = st.code;
    store.update((s) => { saveDraft(s, ex.id, code); });
  };

  // Repinta solo lo que cambia al ejecutar, en la pantalla que esté a la vista (puede haberse
  // repintado entera mientras tanto, p. ej. al cambiar de idioma).
  const liveScreen = () => document.querySelector(`.ex-screen[data-exercise="${CSS.escape(ex.id)}"]`);
  // «Start over» solo se puede pulsar si el código ha cambiado.
  const paintReset = (screen) => {
    const reset = screen.querySelector('[data-action="ex-reset"]');
    if (st.code === ex.starter) reset.setAttribute("aria-disabled", "true");
    else reset.removeAttribute("aria-disabled");
  };
  const paint = () => {
    const screen = liveScreen();
    if (!screen) return;
    const running = Boolean(st.running);
    screen.querySelector("#ex-tests").innerHTML = testsList(ex, st);
    screen.querySelector("#ex-status").innerHTML = statusChip(ex, st);
    screen.querySelector("#ex-out").innerHTML = consoleLines({ running, output: st.output });
    screen.querySelector(".ex-console").setAttribute("aria-busy", String(running));
    screen.querySelector("#ex-result").innerHTML = resultNote(ex, st, store.get().exercises[ex.id], nextHref);
    for (const action of ["ex-run", "ex-check"]) {
      const b = screen.querySelector(`[data-action="${action}"]`);
      if (running) b.setAttribute("aria-disabled", "true");
      else b.removeAttribute("aria-disabled");
    }
    paintReset(screen);
  };

  const execute = async (mode) => {
    if (st.running) return;
    const code = st.code;
    if (saveTimer) saveCode();
    st.running = mode;
    if (mode === "check") st.grade = null;
    paint();
    // confirm() responde true en Run y en Check, como al comprobar las soluciones con check-content.
    const output = await runSnippet(code, { confirmAnswer: true, tests: mode === "check" ? ex.tests : null });
    st.running = null;
    st.output = output;
    if (mode === "check") {
      st.grade = gradeRun(ex, output);
      if (!st.grade.unsupported) store.update((s) => { recordCheck(s, ex, st.grade, code, now()); });
    }
    paint();
  };

  bindEditor(area, {
    onInput(code) {
      st.code = code;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveCode, 500);
      pendingSave = saveCode;
      // Al escribir no se repintan los tests ni los avisos (son zonas aria-live: el lector de
      // pantalla los volvería a leer en cada tecla).
      const screen = liveScreen();
      if (screen) paintReset(screen);
    },
    onRun: () => execute("run"),
  });

  const rerender = (nextFocus) => renderExercise(main, store, ctx, nextFocus);
  main.querySelector(".ex-screen").addEventListener("click", (e) => {
    const action = e.target.closest("button[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "ex-run") execute("run");
    else if (action === "ex-check") execute("check");
    else if (action === "ex-reset") {
      if (st.code === ex.starter) return;
      replaceCode(area, ex.starter);
    } else if (action === "ex-hint") {
      if (st.hints >= ex.hints.length) return;
      st.hints++;
      const box = main.querySelector("#ex-hints");
      box.innerHTML = hintsBlock(ex, st, getLang());
      box.querySelector(`#ex-hint-${st.hints}`)?.focus();
    } else if (action === "ex-solution") {
      st.solution = !st.solution;
      if (st.solution) store.update((s) => { recordSolutionSeen(s, ex.id); });
      rerender(st.solution ? "solution" : "solution-toggle");
    }
  });

  if (focus === "solution") {
    const panel = main.querySelector("#ex-solution");
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: "start", behavior: scrollMotion() });
  } else if (focus === "solution-toggle") {
    main.querySelector('[data-action="ex-solution"]')?.focus();
  }
}
