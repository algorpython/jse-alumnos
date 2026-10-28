// Proyectos guiados (Course review): lógica sin DOM.
// - FILES / LANGS: los tres archivos de cada proyecto (index.html, style.css y script.js).
// - scanJs / stripComments: separa el código de los comentarios y los textos, para buscar con
//   expresiones regulares sin confundirse con un comentario o con lo que va dentro de un string.
// - guardLoops: protege los bucles del alumno contra los bucles infinitos (ver más abajo).
// - composeDocument: une los tres archivos en un solo documento para la vista previa aislada.
// - checkJsRegex / validateCheck / stepCounts: comprobaciones de «Must contain» que no necesitan
//   el navegador y validación de su formato (la usa también tools/check-content.mjs).
// - projectProgress / catalogCounts: estado de cada proyecto para el catálogo y el enunciado.
// - stepAt / projectFiles / saveProjectFiles / recordStepCheck: la pantalla de pasos (qué paso es,
//   los archivos del alumno y los pasos superados en state.projects.pN).
// - checklistChecks / checklistItems / recordChecklist / editorStep: «View my website» (el checklist
//   final, que marca el proyecto como terminado con `done`).
// Las comprobaciones que miran el DOM (selector, attr, css, console, behavior) se hacen dentro
// de la vista previa: ver js/engine/preview.js.

export const LANGS = ["html", "css", "js"];
export const FILES = { html: "index.html", css: "style.css", js: "script.js" };
export const LEVELS = ["beginner", "intermediate", "advanced"];
export const CHECK_KINDS = ["selector", "attr", "css", "js-regex", "console", "behavior"];
// Comprobaciones que puede llevar `expect` dentro de un `behavior`.
export const EXPECT_KINDS = ["selector", "attr", "css", "console"];
// Nombre de la función que vigila los bucles (la define la vista previa antes del código del alumno).
export const LOOP_GUARD = "__jseLoop";

// ---------------------------------------------------------------------------
// Escáner de JavaScript
// ---------------------------------------------------------------------------

const KEYWORDS_BEFORE_REGEX = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

// ¿Una «/» en la posición `i` empieza una expresión regular (y no es una división)?
function regexAllowed(code, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  if (j < 0) return true;
  const c = code[j];
  if (/[\w$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[\w$]/.test(code[k])) k--;
    return KEYWORDS_BEFORE_REGEX.has(code.slice(k + 1, j + 1));
  }
  return !(c === ")" || c === "]" || c === "}");
}

// Divide el código en tramos { type, start, end }: "code", "comment", "string" (también las
// plantillas `…${}…`) y "regex". Es aproximado (no es un analizador completo de JavaScript),
// pero acierta con el código de un principiante y nunca lanza errores.
export function scanJs(code) {
  const src = String(code ?? "");
  const n = src.length;
  const segments = [];
  let codeStart = 0;
  const push = (type, start, end) => {
    if (start > codeStart) segments.push({ type: "code", start: codeStart, end: start });
    segments.push({ type, start, end });
    codeStart = end;
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let end = src.indexOf("\n", i);
      if (end < 0) end = n;
      push("comment", i, end);
      i = end;
    } else if (c === "/" && d === "*") {
      let end = src.indexOf("*/", i + 2);
      end = end < 0 ? n : end + 2;
      push("comment", i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      const end = Math.min(j + 1, n);
      push("string", i, end);
      i = end;
    } else if (c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== "`") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "$" && src[j + 1] === "{") {
          // Expresión dentro de la plantilla: se salta hasta su llave de cierre.
          let depth = 1;
          j += 2;
          while (j < n && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          continue;
        }
        j++;
      }
      const end = Math.min(j + 1, n);
      push("string", i, end);
      i = end;
    } else if (c === "/" && regexAllowed(src, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        const ch = src[j];
        if (ch === "\\") { j += 2; continue; }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        j++;
      }
      if (j >= n || src[j] !== "/") {
        i++; // No era una expresión regular completa: se trata como código.
        continue;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      push("regex", i, j);
      i = j;
    } else {
      i++;
    }
  }
  if (codeStart < n) segments.push({ type: "code", start: codeStart, end: n });
  return segments;
}

// Copia del código con los tramos de los tipos indicados tapados: cada carácter pasa a ser un
// espacio, salvo los saltos de línea, así que las posiciones y los números de línea no cambian.
function maskSegments(code, segments, types) {
  let out = "";
  for (const s of segments) {
    const text = code.slice(s.start, s.end);
    out += types.includes(s.type) ? text.replace(/[^\n]/g, " ") : text;
  }
  return out;
}

// Quita los comentarios de un archivo (los sustituye por espacios, así que las líneas no cambian).
export function stripComments(source, lang) {
  const src = String(source ?? "");
  const blank = (m) => m.replace(/[^\n]/g, " ");
  if (lang === "html") return src.replace(/<!--[\s\S]*?(-->|$)/g, blank);
  if (lang === "css") return src.replace(/\/\*[\s\S]*?(\*\/|$)/g, blank);
  return maskSegments(src, scanJs(src), ["comment"]);
}

// ---------------------------------------------------------------------------
// Protección contra bucles infinitos
// ---------------------------------------------------------------------------
// La vista previa ejecuta el script del alumno en un iframe, y un `while (true) {}` colgaría la
// página entera. Antes de ejecutarlo, cada condición de `while`, `do…while` y `for (;;)` pasa a
// ser `__jseLoop(línea) && (condición)`. __jseLoop (js/engine/preview.js) lanza un error
// «InfiniteLoop» si el mismo trozo de código lleva más de un segundo en bucles. Los `for…of` y
// `for…in` no se tocan (recorren algo que tiene fin). Solo se insertan textos dentro de la misma
// línea, así que los números de línea de los errores siguen siendo los del alumno.

function matchingParen(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

// Posiciones de los «;» que no están dentro de otros paréntesis, corchetes o llaves.
function topLevelSemicolons(masked, from, to) {
  const out = [];
  let depth = 0;
  for (let i = from; i < to; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) out.push(i);
  }
  return out;
}

export function guardLoops(code, guard = LOOP_GUARD) {
  const src = String(code ?? "");
  const masked = maskSegments(src, scanJs(src), ["comment", "string", "regex"]);
  const inserts = [];
  const re = /\b(for|while)\s*\(/g;
  let m;
  while ((m = re.exec(masked))) {
    if (m.index > 0 && /[\w$.]/.test(masked[m.index - 1])) continue;
    const open = m.index + m[0].length - 1;
    const close = matchingParen(masked, open);
    if (close < 0) continue;
    const line = masked.slice(0, m.index).split("\n").length;
    const call = `${guard}(${line})`;
    if (m[1] === "while") {
      inserts.push({ pos: open + 1, text: `${call} && (` }, { pos: close, text: ")" });
      continue;
    }
    const semis = topLevelSemicolons(masked, open + 1, close);
    if (semis.length !== 2) continue; // for…of, for…in o código incompleto
    const [a, b] = semis;
    if (masked.slice(a + 1, b).trim() === "") inserts.push({ pos: a + 1, text: ` ${call}` });
    else inserts.push({ pos: a + 1, text: ` ${call} && (` }, { pos: b, text: ")" });
  }
  // Se insertan de atrás hacia delante para que las posiciones sigan siendo válidas.
  inserts.sort((x, y) => y.pos - x.pos);
  let out = src;
  for (const ins of inserts) out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
  return out;
}

// ---------------------------------------------------------------------------
// Documento de la vista previa
// ---------------------------------------------------------------------------

const LINK_CSS = /<link\b[^>]*\bhref\s*=\s*["']?(?:\.\/)?style\.css(?:[?#][^"'\s>]*)?["']?[^>]*>/gi;
const SCRIPT_JS = /<script\b[^>]*\bsrc\s*=\s*["']?(?:\.\/)?script\.js(?:[?#][^"'\s>]*)?["']?[^>]*>\s*<\/script\s*>/gi;
const SCRIPT_MARK = "\u0000JSE_SCRIPT\u0000";

// ¿El index.html enlaza style.css y script.js (como tiene que estar para que el .zip funcione)?
export function linkedFiles(html) {
  const src = stripComments(html, "html");
  return {
    css: new RegExp(LINK_CSS.source, "i").test(src),
    js: new RegExp(SCRIPT_JS.source, "i").test(src),
  };
}

// Une index.html, style.css y script.js en un solo documento:
// - el <link href="style.css"> se sustituye por un <style> con el CSS, y el
//   <script src="script.js"></script> por un <script> con el JS, en el mismo sitio (así un script
//   en <head> sin `defer` se comporta igual que en una web de verdad). Con `defer` o `async`, el
//   script pasa al final de <body> (se ejecuta cuando la página ya está construida, como `defer`);
//   con type="module" se mantiene como módulo;
// - los enlaces que están dentro de un comentario <!-- --> no cuentan, como en el navegador;
// - si index.html no los enlaza, el CSS va al final de <head> y el JS al final de <body>
//   (así la vista previa funciona desde el primer paso);
// - `head` (opcional) se pone al principio de <head>: la CSP y el agente de la vista previa;
// - `guard`: protege los bucles (guardLoops).
// Devuelve { html, jsLine }: jsLine es la línea del documento en la que empieza script.js
// (para traducir los números de línea de los errores).
export function composeDocument(files, { head = "", guard = true } = {}) {
  let html = String(files?.html ?? "");
  const css = String(files?.css ?? "");
  const js = guard ? guardLoops(files?.js ?? "") : String(files?.js ?? "");
  // Un «</style» o «</script» dentro del código cerraría la etiqueta antes de tiempo.
  const styleTag = `<style>\n${css.replace(/<\/(style)/gi, "<\\/$1")}\n</style>`;
  const scriptBody = js.replace(/<\/(script)/gi, "<\\/$1");

  const masked = stripComments(html, "html");
  const links = matchesIn(LINK_CSS, masked);
  const scripts = matchesIn(SCRIPT_JS, masked);
  const edits = links.map((m, i) => ({ ...m, text: i === 0 ? styleTag : "" }));
  let moveToEnd = !scripts.length;
  let isModule = false;
  scripts.forEach((m, i) => {
    if (i === 0) {
      const open = /<script\b[^>]*>/i.exec(html.slice(m.start, m.end))[0];
      isModule = /\btype\s*=\s*["']?module\b/i.test(open);
      moveToEnd = !isModule && /\s(defer|async)\b/i.test(open);
    }
    edits.push({ ...m, text: i === 0 && !moveToEnd ? SCRIPT_MARK : "" });
  });
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) html = html.slice(0, e.start) + e.text + html.slice(e.end);

  if (!links.length) html = insertBefore(html, /<\/head\s*>/i, styleTag, /<body\b[^>]*>/i);
  if (moveToEnd) html = insertBefore(html, /<\/body\s*>/i, SCRIPT_MARK, /<\/html\s*>/i, true);

  if (head) html = insertHead(html, head);

  const at = html.indexOf(SCRIPT_MARK);
  const jsLine = html.slice(0, at).split("\n").length + 1;
  const openTag = isModule ? '<script type="module">' : "<script>";
  html = html.slice(0, at) + `${openTag}\n${scriptBody}\n</script>` + html.slice(at + SCRIPT_MARK.length);
  return { html, jsLine };
}

// Coincidencias de `re` (con la bandera g) en `text`: [{ start, end }].
function matchesIn(re, text) {
  const out = [];
  const global = new RegExp(re.source, "gi");
  let m;
  while ((m = global.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

// Inserta `text` antes de `re`; si no está, después de `fallback` (o antes, con `beforeFallback`);
// si tampoco, al final. No cuenta lo que está dentro de un comentario <!-- -->.
function insertBefore(html, re, text, fallback, beforeFallback = false) {
  const masked = stripComments(html, "html");
  let m = re.exec(masked);
  if (m) return html.slice(0, m.index) + text + html.slice(m.index);
  m = fallback.exec(masked);
  if (m && !beforeFallback) return html.slice(0, m.index + m[0].length) + text + html.slice(m.index + m[0].length);
  if (m) return html.slice(0, m.index) + text + html.slice(m.index);
  return html + text;
}

// Inserta `text` al principio de <head> (o tras <html>, o tras el doctype, o al principio).
// Nunca antes del doctype: la página pasaría a «modo quirks».
function insertHead(html, text) {
  const masked = stripComments(html, "html");
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(masked);
    if (m) return html.slice(0, m.index + m[0].length) + text + html.slice(m.index + m[0].length);
  }
  return text + html;
}

// ---------------------------------------------------------------------------
// Comprobaciones sin navegador
// ---------------------------------------------------------------------------

// js-regex: busca `pattern` en el archivo (script.js por defecto) sin contar los comentarios.
// Con `count` hace falta exactamente ese número de coincidencias; con `min`, al menos esas (1 por
// defecto). Devuelve { pass, reason, found }.
export function checkJsRegex(check, files) {
  const lang = check.file || "js";
  const source = stripComments(files?.[lang] ?? "", lang);
  let re;
  try {
    re = new RegExp(check.pattern, ((check.flags || "").replace(/g/g, "")) + "g");
  } catch (err) {
    return { pass: false, reason: "invalid", message: err.message };
  }
  const found = (source.match(re) || []).length;
  const pass = Number.isInteger(check.count) ? found === check.count : found >= (check.min ?? 1);
  return { pass, reason: pass ? null : "count", found };
}

// Pasos por lenguaje: { html: 3, css: 4, js: 2 } (para «HTML · 3 steps» y las fases).
export function stepCounts(project) {
  const counts = { html: 0, css: 0, js: 0 };
  for (const s of project?.steps || []) if (s.lang in counts) counts[s.lang]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Estado del alumno en un proyecto (catálogo, «Project brief» y pasos)
// ---------------------------------------------------------------------------

// Estados del catálogo, en el orden de sus filtros: sin empezar, en curso y terminado.
export const PROJECT_STATUSES = ["progress", "done", "new"];

// Resumen del progreso en un proyecto a partir de su apartado del progreso (`state.projects.pN`):
// `{ passed: ["html-1", …], done }`. `passed`: pasos superados («Check step», 5.1c); `done`: el
// checklist final de «View my website» está superado (5.1d). Los ids que ya no existen no cuentan.
// El total incluye el paso final «View my website», que la app añade y cuenta como hecho con `done`.
// Devuelve { status, total, passed, pct, next, byLang: { html: { passed, total }, … }, passedIds }.
// `next` es el número (desde 1) del primer paso sin superar; con todo superado, el paso final.
export function projectProgress(project, entry) {
  const steps = project?.steps || [];
  const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
  const ids = new Set(Array.isArray(record?.passed) ? record.passed : []);
  const done = record?.done === true;
  const passedIds = new Set(steps.filter((s) => ids.has(s.id)).map((s) => s.id));
  const byLang = {};
  for (const lang of LANGS) {
    const own = steps.filter((s) => s.lang === lang);
    byLang[lang] = { passed: own.filter((s) => passedIds.has(s.id)).length, total: own.length };
  }
  const total = steps.length + 1;
  const passed = passedIds.size + (done ? 1 : 0);
  const firstOpen = steps.findIndex((s) => !passedIds.has(s.id));
  const next = firstOpen === -1 ? steps.length + 1 : firstOpen + 1;
  // Un apartado guardado sin pasos superados (p. ej., ya ha escrito código) también es «en curso».
  const status = done ? "done" : (passed > 0 || record ? "progress" : "new");
  return { status, total, passed, pct: Math.round((passed / total) * 100), next, byLang, passedIds };
}

// Cuántos proyectos hay de cada estado: { all, progress, done, new } (para los filtros).
export function catalogCounts(projects, stateProjects = {}) {
  const counts = { all: projects.length, progress: 0, done: 0, new: 0 };
  for (const p of projects) counts[projectProgress(p, stateProjects?.[p.id]).status]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Espacio de trabajo con pasos (#/projects/N/step/M, js/views/project-step.js)
// ---------------------------------------------------------------------------

// Paso M (de 1 al total, que es el paso final «View my website»): { number, total, final, step,
// prev, next }, o null si no existe. `step` es null en el paso final.
export function stepAt(project, m) {
  const steps = project?.steps || [];
  const total = steps.length + 1;
  if (!Number.isInteger(m) || m < 1 || m > total) return null;
  return { number: m, total, final: m === total, step: steps[m - 1] || null, prev: m > 1 ? m - 1 : null, next: m < total ? m + 1 : null };
}

// Archivos del alumno ({ html, css, js }): los guardados en state.projects.pN.files o, si no hay,
// los de partida del proyecto.
export function projectFiles(project, entry) {
  const saved = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.files : null;
  const out = {};
  for (const lang of LANGS) {
    out[lang] = typeof saved?.[lang] === "string" ? saved[lang] : String(project?.starter?.[lang] ?? "");
  }
  return out;
}

// Apartado del proyecto dentro del progreso, creado y reparado si hace falta: { passed, done, files? }.
function projectEntry(state, project) {
  if (!isObj(state.projects)) state.projects = {};
  let e = state.projects[project.id];
  if (!isObj(e)) e = state.projects[project.id] = {};
  if (!Array.isArray(e.passed)) e.passed = [];
  if (typeof e.done !== "boolean") e.done = false;
  return e;
}

// Guarda los archivos del alumno (se llama al escribir). No toca los pasos superados ni `done`.
export function saveProjectFiles(state, project, files) {
  const e = projectEntry(state, project);
  e.files = {};
  for (const lang of LANGS) e.files[lang] = String(files?.[lang] ?? "");
}

// Guarda el resultado de «Check step»: los archivos y, si han pasado todas las comprobaciones, el
// paso como superado (en el orden de los pasos). Un paso superado sigue contando aunque después se
// cambie el código (como los ejercicios). Devuelve true si el paso se acaba de superar.
export function recordStepCheck(state, project, stepId, results, files) {
  const e = projectEntry(state, project);
  if (files) saveProjectFiles(state, project, files);
  const step = (project.steps || []).find((s) => s.id === stepId);
  const allPassed = Boolean(step) && Array.isArray(results) && results.length === step.checks.length && results.every((r) => r && r.pass === true);
  if (!allPassed || e.passed.includes(stepId)) return false;
  const order = (project.steps || []).map((s) => s.id);
  e.passed = [...e.passed, stepId].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });
  return true;
}

// ---------------------------------------------------------------------------
// «View my website» y checklist final (#/projects/N/result, js/views/project-result.js)
// ---------------------------------------------------------------------------

// Todas las comprobaciones del checklist, seguidas (para evaluarlas de una vez con evaluateChecks).
export function checklistChecks(project) {
  return (project?.checklist || []).flatMap((item) => item.checks || []);
}

// Agrupa los resultados de checklistChecks por punto del checklist: [{ lang, label, pass, reason }].
// Un punto se cumple si pasan todas sus comprobaciones. `reason` es "timeout" si alguna no terminó
// a tiempo (p. ej., un bucle infinito). Sin resultados (null) devuelve null.
export function checklistItems(project, results) {
  if (!Array.isArray(results)) return null;
  let at = 0;
  return (project?.checklist || []).map((item) => {
    const own = results.slice(at, at + (item.checks || []).length);
    at += (item.checks || []).length;
    const pass = own.length > 0 && own.length === (item.checks || []).length && own.every((r) => r && r.pass === true);
    const timeout = !pass && own.some((r) => !r || r.reason === "timeout");
    return { lang: item.lang, label: item.label, pass, ...(timeout ? { reason: "timeout" } : {}) };
  });
}

// Guarda el resultado del checklist final: si se cumplen todos los puntos, el proyecto queda
// terminado (`done: true`). Como los pasos, no se desmarca aunque después se cambie el código.
// Devuelve true si el proyecto se acaba de terminar.
export function recordChecklist(state, project, items) {
  const allPassed = Array.isArray(items) && items.length > 0 && items.length === (project?.checklist || []).length && items.every((i) => i && i.pass === true);
  if (!allPassed) return false;
  const e = projectEntry(state, project);
  if (e.done) return false;
  e.done = true;
  return true;
}

// Paso al que vuelve «Back to editor»: el primero sin superar o, si están todos, el último.
export function editorStep(project, entry) {
  const steps = project?.steps || [];
  return Math.max(1, Math.min(projectProgress(project, entry).next, steps.length));
}

// Todas las comprobaciones de un proyecto, con dónde están: [{ where, stepId?, index, check }].
// `where` es "step" o "checklist". Lo usan tools/project-harness.html y la pantalla de pasos.
export function allChecks(project) {
  const out = [];
  for (const step of project?.steps || []) {
    (step.checks || []).forEach((check, index) => out.push({ where: "step", id: step.id, index, check }));
  }
  (project?.checklist || []).forEach((item, n) => {
    (item.checks || []).forEach((check, index) => out.push({ where: "checklist", id: `checklist-${n + 1}`, index, check }));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Validación del formato de una comprobación (tools/check-content.mjs y tests)
// ---------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => typeof v === "string" && v.trim() !== "";
const nat = (v) => Number.isInteger(v) && v >= 0;

function regexError(pattern, flags = "") {
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (err) {
    return err.message;
  }
}

// Devuelve la lista de problemas de `check` (vacía si está bien). `inBehavior`: está dentro del
// `expect` de un behavior (entonces no lleva label ni puede ser js-regex o behavior).
// Los textos (label) los comprueba quien llama, porque son bilingües.
export function validateCheck(check, { inBehavior = false } = {}) {
  const errs = [];
  if (!isObj(check)) return ["no es un objeto"];
  const kinds = inBehavior ? EXPECT_KINDS : CHECK_KINDS;
  if (!kinds.includes(check.kind)) return [`kind debe ser ${kinds.join(", ")}`];
  const counts = () => {
    for (const k of ["count", "min", "max"]) if (k in check && !nat(check[k])) errs.push(`${k} debe ser un entero ≥ 0`);
    if ("count" in check && ("min" in check || "max" in check)) errs.push("count no se combina con min/max");
  };
  const pattern = (field, flags) => {
    if (field in check) {
      const e = !str(check[field]) ? "no puede estar vacío" : regexError(check[field], flags);
      if (e) errs.push(`${field}: expresión regular no válida (${e})`);
    }
  };
  const width = () => {
    if ("width" in check && (!Number.isInteger(check.width) || check.width < 200 || check.width > 2000)) {
      errs.push("width debe ser un entero entre 200 y 2000");
    }
  };
  switch (check.kind) {
    case "selector":
      if (!str(check.selector)) errs.push("falta selector");
      counts();
      pattern("text", "i");
      if ("visible" in check && typeof check.visible !== "boolean") errs.push("visible debe ser true o false");
      width();
      break;
    case "attr":
      if (!str(check.selector)) errs.push("falta selector");
      if (!str(check.attr)) errs.push("falta attr");
      if ("value" in check && typeof check.value !== "string") errs.push("value debe ser un texto");
      if ("value" in check && "pattern" in check) errs.push("usa value o pattern, no los dos");
      pattern("pattern");
      if ("any" in check && typeof check.any !== "boolean") errs.push("any debe ser true o false");
      width();
      break;
    case "css": {
      const ruleMode = "rule" in check;
      if (ruleMode) {
        pattern("rule");
        if ("selector" in check) errs.push("usa selector (estilo calculado) o rule (regla del CSS), no los dos");
        if ("pseudo" in check || "any" in check) errs.push("pseudo y any solo valen con selector");
        if ("min" in check || "max" in check) errs.push("min y max solo valen con selector");
        pattern("media");
        for (const k of ["value", "not", "pattern"]) if (k in check && !str(check.prop)) errs.push(`${k} necesita prop`);
      } else {
        if (!str(check.selector)) errs.push("falta selector o rule");
        if (!str(check.prop)) errs.push("falta prop");
        if ("media" in check) errs.push("media solo vale con rule");
        for (const k of ["min", "max"]) if (k in check && typeof check[k] !== "number") errs.push(`${k} debe ser un número`);
        if ("pseudo" in check && !["::before", "::after", "::placeholder", "::marker"].includes(check.pseudo)) {
          errs.push("pseudo debe ser ::before, ::after, ::placeholder o ::marker");
        }
        if ("any" in check && typeof check.any !== "boolean") errs.push("any debe ser true o false");
      }
      if ("prop" in check && !str(check.prop)) errs.push("prop no puede estar vacío");
      for (const k of ["value", "not"]) if (k in check && typeof check[k] !== "string") errs.push(`${k} debe ser un texto`);
      pattern("pattern", "i");
      width();
      break;
    }
    case "js-regex":
      if (!str(check.pattern)) errs.push("falta pattern");
      else pattern("pattern", (check.flags || "").replace(/g/g, ""));
      if ("flags" in check && (typeof check.flags !== "string" || !/^[imsu]*$/.test(check.flags))) errs.push("flags solo admite i, m, s y u");
      if ("file" in check && !LANGS.includes(check.file)) errs.push("file debe ser html, css o js");
      if ("max" in check) errs.push("max no vale en js-regex");
      counts();
      break;
    case "console":
      if (!("text" in check) && !("pattern" in check)) errs.push("falta text o pattern");
      if ("text" in check && typeof check.text !== "string") errs.push("text debe ser un texto");
      pattern("pattern");
      break;
    case "behavior":
      if (!Array.isArray(check.actions) || !check.actions.length) errs.push("actions debe tener al menos una acción");
      else check.actions.forEach((a, i) => errs.push(...validateAction(a).map((e) => `actions[${i}]: ${e}`)));
      if (!Array.isArray(check.expect) || !check.expect.length) errs.push("expect debe tener al menos una comprobación");
      else check.expect.forEach((c, i) => errs.push(...validateCheck(c, { inBehavior: true }).map((e) => `expect[${i}]: ${e}`)));
      width();
      break;
  }
  if (inBehavior) {
    if ("label" in check) errs.push("las comprobaciones de expect no llevan label");
    if ("width" in check) errs.push("width va en el behavior, no en expect");
  }
  return errs;
}

function validateAction(a) {
  if (!isObj(a)) return ["no es un objeto"];
  const keys = ["click", "input", "wait"].filter((k) => k in a);
  if (keys.length !== 1) return ["cada acción es { click }, { input, value } o { wait }"];
  const errs = [];
  if (keys[0] === "wait") {
    if (!Number.isInteger(a.wait) || a.wait < 0 || a.wait > 5000) errs.push("wait debe ser un entero de 0 a 5000 (ms)");
  } else {
    if (!str(a[keys[0]])) errs.push(`${keys[0]} debe ser un selector`);
    if ("index" in a && !nat(a.index)) errs.push("index debe ser un entero ≥ 0");
    if (keys[0] === "input" && typeof a.value !== "string") errs.push("input necesita value (texto)");
  }
  return errs;
}
