// Panel «Run this code» de las explicaciones: el alumno ejecuta el código de la pregunta, lo
// cambia, lo vuelve a ejecutar y puede volver al original. La ejecución aislada está en
// js/engine/runner.js; aquí solo se pinta el panel y la consola.
//
// Estado (se guarda en `view.run` para que sobreviva a los repintados de la pantalla, p. ej. al
// cambiar de idioma): { id, code, output, running }. `id` es la pregunta a la que pertenece.

import { t } from "../i18n.js";
import { escapeHtml } from "../engine/format.js";
import { snippetFor, runSnippet, RUN_TIMEOUT, MAX_LINES } from "../engine/runner.js";
import { editorHtml, bindEditor, setCode } from "./code-editor.js";

// Estado del panel para esta pregunta, o null si está cerrado.
export function runState(question, view) {
  return view.run && view.run.id === question.id ? view.run : null;
}

export function openRunner(question, view) {
  view.run = { id: question.id, code: snippetFor(question), output: null, running: false };
  return view.run;
}

export function closeRunner(view) {
  view.run = null;
}

// Cómo responden los diálogos al ejecutar el código de esta pregunta, igual que
// tools/check-content.mjs al comprobar la respuesta: `prompt` devuelve lo que escribe el usuario
// del enunciado (verify.inputs, en orden; después null, «Cancelar») y `confirm`, true («Aceptar»).
// Así la salida coincide con la de la pregunta. Las fichas de teoría no tienen verify: [].
export function runOptions(question) {
  const inputs = Array.isArray(question?.verify?.inputs) ? question.verify.inputs.map(String) : [];
  return { inputs, confirmAnswer: true };
}

// Aviso del panel cuando el código usa prompt o confirm: qué van a responder. "" si no los usa.
export function dialogNote(question) {
  const code = snippetFor(question) || "";
  if (!/\b(prompt|confirm)\s*\(/.test(code)) return "";
  const { inputs } = runOptions(question);
  if (!inputs.length) return t("run.dialogNoteCancel");
  return t("run.dialogNote", { inputs: inputs.map((v) => JSON.stringify(v)).join(", ") });
}

// Botón que abre y cierra el panel (va dentro de la explicación). "" si la pregunta no tiene código.
export function runnerToggle(question, view) {
  if (!snippetFor(question)) return "";
  const open = Boolean(runState(question, view));
  return `<button type="button" class="btn ghost run-toggle" data-action="run-toggle" aria-expanded="${open}"${open ? ' aria-controls="runner"' : ""}>
      <span aria-hidden="true">▶</span> ${t("run.open")}</button>`;
}

// Panel abierto (editor, botones y consola). "" si está cerrado.
export function runnerPanel(question, view) {
  const run = runState(question, view);
  if (!run) return "";
  const original = snippetFor(question);
  const edited = run.code !== original;
  return `
    <section class="card runner" id="runner" aria-labelledby="runner-title">
      <h2 id="runner-title">${t("run.title")}</h2>
      <p class="small runner-intro">${t("run.intro")}</p>
      ${question.type === "gap" ? `<p class="small runner-intro">${t("run.gapNote")}</p>` : ""}
      ${dialogNote(question) ? `<p class="small runner-intro runner-dialogs">${dialogNote(question)}</p>` : ""}
      ${editorHtml({ id: "runner-code", code: run.code, label: t("run.codeLabel") })}
      <div class="runner-actions">
        <button type="button" class="btn ghost" data-action="run-reset"${edited ? "" : ' aria-disabled="true"'}>${t("run.reset")}</button>
        <button type="button" class="btn primary" data-action="run-go"${run.running ? ' aria-disabled="true"' : ""}><span aria-hidden="true">▶</span> ${t("run.run")}</button>
      </div>
      <div class="console runner-console" role="log" aria-labelledby="runner-console-title" aria-busy="${run.running}">
        <p class="console-title" id="runner-console-title">${t("run.console")}</p>
        <div class="runner-out">${consoleLines(run)}</div>
      </div>
    </section>`;
}

// Contenido de la consola según el estado de la ejecución.
export function consoleLines(run) {
  if (run.running) return `<p class="cl msg muted">${t("run.running")}</p>`;
  const out = run.output;
  if (!out) return `<p class="cl msg muted">${t("run.idle")}</p>`;
  if (out.unsupported) return `<p class="cl msg warn">${t("run.unsupported")}</p>`;
  const lines = out.lines.map((l) => {
    if (l.kind === "error" && l.error) {
      const name = l.error.name ? `${escapeHtml(l.error.name)}: ` : "";
      const where = l.error.line ? ` <span class="cl-line">(${t("run.line", { n: l.error.line })})</span>` : "";
      const prefix = l.error.promise ? "Uncaught (in promise)" : "Uncaught";
      return `<p class="cl err"><span aria-hidden="true">✖ </span>${prefix} ${name}${escapeHtml(l.text)}${where}</p>`;
    }
    const cls = l.kind === "error" ? "err" : l.kind === "warn" ? "warn" : l.kind === "dialog" ? "dialog" : "log";
    return `<p class="cl ${cls}">${escapeHtml(l.text)}</p>`;
  });
  if (out.truncated) lines.push(`<p class="cl msg muted">${t("run.truncated", { n: MAX_LINES })}</p>`);
  if (out.timedOut) lines.push(`<p class="cl msg warn"><span aria-hidden="true">⏱ </span>${t("run.timeout", { seconds: RUN_TIMEOUT / 1000 })}</p>`);
  if (!lines.length) lines.push(`<p class="cl msg muted">${t("run.empty")}</p>`);
  return lines.join("");
}

// Eventos del panel (si está abierto). Ejecutar no repinta la pantalla: solo la consola y los
// botones, para no perder el foco ni lo escrito.
export function bindRunner(main, question, view) {
  const panel = main.querySelector("#runner");
  const run = runState(question, view);
  if (!panel || !run) return;
  const area = panel.querySelector("#runner-code");
  const original = snippetFor(question);

  // El panel puede haberse repintado mientras se ejecutaba (p. ej., al cambiar de idioma, que
  // crea un <main> nuevo): siempre se busca el que está en la página.
  const livePanel = () => document.getElementById("runner");
  const refresh = () => {
    const current = livePanel();
    if (!current || view.run !== run) return;
    current.querySelector(".runner-out").innerHTML = consoleLines(run);
    current.querySelector(".runner-console").setAttribute("aria-busy", String(run.running));
    const go = current.querySelector('[data-action="run-go"]');
    if (run.running) go.setAttribute("aria-disabled", "true");
    else go.removeAttribute("aria-disabled");
    const reset = current.querySelector('[data-action="run-reset"]');
    if (run.code !== original) reset.removeAttribute("aria-disabled");
    else reset.setAttribute("aria-disabled", "true");
  };

  const execute = async () => {
    if (run.running) return;
    run.running = true;
    refresh();
    const output = await runSnippet(run.code, runOptions(question));
    run.running = false;
    run.output = output;
    refresh();
  };

  bindEditor(area, {
    onInput(code) {
      run.code = code;
      refresh();
    },
    onRun: execute,
  });
  panel.querySelector('[data-action="run-go"]').addEventListener("click", execute);
  panel.querySelector('[data-action="run-reset"]').addEventListener("click", () => {
    if (run.code === original) return;
    run.code = original;
    setCode(area, original);
    refresh();
    area.focus();
  });
}
