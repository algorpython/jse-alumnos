// Tooltips del glosario (términos marcados por js/engine/glossary.js). El CSS (.term en
// css/base.css) los enseña al pasar el ratón o al llegar con Tab; aquí se añade lo que el CSS
// no puede hacer solo:
// - recolocarlos para que no se salgan de la ventana (a los lados o por arriba);
// - cerrarlos con Escape sin mover el foco ni el ratón (WCAG 1.4.13);
// - abrirlos al tocar el término en pantallas táctiles (algunos navegadores no enfocan los
//   botones al pulsarlos).
// Se instala una sola vez para toda la app (los listeners van en el documento).

const MARGIN = 8;

export function installGlossaryTips(doc = document) {
  const open = (term) => {
    term.classList.remove("tip-off");
    placeTip(term);
  };
  doc.addEventListener("mouseover", (e) => {
    const term = e.target.closest?.(".term");
    if (term && !term.contains(e.relatedTarget)) open(term);
  });
  doc.addEventListener("focusin", (e) => {
    const term = e.target.closest?.(".term");
    if (term) open(term);
  });
  doc.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".term-btn");
    if (!btn) return;
    btn.focus();
    open(btn.parentElement);
  });
  doc.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    doc.querySelectorAll(".term:hover, .term:focus-within, .term.tip-on").forEach((term) => {
      term.classList.add("tip-off");
      term.classList.remove("tip-on");
    });
  });
}

// Coloca el tooltip encima del término y lo desplaza si se sale por un lado; si no cabe por
// arriba, lo pone debajo.
export function placeTip(term) {
  const tip = term.querySelector(".term-tip");
  if (!tip) return;
  term.classList.remove("tip-below");
  tip.style.removeProperty("--tip-shift");
  const r = tip.getBoundingClientRect();
  if (!r.width) return; // oculto
  const width = document.documentElement.clientWidth;
  let shift = 0;
  if (r.right > width - MARGIN) shift = width - MARGIN - r.right;
  if (r.left + shift < MARGIN) shift = MARGIN - r.left;
  if (shift) tip.style.setProperty("--tip-shift", `${Math.round(shift)}px`);
  if (r.top < MARGIN) term.classList.add("tip-below");
}

// Solo con ?debug (para screens.ps1): deja abierto el tooltip del primer término.
export function showFirstTip(root) {
  const term = root.querySelector(".term");
  if (!term) return;
  term.classList.add("tip-on");
  placeTip(term);
}
