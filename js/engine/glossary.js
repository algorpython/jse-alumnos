// Glosario técnico EN↔ES (data/glossary.json): marca los términos en el texto de las preguntas
// y explicaciones y les pone un tooltip con el término en los dos idiomas y su definición.
// Sin DOM (se prueba con node --test). El comportamiento del tooltip (posición, Escape) está
// en js/views/glossary-tips.js y su aspecto en css/base.css (.term).
//
// Reglas del marcado:
// - Se buscan las formas del idioma del texto: el término (`en` o `es`) y sus `aliases[lang]`.
//   Cada forma acepta además el plural regular («strings», «operadores»).
// - Solo palabras completas: «variable» no se marca dentro de «invariable», ni «shadow» dentro
//   de «box-shadow» (el guion también une palabras).
// - Nunca dentro de `código`: format.inlineText solo pasa aquí el texto que va fuera de ``.
// - Cada término se marca una sola vez por bloque (la primera vez que aparece), para no llenar
//   el texto de subrayados. Si dos formas se solapan gana la más larga («arrow function»
//   antes que «function»).
// - `notIn[lang]` (opcional): frases en las que el término NO se marca porque ahí significa otra
//   cosa (p. ej. «Which two statements are true?», donde «statement» es «afirmación»). Se marca
//   entonces la siguiente aparición que quede fuera de esas frases.

import { escapeHtml } from "../i18n.js";

const LANGS = ["en", "es"];

// Formas que se buscan para un término en un idioma (sin repetir).
export function termForms(entry, lang) {
  const forms = [entry[lang], ...(entry.aliases?.[lang] || [])]
    .filter((f) => typeof f === "string" && f.trim())
    .map((f) => f.trim());
  return [...new Set(forms)];
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Texto normal (no código): se escapa y los saltos de línea pasan a <br>.
const plain = (text) => escapeHtml(text).replace(/\n/g, "<br>");

// Contador para los id de los tooltips (únicos en la página).
let nextTipId = 1;

// Crea el marcador de un idioma: { mark(text, seen) } devuelve el HTML del texto con los
// términos marcados. `seen` (Set de ids) guarda los términos ya marcados en ese bloque.
export function createMarker(entries, lang) {
  const byForm = new Map();
  for (const entry of entries || []) {
    if (!entry?.id || !LANGS.every((l) => entry[l])) continue;
    for (const form of termForms(entry, lang)) {
      if (!byForm.has(form.toLowerCase())) byForm.set(form.toLowerCase(), entry);
    }
  }
  if (!byForm.size) return { mark: (text) => plain(text) };

  // Frases de exclusión de cada término (notIn), sin distinguir mayúsculas.
  const notIn = new Map();
  for (const entry of new Set(byForm.values())) {
    const phrases = (entry.notIn?.[lang] || []).filter((p) => typeof p === "string" && p.trim());
    if (phrases.length) notIn.set(entry.id, new RegExp(phrases.map((p) => escapeRegex(p.trim())).join("|"), "giu"));
  }
  // ¿Cae la posición `at` del texto dentro de una frase de exclusión del término?
  const excluded = (src, entry, at) => {
    const phrase = notIn.get(entry.id);
    if (!phrase) return false;
    for (const m of src.matchAll(phrase)) if (at >= m.index && at < m.index + m[0].length) return true;
    return false;
  };

  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length);
  // Palabra completa: ni letra (también con tilde), ni número, ni _, $ o - a los lados.
  const re = new RegExp(`(?<![\\p{L}\\p{N}_$-])(${forms.map(escapeRegex).join("|")})(?:e?s)?(?![\\p{L}\\p{N}_$-])`, "giu");

  return {
    mark(text, seen = new Set()) {
      const src = String(text ?? "");
      let out = "";
      let last = 0;
      for (const m of src.matchAll(re)) {
        const entry = byForm.get(m[1].toLowerCase());
        if (!entry || seen.has(entry.id) || excluded(src, entry, m.index)) continue;
        seen.add(entry.id);
        out += plain(src.slice(last, m.index)) + termHtml(m[0], entry, lang);
        last = m.index + m[0].length;
      }
      return out + plain(src.slice(last));
    },
  };
}

// Término marcado: un botón (se llega con Tab) descrito por su tooltip (role="tooltip").
// El tooltip enseña el término en inglés y en español y la definición en el idioma del texto.
// La definición puede llevar `código` (se pinta con <code>, sin marcar términos dentro).
export function termHtml(text, entry, lang) {
  const id = `term-tip-${nextTipId++}`;
  const same = entry.en.toLowerCase() === entry.es.toLowerCase();
  const head = same
    ? `<span class="term-lang" aria-hidden="true">EN · ES</span> <span lang="en">${escapeHtml(entry.en)}</span>`
    : `<span class="term-lang" aria-hidden="true">EN</span> <span lang="en">${escapeHtml(entry.en)}</span>`
      + `<span class="term-sep" aria-hidden="true"> · </span>`
      + `<span class="term-lang" aria-hidden="true">ES</span> <span lang="es">${escapeHtml(entry.es)}</span>`;
  const definition = entry.definition?.[lang] || entry.definition?.en || "";
  return `<span class="term">`
    + `<button type="button" class="term-btn" aria-describedby="${id}">${escapeHtml(text)}</button>`
    + `<span class="term-tip" role="tooltip" id="${id}">`
    + `<span class="term-head">${head}</span><span class="visually-hidden">: </span>`
    + `<span class="term-def">${codeSpans(definition)}</span>`
    + `</span></span>`;
}

function codeSpans(text) {
  return String(text).split(/(`[^`]+`)/)
    .map((part) => (/^`[^`]+`$/.test(part) ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : plain(part)))
    .join("");
}

// ---------- Glosario activo de la app ----------
// app.js lo carga al arrancar (data.loadGlossary) y las vistas piden el marcador del idioma.

let active = [];
const markers = new Map();

export function setGlossary(entries) {
  active = Array.isArray(entries) ? entries : [];
  markers.clear();
}

export function getGlossary() {
  return active;
}

// Marcador del idioma con el glosario activo (null si el glosario está vacío).
export function termMarker(lang) {
  if (!active.length) return null;
  if (!markers.has(lang)) markers.set(lang, createMarker(active, lang));
  return markers.get(lang);
}
