// «View my website»: #/projects/3/result (como ../maquetas/09_proyecto_resultado.png), a pantalla
// completa.
// - A la izquierda, la web del alumno (sus index.html + style.css + script.js guardados en
//   state.projects.pN.files) en una vista previa aislada a tamaño completo, con la barra de
//   direcciones «carpeta/index.html». Se puede usar: clics, formularios…
// - A la derecha, el checklist final: se comprueba solo al entrar (con evaluateChecks, en vistas
//   previas ocultas) y, si se cumplen todos los puntos, el proyecto queda terminado (`done`, que
//   leen el catálogo, el enunciado y «Progress»). Debajo, «Download project (.zip)» y «Compare with
//   reference solution», que cambia la parte izquierda por la web y el código del alumno al lado de
//   la solución de referencia.
// - Arriba, «Back to editor» (al primer paso sin superar) y «Open in new tab», que abre la web en
//   una pestaña nueva, también aislada (iframe sandbox) y protegida contra los bucles infinitos.
// El resultado del checklist y el modo «comparar» viven en memoria mientras la pestaña está abierta
// (el botón EN/ES no vuelve a comprobar nada si los archivos no han cambiado).
// Solo con ?debug: `compare` abre la comparación y `tab=html|css|js` elige su archivo (screens.ps1).

import { langSwitch, bindLangSwitch } from "./shell.js";
import { pick } from "./question.js";
import { briefHead } from "./projects.js";
import { loadProject } from "../data.js";
import {
  LANGS, FILES, projectFiles, projectProgress, checklistChecks, checklistItems, recordChecklist, editorStep,
} from "../engine/projects.js";
import { mountPreview, evaluateChecks, previewDocument } from "../engine/preview.js";
import { projectZip } from "../engine/zip.js";
import { inlineText, escapeHtml, codeBlock } from "../engine/format.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(globalThis.location?.search || "").has("debug");
const LANG_NAME = { html: "HTML", css: "CSS", js: "JavaScript" };
// Tamaño al que se dibujan las dos webs de la comparación (después se escalan al ancho de su columna).
const SHOT_WIDTH = 1024;
const SHOT_HEIGHT = 720;

// ---------------------------------------------------------------------------
// Estado en memoria
// ---------------------------------------------------------------------------

// Checklist por proyecto: { key (los archivos comprobados), items (null mientras se comprueba), promise }.
const checked = new Map();
// Comparación por proyecto: { open, tab }.
const compareView = new Map();
const viewOf = (project) => {
  if (!compareView.has(project.id)) compareView.set(project.id, { open: false, tab: "html" });
  return compareView.get(project.id);
};

// Vistas previas de esta pantalla (la web y las dos de la comparación). Se quitan al salir.
let previews = [];
let observers = [];
function closePreviews() {
  previews.forEach((p) => p.destroy());
  observers.forEach((o) => o.disconnect());
  previews = [];
  observers = [];
}
globalThis.addEventListener?.("hashchange", closePreviews);

// ---------------------------------------------------------------------------
// HTML (sin DOM: se prueba en tests/projects-view.test.mjs)
// ---------------------------------------------------------------------------

// Cabecera morada (como la maqueta 09): título, EN/ES, «Back to editor» y «Open in new tab».
export function resultHead(project, lang, backStep) {
  return `
    <header class="proj-head">
      <div class="brand">
        <div class="logo" aria-hidden="true">&lt;/&gt;</div>
        <div>
          <h1>${t("brief.headTitle", { n: project.number, title: pick(project.title, lang) })}</h1>
          <small>${t("result.headSub")}</small>
        </div>
      </div>
      <div class="proj-head-end">
        ${langSwitch()}
        <a class="btn pr-back" href="#/projects/${project.number}/step/${backStep}"><span aria-hidden="true">←</span> ${t("result.backEditor")}</a>
        <button type="button" class="btn lime" data-action="open-tab">${t("result.openTab")}</button>
      </div>
    </header>`;
}

// Resumen del checklist: { chip, note } según los resultados (`items`, null mientras se comprueba)
// y si el proyecto ya estaba terminado.
export function checklistSummary(items, done) {
  if (!items) return { chip: `<span class="chip">${t("result.checking")}</span>`, note: "" };
  const total = items.length;
  const passed = items.filter((i) => i.pass).length;
  const completed = `<span class="chip green pr-status">${t("result.statusDone")}</span>`;
  if (passed === total) return { chip: completed, note: `<p class="note green pr-note">${t("result.noteDone")}</p>` };
  if (done) return { chip: completed, note: `<p class="note lime pr-note">${t("result.noteChanged", { passed, total })}</p>` };
  const chip = `<span class="chip purple pr-status">${t("result.statusSome", { passed, total })}</span>`;
  if (items.some((i) => i.reason === "timeout")) return { chip, note: `<p class="note lime pr-note">${t("result.noteTimeout")}</p>` };
  return { chip, note: `<p class="note purple pr-note">${passed ? t("result.noteSome", { passed, total }) : t("result.noteNone")}</p>` };
}

// Puntos del checklist agrupados por lenguaje, con ✓ o «Not yet» (o nada mientras se comprueba).
export function checklistList(project, items, lang) {
  let current = null;
  return (project.checklist || []).map((point, i) => {
    const r = items ? items[i] : null;
    const head = point.lang !== current ? `<li class="pr-lang"><span class="chip ${point.lang}">${LANG_NAME[point.lang]}</span></li>` : "";
    current = point.lang;
    const mark = !r
      ? `<span class="visually-hidden"> (${t("result.itemChecking")})</span>`
      : r.pass
        ? `<span class="visually-hidden"> (${t("result.itemDone")})</span><span class="chip green pr-mark" aria-hidden="true">✓</span>`
        : `<span class="chip pr-mark">${t("result.notYet")}</span>`;
    return `${head}<li class="pr-item${r ? (r.pass ? " ok" : " ko") : ""}"><span class="pr-label">${inlineText(pick(point.label, lang))}</span>${mark}</li>`;
  }).join("");
}

// Tarjeta de la derecha: estado, «Final checklist», resumen y botones.
export function checklistCard(project, items, progress, view, lang) {
  const { chip, note } = checklistSummary(items, progress.status === "done");
  return `
    <aside class="card pr-check" aria-labelledby="pr-check-title">
      <div class="pr-chip">${chip}</div>
      <h2 id="pr-check-title">${t("result.checklist")}</h2>
      <ul class="pr-list" aria-busy="${!items}">${checklistList(project, items, lang)}</ul>
      <div id="pr-summary" role="status">${note}</div>
      <div class="pr-actions">
        <button type="button" class="btn primary" data-action="zip">${t("result.download")}</button>
        <p id="pr-action-status" class="small" role="status"></p>
        <button type="button" class="btn ghost" data-action="compare" aria-pressed="${view.open}">${t(view.open ? "result.compareClose" : "result.compare")}</button>
      </div>
    </aside>`;
}

// La web del alumno a tamaño completo, en una ventana de navegador con la barra de direcciones.
export function siteHtml(project) {
  return `
    <section class="card pr-site" aria-labelledby="pr-site-title">
      <h2 class="visually-hidden" id="pr-site-title">${t("result.siteTitle")}</h2>
      <div class="pr-bar" aria-hidden="true"><span class="pr-dots"><i></i><i></i><i></i></span><span class="pr-url">${escapeHtml(project.folder || "my-project")}/index.html</span></div>
      <div class="pr-frame"></div>
    </section>`;
}

// Comparación: las dos webs (a escala) y el código de cada archivo, el del alumno junto al de la
// solución de referencia.
export function compareHtml(project, files, view) {
  const tabs = LANGS.map((l) => {
    const on = l === view.tab;
    return `<button type="button" role="tab" id="pr-tab-${l}" data-tab="${l}" aria-controls="pr-code-panel" aria-selected="${on}" tabindex="${on ? 0 : -1}">${FILES[l]}</button>`;
  }).join("");
  return `
    <section class="card pr-site pr-compare" aria-labelledby="pr-compare-title">
      <div class="pr-compare-head">
        <h2 id="pr-compare-title">${t("result.compareTitle")}</h2>
        <p class="small">${t("result.compareNote")}</p>
      </div>
      <div class="pr-pair">
        <figure class="pr-fig"><figcaption>${t("result.compareMine")}</figcaption>
          <div class="browser"><div class="bar-top" aria-hidden="true"><i></i><i></i><i></i></div><div class="pr-shot" data-who="mine" inert></div></div></figure>
        <figure class="pr-fig"><figcaption>${t("result.compareRef")}</figcaption>
          <div class="browser"><div class="bar-top" aria-hidden="true"><i></i><i></i><i></i></div><div class="pr-shot" data-who="ref" inert></div></div></figure>
      </div>
      <div class="tabs pr-tabs" role="tablist" aria-label="${t("result.codeTabs")}">${tabs}</div>
      <div class="pr-codes" id="pr-code-panel" role="tabpanel" aria-labelledby="pr-tab-${view.tab}">${codePair(project, files, view.tab)}</div>
    </section>`;
}

function codePair(project, files, tab) {
  const file = FILES[tab];
  const block = (title, code) => `
    <div class="pr-code"><h3 class="small">${title}</h3>
      <div class="pr-code-box" tabindex="0" role="region" aria-label="${escapeHtml(title)}">${codeBlock(code, { lang: tab })}</div></div>`;
  return block(t("result.codeMine", { file }), files[tab]) + block(t("result.codeRef", { file }), String(project.solution?.[tab] ?? ""));
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

// Descarga el .zip con la carpeta del proyecto y los tres archivos. Devuelve el nombre del archivo.
function downloadZip(project, files) {
  const name = `${project.folder || "my-project"}.zip`;
  const blob = new Blob([projectZip(project, files)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return name;
}

// Abre la web en una pestaña nueva. Va dentro de un iframe sandbox (como la vista previa): así el
// código del alumno no llega a la app ni a su progreso, y un bucle infinito se para.
// Devuelve false si el navegador bloquea la pestaña.
function openInNewTab(project, files, lang) {
  const win = window.open("", "_blank");
  if (!win) return false;
  const title = escapeHtml(t("result.newTabTitle", { title: pick(project.title, lang) }));
  win.document.open();
  win.document.write(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>html, body { margin: 0; height: 100%; } iframe { display: block; width: 100%; height: 100%; border: 0; }</style></head>
<body><iframe sandbox="allow-scripts allow-forms" title="${title}"></iframe></body></html>`);
  win.document.close();
  win.document.querySelector("iframe").srcdoc = previewDocument(files, { focus: "always" }).html;
  try {
    win.opener = null;
  } catch {
    // sin importancia: solo corta el enlace con la pestaña de la app
  }
  return true;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

const screenFor = (project) => document.querySelector(`.pr-screen[data-project="${CSS.escape(project.id)}"]`);

// Comprueba el checklist con estos archivos (o reutiliza la comprobación si no han cambiado).
function checkFiles(project, files, store) {
  const key = JSON.stringify(files);
  const prev = checked.get(project.id);
  if (prev && prev.key === key) return prev;
  const entry = { key, items: null, promise: null };
  entry.promise = evaluateChecks(files, checklistChecks(project))
    .catch(() => checklistChecks(project).map(() => ({ pass: false, reason: "error" })))
    .then((results) => {
      entry.items = checklistItems(project, results);
      // Solo cuenta si siguen siendo los archivos guardados (p. ej., no se ha reiniciado el progreso).
      if (checked.get(project.id) === entry && JSON.stringify(projectFiles(project, (store.get().projects || {})[project.id])) === key) {
        store.update((s) => { recordChecklist(s, project, entry.items); });
      }
      return entry;
    });
  checked.set(project.id, entry);
  return entry;
}

// Monta una web a escala en `shot` (para la comparación).
function mountShot(shot, files, title) {
  const preview = mountPreview(shot, files, { width: SHOT_WIDTH, height: SHOT_HEIGHT, title });
  const frame = preview.frame;
  frame.setAttribute("tabindex", "-1");
  frame.style.width = `${SHOT_WIDTH}px`;
  frame.style.height = `${SHOT_HEIGHT}px`;
  const fit = () => {
    const scale = shot.clientWidth / SHOT_WIDTH || 0.4;
    frame.style.transform = `scale(${scale})`;
    shot.style.height = `${Math.round(SHOT_HEIGHT * scale)}px`;
  };
  fit();
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(fit);
    observer.observe(shot);
    observers.push(observer);
  }
  previews.push(preview);
}

export function renderResult(main, store, params, query = new URLSearchParams()) {
  closePreviews();
  const lang = getLang();
  main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="small pb-msg" role="status">${t("result.loading")}</p></div>`;
  bindLangSwitch(main);

  (async () => {
    const project = /^\d+$/.test(params.n) ? await loadProject(Number(params.n)) : null;
    if (!main.isConnected) return;
    if (!project) {
      main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="note purple pb-msg">${t("brief.notFound")}</p></div>`;
      bindLangSwitch(main);
      return;
    }
    drawResult(main, store, project, query);
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="note purple pb-msg" role="alert">${t("projects.loadError")}</p></div>`;
    bindLangSwitch(main);
  });
}

function drawResult(main, store, project, query) {
  const lang = getLang();
  const entryNow = () => (store.get().projects || {})[project.id];
  const files = projectFiles(project, entryNow());
  const view = viewOf(project);
  if (DEBUG) {
    if (query.has("compare")) view.open = true;
    if (LANGS.includes(query.get("tab"))) view.tab = query.get("tab");
  }
  const check = checkFiles(project, files, store);
  // Comprobado antes con estos mismos archivos (p. ej., tras importar un progreso sin `done`).
  if (check.items && projectProgress(project, entryNow()).status !== "done") {
    store.update((s) => { recordChecklist(s, project, check.items); });
  }

  main.innerHTML = `
    <div class="pb-screen pr-screen" data-project="${escapeHtml(project.id)}">
      ${resultHead(project, lang, editorStep(project, entryNow()))}
      <div class="pr-body">
        <div class="pr-left">${view.open ? compareHtml(project, files, view) : siteHtml(project)}</div>
        ${checklistCard(project, check.items, projectProgress(project, entryNow()), view, lang)}
      </div>
    </div>`;
  document.title = `${t("titles.projectResult")} · ${pick(project.title, lang)} · ${t("app.name")}`;
  bindLangSwitch(main);

  const mountLeft = () => {
    closePreviews();
    const screen = screenFor(project);
    if (!screen) return;
    if (view.open) {
      mountShot(screen.querySelector('.pr-shot[data-who="mine"]'), files, t("result.compareMine"));
      mountShot(screen.querySelector('.pr-shot[data-who="ref"]'), project.solution, t("result.compareRef"));
    } else {
      previews.push(mountPreview(screen.querySelector(".pr-frame"), files, { title: t("result.frame") }));
    }
  };
  mountLeft();

  // Cuando termina la comprobación, se repinta la tarjeta del checklist (en la pantalla que esté a
  // la vista: puede haberse repintado entera, p. ej. al cambiar de idioma).
  if (!check.items) {
    check.promise.then((entry) => {
      const screen = screenFor(project);
      if (!screen || checked.get(project.id) !== entry) return;
      const progress = projectProgress(project, entryNow());
      const { chip, note } = checklistSummary(entry.items, progress.status === "done");
      screen.querySelector(".pr-chip").innerHTML = chip;
      const list = screen.querySelector(".pr-list");
      list.innerHTML = checklistList(project, entry.items, getLang());
      list.setAttribute("aria-busy", "false");
      screen.querySelector("#pr-summary").innerHTML = note;
    });
  }

  const left = main.querySelector(".pr-left");
  const selectTab = (tab) => {
    if (view.tab !== tab) {
      view.tab = tab;
      left.querySelectorAll("[data-tab]").forEach((b) => {
        const on = b.dataset.tab === tab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      const panel = left.querySelector("#pr-code-panel");
      panel.setAttribute("aria-labelledby", `pr-tab-${tab}`);
      panel.innerHTML = codePair(project, files, tab);
    }
    left.querySelector(`#pr-tab-${tab}`)?.focus();
  };
  left.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) selectTab(tab.dataset.tab);
  });
  left.addEventListener("keydown", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = LANGS.indexOf(tab.dataset.tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? LANGS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + LANGS.length) % LANGS.length;
    selectTab(LANGS[next]);
  });

  main.querySelector(".pr-screen").addEventListener("click", (e) => {
    const action = e.target.closest("button[data-action]")?.dataset.action;
    if (action === "zip") {
      const name = downloadZip(project, files);
      main.querySelector("#pr-action-status").textContent = t("result.downloaded", { file: name });
    } else if (action === "open-tab") {
      if (!openInNewTab(project, files, getLang())) main.querySelector("#pr-action-status").textContent = t("result.blocked");
    } else if (action === "compare") {
      view.open = !view.open;
      left.innerHTML = view.open ? compareHtml(project, files, view) : siteHtml(project);
      const btn = e.target.closest("button");
      btn.setAttribute("aria-pressed", String(view.open));
      btn.textContent = t(view.open ? "result.compareClose" : "result.compare");
      mountLeft();
    }
  });
}

