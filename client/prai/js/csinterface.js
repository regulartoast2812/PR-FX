/* Minimal CSInterface subset for this prototype. */
(function () {
  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
      window.__adobe_cep__.evalScript(script, callback || function () {});
      return;
    }
    if (callback) {
      callback(JSON.stringify({ ok: false, error: "CEP evalScript is unavailable. Open this panel inside Premiere Pro." }));
    }
  };

  window.CSInterface = CSInterface;
})();
