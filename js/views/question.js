// Piezas HTML de una pregunta: enunciado, código, opciones y, tras corregir, la explicación,
// el porqué de cada opción incorrecta y la referencia al curso. Las usa «Practice by topic»
// (js/views/practice.js) y las usarán los simulacros, que pintan las opciones sin resultado.
// El contenido de las preguntas viene de data/ (texto bilingüe { en, es }) y se escapa siempre.

import { t } from "../i18n.js";
import { chooseCount, isMultiple } from "../engine/questions.js";
import { codeBlock, inlineText, escapeHtml } from "../engine/format.js";
import { termMarker } from "../engine/glossary.js";

// Texto del enunciado o de la explicación con los términos del glosario marcados (tooltip).
// No se marcan las opciones ni su porqué: van dentro de un <button> y el término también lo es.
function richText(text, lang) {
  return inlineText(text, { terms: termMarker(lang) });
}

// Texto bilingüe en el idioma pedido (inglés si faltara).
export function pick(text, lang) {
  return (text && (text[lang] || text.en)) || "";
}

// Claves de data/ui escritas enteras (tests/i18n.test.mjs comprueba que existen y se usan).
const TYPE_KEYS = {
  single: "question.type.single",
  multiple: "question.type.multiple",
  output: "question.type.output",
  error: "question.type.error",
  gap: "question.type.gap",
};
const NUMBER_KEYS = { 2: "question.numbers.two", 3: "question.numbers.three", 4: "question.numbers.four", 5: "question.numbers.five" };

// «Predict the output», «Multiple choice · choose two»…
export function typeLabel(question) {
  if (!isMultiple(question)) return t(TYPE_KEYS[question.type]);
  const n = chooseCount(question);
  return t(TYPE_KEYS.multiple, { n: NUMBER_KEYS[n] ? t(NUMBER_KEYS[n]) : n });
}

// En «output» y «gap» la opción es código (salida de consola o lo que va en el hueco):
// se muestra entera en monoespaciada. En el resto es texto con `código` en línea.
function optionText(question, option, lang) {
  if (question.type === "output" || question.type === "gap") {
    return `<code class="opt-code">${escapeHtml(pick(option.text, lang))}</code>`;
  }
  return `<span class="opt-text">${inlineText(pick(option.text, lang))}</span>`;
}

// Enunciado + código. En «gap» el hueco muestra la opción elegida (si hay).
// `glossary`: marca los términos del glosario (en los simulacros no, porque darían pistas).
// `promptId`: id del enunciado (distinto para cada pregunta si hay varias en la página).
export function questionStem(question, { lang, selected = [], glossary = true, promptId = "q-prompt" }) {
  let gapFill = null;
  if (question.type === "gap" && selected.length) {
    const opt = question.options.find((o) => o.id === selected[0]);
    if (opt) gapFill = pick(opt.text, "en");
  }
  return `
    <p class="q-prompt" id="${promptId}">${glossary ? richText(pick(question.prompt, lang), lang) : inlineText(pick(question.prompt, lang))}</p>
    ${question.code ? codeBlock(question.code, { gapFill, gapLabel: t("question.gap") }) : ""}`;
}

// Lista de opciones. Sin `result`: botones que se pueden marcar (aria-pressed).
// Con `result` (corregida): desactivadas, con las correctas en verde, la elegida mal en rojo y,
// debajo de cada opción incorrecta, por qué no es correcta (`why`).
export function optionList(question, { lang, selected = [], result = null, promptId = "q-prompt" }) {
  const multi = isMultiple(question);
  const states = new Map((result?.options || []).map((o) => [o.id, o]));
  const items = question.options.map((o) => {
    const st = states.get(o.id);
    const pressed = selected.includes(o.id);
    let cls = "opt";
    let tail = "";
    if (st?.state === "right") {
      cls += " right";
      tail = `<span class="chip green">${t("question.correctChip")}</span>${st.picked ? `<span class="visually-hidden"> (${t("question.yourAnswer")})</span>` : ""}`;
    } else if (st?.state === "wrong") {
      cls += " wrong";
      tail = `<span class="chip red">${t("question.yourAnswer")}</span>`;
    }
    const why = result && !st?.isAnswer && o.why
      ? `<span class="opt-why">${inlineText(pick(o.why, lang))}</span>`
      : "";
    const attrs = result ? " disabled" : ` aria-pressed="${pressed}"`;
    return `
      <button type="button" class="${cls}" data-option="${escapeHtml(o.id)}"${attrs}>
        <span class="letter${multi ? " box" : ""}" aria-hidden="true">${escapeHtml(o.id)}</span>
        <span class="opt-body"><span class="visually-hidden">${escapeHtml(o.id)}. </span>${optionText(question, o, lang)}${why}</span>
        ${tail}
      </button>`;
  }).join("");
  return `<div class="options" role="group" aria-labelledby="${promptId}">${items}</div>`;
}

// Panel de la derecha tras corregir: mensaje, explicación, `extra` (p. ej., la traducción)
// y la referencia al curso. `retry`: añade el botón «Try again» (data-action="retry").
// `runner`: { toggle, panel } de «Run this code» (js/views/runner-panel.js): el botón va al
// final de la explicación y el panel justo debajo.
export function feedbackPanel(question, result, { lang, extra = "", retry = false, runner = null }) {
  return `
    <div class="q-result-row">
      <p class="q-result ${result.correct ? "ok" : "ko"}" role="status" tabindex="-1" id="q-result">${t(result.correct ? "question.rightMsg" : "question.wrongMsg")}</p>
      ${retry ? `<button type="button" class="mini" data-action="retry">${t("question.retry")}</button>` : ""}
    </div>
    <div class="note green">
      <strong>${t("question.explanation")}</strong><br>
      ${richText(pick(question.explanation, lang), lang)}
      ${runner?.toggle ? `<div class="q-run">${runner.toggle}</div>` : ""}
    </div>
    ${runner?.panel || ""}
    ${extra}
    <div class="card q-course">
      <p class="small">${t("question.course")}</p>
      <p><code>${escapeHtml(question.courseRef)}</code> → ${t("question.courseHint")}</p>
    </div>`;
}

// Tarjeta con la pregunta en el otro idioma («Ver en español» / «Ver en inglés»):
// enunciado, opciones de texto (si cambian con el idioma) y, tras corregir, la explicación.
export function peekPanel(question, { lang, answered }) {
  const options = question.type === "output" || question.type === "gap"
    ? []
    : question.options.filter((o) => pick(o.text, lang) !== pick(o.text, lang === "en" ? "es" : "en"));
  return `
    <div class="note lime q-peek" lang="${lang}">
      <strong>${t("question.peekTitle")}</strong><br>
      <em>${inlineText(pick(question.prompt, lang))}</em>
      ${options.length ? `
      <ul class="q-peek-opts">
        ${options.map((o) => `<li><b>${escapeHtml(o.id)}</b> ${inlineText(pick(o.text, lang))}</li>`).join("")}
      </ul>` : ""}
      ${answered ? `<p>${inlineText(pick(question.explanation, lang))}</p>` : ""}
    </div>`;
}
