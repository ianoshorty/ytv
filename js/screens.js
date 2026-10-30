// The app's screens: Home, Recent, Subscriptions, Channel, Search, Controls
// and Account.
(function () {
  "use strict";

  var YTV = window.YTV;
  var S = YTV.screens;

  function header(el, title, sub) {
    var h = YTV.el("div", "head");
    h.appendChild(YTV.el("h1", null, title));
    if (sub) h.appendChild(YTV.el("div", "sub", sub));
    el.appendChild(h);
    return h;
  }

  // What the app received at launch (never shows the keys themselves).
  function launchInfo() {
    var l = YTV.launch;
    return "Keys: " + (l.source || "none") + " · launch address had " + (l.hashChars ? l.hashChars + " characters after #" : "nothing after #") +
      (l.appList ? " · app list: " + l.appList : "");
  }

  function needsSetup(el) {
    if (YTV.MOCK || YTV.config.apiKey) return false;
    YTV.ui.message(el, "This TV hasn't been given its YouTube API key yet. Run the installer with your secrets file (see the setup guide).", "bad");
    YTV.ui.message(el, launchInfo(), "hint");
    return true;
  }

  // --- Home: rows that scroll sideways --------------------------------------
  // Sent from your phone · Continue watching · Latest from your subscriptions
  // (no Shorts) · Shorts from your subscriptions
  S.home = function (el, params) {
    var h = header(el, "Home");

    var sent = YTV.send.pending();
    if (sent.length && YTV.auth.signedIn()) {
      YTV.ui.videoRow(el, "Sent from your phone", function () {
        return Promise.resolve(sent.map(function (q) { return q.video; }));
      }, { sub: sent.length + " waiting" });
    }

    var unfinished = YTV.history.unfinished();
    if (unfinished.length) {
      YTV.ui.videoRow(el, "Continue watching on this TV", function () { return Promise.resolve(unfinished); });
    }

    if (needsSetup(el)) return;
    if (!YTV.auth.signedIn()) {
      YTV.ui.message(el, "Sign in to see the latest videos from your subscriptions.");
      var row = YTV.el("div", "row-btns");
      row.appendChild(YTV.ui.button("Sign in", function () { YTV.nav.go("account", {}, true); }));
      row.appendChild(YTV.ui.button("Search", function () { YTV.nav.go("search", {}, true); }));
      el.appendChild(row);
      return;
    }
    h.appendChild(YTV.el("div", "sub"));
    h.appendChild(YTV.ui.button("Refresh", function () { YTV.nav.go("home", { force: true }, true); }, "small"));
    // One fetch feeds both rows. Videos you've watched to the end are left
    // out (they're in Recent).
    var feed = YTV.api.feed(params.force).then(function (videos) {
      var f = YTV.store.get("feed", null);
      if (f) sub.textContent = "updated " + YTV.ago(f.at);
      return videos.filter(function (v) { return !YTV.history.watched(v.id); });
    });
    var sub = YTV.ui.videoRow(el, "Latest from your subscriptions", function () {
      return feed.then(function (v) { return v.filter(function (x) { return !x.short; }); });
    }, { hideWatched: true });
    YTV.ui.videoRow(el, "Shorts", function () {
      return feed.then(function (v) { return v.filter(function (x) { return x.short; }); });
    }, { hideWatched: true, sub: "from your subscriptions", empty: "No recent Shorts from your subscriptions." });

    // Rows by topic and category, built from the same videos.
    var groupsEl = YTV.el("div");
    el.appendChild(groupsEl);
    feed.then(function (v) {
      YTV.clusters(v.filter(function (x) { return !x.short; })).forEach(function (c) {
        YTV.ui.videoRow(groupsEl, c.title, function () { return Promise.resolve(c.videos); },
          { hideWatched: true, sub: c.videos.length + " videos" });
      });
    });
  };

  // --- Recent: everything played on this TV --------------------------------
  S.recent = function (el) {
    var h = header(el, "Recent", "Played in YTV on this TV, newest first. YouTube's own history isn't available to apps.");
    var list = YTV.history.all();
    if (!list.length) {
      YTV.ui.message(el, "Nothing yet. Videos you play in YTV will appear here, with where you stopped.");
      return;
    }
    h.appendChild(YTV.ui.button("Clear", function () {
      YTV.history.clear();
      YTV.toast("Recent cleared");
      YTV.nav.go("recent", {}, true);
    }, "small"));
    YTV.ui.videoGrid(el, function () { return Promise.resolve({ videos: list }); }, 4);
  };

  // --- Sent to TV: your "TV" playlist --------------------------------------
  S.sent = function (el) {
    header(el, "Sent to TV", "Your YouTube playlist “TV”, newest first. Save a video to it on your phone and it plays here.");
    if (needsSetup(el)) return;
    if (!YTV.auth.signedIn()) {
      YTV.ui.message(el, "Sign in to use Send to TV.");
      return;
    }
    YTV.ui.message(el, "Status: " + YTV.send.status + ". Thumbnails with a full bar have been played on this TV.", "hint");
    YTV.ui.videoGrid(el, function () {
      return YTV.api.tvPlaylist(true).then(function (id) {
        if (!id) throw new Error("No playlist called “TV” found in your YouTube account.");
        return YTV.api.playlistQueue(id);
      }).then(function (queue) {
        return { videos: queue.map(function (q) { return q.video; }) };
      });
    }, 4);
  };

  // --- Subscriptions: your channels ----------------------------------------
  S.subs = function (el) {
    header(el, "Subscriptions");
    if (needsSetup(el)) return;
    if (!YTV.auth.signedIn()) {
      YTV.ui.message(el, "Sign in to see your subscriptions.");
      el.appendChild(YTV.ui.button("Sign in", function () { YTV.nav.go("account", {}, true); }));
      return;
    }
    var status = YTV.ui.message(el, "Loading…");
    var grid = YTV.el("div", "grid channels");
    el.appendChild(grid);
    YTV.api.subscriptions().then(function (channels) {
      status.style.display = channels.length ? "none" : "";
      status.textContent = "You don't subscribe to any channels yet.";
      el.querySelector(".head").appendChild(YTV.el("div", "sub", channels.length + " channels"));
      channels.forEach(function (ch) {
        var tile = YTV.el("div", "channel f");
        var avatar = YTV.el("div", "avatar", ch.thumb ? "" : ch.title.charAt(0));
        if (ch.thumb) {
          var img = YTV.el("img");
          img.src = ch.thumb;
          avatar.appendChild(img);
        }
        tile.appendChild(avatar);
        tile.appendChild(YTV.el("div", "name", ch.title));
        tile._select = function () { YTV.nav.go("channel", { id: ch.id, title: ch.title }); };
        grid.appendChild(tile);
      });
      YTV.focus.settle();
    }, function (e) {
      status.textContent = e.message;
      status.className = "message bad";
    });
  };

  // --- Channel: one channel's uploads --------------------------------------
  S.channel = function (el, p) {
    header(el, p.title, "Uploads · Back to return");
    YTV.ui.videoGrid(el, function (token) { return YTV.api.channelVideos(p.id, token); }, 4);
  };

  // --- Search: on-screen keyboard and results ------------------------------
  var KEYS = "abcdefghijklmnopqrstuvwxyz1234567890".split("");

  S.search = function (el) {
    header(el, "Search");
    if (needsSetup(el)) return;
    var wrap = YTV.el("div", "search");
    var left = YTV.el("div", "search-left");
    var right = YTV.el("div", "search-right");
    wrap.appendChild(left);
    wrap.appendChild(right);
    el.appendChild(wrap);

    var query = "";
    var box = YTV.el("div", "query");
    left.appendChild(box);
    function show() { box.textContent = query || "Type with the keys below"; box.classList.toggle("empty", !query); }
    show();

    var kb = YTV.el("div", "keyboard");
    KEYS.forEach(function (k) {
      var key = YTV.el("div", "key f", k);
      key._select = function () { query += k; show(); };
      kb.appendChild(key);
    });
    [["space", "wide", function () { if (query && query.slice(-1) !== " ") query += " "; }],
     ["⌫", "", function () { query = query.slice(0, -1); }],
     ["clear", "", function () { query = ""; }],
     ["Search", "go", function () { run(query); }]].forEach(function (spec) {
      var key = YTV.el("div", "key f " + spec[1], spec[0]);
      key._select = function () { spec[2](); show(); };
      kb.appendChild(key);
    });
    left.appendChild(kb);

    var recentEl = YTV.el("div", "recent");
    left.appendChild(recentEl);
    function renderRecent() {
      recentEl.innerHTML = "";
      var recent = YTV.store.get("recentSearches", []);
      if (!recent.length) return;
      recentEl.appendChild(YTV.el("div", "label", "Recent"));
      recent.forEach(function (q) {
        recentEl.appendChild(YTV.ui.button(q, function () { query = q; show(); run(q); }, "small recent-item"));
      });
    }
    renderRecent();

    YTV.ui.message(right, "Each search uses about 1% of the day's YouTube allowance.", "hint");

    function run(q) {
      q = q.trim();
      if (!q) return;
      var recent = YTV.store.get("recentSearches", []).filter(function (r) { return r !== q; });
      recent.unshift(q);
      YTV.store.set("recentSearches", recent.slice(0, 6));
      renderRecent();
      right.innerHTML = "";
      right.appendChild(YTV.el("div", "sub", "Results for “" + q + "”"));
      YTV.ui.videoGrid(right, function (token) { return YTV.api.search(q, token); }, 3).then(function (videos) {
        var first = right.querySelector(".card");
        if (first && videos && videos.length) YTV.focus.set(first);
      });
    }

    // Number keys on the remote type digits here.
    el._key = function (code) {
      if (code >= 48 && code <= 57) { query += String(code - 48); show(); return true; }
      return false;
    };
  };

  // --- Controls: what every remote button does -----------------------------
  var CONTROLS = [
    ["Browsing", [
      ["Arrows", "Move around"],
      ["OK", "Open or play"],
      ["Back", "Go back a screen"],
      ["Back twice on Home", "Exit YTV"],
      ["Blue  or  ← at the start", "Open the menu (it shrinks as you scroll along a row)"],
      ["0–9 (in Search)", "Type a digit"]
    ]],
    ["Playing a video", [
      ["OK  or  Play/Pause", "Play or pause"],
      ["← / →", "Back or forward 10 seconds"],
      ["Rewind / Fast-forward", "Back or forward 30 seconds"],
      ["↑ / ↓", "Faster or slower (0.25x–2x)"],
      ["0–9", "Jump to 0%–90% (0 starts over)"],
      ["Red", "Show or hide the info bar"],
      ["Green", "Captions on or off"],
      ["Yellow", "Change quality (1080p → 1440p → 4K → 480p → 720p)"],
      ["Blue", "Play the video just sent from your phone"],
      ["Back  or  Stop", "Close the video"]
    ]]
  ];

  S.controls = function (el) {
    header(el, "Controls", "Speed, captions and quality are remembered. Videos resume where you stopped.");
    var cols = YTV.el("div", "controls");
    CONTROLS.forEach(function (group) {
      var col = YTV.el("div", "controls-col");
      col.appendChild(YTV.el("h2", null, group[0]));
      group[1].forEach(function (row) {
        var r = YTV.el("div", "control");
        r.appendChild(YTV.el("span", "control-key", row[0]));
        r.appendChild(YTV.el("span", "control-does", row[1]));
        col.appendChild(r);
      });
      cols.appendChild(col);
    });
    el.appendChild(cols);
    YTV.ui.message(el, "The info bar shows the quality you asked for and what YouTube is actually playing. YouTube makes the final choice.", "hint");
  };

  // --- Account: sign in/out and settings -----------------------------------
  S.account = function (el) {
    header(el, "Account");
    var body = YTV.el("div", "account");
    el.appendChild(body);

    if (!YTV.auth.configured()) {
      YTV.ui.message(body, "Sign-in isn't set up on this TV yet. Run the installer with your secrets file (see the setup guide).", "bad");
    } else if (YTV.auth.signedIn()) {
      var who = YTV.ui.message(body, "Signed in" + (YTV.store.get("me", "") ? " as " + YTV.store.get("me", "") : ""));
      if (!YTV.store.get("me", "")) {
        YTV.api.me().then(function (name) { YTV.store.set("me", name); who.textContent = "Signed in as " + name; }, function () {});
      }
      body.appendChild(YTV.ui.button("Refresh subscriptions", function () {
        YTV.store.del("subs");
        YTV.store.del("feed");
        YTV.toast("Subscriptions will reload");
      }));
      body.appendChild(YTV.ui.button("Sign out", function () {
        YTV.auth.signOut().then(function () { YTV.toast("Signed out"); YTV.nav.go("account", {}, true); });
      }));
    } else {
      YTV.ui.message(body, "Sign in with your Google account to see your subscriptions. YTV only asks to read your YouTube data.");
      var signIn = YTV.ui.button("Sign in", start);
      body.appendChild(signIn);
    }

    function start() {
      var panel = YTV.el("div", "code-panel");
      var steps = YTV.el("div", "steps", "Getting a code…");
      var code = YTV.el("div", "code", "");
      panel.appendChild(steps);
      panel.appendChild(code);
      body.innerHTML = "";
      body.appendChild(panel);
      var cancelled = false;
      var cancel = YTV.ui.button("Cancel", function () { cancelled = true; YTV.nav.go("account", {}, true); });
      body.appendChild(cancel);
      YTV.focus.set(cancel);
      YTV.auth.signIn(function (c) {
        steps.textContent = "On your phone or computer, go to " + c.url + " and enter:";
        code.textContent = c.code;
      }, function () { return cancelled || YTV.nav.top().el !== el; }).then(function () {
        YTV.toast("Signed in");
        YTV.nav.go("home", {}, true);
      }, function (e) {
        if (e.message === "cancelled") return;
        steps.textContent = e.message;
        code.textContent = "";
      });
    }

    // Settings
    var settings = YTV.el("div", "settings");
    settings.appendChild(YTV.el("h2", null, "Settings"));
    var shorts = YTV.ui.button("", function () {
      YTV.store.set("hideShorts", !YTV.store.get("hideShorts", true));
      YTV.store.del("feed");
      label();
    });
    function label() { shorts.textContent = "Hide Shorts: " + (YTV.store.get("hideShorts", true) ? "on" : "off"); }
    label();
    settings.appendChild(shorts);
    settings.appendChild(YTV.el("div", "info", "While playing: ↑/↓ speed, Green captions, Yellow quality. All three are remembered between videos."));
    settings.appendChild(YTV.el("div", "info", "Send to TV: on your phone, Save a video to your playlist called “TV”. YTV plays it within about 10 seconds while it's open (status: " +
      YTV.send.status + "). YTV can't remove videos from that playlist, so tidy it on your phone now and then."));
    settings.appendChild(YTV.el("div", "info", "Ads and watch history: YouTube's player only knows about Premium and records history if you're signed in to YouTube in the TV's web browser. Signing in above only lets YTV read your subscriptions."));
    settings.appendChild(YTV.el("div", "info", "YouTube allowance used today: about " + YTV.quotaToday() + " of 10,000 units."));
    settings.appendChild(YTV.el("div", "info", launchInfo()));
    settings.appendChild(YTV.el("div", "info", "YTV " + YTV.VERSION + (YTV.MOCK ? " · sample data" : "")));
    el.appendChild(settings);
  };
})();
