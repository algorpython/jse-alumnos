// Vista previa aislada de un proyecto y comprobaciones de «Must contain» que miran el DOM.
//
// Cómo se aísla (igual que «Run this code», js/engine/runner.js):
// - Un <iframe sandbox="allow-scripts allow-forms"> sin allow-same-origin: origen opaco, sin
//   acceso al progreso guardado (localStorage), a las cookies ni al DOM de la app. Su CSP solo
//   deja cargar imágenes y fuentes (no hay fetch ni XHR).
// - El documento lo compone composeDocument (js/engine/projects.js): index.html con el CSS y el JS
//   dentro, y los bucles protegidos contra los bucles infinitos.
// - Antes que nada se ejecuta el agente (agentMain): recoge la consola y los errores y los manda a
//   la app, define la protección de los bucles, evita que un enlace o un formulario saquen al
//   iframe de la página y, cuando la app se lo pide, evalúa las comprobaciones.
//
// agentMain y formatArgs se copian como texto (toString) dentro del iframe: no pueden usar nada de
// fuera de su propio cuerpo.

import { formatArgs } from "./console-format.js";
import { composeDocument, checkJsRegex } from "./projects.js";

export const PREVIEW_WIDTH = 1024;
export const PREVIEW_HEIGHT = 768;
export const LOOP_LIMIT = 1000; // ms que puede pasar un trozo de código en bucles
const READY_TIMEOUT = 5000;
const RUN_TIMEOUT = 8000;

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; img-src data: blob: https:; media-src data: blob: https:";

// Se ejecuta dentro del iframe, antes del código del alumno.
function agentMain(cfg) {
  const parentWin = window.parent;
  const post = (msg) => parentWin.postMessage(Object.assign({ jsePreview: true }, msg), "*");
  const log = [];
  const realConsole = {};

  // A la app solo se mandan las primeras 1000 líneas (y todos los errores): un bucle que escribe
  // en la consola durante 1 s mandaría cientos de miles de mensajes.
  let sent = 0;
  function record(kind, text, extra) {
    const line = Object.assign({ kind, text: String(text) }, extra || {});
    if (log.length < 1000) log.push(line);
    if (sent < 1000 || line.error) {
      sent++;
      post({ type: "console", line });
    }
  }

  // Línea del error dentro de script.js (o de index.html si viene de otro sitio).
  function where(docLine) {
    if (!Number.isInteger(docLine) || docLine < 1) return { file: null, line: null };
    if (docLine >= cfg.jsLine && docLine < cfg.jsLine + cfg.jsLines) return { file: "script.js", line: docLine - cfg.jsLine + 1 };
    return { file: "index.html", line: null };
  }

  ["log", "info", "warn", "error", "debug"].forEach((k) => {
    realConsole[k] = console[k];
    console[k] = function (...args) {
      let text;
      try { text = formatArgs(args); } catch (e) { text = args.map(String).join(" "); }
      record(k === "error" ? "error" : k === "warn" ? "warn" : "log", text);
    };
  });
  // El código del alumno no puede quitarle el foco a la app. Un element.focus() dentro del iframe
  // mueve el foco de toda la página al iframe; en las vistas previas ocultas de «Check step» y del
  // checklist (que se destruyen al terminar) el foco acababa en <body> y quien usa el teclado perdía
  // su sitio. Por eso focus() no hace nada:
  // - cfg.focus "never" (vistas previas ocultas): nunca;
  // - cfg.focus "user" (vista previa a la vista): hasta que el alumno usa la vista previa (clic o
  //   tecla dentro de ella). Así, al escribir en el editor, un focus() al cargar no se lleva el foco,
  //   y después la web funciona como la descargada (p. ej. el foco a la pregunta siguiente).
  if (cfg.focus !== "always") {
    const ua = navigator.userActivation;
    const allowed = () => cfg.focus === "user" && (!ua || ua.hasBeenActive);
    [window.HTMLElement, window.SVGElement, window.MathMLElement].forEach((C) => {
      const real = C && C.prototype.focus;
      if (typeof real !== "function") return;
      C.prototype.focus = function () { if (allowed()) return real.apply(this, arguments); };
    });
    const realWindowFocus = window.focus;
    window.focus = function () { if (allowed()) return realWindowFocus.apply(window, arguments); };
  }

  // Los diálogos no se abren (bloquearían la app): se escriben en la consola.
  window.alert = (msg) => { record("dialog", "alert: " + (msg === undefined ? "" : String(msg))); };
  window.confirm = (msg) => { record("dialog", "confirm: " + (msg === undefined ? "" : String(msg))); return false; };
  window.prompt = (msg) => { record("dialog", "prompt: " + (msg === undefined ? "" : String(msg))); return null; };

  function reportError(err, docLine) {
    const isErr = err && typeof err === "object" && typeof err.name === "string";
    const name = isErr ? err.name : null;
    const message = isErr ? String(err.message) : formatArgs([err]);
    let loc = where(docLine);
    if (isErr && name === "InfiniteLoop" && Number.isInteger(err.loopLine)) loc = { file: "script.js", line: err.loopLine };
    record("error", message, { error: { name, file: loc.file, line: loc.line } });
  }
  window.addEventListener("error", (e) => {
    if (e.target && e.target !== window) return; // fallo al cargar una imagen: no es un error de JS
    e.preventDefault();
    reportError(e.error !== undefined && e.error !== null ? e.error : e.message, e.lineno);
  });
  window.addEventListener("unhandledrejection", (e) => {
    e.preventDefault();
    reportError(e.reason, null);
  });

  // Protección contra bucles infinitos (ver guardLoops en js/engine/projects.js).
  let armed = false;
  let start = 0;
  let calls = 0;
  window[cfg.guard] = function (line) {
    if (armed && (++calls & 255) !== 0) return true;
    const now = performance.now();
    if (!armed) {
      armed = true;
      start = now;
      // El temporizador salta cuando termina el trozo de código que se está ejecutando.
      setTimeout(() => { armed = false; }, 0);
    } else if (now - start > cfg.loopLimit) {
      armed = false;
      const err = new Error("This loop seems to never end, so it was stopped.");
      err.name = "InfiniteLoop";
      err.loopLine = line;
      throw err;
    }
    return true;
  };

  // Un enlace o un formulario no pueden llevar al iframe a otra página.
  // Los enlaces «#id» tampoco se dejan seguir: el documento es un srcdoc y su URL base es la de la
  // app, así que el navegador resolvería «#menu» como «<URL de la app>#menu» y cargaría la app
  // dentro de la vista previa. Se hace a mano lo que haría la web descargada: ir a ese elemento
  // (o arriba del todo con «#» o «#top»). Solo se desplaza la vista previa, nunca la app; se
  // respeta `scroll-behavior` del alumno y sus propios listeners siguen ejecutándose.
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    const href = a.getAttribute("href").trim();
    e.preventDefault();
    if (!href.startsWith("#")) {
      record("info", "link: " + href);
      return;
    }
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch (err) { /* se usa tal cual */ }
    // Como el navegador: primero el id y, si no hay, un <a name="…"> (HTML antiguo).
    const target = id ? document.getElementById(id) || Array.from(document.getElementsByName(id)).find((el) => el.tagName === "A") : null;
    if (target) {
      const r = target.getBoundingClientRect();
      window.scrollTo(r.left + window.scrollX, r.top + window.scrollY);
    } else if (!id || id.toLowerCase() === "top") {
      window.scrollTo(0, 0);
    }
  }, true);
  window.addEventListener("submit", (e) => {
    if (!e.defaultPrevented) {
      e.preventDefault();
      record("info", "form submitted");
    }
  });

  // ---- Comprobaciones ----
  const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const norm = (v) => String(v).trim().replace(/\s+/g, " ").toLowerCase();
  const visible = (el) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0);

  function amount(check, found) {
    if (Number.isInteger(check.count)) return found === check.count;
    if (Number.isInteger(check.max) && found > check.max) return false;
    return found >= (Number.isInteger(check.min) ? check.min : 1);
  }

  function checkSelector(c) {
    let els = all(c.selector);
    if (typeof c.visible === "boolean") els = els.filter((el) => visible(el) === c.visible);
    if (c.text) {
      const re = new RegExp(c.text, "i");
      els = els.filter((el) => re.test(el.textContent.trim()));
    }
    const pass = amount(c, els.length);
    return { pass, reason: pass ? null : "count", found: els.length };
  }

  function valueOk(c, got) {
    if (typeof c.value === "string" && norm(got) !== norm(c.value)) return false;
    if (typeof c.not === "string" && norm(got) === norm(c.not)) return false;
    if (c.pattern && !new RegExp(c.pattern, "i").test(got)) return false;
    if (typeof c.min === "number" && !(parseFloat(got) >= c.min)) return false;
    if (typeof c.max === "number" && !(parseFloat(got) <= c.max)) return false;
    return true;
  }

  function checkAttr(c) {
    const els = all(c.selector);
    if (!els.length) return { pass: false, reason: "none", found: 0 };
    const ok = (el) => {
      if (!el.hasAttribute(c.attr)) return false;
      const got = el.getAttribute(c.attr);
      if (typeof c.value === "string") return got.trim() === c.value;
      if (c.pattern) return new RegExp(c.pattern).test(got);
      return got.trim() !== "";
    };
    const good = els.filter(ok).length;
    const pass = c.any ? good > 0 : good === els.length;
    return { pass, reason: pass ? null : "attr", found: els.length, good };
  }

  function rulesOf(list, media, out) {
    for (const rule of Array.from(list || [])) {
      if (rule.type === 1) out.push({ rule, media });
      else if (rule.cssRules) {
        const cond = rule.media ? rule.media.mediaText : rule.conditionText || "";
        out.push(...rulesOf(rule.cssRules, media ? media + " and " + cond : cond, []));
      }
    }
    return out;
  }

  function checkCss(c) {
    if (c.rule) {
      const re = new RegExp(c.rule);
      const mediaRe = c.media ? new RegExp(c.media) : null;
      let rules = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try { rules = rules.concat(rulesOf(sheet.cssRules, "", [])); } catch (e) { /* hoja externa */ }
      }
      const found = rules.filter(({ rule, media }) => {
        if (mediaRe ? !(media && mediaRe.test(media)) : false) return false;
        const sel = rule.selectorText.split(",").map((s) => s.trim().replace(/\s+/g, " "));
        if (!sel.some((s) => re.test(s))) return false;
        if (!c.prop) return rule.style.length > 0;
        const got = rule.style.getPropertyValue(c.prop);
        return got !== "" && valueOk(c, got);
      });
      return { pass: found.length > 0, reason: found.length ? null : "rule" };
    }
    const els = all(c.selector);
    if (!els.length) return { pass: false, reason: "none", found: 0 };
    const values = els.map((el) => getComputedStyle(el, c.pseudo || null).getPropertyValue(c.prop));
    const good = values.filter((v) => valueOk(c, v)).length;
    const pass = c.any ? good > 0 : good === els.length;
    return { pass, reason: pass ? null : "value", got: values.find((v) => !valueOk(c, v)) ?? values[0] };
  }

  function checkConsole(c, from) {
    const lines = log.slice(from).filter((l) => l.kind === "log" || l.kind === "dialog");
    const re = c.pattern ? new RegExp(c.pattern) : null;
    const pass = lines.some((l) => (typeof c.text === "string" ? l.text.trim() === c.text.trim() : re.test(l.text)));
    return { pass, reason: pass ? null : "console" };
  }

  async function checkBehavior(c) {
    const from = log.length;
    for (const a of c.actions) {
      if ("wait" in a) { await tick(a.wait); continue; }
      const sel = a.click || a.input;
      const el = all(sel)[a.index || 0];
      if (!el) return { pass: false, reason: "action", selector: sel };
      if (a.click) el.click();
      else {
        el.value = a.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await tick(0);
    }
    await tick(0);
    for (let i = 0; i < c.expect.length; i++) {
      const r = runOne(c.expect[i], from);
      if (!r.pass) return Object.assign({}, r, { pass: false, failed: i });
    }
    return { pass: true, reason: null };
  }

  function runOne(c, from) {
    if (c.kind === "selector") return checkSelector(c);
    if (c.kind === "attr") return checkAttr(c);
    if (c.kind === "css") return checkCss(c);
    if (c.kind === "console") return checkConsole(c, from || 0);
    return { pass: false, reason: "unknown" };
  }

  async function runCheck(c) {
    try {
      return c.kind === "behavior" ? await checkBehavior(c) : runOne(c, 0);
    } catch (err) {
      return { pass: false, reason: "error", message: String(err && err.message ? err.message : err) };
    }
  }

  // ---- Esperar a que haya maquetación ----
  // La vista previa (iframe sandbox, origen opaco) va en un proceso aparte del de la app. Cuando
  // llega «load», ese proceso a veces todavía no ha recibido el tamaño del iframe ni ha hecho su
  // primera maquetación: innerWidth vale 0, getComputedStyle(...).width da «auto» y
  // checkVisibility() da false aunque se fuerce la maquetación (el navegador no la hace hasta el
  // primer fotograma). Por eso, antes de decir «lista» y antes de comprobar nada, se espera a que
  // el documento tenga caja de verdad. Se mira en cada fotograma (o cada 50 ms si no llegan
  // fotogramas) y como mucho LAYOUT_WAIT ms: si el alumno oculta todo el <html>, no se espera más.
  const LAYOUT_WAIT = 3000;
  const laidOut = () => window.innerWidth > 0 && getComputedStyle(document.documentElement).width !== "auto";
  function whenLaidOut() {
    if (laidOut()) return Promise.resolve(true);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        let done = false;
        const next = () => {
          if (done) return;
          done = true;
          if (laidOut()) resolve(true);
          else if (performance.now() - t0 > LAYOUT_WAIT) resolve(false);
          else step();
        };
        requestAnimationFrame(next);
        setTimeout(next, 50);
      };
      step();
    });
  }

  window.addEventListener("message", async (e) => {
    if (e.source !== parentWin) return;
    const d = e.data || {};
    if (d.jsePreview !== true || d.type !== "run") return;
    await whenLaidOut();
    const results = [];
    for (const c of d.checks || []) results.push(await runCheck(c));
    post({ type: "results", id: d.id, results });
  });

  // Lista cuando la página ha cargado, han corrido los temporizadores de 0 ms del alumno y ya hay
  // maquetación.
  window.addEventListener("load", () => setTimeout(() => whenLaidOut().then(() => post({ type: "ready" })), 0));
}

// Documento completo de la vista previa: { html, jsLine }.
// `focus`: si el código del alumno puede mover el foco con focus() (ver agentMain): "user" (al
// usarla el alumno; vista previa a la vista), "never" (vistas previas ocultas) o "always" (una
// pestaña aparte, sin la app al lado).
export function previewDocument(files, { loopLimit = LOOP_LIMIT, focus = "user" } = {}) {
  // Primero se compone sin agente para saber en qué línea empieza script.js; el agente ocupa una
  // sola línea (los saltos de línea de su código se convierten en espacios), así que después basta
  // con sumar las líneas que añade la cabecera.
  const jsLines = String(files?.js ?? "").split("\n").length;
  const agent = (cfgLine) => {
    const cfg = { jsLine: cfgLine, jsLines, guard: "__jseLoop", loopLimit, focus };
    // Dentro de una función: así sus nombres no chocan con los del alumno (un `const` global aquí
    // daría un SyntaxError si script.js declarase otra variable con el mismo nombre).
    const src = `(function () {\nconst formatArgs = ${formatArgs.toString()};\n(${agentMain.toString()})(${JSON.stringify(cfg)});\n})();`;
    return `<meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${src.replace(/<\/(script)/gi, "<\\/$1")}</script>`;
  };
  // El agente tiene saltos de línea: se calcula con un primer intento y se corrige con la diferencia.
  const first = composeDocument(files, { head: agent(0) });
  const second = composeDocument(files, { head: agent(first.jsLine) });
  return second;
}

// Crea la vista previa dentro de `container`.
// Opciones: width/height (px), hidden (invisible, para las comprobaciones), title
// (texto accesible del iframe) y onConsole(line) (cada línea de consola o error:
// { kind: "log"|"warn"|"error"|"dialog"|"info", text, error?: { name, file, line } }).
// Devuelve { frame, ready, run(checks), destroy() }. `ready` se resuelve cuando la página ha cargado
// y ya tiene maquetación (o a los 5 s, con false). run(checks) evalúa comprobaciones de DOM y devuelve sus resultados.
export function mountPreview(container, files, { width = PREVIEW_WIDTH, height = PREVIEW_HEIGHT, hidden = false, title = "Preview", onConsole = null } = {}) {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-forms");
  frame.setAttribute("title", title);
  frame.className = "preview-frame";
  if (hidden) {
    // Dentro de la pantalla, pero transparente, detrás de todo y sin recibir clics. No se saca
    // fuera de la pantalla: el navegador frena los iframes de otro origen que no se ven (sin
    // fotogramas y con los temporizadores a 1 por segundo), y entonces la primera maquetación y
    // los «wait» de las comprobaciones tardarían mucho más.
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;` +
      "opacity:0;pointer-events:none;z-index:-1;";
  }
  const lines = [];
  const pendingRuns = new Map();
  let nextId = 0;
  let readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  const readyTimer = setTimeout(() => readyResolve(false), READY_TIMEOUT);

  function onMessage(event) {
    if (event.source !== frame.contentWindow) return;
    const msg = event.data || {};
    if (msg.jsePreview !== true) return;
    if (msg.type === "ready") {
      clearTimeout(readyTimer);
      readyResolve(true);
    } else if (msg.type === "console" && msg.line) {
      const line = { kind: String(msg.line.kind), text: String(msg.line.text) };
      if (msg.line.error) line.error = msg.line.error;
      lines.push(line);
      if (onConsole) onConsole(line);
    } else if (msg.type === "results" && pendingRuns.has(msg.id)) {
      pendingRuns.get(msg.id)(msg.results);
      pendingRuns.delete(msg.id);
    }
  }
  window.addEventListener("message", onMessage);

  const { html } = previewDocument(files, { focus: hidden ? "never" : "user" });
  frame.srcdoc = html;
  container.appendChild(frame);

  return {
    frame,
    ready,
    lines,
    run(checks) {
      const id = ++nextId;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRuns.delete(id);
          resolve(checks.map(() => ({ pass: false, reason: "timeout" })));
        }, RUN_TIMEOUT);
        pendingRuns.set(id, (results) => {
          clearTimeout(timer);
          resolve(checks.map((c, i) => (results && results[i]) || { pass: false, reason: "timeout" }));
        });
        frame.contentWindow?.postMessage({ jsePreview: true, type: "run", id, checks: JSON.parse(JSON.stringify(checks)) }, "*");
      });
    },
    destroy() {
      clearTimeout(readyTimer);
      window.removeEventListener("message", onMessage);
      for (const resolve of pendingRuns.values()) resolve([]);
      pendingRuns.clear();
      frame.remove();
    },
  };
}

// Evalúa una lista de comprobaciones sobre los archivos `files` ({ html, css, js }).
// Devuelve una lista de resultados en el mismo orden: { pass, reason, … }.
// - js-regex se evalúa aquí mismo, sin navegador.
// - Las de DOM se agrupan por ancho de ventana (`width`) en una misma vista previa recién cargada;
//   cada behavior va en su propia vista previa, para que sus clics no afecten a las demás.
export async function evaluateChecks(files, checks, { container = document.body } = {}) {
  const results = new Array(checks.length);
  // Por si algo se lleva el foco a una vista previa oculta (el agente ya anula focus()), al terminar
  // se devuelve a donde estaba si se ha quedado en <body>.
  const focused = document.activeElement;
  const keepFocus = () => {
    const now = document.activeElement;
    if (focused && focused !== now && focused.isConnected && (!now || now === document.body)) focused.focus({ preventScroll: true });
  };
  const groups = new Map();
  checks.forEach((check, i) => {
    if (check.kind === "js-regex") {
      results[i] = checkJsRegex(check, files);
      return;
    }
    const key = check.kind === "behavior" ? `behavior-${i}` : `w${check.width || PREVIEW_WIDTH}`;
    if (!groups.has(key)) groups.set(key, { width: check.width || PREVIEW_WIDTH, items: [] });
    groups.get(key).items.push(i);
  });
  for (const { width, items } of groups.values()) {
    const preview = mountPreview(container, files, { width, hidden: true });
    try {
      const loaded = await preview.ready;
      const out = loaded
        ? await preview.run(items.map((i) => checks[i]))
        : items.map(() => ({ pass: false, reason: "timeout" }));
      items.forEach((i, k) => { results[i] = out[k]; });
    } finally {
      preview.destroy();
      keepFocus();
    }
  }
  return results;
}
