// Pantalla «Progress»: resumen del progreso y copia de seguridad (exportar, importar y reiniciar).
// No hay maqueta propia: usa las tarjetas y los botones de 01_inicio.
// Los textos están en data/ui/*.json (progress.*).

import { pageHeader, bindLangSwitch } from "./shell.js";
import { summarize } from "../store.js";
import { loadSummary } from "../data.js";
import { dashboardData } from "../engine/dashboard.js";
import { t } from "../i18n.js";

// Código de error de store.importJSON → clave del mensaje.
const IMPORT_ERRORS = {
  json: "progress.errorJson",
  format: "progress.errorFormat",
  invalid: "progress.errorInvalid",
  newer: "progress.errorNewer",
};

// Pinta la pantalla en `main`. `flash` es un mensaje opcional { kind: "ok" | "error", text }.
export function renderProgress(main, store, flash = null) {
  const s = summarize(store.get());
  const rerender = (msg) => {
    renderProgress(main, store, msg);
    main.querySelector("#progress-status")?.focus();
  };

  main.innerHTML = `
    ${pageHeader({
      title: t("titles.progress"),
      sub: store.persistent
        ? t("progress.subSaved")
        : t("progress.subNotSaved"),
    })}

    ${store.persistent ? "" : `
      <p class="note lime progress-note">${t("progress.noStorage")}</p>`}

    <div id="progress-status" class="progress-status" role="status" tabindex="-1">${flash ? `
      <p class="note ${flash.kind === "error" ? "purple" : "green"}">${flash.text}</p>` : ""}</div>

    <section class="grid4" id="progress-stats" aria-label="${t("progress.summary")}">${stats(s)}
    </section>
    <p class="small progress-hint">${t(s.answered ? "progress.hintStarted" : "progress.hintEmpty")}</p>

    <div class="progress-cols">
      <section class="card" aria-labelledby="backup-title">
        <h2 id="backup-title">${t("progress.backupTitle")}</h2>
        <p class="progress-text">${t("progress.backupText")}</p>
        <div class="progress-actions">
          <button type="button" class="btn primary" data-action="export">${t("progress.export")}</button>
          <button type="button" class="btn ghost" data-action="import">${t("progress.import")}</button>
          <label class="visually-hidden" for="import-file">${t("progress.importLabel")}</label>
          <input type="file" id="import-file" accept=".json,application/json" hidden>
        </div>
      </section>

      <section class="card" aria-labelledby="reset-title">
        <h2 id="reset-title">${t("progress.resetTitle")}</h2>
        <p class="progress-text">${t("progress.resetText")}</p>
        <div class="progress-actions" data-reset-area>
          <button type="button" class="btn ghost" data-action="reset">${t("progress.reset")}</button>
        </div>
      </section>
    </div>`;

  bindLangSwitch(main);
  fillTotals(main, store);

  const fileInput = main.querySelector("#import-file");

  main.querySelector('[data-action="export"]').addEventListener("click", () => {
    downloadText(store.exportJSON(), `jse-practice-progress-${new Date().toISOString().slice(0, 10)}.json`);
    rerender({ kind: "ok", text: t("progress.exported") });
  });

  main.querySelector('[data-action="import"]').addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const result = store.importJSON(await file.text());
    rerender(result.ok
      ? { kind: "ok", text: t("progress.imported") }
      : { kind: "error", text: t(IMPORT_ERRORS[result.error] || IMPORT_ERRORS.invalid) });
  });

  // Reiniciar pide confirmación en la propia página (sin ventanas emergentes).
  const resetArea = main.querySelector("[data-reset-area]");
  main.querySelector('[data-action="reset"]').addEventListener("click", () => {
    resetArea.innerHTML = `
      <p class="progress-confirm" id="reset-confirm-text">${t("progress.resetConfirm")}</p>
      <button type="button" class="btn primary" data-action="reset-yes" aria-describedby="reset-confirm-text">${t("progress.resetYes")}</button>
      <button type="button" class="btn ghost" data-action="reset-no">${t("progress.resetNo")}</button>`;
    resetArea.querySelector('[data-action="reset-no"]').addEventListener("click", () => {
      renderProgress(main, store);
      main.querySelector('[data-action="reset"]').focus();
    });
    resetArea.querySelector('[data-action="reset-yes"]').addEventListener("click", () => {
      store.reset();
      rerender({ kind: "ok", text: t("progress.resetDone") });
    });
    resetArea.querySelector('[data-action="reset-no"]').focus();
  });
}

// Cifras de la fila superior. Sin `totals` (mientras cargan los datos) salen sin el «/ N».
function stats(s, totals = null) {
  return `
      ${stat(t("progress.statAnswered"), s.answered, totals ? `/ ${totals.questions}` : "")}
      ${stat(t("progress.statAccuracy"), s.accuracy === null ? "–" : `${s.accuracy}%`)}
      ${stat(t("progress.statExercises"), s.exercises, totals ? `/ ${totals.exercises}` : "")}
      ${stat(t("progress.statMocks"), s.mocks)}`;
}

// Con los datos cargados, las cifras usan los mismos cálculos que el panel de inicio
// (js/engine/dashboard.js): solo cuentan las preguntas de práctica y los ejercicios que existen
// (no las del banco de simulacros), y los totales son los reales, que crecen con el contenido, en
// vez de cifras fijas. Si la carga falla, se quedan las cifras de summarize() sin total.
async function fillTotals(main, store) {
  try {
    const { sections, questionBanks, exerciseBanks } = await loadSummary();
    const box = main.querySelector("#progress-stats");
    if (!box || !box.isConnected) return;
    const state = store.get();
    const d = dashboardData({ sections, questionBanks, exerciseBanks, state });
    const s = { ...summarize(state), answered: d.questions.answered, accuracy: d.questions.accuracy, exercises: d.exercises.solved };
    box.innerHTML = stats(s, { questions: d.questions.total, exercises: d.exercises.total });
  } catch {
    // Sin datos: se quedan las cifras sin total.
  }
}

function stat(label, value, total = "") {
  return `<div class="card stat"><span>${label}</span><strong>${value}</strong>${total ? ` <small>${total}</small>` : ""}</div>`;
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
