// Texto y código de las preguntas convertidos en HTML seguro. Sin DOM (se prueba con node --test).
// - inlineText: escapa el texto y convierte `código` en <code>código</code>.
// - highlight: resalta un fragmento de JavaScript con las clases de css/base.css
//   (.k palabra clave, .s texto, .n número, .f función, .c comentario) y marca el hueco
//   `___` de las preguntas «Fill the gap».
// - tokenizeHtml / tokenizeCss: lo mismo para index.html y style.css de los proyectos
//   (.t etiqueta o selector, .a atributo, .f propiedad, .s valor entre comillas, .n número o color,
//   .k regla @, .c comentario). highlight(code, { lang: "html" | "css" }) los usa.
// - codeBlock: bloque <pre class="code numbered"> con una <span class="line"> por línea.

import { escapeHtml } from "../i18n.js";

export { escapeHtml };

// Texto de una pregunta, opción o explicación. Los saltos de línea se respetan.
// `terms` (opcional): marcador del glosario (js/engine/glossary.js). Marca los términos solo en
// el texto que va fuera de `código`, y cada término una vez por bloque.
export function inlineText(text, { terms = null } = {}) {
  const seen = new Set();
  return String(text ?? "")
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      return terms ? terms.mark(part, seen) : escapeHtml(part).replace(/\n/g, "<br>");
    })
    .join("");
}

const KEYWORDS = new Set([
  "let", "const", "var", "if", "else", "for", "while", "do", "return", "function", "new",
  "typeof", "instanceof", "in", "of", "true", "false", "null", "undefined", "class", "extends",
  "break", "continue", "switch", "case", "default", "try", "catch", "finally", "throw",
  "this", "delete", "void", "async", "await", "NaN", "Infinity",
]);

export const GAP = "___";

// Divide el código en trozos { cls, text }. cls: "k", "s", "n", "f", "c", "gap" o "".
export function tokenize(code) {
  const tokens = [];
  const src = String(code ?? "");
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|(___)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) tokens.push({ cls: "", text: src.slice(last, m.index) });
    const [text, comment, string, gap, number, word] = m;
    let cls = "";
    if (comment) cls = "c";
    else if (string) cls = "s";
    else if (gap) cls = "gap";
    else if (number) cls = "n";
    else if (word) {
      if (KEYWORDS.has(word)) cls = "k";
      else if (/^\s*\(/.test(src.slice(re.lastIndex))) cls = "f";
    }
    tokens.push({ cls, text });
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ cls: "", text: src.slice(last) });
  return tokens;
}

// index.html: comentarios, etiquetas (nombre .t, atributos .a y valores .s) y texto.
// El contenido de <style> y <script> se deja sin resaltar (en los proyectos van en sus archivos).
export function tokenizeHtml(code) {
  const tokens = [];
  const src = String(code ?? "");
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z!][^<>]*>?/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) tokens.push({ cls: "", text: src.slice(last, m.index) });
    if (m[0].startsWith("<!--")) tokens.push({ cls: "c", text: m[0] });
    else tokens.push(...tagTokens(m[0]));
    last = re.lastIndex;
  }
  if (last < src.length) tokens.push({ cls: "", text: src.slice(last) });
  return tokens;
}

function tagTokens(tag) {
  const out = [];
  const head = /^<\/?[!\w-]*/.exec(tag)[0];
  const bracket = head.match(/^<\/?/)[0];
  out.push({ cls: "", text: bracket }, { cls: "t", text: head.slice(bracket.length) });
  const re = /("[^"]*"?|'[^']*'?)|([^\s=<>"'/]+)|([\s\S])/g;
  const rest = tag.slice(head.length);
  let m;
  while ((m = re.exec(rest))) {
    const [text, str, name] = m;
    out.push({ cls: str ? "s" : name ? "a" : "", text });
  }
  return out;
}

// style.css: comentarios, selectores (.t), reglas @ (.k), propiedades (.f), textos (.s) y números,
// medidas y colores (.n). Distingue el selector de las declaraciones contando las llaves.
export function tokenizeCss(code) {
  const tokens = [];
  const src = String(code ?? "");
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@[\w-]+)|([{};])|(#[0-9a-fA-F]{3,8}\b|-?\b\d*\.?\d+(?:[a-z%]+)?)|([\w-]+)(?=\s*:)|([^{};"'/@\s#\d-][^{};"'/@\n]*?(?=\s*[{,]|\s*$)|[\s\S])/g;
  // Pila de bloques: "decl" (declaraciones) o "rules" (dentro de @media: más selectores).
  const stack = [];
  let pendingAt = false;
  const inDecl = () => stack[stack.length - 1] === "decl";
  let m;
  while ((m = re.exec(src))) {
    const [text, comment, str, at, brace, num, prop] = m;
    let cls = "";
    if (comment) cls = "c";
    else if (str) cls = "s";
    else if (at) { cls = "k"; pendingAt = true; }
    else if (brace) {
      if (brace === "{") { stack.push(pendingAt ? "rules" : "decl"); pendingAt = false; }
      else if (brace === "}") stack.pop();
      else if (!inDecl()) pendingAt = false; // fin de @import …;
    } else if (inDecl()) {
      if (num) cls = "n";
      else if (prop) cls = "f";
    } else if (!pendingAt && /\S/.test(text)) cls = "t";
    tokens.push({ cls, text });
  }
  return tokens;
}

// Devuelve el HTML de cada línea (lista). `gapFill` (opcional): texto que se pone en el
// hueco `___` (la opción elegida en «Fill the gap»); si no hay, se ve el hueco vacío.
// `gapLabel`: texto oculto que anuncia el hueco al lector de pantalla.
// `lang`: "js" (por defecto), "html" o "css".
export function highlight(code, { gapFill = null, gapLabel = "gap", lang = "js" } = {}) {
  const lines = [""];
  const tokens = lang === "html" ? tokenizeHtml(code) : lang === "css" ? tokenizeCss(code) : tokenize(code);
  for (const { cls, text } of tokens) {
    text.split("\n").forEach((piece, i) => {
      if (i > 0) lines.push("");
      if (cls === "gap") {
        lines[lines.length - 1] += gapFill === null
          ? `<span class="gap"><span class="visually-hidden">(${escapeHtml(gapLabel)})</span>${escapeHtml(piece)}</span>`
          : `<span class="gap filled">${escapeHtml(gapFill)}</span>`;
      } else if (!piece) {
        // trozo vacío (salto de línea al principio o al final del token)
      } else {
        lines[lines.length - 1] += cls ? `<span class="${cls}">${escapeHtml(piece)}</span>` : escapeHtml(piece);
      }
    });
  }
  return lines;
}

// Bloque de código con números de línea (los pone el CSS: no se copian ni los lee el lector).
// `lang`: "js" (por defecto), "html" o "css".
export function codeBlock(code, { gapFill = null, gapLabel = "gap", lang = "js" } = {}) {
  const body = highlight(code, { gapFill, gapLabel, lang }).map((l) => `<span class="line">${l}</span>`).join("\n");
  return `<pre class="code numbered"><code>${body}</code></pre>`;
}
