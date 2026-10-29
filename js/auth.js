// Google sign-in with the TV code flow: the TV shows a short code, you enter
// it at google.com/device on your phone, and the TV gets a token it can
// refresh. Read-only YouTube access. Tokens stay on the TV.
(function () {
  "use strict";

  var YTV = window.YTV;
  var DEVICE_URL = "https://oauth2.googleapis.com/device/code";
  var TOKEN_URL = "https://oauth2.googleapis.com/token";
  var REVOKE_URL = "https://oauth2.googleapis.com/revoke";
  var SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

  function post(url, params) {
    var body = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
      .then(function (res) { return res.json().then(function (j) { j._status = res.status; return j; }); });
  }

  function saveTokens(t) {
    var s = YTV.store.get("auth", {});
    s.access = t.access_token;
    s.expires = Date.now() + (t.expires_in - 60) * 1000;
    if (t.refresh_token) s.refresh = t.refresh_token;
    YTV.store.set("auth", s);
  }

  var refreshing = null;

  YTV.auth = {
    signedIn: function () { return YTV.MOCK ? !!YTV.store.get("mockAuth", false) : !!YTV.store.get("auth", {}).refresh; },
    configured: function () { return YTV.MOCK || !!(YTV.config.clientId && YTV.config.clientSecret); },

    // Starts sign-in. onCode({code, url}) shows the code; resolves when done.
    signIn: function (onCode, isCancelled) {
      if (YTV.MOCK) {
        onCode({ code: "MOCK-CODE", url: "google.com/device" });
        return new Promise(function (r) { setTimeout(r, 4000); }).then(function () { YTV.store.set("mockAuth", true); });
      }
      var cfg = YTV.config;
      return post(DEVICE_URL, { client_id: cfg.clientId, scope: SCOPE }).then(function (d) {
        if (!d.device_code) throw new Error(d.error_description || d.error || "Couldn't start sign-in");
        onCode({ code: d.user_code, url: (d.verification_url || "https://www.google.com/device").replace(/^https?:\/\/(www\.)?/, "") });
        var interval = (d.interval || 5) * 1000;
        var deadline = Date.now() + d.expires_in * 1000;
        function poll() {
          if (isCancelled()) return Promise.reject(new Error("cancelled"));
          if (Date.now() > deadline) return Promise.reject(new Error("The code expired. Try again."));
          return new Promise(function (r) { setTimeout(r, interval); }).then(function () {
            if (isCancelled()) throw new Error("cancelled");
            return post(TOKEN_URL, {
              client_id: cfg.clientId, client_secret: cfg.clientSecret, device_code: d.device_code,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code"
            });
          }).then(function (t) {
            if (t.access_token) { saveTokens(t); return; }
            if (t.error === "authorization_pending") return poll();
            if (t.error === "slow_down") { interval += 5000; return poll(); }
            if (t.error === "access_denied") throw new Error("Sign-in was declined.");
            throw new Error(t.error_description || t.error || "Sign-in failed");
          });
        }
        return poll();
      });
    },

    // A valid access token, refreshing it if needed.
    token: function () {
      var s = YTV.store.get("auth", {});
      if (!s.refresh) return Promise.reject(new Error("Not signed in"));
      if (s.access && Date.now() < s.expires) return Promise.resolve(s.access);
      if (!refreshing) {
        refreshing = post(TOKEN_URL, {
          client_id: YTV.config.clientId, client_secret: YTV.config.clientSecret,
          refresh_token: s.refresh, grant_type: "refresh_token"
        }).then(function (t) {
          refreshing = null;
          if (!t.access_token) {
            if (t.error === "invalid_grant") YTV.store.del("auth"); // revoked or expired: sign in again
            throw new Error("Please sign in again");
          }
          saveTokens(t);
          return t.access_token;
        }, function (e) { refreshing = null; throw e; });
      }
      return refreshing;
    },

    // Signs out and tells Google to revoke the token.
    signOut: function () {
      var s = YTV.store.get("auth", {});
      ["auth", "subs", "feed", "me", "mockAuth"].forEach(YTV.store.del);
      if (YTV.MOCK || !s.refresh) return Promise.resolve();
      return post(REVOKE_URL, { token: s.refresh }).catch(function () { /* already invalid */ });
    }
  };
})();
