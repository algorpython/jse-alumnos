// Simulacros de examen (como ../maquetas/04_simulacro.png y 04b_simulacro_error.png).
// Las reglas (reparto, código, opción C, tiempo) están en js/engine/mock.js.
// - #/mock: portada con las normas, el botón para empezar (o seguir el simulacro en curso) y los
//   simulacros ya hechos.
// - #/mock/exam?n=12: pregunta 12 del simulacro en curso, a pantalla completa (sin barra lateral):
//   temporizador, «Finish exam», marcar para revisar y cuadrícula de navegación. Sin feedback:
//   lo elegido se guarda en el progreso al momento (sobrevive a recargar la página) y no se dice
//   si está bien. El tiempo corre aunque el alumno cierre la pestaña, como en el examen real.
// - #/mock/result/3: resultados del simulacro 3 (js/views/mock-results.js).
// Solo con ?debug: en #/mock, `duration=5` (segundos) y `seed=7` (simulacro fijo); en la portada
// y el examen, `left=1421` fija el reloj para que queden 23:41 (capturas); en el examen, `finish` abre
// el aviso de «Finish exam».

import { pageHeader, bindLangSwitch, langSwitch } from "./shell.js";
import { questionStem, optionList, typeLabel } from "./question.js";
import { loadSections, loadQuestions, loadMockBank, loadSummary, loadQuestionsById } from "../data.js";
import { toggleOption, chooseCount, isMultiple } from "../engine/questions.js";
import {
  MOCK_SIZE, MOCK_MINUTES, PASS_PERCENT, planMock, startMock, activeMock, finishedMocks,
  timeLeft, isExpired, formatClock, setMockAnswer, toggleFlag, navStats, isAnswered, finishMock,
  closeExpired, seededRandom,
} from "../engine/mock.js";
import { now, setClock } from "../clock.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(location.search).has("debug");
// Avisos de tiempo (quedan 5 minutos y 1 minuto): una vez por simulacro, aunque se repinte.
const WARNINGS = [{ ms: 5 * 60000, key: "mock.warnFive" }, { ms: 60000, key: "mock.warnOne" }];
const announced = new Set();
let ticker = null;

function loading(main) {
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("practice.loading")}</p>`);
}

function loadError(main, title = t("titles.mock")) {
  if (!main.isConnected) return;
  main.innerHTML = `${pageHeader({ title })}
    <p class="note purple" role="alert">${t("practice.loadError")}</p>`;
  bindLangSwitch(main);
}

// Todas las preguntas que pueden salir en un simulacro y un índice por id. Solo hace falta al
// preparar un simulacro nuevo (planMock elige entre todas: ≈ 1 MB); el resto de pantallas cargan
// solo lo que enseñan (loadMockQuestions).
export async function loadPool() {
  const sections = await loadSections();
  const [mockBank, ...banks] = await Promise.all([loadMockBank(), ...sections.map((s) => loadQuestions(s.id))]);
  const practiceBank = banks.flat();
  const byId = new Map([...practiceBank, ...mockBank].map((q) => [q.id, q]));
  return { sections, mockBank, practiceBank, byId };
}

// Las secciones y las preguntas de un simulacro (completas): { sections, byId }. Solo se descargan
// los bancos donde están (en los 4 primeros simulacros, normalmente solo el banco exclusivo).
export async function loadMockQuestions(mock) {
  const [sections, byId] = await Promise.all([loadSections(), loadQuestionsById(mock?.questions || [])]);
  return { sections, byId };
}

// ?debug&left=N: el reloj se para cuando quedan N segundos del simulacro en curso.
function applyDebugClock(store, query) {
  if (!DEBUG || !query.has("left")) return;
  const mock = activeMock(store.get());
  const left = Number(query.get("left"));
  if (!mock || !Number.isFinite(left)) return;
  const fixed = Date.parse(mock.endsAt) - left * 1000;
  setClock(() => new Date(fixed));
}

// Si se ha acabado el tiempo del simulacro en curso, lo termina. Devuelve el registro o null.
function expireIfNeeded(store, byId) {
  const mock = activeMock(store.get());
  if (!mock || !isExpired(mock, now())) return null;
  let closed = null;
  store.update((s) => { closed = closeExpired(s, byId, now()); });
  return closed;
}

// Etiqueta del tipo de pregunta en el simulacro. «Find the error» lleva «· single choice», como en
// la maqueta 04b, para que quede claro que se elige una sola opción.
export function mockTypeLabel(q) {
  return q.type === "error" && !isMultiple(q) ? t("mock.typeError") : typeLabel(q);
}

export function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------

export function renderMockHome(main, store, query) {
  stopTicker();
  main.innerHTML = pageHeader({ title: t("titles.mock"), sub: t("mock.sub") });
  bindLangSwitch(main);
  loading(main);
  (async () => {
    // La portada solo necesita saber si hay preguntas suficientes para un simulacro: planMock().ok
    // depende solo de cuántas hay de cada sección y de cuáles han salido, así que le basta el
    // índice ligero. Las preguntas enteras se cargan al pulsar «Start» (y, si el simulacro en curso
    // se ha quedado sin tiempo, las suyas para corregirlo).
    const summary = await loadSummary();
    applyDebugClock(store, query);
    const pending = activeMock(store.get());
    if (pending && isExpired(pending, now())) expireIfNeeded(store, (await loadMockQuestions(pending)).byId);
    if (!main.isConnected) return;
    const state = store.get();
    const active = activeMock(state);
    const canStart = Boolean(active) || planMock({
      sections: summary.sections, mockBank: summary.mockBank, practiceBank: summary.questionBanks.flat(), history: state.mocks,
    }).ok;

    main.querySelector('[role="status"]')?.remove();
    main.insertAdjacentHTML("beforeend", `
      <div class="mock-cols">
        <section class="card mock-rules" aria-labelledby="mock-rules-title">
          <h2 id="mock-rules-title">${t("mock.rulesTitle")}</h2>
          <ul class="mock-rule-list">
            <li><b>${MOCK_SIZE}</b><span>${t("mock.ruleQuestions")}</span></li>
            <li><b>${MOCK_MINUTES}</b><span>${t("mock.ruleTime")}</span></li>
            <li><b>${PASS_PERCENT}%</b><span>${t("mock.rulePass")}</span></li>
          </ul>
          <ul class="mock-rule-notes">
            <li>${t("mock.ruleFeedback")}</li>
            <li>${t("mock.ruleFlag")}</li>
            <li>${t("mock.ruleTimer")}</li>
          </ul>
        </section>
        <div class="mock-side">
          ${callToAction(active, canStart)}
          ${history(finishedMocks(state))}
        </div>
      </div>`);

    main.querySelector('[data-action="start"]')?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      // Mientras se cargan las preguntas, un segundo clic no hace nada (no empieza dos simulacros).
      if (btn.getAttribute("aria-disabled") === "true") return;
      btn.setAttribute("aria-disabled", "true");
      // Con una conexión lenta, las preguntas tardan unos segundos: el botón lo dice mientras tanto.
      const label = btn.textContent;
      btn.textContent = t("practice.loading");
      try {
        const pool = await loadPool();
        // Otra pestaña puede haber empezado uno mientras tanto: se sigue ese.
        if (!activeMock(store.get())) {
          const seed = DEBUG && query.has("seed") ? Number(query.get("seed")) : null;
          const plan = planMock({ ...pool, history: store.get().mocks, rng: seed === null ? Math.random : seededRandom(seed) });
          if (!plan.ok) throw new Error(`Not enough questions for a mock exam (${plan.available})`);
          const seconds = DEBUG && query.has("duration") ? Number(query.get("duration")) : null;
          const durationMs = seconds > 0 ? seconds * 1000 : MOCK_MINUTES * 60000;
          store.update((s) => { startMock(s, plan, now(), { durationMs }); });
        }
        location.hash = "#/mock/exam?n=1";
      } catch (err) {
        btn.textContent = label;
        btn.removeAttribute("aria-disabled");
        main.querySelector(".mock-start-error")?.remove();
        btn.insertAdjacentHTML("afterend", `<p class="note purple mock-start-error" role="alert">${t("mock.startError")}</p>`);
        if (DEBUG) throw err;
      }
    });
  })().catch(() => loadError(main));
}

// Tarjeta morada: empezar, seguir el simulacro en curso o «próximamente» si aún no hay preguntas.
function callToAction(active, canStart) {
  let title;
  let text;
  let action;
  if (active) {
    title = t("mock.activeTitle");
    text = t("mock.activeText", { time: formatClock(timeLeft(active, now())) });
    // Se sigue por la primera pregunta sin responder (o por la 1 si están todas).
    const next = active.questions.findIndex((id) => !isAnswered(active, id)) + 1 || 1;
    action = `<a class="btn lime" href="#/mock/exam?n=${next}">${t("mock.resume")}</a>`;
  } else if (canStart) {
    title = t("mock.readyTitle");
    text = t("mock.readyText", { minutes: MOCK_MINUTES });
    action = `<button type="button" class="btn lime" data-action="start">${t("mock.start")}</button>`;
  } else {
    title = t("mock.soonTitle");
    text = t("mock.soonText");
    action = `<a class="btn lime" href="#/practice">${t("mock.toPractice")}</a>`;
  }
  return `
    <section class="card m-cta" aria-labelledby="mock-cta-title">
      <p class="m-kicker">${t("mock.ctaKicker")}</p>
      <h2 id="mock-cta-title">${title}</h2>
      <p class="m-cta-text">${text}</p>
      ${action}
    </section>`;
}

// Simulacros terminados, el más reciente primero.
function history(done) {
  if (!done.length) return "";
  const lang = getLang();
  const date = (iso) => new Date(iso).toLocaleDateString(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short" });
  const items = [...done].reverse().map((m) => `
    <li class="mock-past">
      <div>
        <p class="mock-past-title">${t("mock.historyItem", { n: m.number })} <span class="small">· ${date(m.finishedAt)}</span></p>
        <p class="small">${t("mock.score", { correct: m.score.correct, total: m.score.total })}${m.score.passed ? ` <span class="chip green">${t("mock.passedChip")}</span>` : ""}</p>
      </div>
      <div class="mock-past-end">
        <strong>${m.score.percent}%</strong>
        <a class="mini" href="#/mock/result/${m.number}" aria-label="${t("mock.seeResultLabel", { n: m.number })}">${t("mock.seeResult")}</a>
      </div>
    </li>`).join("");
  return `
    <section class="card" aria-labelledby="mock-history-title">
      <h2 id="mock-history-title">${t("mock.historyTitle")}</h2>
      <ul class="mock-history">${items}</ul>
    </section>`;
}

// ---------------------------------------------------------------------------
// Examen
// ---------------------------------------------------------------------------

export function renderMockExam(main, store, query) {
  stopTicker();
  loading(main);
  (async () => {
    const pool = await loadMockQuestions(activeMock(store.get()));
    if (!main.isConnected) return;
    applyDebugClock(store, query);
    const closed = expireIfNeeded(store, pool.byId);
    if (closed) return location.replace(`#/mock/result/${closed.number}`);
    const mock = activeMock(store.get());
    if (!mock) return location.replace("#/mock");
    let index = Number.parseInt(query.get("n"), 10) - 1;
    if (!(index >= 0 && index < mock.questions.length)) index = 0;
    paintExam(main, store, pool, { number: mock.number, index, finishOpen: DEBUG && query.has("finish") });
  })().catch(() => loadError(main));
}

// Clases y texto accesible de una casilla de la cuadrícula.
function cell(mock, id, i, current) {
  const answered = isAnswered(mock, id);
  const flagged = mock.flagged.includes(id);
  const cls = [flagged ? "flag" : answered ? "done" : "", current ? "cur" : ""].filter(Boolean).join(" ");
  const states = [t(answered ? "mock.cellAnswered" : "mock.cellEmpty")];
  if (flagged) states.push(t("mock.cellFlagged"));
  const label = `${t("mock.cellLabel", { n: i + 1 })}: ${states.join(", ")}`;
  return `<li><a href="#/mock/exam?n=${i + 1}" class="${cls}"${current ? ' aria-current="step"' : ""} aria-label="${label}">${i + 1}</a></li>`;
}

function paintExam(main, store, pool, view, focus = null) {
  const mock = activeMock(store.get());
  if (!mock || mock.number !== view.number) {
    stopTicker();
    location.replace("#/mock");
    return;
  }
  const lang = getLang();
  const total = mock.questions.length;
  const { index } = view;
  const id = mock.questions[index];
  const q = pool.byId.get(id);
  const selected = mock.answers[id] || [];
  const flagged = mock.flagged.includes(id);
  const stats = navStats(mock);
  const isLast = index === total - 1;
  const left = timeLeft(mock, now());

  const body = q ? `
      <div class="mock-chips">
        <span class="chip">${t("mock.sectionN", { n: q.section })}</span>
        <span class="chip purple">${mockTypeLabel(q)}</span>
      </div>
      ${questionStem(q, { lang, selected, glossary: false })}
      ${optionList(q, { lang, selected })}
      ${isMultiple(q) ? `<p class="small" aria-live="polite">${t("question.selectedCount", { count: selected.length, n: chooseCount(q) })}</p>` : ""}` : `
      <p class="note purple">${t("mock.missingQuestion")}</p>`;

  // Todo va dentro de .mock-screen, que es nuevo en cada repintado (así los eventos no se duplican).
  main.innerHTML = `<div class="mock-screen">
    <header class="mock-head">
      <div class="brand"><div class="logo" aria-hidden="true">&lt;/&gt;</div><div><h1 class="mock-title">${t("mock.headTitle")}</h1><small>${t("mock.headSub")}</small></div></div>
      <div class="mock-head-end">
        <p class="mock-count">${t("mock.questionOf", { n: index + 1, total })}</p>
        <p class="mock-timer${left <= WARNINGS[0].ms ? " low" : ""}" role="timer" aria-label="${t("mock.timerLabel")}"><span id="mock-clock">${formatClock(left)}</span></p>
        <button type="button" class="btn lime" data-action="finish">${t("mock.finish")}</button>
        ${langSwitch()}
      </div>
    </header>
    <p class="visually-hidden" role="status" id="mock-alert"></p>

    <div class="mock-layout">
      <section class="mock-q" aria-label="${t("question.questionLabel")}">
        ${body}
        <p class="small mock-nofeedback">${t("mock.noFeedback")}</p>
        <nav class="mock-nav" aria-label="${t("question.navLabel")}">
          <button type="button" class="btn ghost" data-go="${index - 1}"${index === 0 ? " disabled" : ""}>${t("mock.prev")}</button>
          <div class="mock-nav-end">
            <button type="button" class="btn ghost mock-flag" data-action="flag" aria-pressed="${flagged}">${t("mock.flag")}</button>
            ${isLast
              ? `<button type="button" class="btn primary" data-action="finish">${t("mock.finish")}</button>`
              : `<button type="button" class="btn primary" data-go="${index + 1}">${t("mock.next")}</button>`}
          </div>
        </nav>
      </section>

      <aside class="card mock-grid-card" aria-labelledby="mock-grid-title">
        <h2 id="mock-grid-title">${t("mock.gridTitle")}</h2>
        <nav aria-labelledby="mock-grid-title">
          <ol class="mock-grid">${mock.questions.map((qid, i) => cell(mock, qid, i, i === index)).join("")}</ol>
        </nav>
        <ul class="mock-legend">
          <li><span class="chip purple" aria-hidden="true">■</span>${t("mock.legendAnswered", { count: stats.answered })}</li>
          <li><span class="chip flag" aria-hidden="true">■</span>${t("mock.legendFlagged", { count: stats.flagged })}</li>
          <li><span class="chip" aria-hidden="true">■</span>${t("mock.legendEmpty", { count: stats.unanswered })}</li>
        </ul>
      </aside>
    </div>

    <dialog class="mock-dialog" id="mock-finish" aria-labelledby="mock-finish-title" aria-describedby="mock-finish-text">
      <h2 id="mock-finish-title">${t("mock.confirmTitle")}</h2>
      <div id="mock-finish-text">
        <p>${t("mock.confirmAnswered", { answered: stats.total - stats.empty, total: stats.total })}</p>
        ${stats.empty || stats.flagged ? `
        <ul class="mock-dialog-list">
          ${stats.empty ? `<li>${stats.empty === 1 ? t("mock.confirmEmptyOne") : t("mock.confirmEmpty", { count: stats.empty })}</li>` : ""}
          ${stats.flagged ? `<li>${stats.flagged === 1 ? t("mock.confirmFlaggedOne") : t("mock.confirmFlagged", { count: stats.flagged })}</li>` : ""}
        </ul>` : ""}
        <p class="small">${t("mock.confirmText")}</p>
      </div>
      <div class="mock-dialog-actions">
        <button type="button" class="btn ghost" data-action="keep">${t("mock.keepWorking")}</button>
        <button type="button" class="btn primary" data-action="confirm">${t("mock.confirmFinish")}</button>
      </div>
    </dialog>
  </div>`;
  bindLangSwitch(main);
  const screen = main.querySelector(".mock-screen");

  const repaint = (nextFocus) => paintExam(main, store, pool, view, nextFocus);
  const dialog = main.querySelector("#mock-finish");

  function finish(reason) {
    stopTicker();
    let done = null;
    store.update((s) => {
      done = reason === "timeout" ? closeExpired(s, pool.byId, now()) : finishMock(s, view.number, pool.byId, now(), reason);
    });
    if (dialog.open) dialog.close();
    location.hash = `#/mock/result/${done ? done.number : view.number}`;
  }

  screen.addEventListener("click", (e) => {
    const opt = e.target.closest("button[data-option]");
    if (opt && q) {
      const next = toggleOption(q, selected, opt.dataset.option);
      store.update((s) => { setMockAnswer(activeMock(s), id, next); });
      repaint({ option: opt.dataset.option });
      return;
    }
    const go = e.target.closest("button[data-go]");
    if (go && !go.disabled) {
      location.hash = `#/mock/exam?n=${Number(go.dataset.go) + 1}`;
      return;
    }
    const action = e.target.closest("button[data-action]")?.dataset.action;
    if (action === "flag") {
      store.update((s) => { toggleFlag(activeMock(s), id); });
      repaint({ flag: true });
    } else if (action === "finish") {
      view.finishOpen = true;
      dialog.showModal();
      dialog.querySelector('[data-action="keep"]').focus();
    } else if (action === "keep") {
      dialog.close();
    } else if (action === "confirm") {
      finish("submitted");
    }
  });
  // Al cerrar el aviso (botón o Escape) se sigue con el examen.
  dialog.addEventListener("close", () => { view.finishOpen = false; });

  if (focus?.option) main.querySelector(`[data-option="${CSS.escape(focus.option)}"]`)?.focus();
  else if (focus?.flag) main.querySelector('[data-action="flag"]')?.focus();
  if (view.finishOpen) {
    dialog.showModal();
    dialog.querySelector('[data-action="keep"]').focus();
  }

  // Temporizador: se actualiza cada segundo sin repintar la pantalla. Avisa (role="status")
  // cuando quedan 5 minutos y 1 minuto, y al llegar a 0 termina el simulacro.
  stopTicker();
  const tick = () => {
    if (!main.isConnected) return stopTicker();
    const current = activeMock(store.get());
    if (!current || current.number !== view.number) return stopTicker();
    const ms = timeLeft(current, now());
    const clock = main.querySelector("#mock-clock");
    if (clock) clock.textContent = formatClock(ms);
    main.querySelector(".mock-timer")?.classList.toggle("low", ms <= WARNINGS[0].ms);
    for (const w of WARNINGS) {
      const key = `${view.number}:${w.ms}`;
      if (ms <= w.ms && ms > 0 && !announced.has(key)) {
        announced.add(key);
        // Si ya se había pasado el aviso más largo, solo se da el más reciente.
        WARNINGS.filter((x) => x.ms > w.ms).forEach((x) => announced.add(`${view.number}:${x.ms}`));
        const box = main.querySelector("#mock-alert");
        if (box) box.textContent = t(w.key);
      }
    }
    if (ms <= 0) finish("timeout");
  };
  ticker = setInterval(tick, 1000);
}
