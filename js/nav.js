// Remote-control navigation: moving focus with the arrow keys, the screen
// stack for Back, and the video/channel grids.
(function () {
  "use strict";

  var YTV = window.YTV;

  // --- focus ----------------------------------------------------------------
  // Anything with class "f" can take focus. el._select runs on OK.
  var current = null;
  var lastContentFocus = null;
  var userMoved = false; // since the screen opened

  function visible(el) { return el.offsetParent !== null; }

  // Can focus go to o from the current element? Items scrolled out of view
  // in other rows don't count (otherwise ← could jump to a hidden tile in
  // another row instead of opening the menu); items in your own row do.
  function reachable(o) {
    if (o === current || !visible(o)) return false;
    var row = o.closest(".row");
    if (!row || row === current.closest(".row")) return true;
    var r = o.getBoundingClientRect(), box = row.getBoundingClientRect();
    return r.right > box.left + 1 && r.left < box.right - 1;
  }

  // The menu shrinks while you're along a row and comes back at its start.
  function updateRail(el) {
    var row = el.closest(".row");
    if (row && !el.previousElementSibling) row.scrollLeft = 0;
    document.body.classList.toggle("rail-min", !!(row && row.scrollLeft > 0));
  }

  function score(a, b, dir) {
    var ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    var bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2;
    var primary, secondary;
    if (dir === "right") { if (b.left < a.right - 2) return null; primary = b.left - a.right; secondary = Math.abs(by - ay); }
    if (dir === "left") { if (b.right > a.left + 2) return null; primary = a.left - b.right; secondary = Math.abs(by - ay); }
    if (dir === "down") { if (b.top < a.bottom - 2) return null; primary = b.top - a.bottom; secondary = Math.abs(bx - ax); }
    if (dir === "up") { if (b.bottom > a.top + 2) return null; primary = a.top - b.bottom; secondary = Math.abs(bx - ax); }
    return primary + secondary * 3;
  }

  YTV.focus = {
    get: function () { return current; },

    set: function (el) {
      if (!el) return;
      if (current) current.classList.remove("focused");
      current = el;
      el.classList.add("focused");
      if (!el.closest("#rail")) lastContentFocus = el;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      updateRail(el);
      if (el._focus) el._focus();
    },

    // Opens the menu on the current section (Blue, or ← from a row's start).
    rail: function () { YTV.focus.set(document.querySelector("#rail .f.active")); },

    // First video or channel in the visible screen, else its first button.
    first: function () {
      var screen = YTV.nav.top();
      var el = screen && (screen.el.querySelector(".card.f, .channel.f") || screen.el.querySelector(".f"));
      YTV.focus.set(el || document.querySelector("#rail .f.active"));
    },

    // Screens that load content later call this, so focus lands on the
    // content unless you've already moved somewhere.
    settle: function () { if (!userMoved) YTV.focus.first(); },

    move: function (dir) {
      userMoved = true;
      if (!current || !visible(current)) return YTV.focus.first();
      var inRail = !!current.closest("#rail");
      // Into the rail: land on the current section. Out of it: go back to
      // where you were.
      if (!inRail && dir === "left") {
        var screen = YTV.nav.top();
        var leftmost = screen && Array.prototype.every.call(screen.el.querySelectorAll(".f"), function (o) {
          return !reachable(o) || score(current.getBoundingClientRect(), o.getBoundingClientRect(), "left") === null;
        });
        if (leftmost) return YTV.focus.rail();
      }
      if (inRail && dir === "right") {
        if (lastContentFocus && visible(lastContentFocus)) return YTV.focus.set(lastContentFocus);
        return YTV.focus.first();
      }
      var scope = inRail ? document.getElementById("rail") : YTV.nav.top().el;
      var a = current.getBoundingClientRect();
      var best = null, bestScore = Infinity;
      Array.prototype.forEach.call(scope.querySelectorAll(".f"), function (o) {
        if (!reachable(o)) return;
        var s = score(a, o.getBoundingClientRect(), dir);
        if (s !== null && s < bestScore) { best = o; bestScore = s; }
      });
      if (best) YTV.focus.set(best);
      else if (current._edge) current._edge(dir);
    },

    select: function () { if (current && current._select) current._select(); }
  };

  // --- screens ----------------------------------------------------------------
  // Each entry in the stack keeps its DOM, so Back returns to exactly where
  // you were.
  var stack = [];
  YTV.screens = {};

  YTV.nav = {
    top: function () { return stack[stack.length - 1]; },
    depth: function () { return stack.length; },

    // root: true starts a fresh stack (used by the left-hand menu).
    go: function (name, params, root) {
      var content = document.getElementById("content");
      if (root) {
        stack.forEach(function (s) { content.removeChild(s.el); });
        stack = [];
        Array.prototype.forEach.call(document.querySelectorAll("#rail .f"), function (r) {
          r.classList.toggle("active", r.dataset.screen === name);
        });
      } else if (stack.length) {
        var prev = YTV.nav.top();
        prev.focus = current;
        prev.el.style.display = "none";
      }
      var el = YTV.el("section", "screen screen-" + name);
      content.appendChild(el);
      var entry = { name: name, el: el, params: params || {} };
      stack.push(entry);
      userMoved = false;
      YTV.screens[name](el, entry.params);
      YTV.focus.first();
    },

    back: function () {
      if (stack.length < 2) return false;
      var gone = stack.pop();
      gone.el.parentNode.removeChild(gone.el);
      var prev = YTV.nav.top();
      prev.el.style.display = "";
      if (prev.focus && visible(prev.focus)) YTV.focus.set(prev.focus); else YTV.focus.first();
      return true;
    }
  };

  // --- building blocks -----------------------------------------------------
  // The bar under a thumbnail showing how much you've watched.
  function setProgress(card) {
    var f = YTV.history.fraction(card.dataset.id);
    var bar = card.querySelector(".progress");
    bar.style.display = f === null || f === 0 ? "none" : "";
    bar.firstChild.style.width = (f || 0) * 100 + "%";
  }

  YTV.ui = {
    // Updates every card for this video after it's been played, and removes
    // it from lists that hide watched videos once it's been watched to the end.
    refreshProgress: function (id) {
      var watched = YTV.history.watched(id);
      Array.prototype.forEach.call(document.querySelectorAll('.card[data-id="' + id + '"]'), function (card) {
        if (!(watched && card.closest(".hide-watched"))) return setProgress(card);
        if (card === current) YTV.focus.set(card.nextElementSibling || card.previousElementSibling);
        card.parentNode.removeChild(card);
        if (card === current) YTV.focus.first();
      });
    },

    button: function (label, onSelect, cls) {
      var b = YTV.el("div", "btn f" + (cls ? " " + cls : ""), label);
      b._select = onSelect;
      return b;
    },

    message: function (parent, text, cls) {
      var m = YTV.el("div", "message" + (cls ? " " + cls : ""), text);
      parent.appendChild(m);
      return m;
    },

    // A titled row of videos that scrolls sideways (Home).
    // load() -> Promise<videos>. opts.hideWatched as for videoGrid.
    videoRow: function (parent, title, load, opts) {
      opts = opts || {};
      var t = YTV.el("div", "row-title");
      t.appendChild(YTV.el("h2", null, title));
      var sub = YTV.el("span", "sub", opts.sub || "");
      t.appendChild(sub);
      parent.appendChild(t);
      var row = YTV.el("div", "row" + (opts.hideWatched ? " hide-watched" : ""));
      parent.appendChild(row);
      var status = YTV.el("div", "message", "Loading…");
      row.appendChild(status);
      load().then(function (videos) {
        row.removeChild(status);
        if (!videos.length) row.appendChild(YTV.el("div", "message", opts.empty || "Nothing here."));
        videos.forEach(function (v, i) {
          row.appendChild(YTV.ui.videoCard(v, function () { YTV.player.play(videos, i); }));
        });
        YTV.focus.settle();
      }, function (e) {
        status.textContent = e.message;
        status.className = "message bad";
      });
      return sub;
    },

    videoCard: function (v, onSelect) {
      var card = YTV.el("div", "card f" + (v.short ? " short" : ""));
      var thumb = YTV.el("div", "thumb");
      if (v.thumb) {
        var img = YTV.el("img");
        img.src = v.thumb;
        thumb.appendChild(img);
      }
      if (v.live) thumb.appendChild(YTV.el("span", "badge live", "LIVE"));
      else if (v.seconds) thumb.appendChild(YTV.el("span", "badge", YTV.clock(v.seconds)));
      var bar = YTV.el("div", "progress");
      bar.appendChild(YTV.el("div", "progress-fill"));
      thumb.appendChild(bar);
      card.appendChild(thumb);
      card.dataset.id = v.id;
      setProgress(card);
      card.appendChild(YTV.el("div", "title", v.title));
      card.appendChild(YTV.el("div", "meta", [v.channel, v.published ? YTV.ago(v.published) : ""].filter(Boolean).join(" · ")));
      card._select = onSelect;
      return card;
    },

    // A grid of videos that loads more when you reach the last row.
    // load(token) -> Promise<{videos, next}>
    // opts.hideWatched: drop a card once its video has been watched to the end.
    videoGrid: function (parent, load, cols, opts) {
      cols = cols || 4;
      var grid = YTV.el("div", "grid cols-" + cols + (opts && opts.hideWatched ? " hide-watched" : ""));
      parent.appendChild(grid);
      var status = YTV.el("div", "message", "Loading…");
      parent.appendChild(status);
      var videos = [];
      var next = null, loading = false;

      function more(token) {
        loading = true;
        return load(token).then(function (r) {
          loading = false;
          next = r.next || null;
          var start = videos.length;
          videos = videos.concat(r.videos);
          r.videos.forEach(function (v, i) {
            var card = YTV.ui.videoCard(v, function () { YTV.player.play(videos, start + i); });
            card._focus = function () {
              if (next && !loading && start + i >= videos.length - cols) more(next);
            };
            grid.appendChild(card);
          });
          status.textContent = videos.length ? "" : "Nothing here.";
          status.style.display = videos.length ? "none" : "";
          if (!token) YTV.focus.settle();
          return videos;
        }, function (e) {
          loading = false;
          status.style.display = "";
          status.textContent = e.message;
          status.className = "message bad";
        });
      }
      return more(null);
    }
  };
})();
