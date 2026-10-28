// Textos de la interfaz en inglés y español (data/ui/en.json y data/ui/es.json).
// - Los dos diccionarios se cargan al arrancar, así el botón EN/ES cambia el idioma al
//   momento, sin recargar la página ni volver a pedir nada al servidor.
// - Las claves van por puntos ("nav.practice"). Si falta una clave en el idioma actual se usa
//   el inglés, y si tampoco existe se muestra la clave entre ⟦ ⟧ y se avisa con `onMissing`
//   (app.js lo convierte en error en modo ?debug, así smoke.ps1 lo detecta).
// - Los textos de data/ui son nuestros y de confianza: pueden llevar HTML sencillo (<b>, <a>).
//   Las variables {nombre} que se sustituyen dentro sí se escapan.
// La parte pura (createI18n, format, flatten…) no toca el DOM: se prueba con `node --test`.

export const LANGS = ["en", "es"];
export const DEFAULT_LANG = "en";

// Devuelve el primer idioma válido de la lista, o el idioma por defecto.
export function pickLang(...candidates) {
  return candidates.find((l) => LANGS.includes(l)) || DEFAULT_LANG;
}

// Aplana un objeto de textos: { nav: { home: … } } → Map con la clave nav.home
export function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Sustituye {nombre} por vars.nombre (escapado). Las variables que no vienen se dejan tal cual.
export function format(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? escapeHtml(vars[name]) : all));
}

// Nombres de las variables {nombre} de un texto (para comprobar que EN y ES usan las mismas).
export function placeholders(template) {
  return [...String(template).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

// Crea el traductor. `dicts` = { en: objeto o Map, es: … }.
export function createI18n({ dicts, lang = DEFAULT_LANG, onMissing = () => {} }) {
  const flat = {};
  for (const l of LANGS) flat[l] = dicts[l] instanceof Map ? dicts[l] : flatten(dicts[l]);
  let current = pickLang(lang);
  const listeners = new Set();

  return {
    get lang() { return current; },

    has(key) { return flat[DEFAULT_LANG].has(key); },

    t(key, vars) {
      let text = flat[current].get(key);
      if (typeof text !== "string") {
        onMissing(key, current);
        text = flat[DEFAULT_LANG].get(key);
        if (typeof text !== "string") return `⟦${escapeHtml(key)}⟧`;
      }
      return vars ? format(text, vars) : text;
    },

    // Cambia el idioma y avisa a los suscriptores. Devuelve false si no cambia nada.
    setLang(lang) {
      if (!LANGS.includes(lang) || lang === current) return false;
      current = lang;
      listeners.forEach((fn) => fn(current));
      return true;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// Descarga los diccionarios de todos los idiomas. Si falla alguno que no sea el inglés,
// se sigue con el inglés (la app funciona igual, solo que sin traducción). Se piden todos a la
// vez (8.2), sin esperar al inglés para pedir el español.
export async function loadDicts({ base = "data/ui/", fetchFn = globalThis.fetch } = {}) {
  const get = async (lang) => {
    const res = await fetchFn(`${base}${lang}.json`);
    if (!res.ok) throw new Error(`Could not load ${base}${lang}.json (${res.status})`);
    return res.json();
  };
  const others = LANGS.filter((l) => l !== DEFAULT_LANG);
  const pending = others.map((lang) => get(lang).catch((err) => {
    console.error(err);
    return {};
  }));
  const dicts = { [DEFAULT_LANG]: await get(DEFAULT_LANG) };
  const loaded = await Promise.all(pending);
  others.forEach((lang, i) => { dicts[lang] = loaded[i]; });
  return dicts;
}

// Traductor activo de la app (lo crea app.js al arrancar). Las vistas usan t() y getLang().
let active = createI18n({ dicts: { en: {}, es: {} } });

// Devuelve el anterior (los tests lo restauran al terminar).
export function setActiveI18n(instance) {
  const previous = active;
  active = instance;
  return previous;
}

export function t(key, vars) {
  return active.t(key, vars);
}

export function getLang() {
  return active.lang;
}
