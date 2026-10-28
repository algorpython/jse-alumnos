// Router por hash: `#/practice/2` → ruta "/practice/:section" con params { section: "2" }.
// Las funciones puras (parseHash, matchRoute) no tocan el DOM y se prueban con node --test;
// startRouter conecta el router con `hashchange`.

// "#/practice/2?x=1" → { path: "/practice/2", query: URLSearchParams("x=1") }
export function parseHash(hash = "") {
  let rest = String(hash).replace(/^#/, "");
  const q = rest.indexOf("?");
  const query = new URLSearchParams(q === -1 ? "" : rest.slice(q + 1));
  if (q !== -1) rest = rest.slice(0, q);
  const segments = rest.split("/").filter(Boolean).map(safeDecode);
  return { path: "/" + segments.join("/"), segments, query };
}

function safeDecode(part) {
  try { return decodeURIComponent(part); } catch { return part; }
}

// Busca la primera ruta cuyo patrón encaja. Los segmentos ":nombre" son parámetros.
// Devuelve { route, params } o null.
export function matchRoute(routes, path) {
  const segments = path.split("/").filter(Boolean);
  for (const route of routes) {
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params = {};
    const ok = pattern.every((p, i) => {
      if (p.startsWith(":")) { params[p.slice(1)] = segments[i]; return true; }
      return p === segments[i];
    });
    if (ok) return { route, params };
  }
  return null;
}

// Construye un hash a partir de un patrón: href("/practice/:section", { section: 2 }) → "#/practice/2"
export function href(pattern, params = {}) {
  return "#" + pattern.replace(/:(\w+)/g, (_, name) => encodeURIComponent(params[name] ?? ""));
}

// Escucha los cambios de hash y llama a `onRoute({ route, params, query, path })`.
// Si ninguna ruta encaja, `route` es `notFound`. Devuelve { refresh, stop }: refresh vuelve a
// pintar la ruta actual y stop deja de escuchar.
export function startRouter({ routes, notFound, onRoute, win = window }) {
  const handle = () => {
    const { path, query } = parseHash(win.location.hash || "#/");
    const match = matchRoute(routes, path);
    onRoute({ route: match ? match.route : notFound, params: match ? match.params : {}, query, path });
  };
  win.addEventListener("hashchange", handle);
  handle();
  return { refresh: handle, stop: () => win.removeEventListener("hashchange", handle) };
}
