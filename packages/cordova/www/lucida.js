"use strict";
// Cordova JS bridge (cordova.plugins.lucida). Every method is a promise over cordova.exec("Lucida", action, args);
// the native side (src/android, src/ios) delegates to the Lucida Android and iOS SDKs.
var SERVICE = "Lucida";

function exec(action, args) {
  return new Promise(function (resolve, reject) {
    var cordova = globalThis.cordova;
    if (!cordova || typeof cordova.exec !== "function") return reject(new Error("lucida: cordova.exec is unavailable (call after deviceready)"));
    cordova.exec(resolve, function (e) { reject(e instanceof Error ? e : new Error(String(e))); }, SERVICE, action, args || []);
  });
}

// Booleans may arrive as 1/0 from native; the typed API promises booleans.

// Keys prefixed $lc_ are reserved for the gateway and never sent by a client.
function stripReserved(props) {
  var out = {};
  if (props && typeof props === "object") {
    Object.keys(props).forEach(function (k) { if (k.indexOf("$lc_") !== 0) out[k] = props[k]; });
  }
  return out;
}

function str(name, v) {
  if (typeof v !== "string" || v === "") throw new Error("lucida: " + name + " must be a non-empty string");
  return v;
}

// Wraps a sync validator so a bad argument rejects instead of throwing.
function run(fn) {
  try { return fn(); } catch (e) { return Promise.reject(e); }
}

var lucida = {
  stripReserved: stripReserved,

  /**
   * init(apiKey, { apiHost, consent: { mode: "opt_in"|"opt_out", queueBeforeConsent }, flushAt, flushIntervalMs,
   *   maxQueueSize, debug, replay: { enabled, maskAllText, maskAllTextInputs, maskAllImages, sampleRate, ... } })
   */
  init: function (apiKey, options) {
    return run(function () {
      var o = Object.assign({}, options || {});
      if (o.consent && o.consent.mode && o.consent.mode !== "opt_in" && o.consent.mode !== "opt_out") throw new Error("lucida: consent.mode must be opt_in or opt_out");
      return exec("setup", [str("apiKey", apiKey), o]);
    });
  },
  capture: function (event, props) { return run(function () { return exec("capture", [str("event", event), stripReserved(props)]); }); },
  screen: function (name, props) { return run(function () { return exec("screen", [str("name", name), stripReserved(props)]); }); },
  identify: function (id, set, setOnce) { return run(function () { return exec("identify", [str("id", id), stripReserved(set), stripReserved(setOnce)]); }); },
  alias: function (alias) { return run(function () { return exec("alias", [str("alias", alias)]); }); },
  group: function (type, key, props) { return run(function () { return exec("group", [str("type", type), str("key", key), stripReserved(props)]); }); },
  register: function (props) { return exec("register", [stripReserved(props)]); },
  registerOnce: function (props) { return exec("registerOnce", [stripReserved(props)]); },
  unregister: function (key) { return run(function () { return exec("unregister", [str("key", key)]); }); },
  reset: function () { return exec("reset"); },
  getDistinctId: function () { return exec("getDistinctId"); },
  getAnonymousId: function () { return exec("getAnonymousId"); },

  optIn: function () { return exec("optIn"); },
  optOut: function () { return exec("optOut"); },
  /** setConsent({ analytics, replay, marketing }): omitted categories are unchanged. */
  setConsent: function (update) { return exec("setConsent", [Object.assign({}, update || {})]); },
  isOptedOut: function () { return exec("isOptedOut").then(Boolean); },

  getFlag: function (key) { return run(function () { return exec("getFlag", [str("key", key)]); }); },
  isFeatureEnabled: function (key) { return run(function () { return exec("isFeatureEnabled", [str("key", key)]).then(Boolean); }); },
  getFlagPayload: function (key) { return run(function () { return exec("getFlagPayload", [str("key", key)]); }); },
  reloadFlags: function () { return exec("reloadFlags"); },
  /** Calls cb(flags) on every flag refresh. Resolves once the native listener is registered; it lives for the app session. */
  onFlags: function (cb) {
    if (typeof cb !== "function") return Promise.reject(new Error("lucida: onFlags needs a function"));
    var cordova = globalThis.cordova;
    if (!cordova || typeof cordova.exec !== "function") return Promise.reject(new Error("lucida: cordova.exec is unavailable"));
    return new Promise(function (resolve, reject) {
      cordova.exec(function (flags) { if (flags) cb(flags); }, reject, SERVICE, "onFlags", []);
      resolve();
    });
  },

  startReplay: function () { return exec("startReplay"); },
  stopReplay: function () { return exec("stopReplay"); },
  pauseReplay: function () { return exec("pauseReplay"); },
  resumeReplay: function () { return exec("resumeReplay"); },
  isReplayActive: function () { return exec("isReplayActive").then(Boolean); },

  flush: function () { return exec("flush"); },
};

module.exports = lucida;
