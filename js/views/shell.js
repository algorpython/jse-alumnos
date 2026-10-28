// Estructura común de la app: barra lateral (bloques «Exam prep · JSE-40-01» y «Course review»)
// y cabecera de cada página con el título y el interruptor EN/ES.
// Los textos salen de data/ui/*.json a través de t() (js/i18n.js).

import { t, getLang, LANGS } from "../i18n.js";

// key: clave del texto en data/ui (nav.<key>).
export const NAV = [
  {
    group: "nav.groupExam",
    items: [
      { id: "dashboard", href: "#/", key: "nav.dashboard" },
      { id: "practice", href: "#/practice", key: "nav.practice" },
      { id: "exercises", href: "#/exercises", key: "nav.exercises" },
      { id: "mock", href: "#/mock", key: "nav.mock" },
      { id: "mistakes", href: "#/mistakes", key: "nav.mistakes" },
      { id: "progress", href: "#/progress", key: "nav.progress" },
    ],
  },
  {
    group: "nav.groupCourse",
    items: [{ id: "projects", href: "#/projects", key: "nav.projects" }],
  },
];

// Pinta la barra lateral y un <main> vacío dentro de `root`. Devuelve el <main>.
export function renderShell(root, activeId) {
  const groups = NAV.map((g, i) => `
      <p class="group" id="nav-group-${i}">${t(g.group)}</p>
      <ul aria-labelledby="nav-group-${i}">
        ${g.items.map((it) => `<li><a href="${it.href}"${it.id === activeId ? ' aria-current="page"' : ""}>${t(it.key)}</a></li>`).join("")}
      </ul>`).join("");

  root.innerHTML = `
    <a class="skip-link" href="#main">${t("skipLink")}</a>
    <div class="app">
      <nav class="side" aria-label="${t("nav.label")}">
        <div class="brand"><div class="logo" aria-hidden="true">&lt;/&gt;</div><div><b>JSE Practice</b><small>Algorithmics</small></div></div>
        ${groups}
      </nav>
      <main class="main" id="main" tabindex="-1"></main>
    </div>`;

  // El enlace «Skip to content» no puede usar el hash (es el router): mueve el foco a mano.
  root.querySelector(".skip-link").addEventListener("click", (e) => {
    e.preventDefault();
    root.querySelector("#main").focus();
  });
  return root.querySelector("#main");
}

// Pantalla sin barra lateral (el simulacro ocupa toda la ventana, como en la maqueta 04).
// Devuelve el <main>, que la pantalla rellena con su propia cabecera.
export function renderBare(root) {
  root.innerHTML = `
    <a class="skip-link" href="#main">${t("skipLink")}</a>
    <main class="main bare" id="main" tabindex="-1"></main>`;
  root.querySelector(".skip-link").addEventListener("click", (e) => {
    e.preventDefault();
    root.querySelector("#main").focus();
  });
  return root.querySelector("#main");
}

// Cabecera de página: subtítulo opcional, título y el interruptor EN/ES.
export function pageHeader({ title, kicker = "", sub = "" }) {
  return `
    <header class="top">
      <div>
        ${kicker ? `<p class="small">${kicker}</p>` : ""}
        <h1>${title}</h1>
        ${sub ? `<p class="sub">${sub}</p>` : ""}
      </div>
      ${langSwitch()}
    </header>`;
}

// Interruptor EN/ES: marca el idioma actual. Cada botón lleva el `lang` de su idioma.
export function langSwitch(current = getLang()) {
  return `
    <div class="lang" role="group" aria-label="${t("lang.label")}">
      ${LANGS.map((l) => `<button type="button" data-lang="${l}" lang="${l}" aria-pressed="${current === l}">${l.toUpperCase()}</button>`).join("\n      ")}
    </div>`;
}

// Qué hacer al pulsar un idioma. app.js lo fija con setLangHandler: cambia el idioma, lo
// guarda y vuelve a pintar la pantalla.
let onChange = () => {};
export function setLangHandler(fn) {
  onChange = fn;
}

// Activa los interruptores EN/ES que haya dentro de `root`.
export function bindLangSwitch(root) {
  root.querySelectorAll(".lang").forEach((box) => {
    box.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-lang]");
      if (!btn || btn.getAttribute("aria-pressed") === "true") return;
      onChange(btn.dataset.lang);
    });
  });
}

// Desplazamiento animado solo si el alumno no ha pedido menos movimiento (prefers-reduced-motion).
export function scrollMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
