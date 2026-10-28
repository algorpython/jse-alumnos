// Punto de entrada de la app: crea el store del progreso, carga los textos (i18n), define las
// rutas y pinta cada pantalla.

import { renderShell, renderBare, pageHeader, bindLangSwitch, setLangHandler } from "./views/shell.js";
import { renderStyleguide } from "./views/styleguide.js";
import { renderProgress } from "./views/progress.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderTopics, renderSection } from "./views/practice.js";
import { renderMistakes, renderReview } from "./views/mistakes.js";
import { renderExerciseTopics, renderExerciseSection } from "./views/exercises.js";
import { renderMockHome, renderMockExam } from "./views/mock.js";
import { renderMockResult } from "./views/mock-results.js";
import { renderTheory } from "./views/theory.js";
import { renderTricky } from "./views/tricky.js";
import { renderProjects, renderBrief } from "./views/projects.js";
import { renderStep } from "./views/project-step.js";
import { renderResult } from "./views/project-result.js";
import { startRouter } from "./router.js";
import { createStore, memoryStorage, STORAGE_KEY } from "./store.js";
import { setClock, fixedDay, now } from "./clock.js";
import { createI18n, loadDicts, setActiveI18n, t, LANGS } from "./i18n.js";
import { loadGlossary, loadSections } from "./data.js";
import { setGlossary } from "./engine/glossary.js";
import { installGlossaryTips } from "./views/glossary-tips.js";

const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");
const root = document.getElementById("app");

// Lo que se necesita casi siempre se pide ya, a la vez que el resto del arranque (8.2): el glosario
// y, salvo en los proyectos, las secciones. Los errores se tratan donde se usan (aquí solo se
// evita el aviso de promesa sin tratar).
const glossaryLoad = loadGlossary();
glossaryLoad.catch(() => {});
if (!location.hash.startsWith("#/projects")) loadSections().catch(() => {});

// Solo con ?debug (para smoke.ps1 y screens.ps1):
// - `today=AAAA-MM-DD` fija el día del reloj de la app (repaso espaciado);
// - `progress=tests/fixtures/<carpeta>/<archivo>.json` carga un progreso exportado en memoria,
//   sin tocar el guardado del navegador.
if (DEBUG && fixedDay(params.get("today"))) setClock(fixedDay(params.get("today")));
export const store = await createAppStore();

async function createAppStore() {
  const file = params.get("progress") || "";
  if (!DEBUG || !/^tests\/fixtures\/[\w-]+\/[\w-]+\.json$/.test(file)) return createStore({ now });
  const debugStore = createStore({ storage: memoryStorage(), now });
  const res = await fetch(file);
  const result = debugStore.importJSON(res.ok ? await res.text() : "");
  if (!result.ok) reportError(new Error(`Couldn't load the debug progress ${file} (${result.error})`));
  return debugStore;
}

// Textos de la interfaz. El idioma es el guardado en el progreso; `?lang=es` en la URL lo
// cambia solo para esa visita (lo usan las capturas en español) sin tocar el guardado.
let dicts;
try {
  dicts = await loadDicts();
} catch (err) {
  root.innerHTML = `<p class="note purple" role="alert" style="margin: 24px">JSE Practice couldn't start. Check your connection and reload the page.<br><span lang="es">JSE Practice no se ha podido abrir. Comprueba tu conexión y recarga la página.</span></p>`;
  throw err;
}
const urlLang = LANGS.includes(params.get("lang")) ? params.get("lang") : null;
const i18n = createI18n({
  dicts,
  lang: urlLang || store.get().settings.lang,
  // En ?debug, un texto sin traducir es un error (smoke.ps1 lo detecta en #__errors).
  onMissing(key, lang) {
    if (DEBUG) reportError(new Error(`Missing UI text "${key}" in ${lang}.json`));
  },
});
setActiveI18n(i18n);
document.documentElement.lang = i18n.lang;

// Glosario EN↔ES: los términos se marcan en las preguntas y explicaciones con un tooltip.
// Si no se puede cargar, la app sigue funcionando sin marcar nada.
try {
  setGlossary(await glossaryLoad);
} catch (err) {
  if (DEBUG) reportError(err);
}
installGlossaryTips();

// nav: id del enlace de la barra lateral que se marca como actual.
// title: clave del título en data/ui (se traduce al pintar, así cambia con el idioma).
// bare: pantalla completa, sin barra lateral (el simulacro en curso).
const ROUTES = [
  { path: "/", nav: "dashboard", title: "titles.dashboard", render: (main) => renderDashboard(main, store), own: true },
  { path: "/practice", nav: "practice", title: "titles.practice", render: (main) => renderTopics(main, store), own: true },
  { path: "/practice/:section", nav: "practice", title: "titles.practice", render: (main, params, query) => renderSection(main, store, params, query), own: true },
  { path: "/theory/:section", nav: "practice", title: "titles.theory", render: (main, params, query) => renderTheory(main, store, params, query), own: true },
  { path: "/tricky", nav: "practice", title: "titles.tricky", render: (main, params, query) => renderTricky(main, store, params, query), own: true },
  { path: "/tricky/:section", nav: "practice", title: "titles.tricky", render: (main, params, query) => renderTricky(main, store, params, query), own: true },
  { path: "/exercises", nav: "exercises", title: "titles.exercises", render: (main) => renderExerciseTopics(main, store), own: true },
  { path: "/exercises/:section", nav: "exercises", title: "titles.exercises", render: (main, params, query) => renderExerciseSection(main, store, params, query), own: true },
  { path: "/mock", nav: "mock", title: "titles.mock", render: (main, params, query) => renderMockHome(main, store, query), own: true },
  { path: "/mock/exam", nav: "mock", title: "titles.mock", bare: true, render: (main, params, query) => renderMockExam(main, store, query), own: true },
  { path: "/mock/result/:number", nav: "mock", title: "titles.mock", render: (main, params, query) => renderMockResult(main, store, params, query), own: true },
  { path: "/mistakes", nav: "mistakes", title: "titles.mistakes", render: (main) => renderMistakes(main, store), own: true },
  { path: "/mistakes/review", nav: "mistakes", title: "titles.mistakes", render: (main, params, query) => renderReview(main, store, query), own: true },
  { path: "/progress", nav: "progress", title: "titles.progress", render: (main) => renderProgress(main, store), own: true },
  { path: "/projects", nav: "projects", title: "titles.projects", render: (main, params, query) => renderProjects(main, store, query), own: true },
  { path: "/projects/:n", nav: "projects", title: "titles.projectBrief", bare: true, render: (main, params) => renderBrief(main, store, params), own: true },
  { path: "/projects/:n/brief", nav: "projects", title: "titles.projectBrief", bare: true, render: (main, params) => renderBrief(main, store, params), own: true },
  { path: "/projects/:n/step/:m", nav: "projects", title: "titles.projectStep", bare: true, render: (main, params, query) => renderStep(main, store, params, query), own: true },
  { path: "/projects/:n/result", nav: "projects", title: "titles.projectResult", bare: true, render: (main, params, query) => renderResult(main, store, params, query), own: true },
];
if (DEBUG) {
  // Página interna para revisar componentes: su contenido de muestra no se traduce.
  ROUTES.push({
    path: "/styleguide", nav: null, title: null, own: true,
    render(main) { renderStyleguide(main); bindLangSwitch(main); },
  });
}

const NOT_FOUND = {
  nav: null,
  title: "titles.notFound",
  render(main) {
    main.insertAdjacentHTML("beforeend", `
      <section class="card placeholder">
        <p>${t("notFound.text")}</p>
      </section>`);
  },
};

// Sin mover el foco ni el scroll: carga inicial, repintados por cambios en otra pestaña y
// cambios de idioma.
let quiet = true;

const router = startRouter({
  routes: ROUTES,
  notFound: NOT_FOUND,
  onRoute({ route, params, query }) {
    const main = route.bare ? renderBare(root) : renderShell(root, route.nav);
    const title = route.title ? t(route.title) : "Styleguide";
    // Las pantallas «own» pintan su propia cabecera; el resto usa la cabecera común.
    if (!route.own) main.innerHTML = pageHeader({ title });
    route.render(main, params, query);
    if (!route.own) bindLangSwitch(main);
    document.title = `${title} · ${t("app.name")}`;
    // Al navegar se lleva el foco al contenido (para el lector de pantalla) y se sube arriba.
    if (!quiet) {
      main.focus();
      window.scrollTo(0, 0);
    }
    quiet = false;
  },
});

// Botón EN/ES: cambia el idioma sin recargar, lo guarda en el progreso y vuelve a pintar la
// pantalla actual. El foco vuelve al botón del idioma elegido (no se pierde al repintar).
setLangHandler((lang) => {
  if (!i18n.setLang(lang)) return;
  store.update((s) => { s.settings.lang = lang; });
  // Algunas pantallas (p. ej., «Practice by topic») se pintan tras cargar sus datos: se espera
  // a que terminen (los datos ya están en caché) antes de devolver el foco.
  setTimeout(() => root.querySelector(`.lang button[data-lang="${lang}"]`)?.focus(), 0);
});
i18n.subscribe((lang) => {
  document.documentElement.lang = lang;
  quiet = true;
  router.refresh();
});

// Si otra pestaña cambia el progreso (p. ej., lo reinicia, importa uno o cambia el idioma),
// se vuelve a leer y se repinta la pantalla actual, para no sobrescribir esos cambios.
window.addEventListener("storage", (e) => {
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  store.reload();
  quiet = true;
  if (!i18n.setLang(store.get().settings.lang)) router.refresh();
});
