// Proyectos de «Course review».
// - #/projects: catálogo (como ../maquetas/06_proyectos.png). Una tarjeta por proyecto con su nivel,
//   su estado (terminado, paso en curso o sin empezar), los pasos por lenguaje y los temas del curso
//   en los que se basa. Filtros «All / In progress / Completed / Not started».
// - #/projects/3/brief: «Project brief» (como ../maquetas/07_proyecto_enunciado.png), a pantalla
//   completa: objetivo, resultado final (la solución de referencia en una vista previa aislada),
//   requisitos por lenguaje marcados con los pasos superados y «Your progress» con el siguiente paso.
// El estado de cada proyecto sale de state.projects.pN ({ passed, done, files }), que guardan los
// pasos (js/views/project-step.js) y «View my website» (5.1d). Ver projectProgress en js/engine/projects.js.
// Solo con ?debug: `filter=progress|done|new` elige el filtro del catálogo (para screens.ps1).

import { langSwitch, bindLangSwitch, pageHeader, scrollMotion } from "./shell.js";
import { pick } from "./question.js";
import { loadProjectSummaries, loadProject } from "../data.js";
import { projectProgress, catalogCounts, stepCounts, LANGS } from "../engine/projects.js";
import { mountPreview } from "../engine/preview.js";
import { inlineText, escapeHtml } from "../engine/format.js";
import { t, getLang } from "../i18n.js";

const DEBUG = new URLSearchParams(globalThis.location?.search || "").has("debug");

// Claves de data/ui escritas enteras (tests/i18n.test.mjs comprueba que existen y se usan).
const LEVEL_KEYS = { beginner: "projects.levelBeginner", intermediate: "projects.levelIntermediate", advanced: "projects.levelAdvanced" };
const FILTERS = [
  { id: "all", key: "projects.filterAll" },
  { id: "progress", key: "projects.filterProgress" },
  { id: "done", key: "projects.filterDone" },
  { id: "new", key: "projects.filterNew" },
];
const NONE_KEYS = { progress: "projects.noneProgress", done: "projects.noneDone", new: "projects.noneNew" };
const CHIP_LANG = { html: "HTML", css: "CSS", js: "JS" };
const REQ_LANG = { html: "brief.langHtml", css: "brief.langCss", js: "brief.langJs" };
const TOC = [
  { id: "pb-goal", key: "brief.goal" },
  { id: "pb-result", key: "brief.result" },
  { id: "pb-req-html", key: "brief.reqHtml" },
  { id: "pb-req-css", key: "brief.reqCss" },
  { id: "pb-req-js", key: "brief.reqJs" },
  { id: "pb-files", key: "brief.files" },
];

// Filtro elegido en el catálogo (en memoria: sobrevive al cambio de idioma).
const catalogView = { filter: "all" };

function levelName(level) {
  return LEVEL_KEYS[level] ? t(LEVEL_KEYS[level]) : level;
}

const stepHref = (project, n) => `#/projects/${project.number}/step/${n}`;

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

// Etiquetas de lenguaje de una tarjeta. Sin empezar o terminado: «HTML · 3 steps», «CSS · 4»,
// «JS · 2». En curso: «HTML ✓» con el lenguaje hecho y «JS · 1 / 4» con el que falta.
function langChips(project, progress) {
  const counts = stepCounts(project);
  return LANGS.filter((lang) => counts[lang] > 0).map((lang, i) => {
    const name = CHIP_LANG[lang];
    const { passed, total } = progress.byLang[lang];
    let text;
    if (progress.status === "progress") {
      text = passed === total ? t("projects.chipLangDone", { lang: name }) : t("projects.chipPassed", { lang: name, passed, total });
    } else if (i === 0) {
      text = total === 1 ? t("projects.chipStep", { lang: name }) : t("projects.chipSteps", { lang: name, n: total });
    } else {
      text = t("projects.chipCount", { lang: name, n: total });
    }
    return `<span class="chip ${lang}">${text}</span>`;
  }).join("");
}

function statusChip(progress) {
  if (progress.status === "done") return `<span class="chip green">${t("projects.statusDone")}</span>`;
  if (progress.status === "progress") return `<span class="chip purple">${t("projects.statusStep", { n: progress.next, total: progress.total })}</span>`;
  return `<span class="chip">${t("projects.statusNew")}</span>`;
}

// Tarjeta de un proyecto. El título es el enlace al «Project brief» y cubre toda la tarjeta.
export function projectCard(project, progress, lang) {
  const titleId = `proj-${project.number}`;
  return `
    <li class="card proj${progress.status === "progress" ? " current" : ""}">
      <div class="proj-top">
        <p class="proj-num">${t("projects.kicker", { n: project.number, level: levelName(project.level) })}</p>
        ${statusChip(progress)}
      </div>
      <h2 id="${titleId}"><a class="proj-link" href="#/projects/${project.number}/brief">${escapeHtml(pick(project.title, lang))}</a></h2>
      <p class="proj-summary">${inlineText(pick(project.summary, lang))}</p>
      <div class="proj-chips">${langChips(project, progress)}</div>
      ${progress.status === "progress"
        ? `<div class="bar" role="img" aria-label="${t("projects.progressLabel", { passed: progress.passed, total: progress.total })}"><i style="width: ${progress.pct}%"></i></div>`
        : ""}
      <p class="proj-from">${t("projects.basedOn")} ${(project.basedOn || []).map((b) => `<code>${escapeHtml(b)}</code>`).join(" ")}</p>
    </li>`;
}

export function renderProjects(main, store, query = new URLSearchParams()) {
  const header = pageHeader({ title: t("projects.heading"), sub: t("projects.sub") });
  main.innerHTML = header;
  bindLangSwitch(main);
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("projects.loading")}</p>`);
  if (DEBUG && FILTERS.some((f) => f.id === query.get("filter"))) catalogView.filter = query.get("filter");

  (async () => {
    // Las tarjetas solo usan el título, el resumen, el nivel, los temas y los pasos de cada
    // proyecto: vienen en el índice ligero (sin el código de partida ni las soluciones).
    const projects = await loadProjectSummaries();
    if (!main.isConnected) return;
    const lang = getLang();
    const state = store.get().projects || {};

    const draw = (focusFilter = null) => {
      if (!projects.length) {
        main.innerHTML = `${header}<p class="note purple">${t("projects.empty")}</p>`;
        bindLangSwitch(main);
        return;
      }
      const counts = catalogCounts(projects, state);
      const progressOf = new Map(projects.map((p) => [p.id, projectProgress(p, state[p.id])]));
      const shown = projects.filter((p) => catalogView.filter === "all" || progressOf.get(p.id).status === catalogView.filter);
      const buttons = FILTERS.map((f) => `<button type="button" data-filter="${f.id}" aria-pressed="${catalogView.filter === f.id}">${t(f.key, { count: counts[f.id] })}</button>`).join("");
      main.innerHTML = `${header}
        <div class="proj-bar">
          <div class="proj-filters" role="group" aria-label="${t("projects.filterLabel")}">${buttons}</div>
          <p class="small">${t("projects.notExam")}</p>
        </div>
        ${shown.length
          ? `<ul class="projects">${shown.map((p) => projectCard(p, progressOf.get(p.id), lang)).join("")}</ul>`
          : `<p class="note purple">${t(NONE_KEYS[catalogView.filter])}</p>`}`;
      bindLangSwitch(main);
      main.querySelector(".proj-filters").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-filter]");
        if (!btn || btn.dataset.filter === catalogView.filter) return;
        catalogView.filter = btn.dataset.filter;
        draw(btn.dataset.filter);
      });
      if (focusFilter) main.querySelector(`[data-filter="${focusFilter}"]`)?.focus();
    };
    draw();
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `${header}<p class="note purple" role="alert">${t("projects.loadError")}</p>`;
    bindLangSwitch(main);
  });
}

// ---------------------------------------------------------------------------
// «Project brief»
// ---------------------------------------------------------------------------

// Vista previa del resultado final: una sola a la vez. Se quita al salir de la pantalla.
const RESULT_WIDTH = 720;
const RESULT_HEIGHT = 540;
let resultPreview = null;
let resultObserver = null;
function closeResultPreview() {
  resultPreview?.destroy();
  resultObserver?.disconnect();
  resultPreview = null;
  resultObserver = null;
}
globalThis.addEventListener?.("hashchange", closeResultPreview);

// Cabecera morada a pantalla completa (como la maqueta 07). `project` puede ser null.
export function briefHead(project, lang) {
  return `
    <header class="proj-head">
      <div class="brand">
        <div class="logo" aria-hidden="true">&lt;/&gt;</div>
        <div>
          <h1>${project ? t("brief.headTitle", { n: project.number, title: pick(project.title, lang) }) : t("titles.projectBrief")}</h1>
          <small>${t("brief.headSub")}</small>
        </div>
      </div>
      <div class="proj-head-end">
        ${langSwitch()}
        ${project ? `<a class="btn lime" href="#/projects/${project.number}/result"><span aria-hidden="true">▶</span> ${t("brief.viewSite")}</a>` : ""}
      </div>
    </header>`;
}

// Requisitos de un lenguaje: un paso = un requisito, marcado si el paso está superado.
function requirementCard(project, lang, progress, uiLang) {
  const steps = project.steps.filter((s) => s.lang === lang);
  if (!steps.length) return "";
  const { passed, total } = progress.byLang[lang];
  const chip = passed === total ? "green" : passed ? "purple" : "";
  const items = steps.map((s) => {
    const ok = progress.passedIds.has(s.id);
    return `<li><span class="pb-tick${ok ? " ok" : ""}" aria-hidden="true">${ok ? "✓" : ""}</span>
      <span>${inlineText(pick(s.requirement, uiLang))}<span class="visually-hidden"> (${t(ok ? "brief.reqDone" : "brief.reqTodo")})</span></span></li>`;
  }).join("");
  return `
    <section class="card pb-req ${lang}" aria-labelledby="pb-req-${lang}">
      <h3 id="pb-req-${lang}" tabindex="-1">${t(REQ_LANG[lang])}
        <span class="chip ${chip}" role="img" aria-label="${t("brief.reqCount", { passed, total })}">${passed} / ${total}</span></h3>
      <ul>${items}</ul>
    </section>`;
}

// Tarjeta «Your progress» con el botón al siguiente paso.
function progressCard(project, progress) {
  let text;
  let action;
  if (progress.status === "done") {
    text = t("brief.progressDone", { total: progress.total });
    action = `<a class="btn primary" href="#/projects/${project.number}/result">${t("brief.review")}</a>`;
  } else if (progress.passed === 0) {
    text = t("brief.progressNew", { total: progress.total });
    action = `<a class="btn primary" href="${stepHref(project, 1)}">${t("brief.start")}</a>`;
  } else if (progress.next === progress.total) {
    text = t("brief.progressLast", { passed: progress.passed, total: progress.total });
    action = `<a class="btn primary" href="${stepHref(project, progress.next)}">${t("brief.finish")}</a>`;
  } else {
    text = t("brief.progressNext", { passed: progress.passed, total: progress.total, next: progress.next });
    action = `<a class="btn primary" href="${stepHref(project, progress.next)}">${t("brief.continue", { n: progress.next })}</a>`;
  }
  return `
    <section class="card pb-progress" aria-labelledby="pb-progress-title">
      <h2 id="pb-progress-title" class="small">${t("brief.yourProgress")}</h2>
      <div class="bar" aria-hidden="true"><i style="width: ${progress.pct}%"></i></div>
      <p>${text}</p>
      ${action}
    </section>`;
}

export function briefHtml(project, progress, lang) {
  const counts = stepCounts(project);
  const chips = LANGS.filter((l) => counts[l] > 0).map((l, i) => {
    const name = CHIP_LANG[l];
    const n = counts[l];
    const text = i > 0 ? t("projects.chipCount", { lang: name, n }) : n === 1 ? t("projects.chipStep", { lang: name }) : t("projects.chipSteps", { lang: name, n });
    return `<span class="chip ${l}">${text}</span>`;
  }).join("");
  return `
    <div class="pb-body">
      <aside class="pb-side">
        <a class="pb-back" href="#/projects"><span aria-hidden="true">←</span> ${t("brief.back")}</a>
        <nav class="seg pb-tabs" aria-label="${t("brief.tabsLabel")}">
          <a href="${stepHref(project, progress.status === "done" ? 1 : progress.next)}">${t("brief.tabSteps")}</a>
          <a href="#/projects/${project.number}/brief" aria-current="page">${t("brief.tabBrief")}</a>
        </nav>
        <nav class="pb-toc" aria-label="${t("brief.tocLabel")}">
          <ul>${TOC.filter((x) => !x.id.startsWith("pb-req-") || counts[x.id.slice(7)] > 0)
            .map((x, i) => `<li><button type="button" data-jump="${x.id}"${i === 0 ? ' class="on"' : ""}>${t(x.key)}</button></li>`).join("")}</ul>
        </nav>
        ${progressCard(project, progress)}
      </aside>

      <div class="pb-content" tabindex="0" role="region" aria-label="${t("brief.tabBrief")}">
        <div class="pb-row">
          <section class="card pb-goal" aria-labelledby="pb-goal-title">
            <p class="label" id="pb-goal" tabindex="-1">${t("brief.goal")}</p>
            <h2 id="pb-goal-title">${inlineText(pick(project.goal.title, lang))}</h2>
            <p class="pb-text">${inlineText(pick(project.goal.body, lang))}</p>
            <div class="pb-chips">
              <span class="chip">${t("brief.level", { level: levelName(project.level) })}</span>
              <span class="chip">${t("brief.minutes", { n: project.minutes })}</span>
              ${chips}
            </div>
            <p class="label pb-files-label" id="pb-files" tabindex="-1">${t("brief.files")}</p>
            <p class="pb-files">${t("brief.filesText")}</p>
          </section>
          <section class="card pb-result" aria-labelledby="pb-result">
            <h2 class="label" id="pb-result" tabindex="-1">${t("brief.result")}</h2>
            <div class="browser"><div class="bar-top" aria-hidden="true"><i></i><i></i><i></i></div><div class="pb-shot" inert></div></div>
            <p class="small">${inlineText(pick(project.result, lang))}</p>
          </section>
        </div>

        <h2 class="label pb-req-title">${t("brief.reqTitle")}</h2>
        <div class="pb-reqs">
          ${LANGS.map((l) => requirementCard(project, l, progress, lang)).join("")}
        </div>
      </div>
    </div>`;
}

// Monta la solución de referencia en la ventanita «Final result», escalada al ancho de la tarjeta.
function mountResult(main, project) {
  const shot = main.querySelector(".pb-shot");
  if (!shot) return;
  closeResultPreview();
  resultPreview = mountPreview(shot, project.solution, { width: RESULT_WIDTH, height: RESULT_HEIGHT, title: t("brief.resultFrame") });
  const frame = resultPreview.frame;
  frame.setAttribute("tabindex", "-1");
  frame.style.width = `${RESULT_WIDTH}px`;
  frame.style.height = `${RESULT_HEIGHT}px`;
  const fit = () => {
    const scale = shot.clientWidth / RESULT_WIDTH || 0.45;
    frame.style.transform = `scale(${scale})`;
    shot.style.height = `${Math.round(RESULT_HEIGHT * scale)}px`;
  };
  fit();
  if (typeof ResizeObserver === "function") {
    resultObserver = new ResizeObserver(fit);
    resultObserver.observe(shot);
  }
}

export function renderBrief(main, store, params) {
  closeResultPreview();
  const number = Number(params.n);
  const lang = getLang();
  main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="small pb-msg" role="status">${t("brief.loading")}</p></div>`;
  bindLangSwitch(main);

  (async () => {
    const project = /^\d+$/.test(params.n) ? await loadProject(number) : null;
    if (!main.isConnected) return;
    if (!project) {
      main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="note purple pb-msg">${t("brief.notFound")}</p></div>`;
      bindLangSwitch(main);
      return;
    }
    const progress = projectProgress(project, (store.get().projects || {})[project.id]);
    main.innerHTML = `<div class="pb-screen">${briefHead(project, lang)}${briefHtml(project, progress, lang)}</div>`;
    document.title = `${t("brief.headTitle", { n: project.number, title: pick(project.title, lang) })} · ${t("app.name")}`;
    bindLangSwitch(main);
    mountResult(main, project);

    // Índice: lleva al apartado (con el foco en su título) y lo marca como el actual.
    main.querySelector(".pb-toc").addEventListener("click", (e) => {
      const jump = e.target.closest("[data-jump]");
      if (!jump) return;
      main.querySelectorAll(".pb-toc button").forEach((b) => b.classList.toggle("on", b === jump));
      const target = main.querySelector(`#${jump.dataset.jump}`);
      target?.closest(".card")?.scrollIntoView({ block: "start", behavior: scrollMotion() });
      target?.focus({ preventScroll: true });
    });
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `<div class="pb-screen">${briefHead(null, lang)}<p class="note purple pb-msg" role="alert">${t("projects.loadError")}</p></div>`;
    bindLangSwitch(main);
  });
}
