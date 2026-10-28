// Modo ?debug: recoge los errores de la página en <pre id="__errors">.
// tools/smoke.ps1 vuelca el DOM con Edge headless y falla si encuentra ese elemento.
// Es un script clásico (no módulo) y se carga el primero en <head> para
// capturar también los errores de carga y de sintaxis de los módulos.
(function () {
  if (!/[?&]debug\b/.test(location.search)) return;

  var pending = [];

  function report(message) {
    var box = document.getElementById("__errors");
    if (!box) {
      if (!document.body) { pending.push(message); return; }
      box = document.createElement("pre");
      box.id = "__errors";
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;left:0;right:0;bottom:0;margin:0;max-height:40vh;overflow:auto;" +
        "padding:12px 16px;background:#5c0b1f;color:#fff;font:13px/1.4 Consolas,monospace;z-index:99999;white-space:pre-wrap";
      document.body.appendChild(box);
    }
    box.textContent += message + "\n";
  }

  // Fase de captura: recibe tanto errores de JS como fallos al cargar scripts o CSS.
  window.addEventListener("error", function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      report("[load] " + (target.src || target.href));
    } else {
      var where = event.filename ? " (" + event.filename + ":" + event.lineno + ")" : "";
      report("[error] " + event.message + where);
    }
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    report("[promise] " + (reason && reason.stack ? reason.stack : String(reason)));
  });

  document.addEventListener("DOMContentLoaded", function () {
    var queued = pending;
    pending = [];
    queued.forEach(report);
  });
})();
