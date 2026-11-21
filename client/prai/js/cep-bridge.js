/* PR FX port of PR AI.
   PR AI runs inside an <iframe> on PR FX's settings panel (client/index.html,
   #prai-frame) so its CSS, element IDs and key handlers stay isolated from
   PR FX. CEP injects __adobe_cep__ and Node only into the panel's top frame,
   so borrow them from the parent before csinterface.js and main.js run.
   SystemPath is deliberately NOT copied: main.js's extensionRootPath() must
   fall through to location.pathname (this folder, client/prai). */
(function () {
  var parentWindow;
  try {
    parentWindow = window.parent;
    if (!parentWindow || parentWindow === window) {
      return;
    }
    if (!window.__adobe_cep__ && parentWindow.__adobe_cep__) {
      window.__adobe_cep__ = parentWindow.__adobe_cep__;
    }
    if (typeof window.cep_node === "undefined" && typeof parentWindow.cep_node !== "undefined") {
      window.cep_node = parentWindow.cep_node;
    }
    if (typeof window.require === "undefined" && typeof parentWindow.require === "function") {
      window.require = parentWindow.require;
    }
    if (typeof window.cep === "undefined" && typeof parentWindow.cep !== "undefined") {
      window.cep = parentWindow.cep;
    }
  } catch (err) {
    window.__praiBridgeError = String(err && err.message ? err.message : err);
  }
})();
