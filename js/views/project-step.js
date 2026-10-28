// Espacio de trabajo de un proyecto: #/projects/3/step/6 (como ../maquetas/08_proyecto_paso.png).
// - A la izquierda, la lista de pasos agrupados por lenguaje (HTML → CSS → JS → paso final), con
//   los superados marcados. Se desplaza sola si no cabe (en pantallas de 800 px de alto).
// - En el centro, el paso: «What to do», «Must contain» (las comprobaciones del paso), la pista,
//   el editor común (js/views/code-editor.js) con las pestañas index.html / style.css / script.js
//   y los botones «Check step» y «Next step».
// - A la derecha, la vista previa en vivo (js/engine/preview.js: iframe sandbox con la consola y
//   la protección contra los bucles infinitos), que se vuelve a montar al dejar de escribir, y la
//   consola de esa vista previa.
// Los archivos del alumno y los pasos superados se guardan en state.projects.pN
// ({ passed, done, files }, js/engine/projects.js). Lo demás (pestaña elegida, pista abierta,
// resultado del último «Check step») vive en memoria mientras la pestaña está abierta, así el
// botón EN/ES no borra nada.
// El paso final («View my website & final checklist») es la pantalla #/projects/N/result (5.1d).
// Solo con ?debug: `hint` abre la pista y `tab=html|css|js` elige la pestaña (para screens.ps1).

import { bindLangSwitch } from "./shell.js";
import { pick } from "./question.js";
import { briefHead } from "./projects.js";
import { consoleLines } from "./runner-panel.js";
import { MAX_LINES } from "../engine/runner.js";
import { editorHtml, bindEditor } from "./code-editor.js";
import { loadProject } from "../data.js";
import {
  LANGS, FILES, stepAt, projectFiles, projectProgress, saveProjectFiles, recordStepCheck,
} from "../engine/projects.js";
import { mountPreview, evaluateChecks } from "../engine/preview.js";
import { inlineText, escapeHtml } from "../engine/format.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(globalThis.location?.search || "").has("debug");
const LANG_NAME = { html: "HTML", css: "CSS", js: "JavaScript" };
const PREVIEW_DELAY = 400; // ms sin escribir antes de volver a montar la vista previa
const SAVE_DELAY = 500; // mientras se escribe, los archivos se guardan como mucho cada 500 ms

const stepHref = (project, n) => `#/projects/${project.number}/step/${n}`;
const resultHref = (project) => `#/projects/${project.number}/result`;

// ---------------------------------------------------------------------------
// Estado en memoria (por proyecto) y vista previa en vivo
// ---------------------------------------------------------------------------

const sessions = new Map();
function session(project, store) {
  if (!sessions.has(project.id)) {
    sessions.set(project.id, {
      files: projectFiles(project, (store.get().projects || {})[project.id]),
      tabs: {}, // id del paso → pestaña elegida
      hints: new Set(), // pasos con la pista abierta
      results: {}, // id del paso → resultados del último «Check step»
      checking: null, // id del paso que se está comprobando
    });
  }
  return sessions.get(project.id);
}

// Solo hay una vista previa en vivo a la vez: { preview, lines } (y la que se está cargando).
let live = null;
let loading = null;
let previewTimer = null;
let pendingSave = null; // función que guarda ya los archivos pendientes
function closeLive() {
  clearTimeout(previewTimer);
  live?.preview.destroy();
  loading?.preview.destroy();
  live = null;
  loading = null;
}
function flushSave() {
  const save = pendingSave;
  pendingSave = null;
  save?.();
}
globalThis.addEventListener?.("hashchange", () => { flushSave(); closeLive(); });
globalThis.addEventListener?.("pagehide", flushSave);

// ---------------------------------------------------------------------------
// HTML (sin DOM: se prueba en tests/projects-view.test.mjs)
// ---------------------------------------------------------------------------

// Lista de pasos por lenguaje y el paso final.
export function stepsList(project, progress, current) {
  let phaseNo = 0;
  let stepNo = 0;
  const item = (n, title, href, done) => {
    const cur = n === current;
    return `<li><a class="step${done ? " done" : ""}" href="${href}"${cur ? ' aria-current="step"' : ""}>
      <span class="dot" aria-hidden="true">${done ? "✓" : n}</span>
      <span class="step-title">${title}${done ? `<span class="visually-hidden"> (${t("workspace.stepPassed")})</span>` : ""}</span>
      <span class="chev" aria-hidden="true">${cur ? "▾" : "›"}</span></a></li>`;
  };
  const groups = LANGS.map((lang) => {
    const steps = project.steps.filter((s) => s.lang === lang);
    if (!steps.length) return "";
    phaseNo++;
    const { passed, total } = progress.byLang[lang];
    const items = steps.map((s) => {
      stepNo++;
      return item(stepNo, inlineText(pick(s.title, getLang())), stepHref(project, stepNo), progress.passedIds.has(s.id));
    }).join("");
    return `
      <div class="phase"><span class="chip ${lang}">${t("workspace.phase", { n: phaseNo, lang: LANG_NAME[lang] })}</span>
        <span class="small">${t("workspace.phaseCount", { passed, total, file: FILES[lang] })}</span></div>
      <ol class="pw-list">${items}</ol>`;
  }).join("");
  const total = project.steps.length + 1;
  return `${groups}
      <div class="phase"><span class="chip purple">${t("workspace.phaseFinish", { n: phaseNo + 1 })}</span></div>
      <ol class="pw-list">${item(total, t("workspace.finalStep"), resultHref(project), progress.status === "done")}</ol>`;
}

// Columna izquierda: volver, «Steps / Project brief», progreso y la lista de pasos.
export function sideHtml(project, progress, current) {
  return `
    <a class="pb-back" href="#/projects"><span aria-hidden="true">←</span> ${t("brief.back")}</a>
    <nav class="seg pb-tabs" aria-label="${t("brief.tabsLabel")}">
      <a href="${stepHref(project, current)}" aria-current="page">${t("brief.tabSteps")}</a>
      <a href="#/projects/${project.number}/brief">${t("brief.tabBrief")}</a>
    </nav>
    <p class="pw-count">${t("workspace.stepOf", { n: current, total: progress.total })}</p>
    <div class="bar" role="img" aria-label="${t("projects.progressLabel", { passed: progress.passed, total: progress.total })}"><i style="width: ${progress.pct}%"></i></div>
    <nav class="pw-steps" aria-label="${t("workspace.stepsLabel")}">${stepsList(project, progress, current)}</nav>`;
}

// Líneas de «Must contain». `results`: los del último «Check step» (o null si no se ha comprobado).
export function mustList(step, results, lang) {
  return step.checks.map((c, i) => {
    const r = results ? results[i] : null;
    const state = !r ? "" : r.pass ? "ok" : "ko";
    const chip = !r ? "" : r.pass ? `<span class="chip green">${t("workspace.pass")}</span>` : `<span class="chip">${t("workspace.notYet")}</span>`;
    const hidden = r ? "" : `<span class="visually-hidden"> (${t("workspace.notChecked")})</span>`;
    return `<li class="must"><span class="box ${state}" aria-hidden="true">${state === "ok" ? "✓" : state === "ko" ? "✗" : ""}</span>
      <span class="must-text">${inlineText(pick(c.label, lang))}${hidden}</span>${chip}</li>`;
  }).join("");
}

// Aviso tras «Check step» (zona role="status"): "" si aún no se ha comprobado.
export function resultNote(info, results) {
  if (!results) return "";
  const passed = results.filter((r) => r && r.pass).length;
  const total = results.length;
  if (passed === total) {
    const text = info.next === info.total ? t("workspace.resultPassLast") : t("workspace.resultPass", { n: info.next });
    return `<p class="note green pw-note">${text}</p>`;
  }
  if (results.some((r) => r && r.reason === "timeout")) return `<p class="note lime pw-note">${t("workspace.resultTimeout")}</p>`;
  return `<p class="note purple pw-note">${passed ? t("workspace.resultSome", { passed, total }) : t("workspace.resultNone")}</p>`;
}

function hintHtml(step, lang) {
  return `<p class="note lime pw-hint" id="pw-hint"><strong>${t("workspace.hint")}</strong> ${inlineText(pick(step.hint, lang))}</p>`;
}

// Pestañas de los archivos y el editor del archivo elegido.
function codeHtml(step, st, tab) {
  const tabs = LANGS.map((lang) => {
    const on = lang === tab;
    return `<button type="button" role="tab" id="pw-tab-${lang}" data-tab="${lang}" aria-controls="pw-panel" aria-selected="${on}" tabindex="${on ? 0 : -1}">${FILES[lang]}${lang === step.lang ? ` <em class="here">${t("workspace.workHere")}</em>` : ""}</button>`;
  }).join("");
  return `
    <div class="tabs pw-tabs" role="tablist" aria-label="${t("workspace.tabsLabel")}">${tabs}</div>
    <div class="pw-panel" id="pw-panel" role="tabpanel" aria-labelledby="pw-tab-${tab}">
      ${editorHtml({ id: "pw-code", code: st.files[tab], label: t("workspace.codeLabel", { file: FILES[tab] }), rows: 12, className: "pw-editor", lang: tab, help: t("workspace.editorHelp") })}
    </div>`;
}

// Columna central: el paso, el editor y los botones.
export function stepHtml(project, info, progress, st, lang) {
  const step = info.step;
  const tab = st.tabs[step.id] || step.lang;
  const results = st.results[step.id] || null;
  const checking = st.checking === step.id;
  const hintOpen = st.hints.has(step.id);
  const passed = progress.passedIds.has(step.id);
  const nextHref = info.next === info.total ? resultHref(project) : stepHref(project, info.next);
  return `
    <section class="card pw-task" aria-labelledby="pw-step-title">
      <div class="pw-task-head">
        <div class="pw-task-id">
          <h2 id="pw-step-title"><span class="chip ${step.lang}">${t("workspace.chip", { n: info.number, lang: LANG_NAME[step.lang] })}</span><span class="visually-hidden">: ${escapeHtml(pick(step.title, lang))}</span></h2>
          <span class="small">${t("workspace.file")} <code>${FILES[step.lang]}</code></span>
          ${passed ? `<span class="chip green pw-passed"><span aria-hidden="true">✓</span> ${t("workspace.passedChip")}</span>` : ""}
        </div>
        <nav class="pw-nav" aria-label="${t("workspace.navLabel")}">
          ${info.prev ? `<a class="mini" href="${stepHref(project, info.prev)}"><span aria-hidden="true">‹</span> ${t("workspace.prev", { n: info.prev })}</a>` : ""}
          <a class="mini" href="${nextHref}">${info.next === info.total ? t("workspace.nextFinal") : t("workspace.next", { n: info.next })} <span aria-hidden="true">›</span></a>
        </nav>
      </div>
      <div>
        <h3 class="label">${t("workspace.whatToDo")}</h3>
        <p class="pw-text">${inlineText(pick(step.task, lang))}</p>
      </div>
      <div>
        <h3 class="label">${t("workspace.mustContain")}</h3>
        <ul class="pw-must" aria-busy="${checking}">${mustList(step, results, lang)}</ul>
      </div>
      <div id="pw-result" role="status">${resultNote(info, results)}</div>
      <div class="pw-hint-box">
        <button type="button" class="mini pw-hint-btn" data-action="hint" aria-expanded="${hintOpen}" aria-controls="pw-hint-area">${t(hintOpen ? "workspace.hideHint" : "workspace.showHint")}</button>
        <div id="pw-hint-area">${hintOpen ? hintHtml(step, lang) : ""}</div>
      </div>
    </section>

    <div class="pw-code">${codeHtml(step, st, tab)}</div>

    <div class="pw-actions">
      <button type="button" class="btn ghost" data-action="check"${checking ? ' aria-disabled="true"' : ""}>${t(checking ? "workspace.checking" : "workspace.check")}</button>
      <a class="btn primary" href="${nextHref}">${t(info.next === info.total ? "workspace.toFinal" : "workspace.nextStep")}</a>
    </div>`;
}

// Columna derecha: vista previa en vivo, consola y nota del paso.
function previewHtml(step, lang) {
  return `
    <div class="pw-preview-head"><h2 id="pw-preview-title">${t("workspace.preview")}</h2><span class="small">${t("workspace.previewSub")}</span></div>
    <div class="browser pw-browser"><div class="bar-top" aria-hidden="true"><i></i><i></i><i></i></div><div class="pw-frame"></div></div>
    <section class="console pw-console" aria-labelledby="pw-console-title">
      <h3 class="console-title" id="pw-console-title">${t("workspace.console")}</h3>
      <div class="runner-out pw-out">${consoleHtml([])}</div>
    </section>
    ${step.note ? `<p class="small pw-note-text">${inlineText(pick(step.note, lang))}</p>` : ""}`;
}

export function consoleHtml(lines) {
  if (!lines.length) return `<p class="cl msg muted">${t("workspace.consoleEmpty")}</p>`;
  // Como «Run this code»: solo las primeras MAX_LINES líneas, con un aviso (pero los errores que
  // llegan después se ven siempre, p. ej. el de un bucle infinito que escribe en la consola).
  const truncated = lines.length > MAX_LINES;
  const shown = truncated ? [...lines.slice(0, MAX_LINES), ...lines.slice(MAX_LINES).filter((l) => l.error)] : lines;
  return consoleLines({ running: false, output: { lines: shown, truncated } });
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

function screenFor(project, number) {
  return document.querySelector(`.pw-screen[data-project="${CSS.escape(project.id)}"][data-step="${number}"]`);
}

// Monta la vista previa en vivo con los archivos actuales. La nueva se carga oculta encima de la
// anterior y la sustituye cuando está lista (así no parpadea al escribir).
function refreshPreview(project, number, files) {
  const screen = screenFor(project, number);
  const holder = screen?.querySelector(".pw-frame");
  if (!holder) return;
  loading?.preview.destroy();
  const entry = { lines: [], preview: null, timer: null };
  // La consola se repinta como mucho cada 50 ms (un bucle con console.log manda muchas líneas
  // seguidas) y queda abajo del todo, en la última línea.
  const paintConsole = () => {
    entry.timer = null;
    if (live !== entry) return;
    const out = screenFor(project, number)?.querySelector(".pw-out");
    if (!out) return;
    out.innerHTML = consoleHtml(entry.lines);
    const box = out.closest(".pw-console");
    box.scrollTop = box.scrollHeight;
  };
  entry.preview = mountPreview(holder, files, {
    title: t("workspace.previewFrame"),
    onConsole(line) {
      if (entry.lines.length <= MAX_LINES || line.error) entry.lines.push(line);
      if (!entry.timer) entry.timer = setTimeout(paintConsole, 50);
    },
  });
  entry.preview.frame.style.visibility = "hidden";
  loading = entry;
  entry.preview.ready.then(() => {
    if (loading !== entry) return;
    loading = null;
    live?.preview.destroy();
    live = entry;
    entry.preview.frame.style.visibility = "";
    paintConsole();
  });
}

export function renderStep(main, store, params, query = new URLSearchParams()) {
  flushSave();
  closeLive();
  const lang = getLang();
  main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="small pb-msg" role="status">${t("workspace.loading")}</p></div>`;
  bindLangSwitch(main);

  (async () => {
    const project = /^\d+$/.test(params.n) ? await loadProject(Number(params.n)) : null;
    if (!main.isConnected) return;
    if (!project) {
      main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="note purple pb-msg">${t("brief.notFound")}</p></div>`;
      bindLangSwitch(main);
      return;
    }
    const info = /^\d+$/.test(params.m) ? stepAt(project, Number(params.m)) : null;
    if (info?.final) {
      location.replace(resultHref(project));
      return;
    }
    if (!info) {
      main.innerHTML = `<div class="pb-screen">${briefHead(project, lang)}<p class="note purple pb-msg">${t("workspace.notFound", { n: project.number })}</p></div>`;
      bindLangSwitch(main);
      return;
    }
    drawStep(main, store, project, info, query);
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="note purple pb-msg" role="alert">${t("projects.loadError")}</p></div>`;
    bindLangSwitch(main);
  });
}

function drawStep(main, store, project, info, query) {
  const lang = getLang();
  const st = session(project, store);
  const step = info.step;
  // Lo escrito siempre está guardado (renderStep guarda lo pendiente antes de pintar), así que el
  // progreso manda: si no coincide, es que se ha reiniciado o importado (o cambiado en otra pestaña).
  const saved = projectFiles(project, (store.get().projects || {})[project.id]);
  if (LANGS.some((l) => saved[l] !== st.files[l])) {
    st.files = saved;
    st.results = {};
  }
  if (DEBUG) {
    if (query.has("hint")) st.hints.add(step.id);
    if (LANGS.includes(query.get("tab"))) st.tabs[step.id] = query.get("tab");
  }
  const progressNow = () => projectProgress(project, (store.get().projects || {})[project.id]);
  main.innerHTML = `
    <div class="pb-screen pw-screen" data-project="${project.id}" data-step="${info.number}">
      ${briefHead(project, lang)}
      <div class="pw-body">
        <aside class="pw-side">${sideHtml(project, progressNow(), info.number)}</aside>
        <div class="pw-main">${stepHtml(project, info, progressNow(), st, lang)}</div>
        <section class="pw-preview" aria-labelledby="pw-preview-title">${previewHtml(step, lang)}</section>
      </div>
    </div>`;
  document.title = `${t("workspace.chip", { n: info.number, lang: LANG_NAME[step.lang] })} · ${pick(project.title, lang)} · ${t("app.name")}`;
  bindLangSwitch(main);

  // El paso actual queda a la vista, centrado, en la lista de pasos (si no cabe entera). Solo se
  // desplaza la lista: «All projects» y «Steps / Project brief» siguen arriba.
  const list = main.querySelector(".pw-steps");
  const cur = list.querySelector('[aria-current="step"]');
  if (cur && list.scrollHeight > list.clientHeight) {
    const top = cur.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (top + cur.offsetHeight > list.clientHeight - 16) list.scrollTop = top - list.clientHeight / 2;
  }

  refreshPreview(project, info.number, { ...st.files });

  // Solo se repinta lo que cambia, en la pantalla que esté a la vista (puede haberse repintado
  // entera mientras se comprobaba, p. ej. al cambiar de idioma).
  const paint = () => {
    const screen = screenFor(project, info.number);
    if (!screen) return;
    const progress = progressNow();
    const results = st.results[step.id] || null;
    const checking = st.checking === step.id;
    // La lista de pasos se pinta de nuevo: conserva su desplazamiento.
    const keep = screen.querySelector(".pw-steps")?.scrollTop || 0;
    screen.querySelector(".pw-side").innerHTML = sideHtml(project, progress, info.number);
    screen.querySelector(".pw-steps").scrollTop = keep;
    const must = screen.querySelector(".pw-must");
    must.innerHTML = mustList(step, results, getLang());
    must.setAttribute("aria-busy", String(checking));
    screen.querySelector("#pw-result").innerHTML = resultNote(info, results);
    const btn = screen.querySelector('[data-action="check"]');
    btn.textContent = t(checking ? "workspace.checking" : "workspace.check");
    if (checking) btn.setAttribute("aria-disabled", "true");
    else btn.removeAttribute("aria-disabled");
    const id = screen.querySelector(".pw-task-id");
    if (progress.passedIds.has(step.id) && !id.querySelector(".pw-passed")) {
      id.insertAdjacentHTML("beforeend", `<span class="chip green pw-passed"><span aria-hidden="true">✓</span> ${t("workspace.passedChip")}</span>`);
    }
  };

  const check = async () => {
    if (st.checking) return;
    flushSave();
    st.checking = step.id;
    delete st.results[step.id];
    paint();
    const files = { ...st.files };
    let results;
    try {
      results = await evaluateChecks(files, step.checks);
    } catch {
      results = step.checks.map(() => ({ pass: false, reason: "error" }));
    }
    st.checking = null;
    st.results[step.id] = results;
    store.update((s) => { recordStepCheck(s, project, step.id, results, files); });
    paint();
  };

  // Editor: cada cambio actualiza la vista previa (al dejar de escribir) y se guarda.
  const bindArea = () => {
    const area = main.querySelector("#pw-code");
    const tab = st.tabs[step.id] || step.lang;
    bindEditor(area, {
      onInput(code) {
        st.files[tab] = code;
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => refreshPreview(project, info.number, { ...st.files }), PREVIEW_DELAY);
        if (!pendingSave) {
          pendingSave = () => store.update((s) => { saveProjectFiles(s, project, st.files); });
          setTimeout(flushSave, SAVE_DELAY);
        }
      },
      onRun: check,
    });
  };
  bindArea();

  // Pestañas de archivo (con las flechas, como un tablist).
  const selectTab = (lang, focus) => {
    if ((st.tabs[step.id] || step.lang) !== lang) {
      st.tabs[step.id] = lang;
      main.querySelector(".pw-code").innerHTML = codeHtml(step, st, lang);
      bindArea();
    }
    if (focus) main.querySelector(`#pw-tab-${lang}`)?.focus();
  };
  main.querySelector(".pw-code").addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) selectTab(tabBtn.dataset.tab, true);
  });
  main.querySelector(".pw-code").addEventListener("keydown", (e) => {
    const tabBtn = e.target.closest("[data-tab]");
    if (!tabBtn || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = LANGS.indexOf(tabBtn.dataset.tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? LANGS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + LANGS.length) % LANGS.length;
    selectTab(LANGS[next], true);
  });

  main.querySelector(".pw-main").addEventListener("click", (e) => {
    const action = e.target.closest("button[data-action]")?.dataset.action;
    if (action === "check") check();
    else if (action === "hint") {
      const open = !st.hints.has(step.id);
      if (open) st.hints.add(step.id);
      else st.hints.delete(step.id);
      const btn = e.target.closest("button");
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = t(open ? "workspace.hideHint" : "workspace.showHint");
      main.querySelector("#pw-hint-area").innerHTML = open ? hintHtml(step, getLang()) : "";
    }
  });
}
