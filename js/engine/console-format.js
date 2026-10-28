// Texto de una llamada a console.log en «Run this code», con el mismo formato que Node.js
// (util.format), que es el que usa tools/check-content.mjs para comprobar las respuestas:
// los strings sueltos van tal cual y el resto como `[ 1, 2 ]`, `{ a: 1, b: 'x' }`, `[Function: f]`…
//
// IMPORTANTE: formatArgs no usa nada de fuera de su cuerpo (ni imports ni variables del módulo),
// porque js/engine/runner.js copia su código fuente (formatArgs.toString()) dentro del Web Worker
// que ejecuta el fragmento. tests/runner.test.mjs lo compara con util.format.
//
// Diferencias con Node (a propósito, para que se lea mejor en la consola de la app): todo va en
// una sola línea (Node parte las listas largas en varias líneas) y un Error se muestra como
// «TypeError: mensaje», sin la pila de llamadas.

export function formatArgs(args) {
  const MAX_DEPTH = 2;
  const MAX_ITEMS = 100;

  const isIdentifier = (key) => /^[A-Za-z_$][\w$]*$/.test(key);

  function quote(str) {
    let q = "'";
    if (str.includes("'")) {
      if (!str.includes('"')) q = '"';
      else if (!str.includes("`") && !str.includes("${")) q = "`";
    }
    const escaped = str
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/\r/g, "\\r")
      .split(q).join("\\" + q);
    return q + escaped + q;
  }

  function fnName(fn) {
    let source = "";
    try { source = Function.prototype.toString.call(fn); } catch { source = ""; }
    if (/^class\b/.test(source)) {
      const parent = Object.getPrototypeOf(fn);
      const ext = parent && parent.name ? ` extends ${parent.name}` : "";
      return fn.name ? `[class ${fn.name}${ext}]` : `[class (anonymous)${ext}]`;
    }
    return fn.name ? `[Function: ${fn.name}]` : "[Function (anonymous)]";
  }

  function errorText(err) {
    const name = err && err.name ? String(err.name) : "Error";
    const message = err && err.message !== undefined ? String(err.message) : "";
    return message ? `${name}: ${message}` : name;
  }

  // `seen`: objetos que se están recorriendo (para detectar referencias circulares).
  function inspect(value, depth, seen) {
    if (value === null) return "null";
    const type = typeof value;
    if (type === "string") return quote(value);
    if (type === "number") return Object.is(value, -0) ? "-0" : String(value);
    if (type === "bigint") return `${value}n`;
    if (type === "undefined" || type === "boolean") return String(value);
    if (type === "symbol") return value.toString();
    if (type === "function") return fnName(value);

    if (seen.includes(value)) {
      seen.circular = true;
      return "[Circular *1]";
    }
    if (value instanceof Error) return errorText(value);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (value instanceof Number) return `[Number: ${inspect(value.valueOf(), depth, seen)}]`;
    if (value instanceof String) return `[String: ${quote(value.valueOf())}]`;
    if (value instanceof Boolean) return `[Boolean: ${value.valueOf()}]`;

    const isArray = Array.isArray(value);
    const isMap = value instanceof Map;
    const isSet = value instanceof Set;
    const proto = Object.getPrototypeOf(value);
    const ctor = proto && Object.prototype.hasOwnProperty.call(proto, "constructor") ? proto.constructor : null;
    const ctorName = ctor && typeof ctor === "function" ? ctor.name : "";

    if (depth > MAX_DEPTH) {
      if (isArray) return "[Array]";
      if (proto === null) return "[Object: null prototype]";
      return `[${ctorName || "Object"}]`;
    }

    seen.push(value);
    const parts = [];
    const child = (v) => inspect(v, depth + 1, seen);
    if (isArray) {
      let holes = 0;
      const flushHoles = () => {
        if (holes) parts.push(`<${holes} empty item${holes > 1 ? "s" : ""}>`);
        holes = 0;
      };
      const shown = Math.min(value.length, MAX_ITEMS);
      for (let i = 0; i < shown; i++) {
        if (!Object.prototype.hasOwnProperty.call(value, i)) { holes++; continue; }
        flushHoles();
        parts.push(child(value[i]));
      }
      flushHoles();
      if (value.length > MAX_ITEMS) {
        const more = value.length - MAX_ITEMS;
        parts.push(`... ${more} more item${more > 1 ? "s" : ""}`);
      }
    } else if (isMap) {
      for (const [k, v] of value) parts.push(`${child(k)} => ${child(v)}`);
    } else if (isSet) {
      for (const v of value) parts.push(child(v));
    }
    if (!isMap && !isSet) {
      for (const key of Object.keys(value)) {
        if (isArray && /^\d+$/.test(key)) continue;
        const desc = Object.getOwnPropertyDescriptor(value, key);
        let shown;
        if (desc && (desc.get || desc.set)) {
          shown = desc.get && desc.set ? "[Getter/Setter]" : desc.get ? "[Getter]" : "[Setter]";
        } else {
          shown = child(value[key]);
        }
        parts.push(`${isIdentifier(key) ? key : quote(key)}: ${shown}`);
      }
    }
    seen.pop();

    let prefix = "";
    if (isMap) prefix = `Map(${value.size}) `;
    else if (isSet) prefix = `Set(${value.size}) `;
    else if (isArray) prefix = ctorName && ctorName !== "Array" ? `${ctorName}(${value.length}) ` : "";
    else if (proto === null) prefix = "[Object: null prototype] ";
    else if (ctorName && ctorName !== "Object") prefix = `${ctorName} `;

    let text;
    if (isArray) text = parts.length ? `[ ${parts.join(", ")} ]` : "[]";
    else text = parts.length ? `{ ${parts.join(", ")} }` : "{}";
    text = prefix + text;
    if (depth === 0 && seen.circular) {
      seen.circular = false;
      text = `<ref *1> ${text}`;
    }
    return text;
  }

  const show = (v) => inspect(v, 0, []);
  const list = Array.from(args);
  const out = [];
  let rest = list;

  // Marcadores de formato del primer argumento: %s, %d, %i, %f, %o, %O, %j, %c y %%.
  if (typeof list[0] === "string" && list.length > 1 && list[0].includes("%")) {
    let next = 1;
    const head = list[0].replace(/%([sdifoOjc%])/g, (match, flag) => {
      if (flag === "%") return "%";
      if (next >= list.length) return match;
      const arg = list[next++];
      switch (flag) {
        case "s":
          if (typeof arg === "string") return arg;
          if (typeof arg === "bigint") return `${arg}n`;
          if (typeof arg === "symbol") return arg.toString();
          if (arg !== null && typeof arg === "object") return show(arg);
          return Object.is(arg, -0) ? "-0" : String(arg);
        case "d":
        case "i": {
          if (typeof arg === "bigint") return `${arg}n`;
          if (typeof arg === "symbol" || (arg !== null && typeof arg === "object")) return "NaN";
          const n = Number(arg);
          return String(flag === "i" ? Math.trunc(n) : n);
        }
        case "f":
          return typeof arg === "symbol" ? "NaN" : String(Number.parseFloat(arg));
        case "j":
          try { return JSON.stringify(arg); } catch { return "[Circular]"; }
        case "c":
          return "";
        default:
          return show(arg);
      }
    });
    out.push(head);
    rest = list.slice(next);
  } else if (list.length) {
    out.push(typeof list[0] === "string" ? list[0] : show(list[0]));
    rest = list.slice(1);
  }
  for (const arg of rest) out.push(typeof arg === "string" ? arg : show(arg));
  return out.join(" ");
}
