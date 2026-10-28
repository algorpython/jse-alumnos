// Página #/styleguide (solo con ?debug): muestra todos los componentes de css/base.css
// para revisarlos de un vistazo y compararlos con ../maquetas/. No la ven los alumnos.

import { pageHeader } from "./shell.js";

// Bloque de código con números de línea. `lines` ya trae el HTML resaltado (.k, .s, .n…).
export function codeBlock(lines, extraClass = "") {
  const body = lines.map((l) => `<span class="line">${l}</span>`).join("\n");
  return `<pre class="code numbered ${extraClass}"><code>${body}</code></pre>`;
}

const SWATCHES = [
  ["--purple", "#602B7A"], ["--purple-dark", "#43235F"], ["--purple-soft", "#F1E9F6"], ["--lime", "#D4DE00"],
  ["--ground", "#F7F5FB"], ["--ink", "#1E1527"], ["--muted", "#5E5868"], ["--line", "#EAEAF0"],
  ["--green", "#1F7A4D"], ["--red", "#B3261E"], ["--html", "#FFBA48"], ["--css", "#98E0FE"], ["--js", "#AAE86D"],
];

function section(title, body) {
  return `<section class="card sg-section"><h2>${title}</h2>${body}</section>`;
}

export function renderStyleguide(main) {
  const sample = codeBlock([
    `<span class="k">let</span> x = <span class="s">"5"</span>;`,
    `<span class="k">let</span> y = x * <span class="n">2</span> + <span class="s">"1"</span>;`,
    `console.<span class="f">log</span>(y); <span class="c">// 101</span>`,
  ]);

  main.innerHTML = `
    ${pageHeader({ kicker: "Debug only", title: "Styleguide", sub: "Every shared component, taken from the mockups." })}

    ${section("Colours", `
      <div class="sg-swatches">
        ${SWATCHES.map(([name, hex]) => `
          <div class="sg-swatch"><span style="background: var(${name})"></span><code>${name}</code><small class="small">${hex}</small></div>`).join("")}
      </div>`)}

    ${section("Typography", `
      <div class="sg-stack">
        <h1>Heading 1 · Montserrat 26</h1>
        <h2>Heading 2 · Montserrat 17</h2>
        <p>Body text · Inter 15. Strict equality <code>===</code> and loose equality <code>==</code> keep their real characters (no ligatures): <code>!==</code> <code>=&gt;</code> <code>&gt;=</code>.</p>
        <p lang="es">Texto en español: ¿Qué se muestra en la consola? Conversión implícita, año, pequeño.</p>
        <p class="small">Small text · muted colour</p>
        <p class="sub">Subtitle under a page title</p>
      </div>`)}

    <div class="sg-cols">
      ${section("Buttons", `
        <div class="sg-row">
          <button type="button" class="btn primary">Next question</button>
          <button type="button" class="btn lime">▶ View my website</button>
          <button type="button" class="btn ghost">Previous</button>
          <button type="button" class="btn primary" disabled>Disabled</button>
        </div>
        <div class="sg-row">
          <button type="button" class="mini">‹ Step 10</button>
          <button type="button" class="mini">Step 12 ›</button>
          <button type="button" class="mini">Show hint</button>
        </div>`)}

      ${section("Chips", `
        <div class="sg-row">
          <span class="chip">Default</span>
          <span class="chip purple">Predict the output</span>
          <span class="chip green">Correct</span>
          <span class="chip red">Your answer</span>
          <span class="chip lime">New</span>
        </div>
        <div class="sg-row">
          <span class="chip html">HTML</span>
          <span class="chip css">CSS</span>
          <span class="chip js">JavaScript</span>
        </div>`)}
    </div>

    ${section("Cards, stats and progress bars", `
      <div class="grid4">
        <div class="card stat"><span>Questions answered</span><strong>128</strong> <small>/ 300</small></div>
        <div class="card stat"><span>Correct answers</span><strong>76%</strong></div>
        <div class="card stat"><span>Exercises solved</span><strong>9</strong> <small>/ 40</small></div>
        <div class="card stat"><span>To review</span><strong>7</strong> <small>you're improving!</small></div>
      </div>
      <div class="sg-bars">
        <div class="bar-row"><div class="lbl"><span>2 · Variables and data types</span><span>82%</span></div><div class="bar"><i class="ok" style="width: 82%"></i></div></div>
        <div class="bar-row"><div class="lbl"><span>3 · Operators</span><span>64%</span></div><div class="bar"><i style="width: 64%"></i></div></div>
        <div class="bar-row"><div class="lbl"><span>4 · Flow control</span><span>35%</span></div><div class="bar"><i class="bad" style="width: 35%"></i></div></div>
      </div>`)}

    <div class="sg-cols">
      ${section("Question: code block and options", `
        <div class="sg-stack">
          <p style="font-size: 17px; font-weight: 600">What will be printed to the console?</p>
          ${sample}
          <div class="options">
            <button type="button" class="opt" disabled><span class="letter">A</span><code>11</code></button>
            <button type="button" class="opt right" disabled><span class="letter">B</span><code>101</code><span class="chip green">Correct</span></button>
            <button type="button" class="opt wrong" disabled><span class="letter">C</span><code>21</code><span class="chip red">Your answer</span></button>
            <button type="button" class="opt" aria-pressed="true"><span class="letter">D</span><code>NaN</code><span class="small" style="margin-left: auto">Selected</span></button>
            <button type="button" class="opt" aria-pressed="false"><span class="letter box">E</span><span>Choose 2 · square letter for multiple choice</span></button>
          </div>
        </div>`)}

      ${section("Notes", `
        <div class="sg-stack">
          <div class="note green">
            <strong>Explanation</strong><br>
            The <code>*</code> operator converts <code>"5"</code> to a number, so <code>x * 2</code> is <code>10</code>.
            Then <code>+</code> with a string <em>concatenates</em>: <code>10 + "1"</code> → <code>"101"</code>.
          </div>
          <div class="note lime" lang="es">
            <strong>Traducción (ES)</strong><br>
            El operador <code>*</code> convierte <code>"5"</code> en número, así que <code>x * 2</code> vale <code>10</code>.
          </div>
          <div class="note purple"><strong>Exam trap</strong><br><code>typeof null</code> is <code>"object"</code>.</div>
          <div class="card" style="padding: 16px">
            <p class="small" style="margin-bottom: 6px">From your course</p>
            <p style="font-size: 14px"><code>03_Casting</code> → implicit type conversion</p>
          </div>
        </div>`)}
    </div>

    ${section("Project workspace", `
      <div class="sg-project">
        <div class="sg-stack" style="gap: 2px">
          <div class="seg" role="group" aria-label="Panel"><button type="button" aria-pressed="true">Steps</button><button type="button" aria-pressed="false">Project brief</button></div>
          <div class="small" style="font-weight: 600; margin-top: 8px">Step 11 of 14</div>
          <div class="bar" style="margin: 6px 0 2px"><i style="width: 71%"></i></div>
          <div class="phase"><span class="chip css">2 · CSS</span><span class="small">5 / 5 · style.css</span></div>
          <button type="button" class="step done"><span class="dot">✓</span>Hover overlay with transition<span class="chev" aria-hidden="true">›</span></button>
          <div class="phase"><span class="chip js">3 · JavaScript</span><span class="small">1 / 4 · script.js</span></div>
          <button type="button" class="step" aria-current="step"><span class="dot">11</span>Listen to clicks on the buttons<span class="chev" aria-hidden="true">▾</span></button>
          <button type="button" class="step"><span class="dot">12</span>Show / hide photos by category<span class="chev" aria-hidden="true">›</span></button>
        </div>
        <div class="sg-stack">
          <div>
            <div class="label">What to do</div>
            <p style="font-size: 14.5px">Make every filter button react to a click.</p>
          </div>
          <div>
            <div class="label">Must contain</div>
            <div class="must"><span class="box ok" aria-hidden="true">✓</span><span><code>addEventListener("click", …)</code> on each button</span><span class="chip green">Pass</span></div>
            <div class="must"><span class="box" aria-hidden="true"></span><span><code>console.log(btn.dataset.filter)</code> inside the listener</span><span class="chip">Pending</span></div>
          </div>
          <div>
            <div class="tabs" role="tablist" aria-label="Files">
              <button type="button" role="tab" aria-selected="false">index.html</button>
              <button type="button" role="tab" aria-selected="false">style.css</button>
              <button type="button" role="tab" aria-selected="true">script.js <em class="here">work here</em></button>
            </div>
            ${codeBlock([
              `buttons.<span class="f">forEach</span>((btn) <span class="k">=&gt;</span> {`,
              `  btn.<span class="f">addEventListener</span>(<span class="s">"click"</span>, () <span class="k">=&gt;</span> {`,
              `    console.<span class="f">log</span>(btn.dataset.filter);`,
              `  });`,
              `});`,
            ], "sg-editor")}
          </div>
        </div>
        <div class="sg-stack">
          <div class="browser"><div class="bar-top" aria-hidden="true"><i></i><i></i><i></i></div><div style="padding: 12px"><b style="font: 800 15px var(--head)">My Gallery</b></div></div>
          <div class="console"><span class="console-title">Console</span><br>&gt; nature<br><span class="err">TypeError: btn is undefined</span></div>
        </div>
      </div>`)}
  `;

  // Las opciones de muestra se pueden pulsar para ver el estado seleccionado.
  main.querySelectorAll(".opt[aria-pressed]").forEach((opt) => {
    opt.addEventListener("click", () => opt.setAttribute("aria-pressed", String(opt.getAttribute("aria-pressed") !== "true")));
  });
}
