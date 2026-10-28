// «Run this code»: ejecuta un fragmento de JavaScript aislado de la app y devuelve lo que
// muestra la consola y los errores.
//
// Cómo se aísla:
// 1. Un <iframe sandbox="allow-scripts"> (sin allow-same-origin): origen opaco, sin acceso al
//    progreso guardado (localStorage), a las cookies ni al DOM de la app. Su CSP bloquea la red.
// 2. Dentro del iframe, un Web Worker ejecuta el código con importScripts (como un <script>
//    normal: mismas reglas de let/const, hoisting y errores, y con números de línea).
//    El iframe para el worker si tarda más de `timeout` ms: un bucle infinito no cuelga la app,
//    porque el worker va en otro hilo.
// 3. Si el iframe no contesta (navegador sin workers…), la app lo quita igualmente al pasar
//    `timeout` + WATCHDOG ms.
// Se crea un iframe nuevo en cada ejecución, así cada vez se empieza desde cero.
//
// Ejercicios de código (tarea 2.1): con `tests`, el worker ejecuta además los tests del ejercicio
// cuando el código termina (ver runTests más abajo) y devuelve el resultado de cada uno.
//
// formatArgs, describeError, toPlain, jsonEqual, showValue, workerMain y frameMain se copian como
// texto (toString) al iframe y al worker: no pueden usar nada de fuera de su propio cuerpo.

import { formatArgs } from "./console-format.js";
import { GAP } from "./format.js";

export const RUN_TIMEOUT = 2000;
export const MAX_LINES = 500;
export const MAX_LINE_LENGTH = 5000;
const WATCHDOG = 3000;

// Código que se ejecuta para una pregunta. En «Fill the gap», el hueco se rellena con la
// respuesta correcta (así el alumno ve la salida que se pedía). Sin código: null.
export function snippetFor(question) {
  if (!question?.code) return null;
  if (question.type !== "gap") return question.code;
  const answer = question.options.find((o) => o.id === question.answer[0]);
  const fill = answer?.text?.en ?? "";
  return question.code.split(GAP).join(fill);
}

// Nombre, mensaje y línea de un error lanzado por el fragmento. `url`: dirección (blob:) con
// la que se ha cargado el fragmento; la línea sale de la pila de llamadas (Chrome, Edge, Firefox
// y Safari ponen «url:línea:columna»). Si se lanza algo que no es un Error (throw "x"), name es null.
export function describeError(err, url) {
  const isError = err !== null && typeof err === "object" &&
    typeof err.name === "string" && typeof err.message === "string";
  if (!isError) return { name: null, message: formatArgs([err]), line: null };
  const message = err.message.replace(/^Failed to execute 'importScripts' on 'WorkerGlobalScope':\s*/, "");
  let line = null;
  const stack = typeof err.stack === "string" ? err.stack : "";
  if (url) {
    const at = stack.indexOf(url + ":");
    if (at >= 0) {
      const m = /^:(\d+):\d+/.exec(stack.slice(at + url.length));
      if (m) line = Number(m[1]);
    }
    if (line === null && err.fileName === url && Number.isInteger(err.lineNumber)) line = err.lineNumber;
  }
  return { name: err.name, message, line };
}

// ---------------------------------------------------------------------------
// Comparación de valores de los tests de los ejercicios. Hacen lo mismo que tools/check-content.mjs
// (toPlain + util.isDeepStrictEqual + formatValue): un ejercicio que pasa allí pasa aquí.
// ---------------------------------------------------------------------------

// Valor devuelto convertido en JSON (los objetos y listas pasan por JSON.stringify/parse).
// Si no se puede (referencias circulares, BigInt), se queda como está.
export function toPlain(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return value;
  }
}

// ¿`value` es igual a `expected` (un valor JSON)? Comparación estricta y profunda, como
// util.isDeepStrictEqual: 1 no es "1", NaN es igual a NaN y 0 no es igual a -0.
export function jsonEqual(value, expected) {
  if (expected === null || typeof expected !== "object") return Object.is(value, expected);
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.length !== expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (!(i in value) || !jsonEqual(value[i], expected[i])) return false;
    }
    return Object.keys(value).length === expected.length;
  }
  if (Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(expected);
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(value, k) && jsonEqual(value[k], expected[k]));
}

// Valor como en la consola, con los strings entre comillas dobles ("Hello", 5, [ 1, 2 ], undefined).
export function showValue(value) {
  return typeof value === "string" ? JSON.stringify(value) : formatArgs([value]);
}

// Se ejecuta dentro del worker (formatArgs, describeError, toPlain, jsonEqual y showValue están
// definidas antes).
function workerMain() {
  const post = (msg) => self.postMessage(msg);
  const real = {
    setTimeout: self.setTimeout.bind(self),
    clearTimeout: self.clearTimeout.bind(self),
    setInterval: self.setInterval.bind(self),
  };
  const pending = new Set();
  let limits = { maxLines: 500, maxLength: 5000 };
  let count = 0;
  let url = "";
  let finished = false;
  let idleTimer = null;
  // Para los tests de los ejercicios: lo que escribe la consola (sin los avisos de alert/prompt)
  // y el primer error no capturado. Mientras se evalúan los tests, la consola no escribe nada.
  let tests = null;
  let confirmAnswer = false;
  let inputs = [];
  const printed = [];
  let firstError = null;
  let muted = false;

  function emit(msg) {
    if (finished || muted) return;
    if (count >= limits.maxLines) {
      if (count === limits.maxLines) post({ type: "truncated" });
      count = limits.maxLines + 1;
      return;
    }
    count++;
    if (typeof msg.text === "string" && msg.text.length > limits.maxLength) {
      msg.text = msg.text.slice(0, limits.maxLength) + " …";
    }
    post(msg);
  }

  function uncaught(err, promise) {
    const info = describeError(err, url);
    if (!firstError) firstError = { name: info.name, message: info.message, line: info.line };
    emit({ type: "line", kind: "error", text: info.message, error: { name: info.name, line: info.line, promise: Boolean(promise) } });
  }

  function guard(fn, args) {
    try {
      fn(...args);
    } catch (err) {
      uncaught(err);
    }
  }

  // Termina cuando no queda nada pendiente (temporizadores) y se han resuelto las promesas.
  function checkIdle() {
    if (finished || pending.size) return;
    real.clearTimeout(idleTimer);
    idleTimer = real.setTimeout(() => {
      if (finished || pending.size) return;
      if (tests) runTests();
      post({ type: "done" });
      finished = true;
    }, 30);
  }

  // Tests del ejercicio, cuando el código ya ha terminado (también sus temporizadores), igual que
  // tools/check-content.mjs: si el código ha lanzado un error, no pasa ningún test.
  // - { call, expected }: se evalúa `call` en el ámbito global (ve las funciones y variables del
  //   alumno) y se compara su valor con `expected`.
  // - { output }: la salida de la consola tiene que ser exactamente esa.
  // Cada resultado se envía en cuanto se tiene: si un test se queda en un bucle infinito, los
  // anteriores ya han llegado y el iframe para el worker por tiempo límite.
  function runTests() {
    muted = true;
    tests.forEach((test, index) => {
      const result = { type: "test", index, pass: false, got: null, error: null, blocked: false };
      if (firstError) {
        result.error = firstError;
        result.blocked = true; // el error es del código, no de este test
      } else if (typeof test.output === "string") {
        result.got = printed.join("\n");
        result.pass = result.got === test.output;
      } else {
        try {
          const value = (0, eval)(String(test.call));
          result.got = showValue(value);
          result.pass = jsonEqual(toPlain(value), test.expected);
        } catch (err) {
          const info = describeError(err, "");
          result.error = { name: info.name, message: info.message, line: null };
        }
      }
      post(result);
    });
  }

  const log = (kind) => function () {
    const text = formatArgs(arguments);
    if (!finished && !muted) printed.push(text);
    emit({ type: "line", kind, text });
  };
  const fakeConsole = {
    log: log("log"), info: log("log"), debug: log("log"), table: log("log"), dir: log("log"),
    warn: log("warn"), error: log("error"),
  };
  Object.defineProperty(self, "console", { value: fakeConsole, writable: true, configurable: true });

  // alert, confirm y prompt no pueden abrir ventanas aquí: se apuntan en la consola y responden
  // solos, como tools/check-content.mjs al comprobar las respuestas:
  // - confirm devuelve confirmAnswer (true = «Aceptar»);
  // - prompt devuelve, en orden, los textos de `inputs` (lo que «escribe» el usuario del enunciado,
  //   verify.inputs de la pregunta) y, cuando se acaban, null («Cancelar»).
  const text = (v) => (v === undefined ? "" : String(v));
  self.alert = (msg) => { emit({ type: "line", kind: "dialog", text: `[alert] ${text(msg)}` }); };
  self.confirm = (msg) => { emit({ type: "line", kind: "dialog", text: `[confirm] ${text(msg)} → ${confirmAnswer}` }); return confirmAnswer; };
  self.prompt = (msg) => {
    const answer = inputs.length ? String(inputs.shift()) : null;
    emit({ type: "line", kind: "dialog", text: `[prompt] ${text(msg)} → ${answer === null ? "null" : JSON.stringify(answer)}` });
    return answer;
  };

  self.setTimeout = function (fn, ms, ...args) {
    const cb = typeof fn === "function" ? fn : () => {};
    const id = real.setTimeout(() => {
      pending.delete(id);
      guard(cb, args);
      checkIdle();
    }, ms);
    pending.add(id);
    return id;
  };
  self.setInterval = function (fn, ms, ...args) {
    const cb = typeof fn === "function" ? fn : () => {};
    const id = real.setInterval(() => {
      guard(cb, args);
      checkIdle();
    }, ms);
    pending.add(id);
    return id;
  };
  self.clearTimeout = self.clearInterval = function (id) {
    pending.delete(id);
    real.clearTimeout(id);
    checkIdle();
  };

  self.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();
    uncaught(event.reason, true);
    checkIdle();
  });
  self.addEventListener("error", (event) => {
    event.preventDefault();
    uncaught(event.error !== undefined ? event.error : event.message);
    checkIdle();
  });

  self.onmessage = (event) => {
    self.onmessage = null;
    const data = event.data || {};
    limits = { maxLines: data.maxLines, maxLength: data.maxLength };
    tests = Array.isArray(data.tests) ? data.tests : null;
    confirmAnswer = data.confirmAnswer === true;
    inputs = Array.isArray(data.inputs) ? data.inputs.slice() : [];
    url = URL.createObjectURL(new Blob([String(data.code)], { type: "text/javascript" }));
    try {
      importScripts(url);
    } catch (err) {
      uncaught(err);
    }
    checkIdle();
  };
}

// Se ejecuta dentro del iframe: crea el worker, le pasa el código y reenvía sus mensajes a la
// app. Si el worker no termina a tiempo, lo para.
function frameMain(workerSource) {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data || {};
    let worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
    } catch (err) {
      window.parent.postMessage({ type: "unsupported" }, "*");
      return;
    }
    let ended = false;
    const end = (msg) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      worker.terminate();
      window.parent.postMessage(msg, "*");
    };
    const timer = setTimeout(() => end({ type: "timeout" }), data.timeout);
    // Chrome y Edge no dan la línea de un SyntaxError lanzado por importScripts. Se pide a un
    // segundo worker que cargue solo el fragmento: no llega a ejecutar nada (no se puede
    // analizar) y su evento «error» sí trae la línea. Los mensajes esperan en cola mientras tanto.
    const syntaxLine = (code) => new Promise((resolve) => {
      let probe;
      try {
        probe = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      } catch (err) {
        resolve(null);
        return;
      }
      const stop = (line) => { clearTimeout(probeTimer); probe.terminate(); resolve(line); };
      const probeTimer = setTimeout(() => stop(null), 1000);
      probe.onerror = (e) => { e.preventDefault(); stop(e.lineno || null); };
    });
    let queue = Promise.resolve();
    let syntaxPromise = null;
    worker.onmessage = (m) => {
      const msg = m.data || {};
      queue = queue.then(async () => {
        if ((msg.type === "line" || msg.type === "test") && msg.error && msg.error.name === "SyntaxError" && msg.error.line === null) {
          syntaxPromise = syntaxPromise || syntaxLine(String(data.code));
          msg.error.line = await syntaxPromise;
        }
        if (msg.type === "done") end(msg);
        else if (!ended) window.parent.postMessage(msg, "*");
      });
    };
    // Error del propio worker (no del fragmento, que se recoge dentro): no se ha podido ejecutar.
    worker.onerror = (e) => {
      e.preventDefault();
      end({ type: "unsupported" });
    };
    worker.postMessage({ code: data.code, maxLines: data.maxLines, maxLength: data.maxLength, tests: data.tests, confirmAnswer: data.confirmAnswer, inputs: data.inputs });
  });
  window.parent.postMessage({ type: "ready" }, "*");
}

// Página del iframe (srcdoc). La CSP bloquea la red y solo permite el script de la página y los blob:.
export function sandboxHtml() {
  const workerSource = [
    `const formatArgs = ${formatArgs.toString()};`,
    `const describeError = ${describeError.toString()};`,
    `const toPlain = ${toPlain.toString()};`,
    `const jsonEqual = ${jsonEqual.toString()};`,
    `const showValue = ${showValue.toString()};`,
    `(${workerMain.toString()})();`,
  ].join("\n");
  // < evita que un «</script>» dentro del código cierre la etiqueta antes de tiempo.
  const arg = JSON.stringify(workerSource).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:">` +
    `</head><body><script>(${frameMain.toString()})(${arg});</script></body></html>`;
}

// Ejecuta `code`. Devuelve una promesa con:
// { lines: [{ kind: "log"|"warn"|"error"|"dialog", text, error? }], timedOut, truncated, unsupported }
// `error` (solo en los errores no capturados): { name, line, promise }.
// `tests` (tests de un ejercicio, opcional): se ejecutan cuando termina el código y
// `result.tests[i]` es { pass, got, error, blocked } (error: { name, message, line } o null;
// blocked: el error es del código y no se ha evaluado el test). Si el tiempo límite corta la
// ejecución, los tests que no han llegado a ejecutarse se quedan en null.
// `confirmAnswer`: lo que devuelve confirm() (false = «Cancelar»; «Run this code» y los ejercicios
// pasan true, «Aceptar», como tools/check-content.mjs).
// `inputs`: lo que devuelve prompt() en cada llamada, en orden (después, null = «Cancelar»).
export function runSnippet(code, { timeout = RUN_TIMEOUT, container = document.body, tests = null, confirmAnswer = false, inputs = [] } = {}) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.className = "runner-frame";
    frame.hidden = true;
    const result = { lines: [], timedOut: false, truncated: false, unsupported: false };
    if (tests) result.tests = tests.map(() => null);
    let watchdog = null;
    let ready = false;

    const finish = (extra = {}) => {
      clearTimeout(watchdog);
      window.removeEventListener("message", onMessage);
      frame.remove();
      resolve({ ...result, ...extra });
    };
    function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      const msg = event.data || {};
      if (msg.type === "ready") {
        ready = true;
        const testList = tests ? JSON.parse(JSON.stringify(tests)) : null;
        frame.contentWindow.postMessage({ code: String(code), timeout, maxLines: MAX_LINES, maxLength: MAX_LINE_LENGTH, tests: testList, confirmAnswer, inputs: (Array.isArray(inputs) ? inputs : []).map(String) }, "*");
      } else if (msg.type === "test") {
        if (result.tests && Number.isInteger(msg.index) && msg.index >= 0 && msg.index < result.tests.length) {
          const err = msg.error;
          result.tests[msg.index] = {
            pass: msg.pass === true,
            blocked: msg.blocked === true,
            got: typeof msg.got === "string" ? msg.got : null,
            error: err ? { name: err.name ?? null, message: String(err.message ?? ""), line: err.line ?? null } : null,
          };
        }
      } else if (msg.type === "line") {
        result.lines.push({ kind: msg.kind, text: String(msg.text), ...(msg.error ? { error: msg.error } : {}) });
      } else if (msg.type === "truncated") {
        result.truncated = true;
      } else if (msg.type === "done") {
        finish();
      } else if (msg.type === "timeout") {
        finish({ timedOut: true });
      } else if (msg.type === "unsupported") {
        finish({ unsupported: true });
      }
    }

    window.addEventListener("message", onMessage);
    // Si el iframe ni siquiera ha arrancado, el navegador no puede ejecutar el código aquí.
    watchdog = setTimeout(() => finish(ready ? { timedOut: true } : { unsupported: true }), timeout + WATCHDOG);
    frame.srcdoc = sandboxHtml();
    container.appendChild(frame);
  });
}
