// Editor de código común: «Run this code» (js/views/runner-panel.js), los ejercicios de código
// (js/views/exercises.js) y los pasos de los proyectos (js/views/project-step.js, también con
// index.html y style.css).
//
// Es un <textarea> real (con su <label>: funciona con el lector de pantalla, el corrector del
// móvil desactivado y deshacer/rehacer del navegador) con dos capas al lado que no se leen
// (aria-hidden): los números de línea y el código resaltado, que se ve a través del textarea
// transparente. Teclas:
// - Tab sangra 2 espacios (o las líneas seleccionadas) y Mayús+Tab quita la sangría.
// - Para salir del editor con el teclado: Esc y después Tab (o Mayús+Tab). Lo dice el texto de
//   ayuda que va debajo, enlazado con aria-describedby.
// - Intro mantiene la sangría de la línea (y añade un nivel tras «{»).
// - Ctrl+Enter (Cmd+Enter en Mac) ejecuta el código (onRun).
// Las ediciones se calculan en js/engine/editing.js.

import { t } from "../i18n.js";
import { escapeHtml, highlight } from "../engine/format.js";
import { indentEdit, newlineEdit, applyEdit } from "../engine/editing.js";

const lineCount = (code) => String(code).split("\n").length;
export const gutter = (code) => Array.from({ length: lineCount(code) }, (_, i) => i + 1).join("\n");

// Código resaltado. El espacio final deja sitio a la última línea si está vacía (un <pre> no
// pinta el último salto de línea).
// `lang`: "js" (por defecto), "html" o "css".
export function highlighted(code, lang = "js") {
  return highlight(code, { lang }).join("\n") + "\n ";
}

// Filas del textarea que crece con el código (de 3 a 16; a partir de ahí, barra de desplazamiento).
export const autoRows = (code) => Math.min(Math.max(lineCount(code), 3), 16);

// HTML del editor. `rows`: filas fijas, o null para que crezca con el código. `lang`: lenguaje del
// resaltado. `help`: texto de ayuda de las teclas (por defecto, el de «Run this code»).
export function editorHtml({ id, code, label, rows = null, className = "", lang = "js", help = null }) {
  const helpId = `${id}-help`;
  return `
    <div class="editor ${className}" data-editor data-code-lang="${lang}">
      <pre class="editor-gutter" aria-hidden="true">${gutter(code)}</pre>
      <div class="editor-area">
        <pre class="editor-hl" aria-hidden="true"><code>${highlighted(code, lang)}</code></pre>
        <label class="visually-hidden" for="${id}">${label}</label>
        <textarea id="${id}" class="editor-input" rows="${rows ?? autoRows(code)}"${rows ? "" : " data-autorows"} aria-describedby="${helpId}" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off">${escapeHtml(code)}</textarea>
      </div>
    </div>
    <p class="small editor-help" id="${helpId}">${help ?? t("editor.help")}</p>`;
}

// Vuelve a pintar los números de línea y el resaltado (tras escribir o cambiar el código).
function syncLayers(area) {
  const box = area.closest("[data-editor]");
  if (!box) return;
  box.querySelector(".editor-gutter").textContent = gutter(area.value);
  box.querySelector(".editor-hl code").innerHTML = highlighted(area.value, box.dataset.codeLang || "js");
  if (area.hasAttribute("data-autorows")) area.rows = autoRows(area.value);
  syncScroll(area);
}

function syncScroll(area) {
  const box = area.closest("[data-editor]");
  if (!box) return;
  box.querySelector(".editor-gutter").scrollTop = area.scrollTop;
  const hl = box.querySelector(".editor-hl");
  hl.scrollTop = area.scrollTop;
  hl.scrollLeft = area.scrollLeft;
}

// Cambia todo el código (p. ej., «Back to the original»), sin pasar por el historial de deshacer.
export function setCode(area, code) {
  area.value = code;
  syncLayers(area);
}

// Aplica una edición como si se hubiera escrito (así Ctrl+Z la deshace). Si el navegador no
// permite insertText, se cambia el valor directamente.
function applyToArea(area, edit) {
  const before = area.value;
  const expected = applyEdit(before, edit);
  area.setSelectionRange(edit.from, edit.to);
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, edit.text);
  } catch (err) {
    ok = false;
  }
  if (!ok || area.value !== expected) {
    area.value = expected;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }
  area.setSelectionRange(edit.selStart, edit.selEnd);
}

// Sustituye todo el código como si se hubiera escrito (Ctrl+Z lo recupera) y deja el foco en el
// editor, con el cursor al principio. Lo usa «Start over» de los ejercicios.
export function replaceCode(area, code) {
  area.focus();
  applyToArea(area, { from: 0, to: area.value.length, text: code, selStart: 0, selEnd: 0 });
  area.scrollTop = 0;
  syncScroll(area);
}

// Activa un editor. onInput(code) tras cada cambio; onRun() con Ctrl+Enter.
export function bindEditor(area, { onInput = () => {}, onRun = null } = {}) {
  const box = area.closest("[data-editor]");
  // Tras pulsar Esc, el siguiente Tab sale del editor en vez de sangrar.
  let leaving = false;
  const setLeaving = (on) => {
    leaving = on;
    box?.toggleAttribute("data-leaving", on);
    box?.nextElementSibling?.classList.toggle("editor-help-on", on);
  };

  area.addEventListener("input", () => {
    syncLayers(area);
    onInput(area.value);
  });
  area.addEventListener("scroll", () => syncScroll(area));
  area.addEventListener("blur", () => setLeaving(false));
  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setLeaving(true);
      return;
    }
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (leaving) {
        setLeaving(false);
        return; // el navegador mueve el foco al control siguiente (o anterior con Mayús)
      }
      e.preventDefault();
      applyToArea(area, indentEdit(area.value, area.selectionStart, area.selectionEnd, e.shiftKey));
      return;
    }
    if (e.key !== "Shift") setLeaving(false);
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRun?.();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing) {
      e.preventDefault();
      applyToArea(area, newlineEdit(area.value, area.selectionStart, area.selectionEnd));
    }
  });
}
