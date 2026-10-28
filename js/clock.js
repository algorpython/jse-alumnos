// Reloj de la app. Las vistas lo usan en lugar de `new Date()` para que se pueda fijar:
// - en los tests, la lógica (js/srs.js, js/store.js…) recibe el reloj como parámetro;
// - en ?debug, `?today=AAAA-MM-DD` fija el día (lo usan smoke.ps1 y screens.ps1 para que las
//   capturas del repaso espaciado no cambien según el día en que se hagan).

let current = () => new Date();

export function now() {
  return current();
}

export function setClock(fn) {
  current = fn;
}

// Reloj fijo a mediodía (hora local) del día "AAAA-MM-DD". null si el texto no es una fecha.
export function fixedDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return null;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  return Number.isNaN(date.getTime()) ? null : () => new Date(date);
}
