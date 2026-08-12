/* Lightweight CEP bridge: enough for this extension without an external dependency. */
(function (global) {
  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    if (!global.__adobe_cep__) {
      if (callback) callback('ERROR: This panel must run inside Adobe Premiere Pro.');
      return;
    }
    global.__adobe_cep__.evalScript(script, callback || function () {});
  };

  CSInterface.prototype.registerKeyEventsInterest = function (interest) {
    if (global.__adobe_cep__ && global.__adobe_cep__.registerKeyEventsInterest) {
      global.__adobe_cep__.registerKeyEventsInterest(interest);
    }
  };

  global.CSInterface = CSInterface;
}(window));
