// Panel de inicio «Dashboard» (#/, como ../maquetas/01_inicio.png).
// Saludo sin el nombre del alumno, cifras reales del progreso (preguntas respondidas, acierto,
// ejercicios resueltos y mejor simulacro), avance por las 6 secciones oficiales, el siguiente paso
// recomendado (siempre en positivo), la tarjeta del simulacro y la de «Course review» con el
// proyecto en curso. Los cálculos están en js/engine/dashboard.js.
// No hay semáforo de «¿estoy preparado?» (decisión del cliente): solo avance y ánimo.

import { pageHeader, bindLangSwitch } from "./shell.js";
import { pick } from "./question.js";
import { loadSummary } from "../data.js";
import { dashboardData } from "../engine/dashboard.js";
import { MOCK_SIZE, MOCK_MINUTES, PASS_PERCENT } from "../engine/mock.js";
import { LANGS as PROJECT_LANGS } from "../engine/projects.js";
import { escapeHtml } from "../engine/format.js";
import { now } from "../clock.js";
import { t, getLang } from "../i18n.js";

function header(empty) {
  return pageHeader({
    title: t(empty ? "dashboard.titleFirst" : "dashboard.title"),
    sub: t("dashboard.sub", { questions: MOCK_SIZE, minutes: MOCK_MINUTES, pass: PASS_PERCENT }),
  });
}

export function renderDashboard(main, store) {
  main.innerHTML = header(false);
  bindLangSwitch(main);
  main.insertAdjacentHTML("beforeend", `<p class="small" role="status">${t("practice.loading")}</p>`);
  (async () => {
    // Solo cuenta: le basta el índice ligero (no descarga los bancos enteros).
    const { sections, questionBanks, exerciseBanks, mockBank, projects } = await loadSummary();
    if (!main.isConnected) return;
    const d = dashboardData({ sections, questionBanks, exerciseBanks, mockBank, projects, state: store.get(), now: now() });
    const lang = getLang();

    main.innerHTML = `
      ${header(d.empty)}
      <section class="grid4" aria-label="${t("dashboard.statsLabel")}">
        ${stat(t("dashboard.statAnswered"), d.questions.answered, `/ ${d.questions.total}`)}
        ${stat(t("dashboard.statAccuracy"), d.questions.accuracy === null ? "–" : `${d.questions.accuracy}%`, "", d.questions.accuracy === null ? t("dashboard.noData") : "")}
        ${stat(t("dashboard.statExercises"), d.exercises.solved, `/ ${d.exercises.total}`)}
        ${stat(t("dashboard.statMock"), d.bestMock ? `${d.bestMock.percent}%` : "–", "", d.bestMock ? "" : t("dashboard.noMock"), d.bestMock?.passed ? "ok" : "")}
      </section>

      <div class="dash-cols">
        <div class="dash-main">
          ${sectionsCard(d.sections, lang)}
          ${nextCard(d.next, lang)}
        </div>
        <div class="dash-side">
          ${mockCard(d.mock)}
          ${projectsCard(d.projects, lang)}
        </div>
      </div>`;
    bindLangSwitch(main);
  })().catch(() => {
    if (!main.isConnected) return;
    main.innerHTML = `${header(false)}
      <p class="note purple" role="alert">${t("practice.loadError")}</p>`;
    bindLangSwitch(main);
  });
}

// Cifra de la fila superior. `note`: texto pequeño bajo la cifra (p. ej., «Not taken yet»).
function stat(label, value, total = "", note = "", cls = "") {
  return `
        <div class="card stat">
          <span>${label}</span>
          <strong class="${cls}">${value}${total ? ` <small>${total}</small>` : ""}</strong>
          ${note ? `<p class="dash-stat-note">${note}</p>` : ""}
        </div>`;
}

// «Progress by exam section»: lo respondido en cada sección. Las secciones sin preguntas todavía
// dicen «Coming soon» en vez de un 0 %.
function sectionsCard(rows, lang) {
  const items = rows.map((r) => {
    const title = `${r.id}. ${escapeHtml(pick(r.title, lang))}`;
    const value = r.total ? `${r.pct}%` : t("dashboard.soon");
    const detail = r.total
      ? t("dashboard.sectionDetail", { answered: r.answered, total: r.total })
      : t("dashboard.soonDetail");
    return `
          <li class="bar-row">
            <div class="lbl"><a href="#/practice/${r.id}">${title}</a><span>${value}<span class="visually-hidden"> · ${detail}</span></span></div>
            <div class="bar" aria-hidden="true">${r.pct ? `<i style="width: ${r.pct}%"></i>` : ""}</div>
          </li>`;
  }).join("");
  return `
        <section class="card dash-sections" aria-labelledby="dash-sections-title">
          <h2 id="dash-sections-title">${t("dashboard.sectionsTitle")}</h2>
          <ul class="dash-bars">${items}</ul>
        </section>`;
}

// Siguiente paso recomendado (js/engine/dashboard.js, nextStep).
function nextCard(next, lang) {
  let title;
  let text;
  let action;
  const sectionName = (s) => pick(s.title, lang); // t() ya escapa las variables
  if (next.kind === "review") {
    title = next.count === 1 ? t("dashboard.reviewOne") : t("dashboard.reviewMany", { count: next.count });
    text = t("dashboard.reviewText");
    action = `<a class="btn primary" href="#/mistakes/review?n=1">${t("dashboard.reviewButton")}</a>`;
  } else if (next.kind === "start") {
    title = t("dashboard.startTitle", { n: next.section.id });
    text = t("dashboard.startText", { title: sectionName(next.section) });
    action = `<a class="btn primary" href="#/practice/${next.section.id}">${t("dashboard.startButton")}</a>`;
  } else if (next.kind === "focus") {
    title = t("dashboard.focusTitle", { n: next.section.id });
    text = t("dashboard.focusText", { title: sectionName(next.section), answered: next.section.answered, total: next.section.total });
    action = `<a class="btn primary" href="#/practice/${next.section.id}">${t("dashboard.focusButton")}</a>`;
  } else {
    title = t(next.passed ? "dashboard.mockAgainTitle" : "dashboard.mockTitle");
    text = t("dashboard.mockText", { questions: MOCK_SIZE, minutes: MOCK_MINUTES });
    action = `<a class="btn primary" href="#/mock">${t("dashboard.mockButton")}</a>`;
  }
  return `
        <section class="card dash-next" aria-labelledby="dash-next-title">
          <div class="dash-next-text">
            <p class="dash-kicker">${t("dashboard.nextKicker")}</p>
            <h2 id="dash-next-title">${title}</h2>
            <p class="dash-text">${text}</p>
          </div>
          ${action}
        </section>`;
}

// Tarjeta morada del simulacro: empezar o seguir el que está en curso.
function mockCard(mock) {
  let title;
  let text;
  let action;
  if (mock.active && !mock.expired) {
    title = t("dashboard.mockActiveTitle");
    text = t("dashboard.mockActiveText");
    action = `<a class="btn lime" href="#/mock/exam?n=${mock.next}">${t("mock.resume")}</a>`;
  } else {
    title = t("dashboard.mockCardTitle", { questions: MOCK_SIZE, minutes: MOCK_MINUTES });
    text = t("dashboard.mockCardText");
    action = `<a class="btn lime" href="#/mock">${t("mock.start")}</a>`;
  }
  return `
          <section class="card m-cta" aria-labelledby="dash-mock-title">
            <p class="m-kicker">${t("mock.ctaKicker")}</p>
            <h2 id="dash-mock-title">${title}</h2>
            <p class="m-cta-text">${text}</p>
            ${action}
          </section>`;
}

// «Course review»: proyectos terminados y el que toca seguir (o empezar).
function projectsCard(info, lang) {
  let title;
  let text;
  let chips = "";
  let action;
  const cur = info.current;
  if (!info.total) {
    title = t("dashboard.projectsSoonTitle");
    text = t("dashboard.projectsSoonText");
    action = `<a class="btn primary" href="#/projects">${t("dashboard.projectsSee")}</a>`;
  } else if (!cur) {
    title = t("dashboard.projectsAllTitle");
    text = t("dashboard.projectsAllText");
    action = `<a class="btn primary" href="#/projects">${t("dashboard.projectsSee")}</a>`;
  } else {
    // {name} lleva HTML (el título en negrita): se sustituye después de t(), que escapa las variables.
    const name = `<strong>${escapeHtml(pick(cur.project.title, lang))}</strong>`;
    const p = cur.progress;
    title = t("dashboard.projectsTitle", { done: info.done, total: info.total });
    if (p.status === "progress") {
      text = t("dashboard.projectsContinue", { step: p.next, total: p.total }).replace("{name}", () => name);
      chips = `<div class="dash-chips">${PROJECT_LANGS.filter((l) => p.byLang[l].total).map((l) => {
        const { passed, total } = p.byLang[l];
        const label = l.toUpperCase();
        return `<span class="chip ${l}">${passed === total
          ? t("projects.chipLangDone", { lang: label })
          : t("dashboard.chipLang", { lang: label, passed, total })}</span>`;
      }).join("")}</div>`;
      action = `<a class="btn primary" href="#/projects/${cur.project.number}/step/${p.next}">${t("dashboard.projectsContinueButton")}</a>`;
    } else {
      text = t(info.done ? "dashboard.projectsNext" : "dashboard.projectsFirst", {}).replace("{name}", () => name);
      action = `<a class="btn primary" href="#/projects/${cur.project.number}/brief">${t("dashboard.projectsStartButton")}</a>`;
    }
  }
  return `
          <section class="card dash-projects" aria-labelledby="dash-projects-title">
            <p class="dash-kicker">${t("dashboard.projectsKicker")}</p>
            <h2 id="dash-projects-title">${title}</h2>
            <p class="dash-text">${text}</p>
            ${chips}
            ${action}
          </section>`;
}
