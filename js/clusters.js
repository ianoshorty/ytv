// Groups videos into Home rows by what they're about, using only data YTV
// already fetches (no extra quota):
// - specific rows from topic labels and tags that several videos share
//   (e.g. "Formula 1", "World of Warcraft")
// - then broad rows from YouTube's own categories (Gaming, News & Politics, ...)
// Each video goes in one row only, and bigger groups are picked first, so
// "Formula 1" takes the F1 videos rather than one row per driver.
(function () {
  "use strict";

  var YTV = window.YTV;
  var MIN_SPECIFIC = 4; // videos needed for a topic or tag row
  var MIN_CATEGORY = 3; // videos needed for a category row
  var MAX_SPECIFIC = 4;
  var MAX_CATEGORY = 6;

  var CATEGORIES = {
    1: "Film & Animation", 2: "Cars & Vehicles", 10: "Music", 15: "Pets & Animals", 17: "Sport",
    19: "Travel & Events", 20: "Gaming", 22: "People & Blogs", 23: "Comedy", 24: "Entertainment",
    25: "News & Politics", 26: "How-to & Style", 27: "Education", 28: "Science & Technology", 29: "Non-profits"
  };

  // Topic labels too broad to be useful as a row of their own.
  var BROAD_TOPICS = ["lifestyle (sociology)", "society", "entertainment", "hobby", "knowledge", "video game culture",
    "television program", "humour", "film", "music", "sport", "technology", "politics", "health", "food", "tourism",
    "vehicle", "pet", "performing arts", "business"];

  // Tags that say nothing about the subject.
  var BROAD_TAGS = ["video", "videos", "youtube", "new", "live", "stream", "livestream", "shorts", "short", "funny",
    "vlog", "gaming", "gameplay", "game", "games", "news", "music", "official", "trailer", "review", "reaction",
    "highlights", "best", "top", "how to", "tutorial", "guide", "podcast", "episode", "full", "hd", "4k", "60fps",
    "uk", "today", "update", "2024", "2025", "2026", "2027"];

  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

  // One group {title, videos[]} per key (category, topic or tag) any video has.
  function collect(videos, keysOf) {
    var groups = {};
    videos.forEach(function (v) {
      var seen = {};
      keysOf(v).forEach(function (raw) {
        var key = norm(raw);
        if (!key || seen[key]) return;
        seen[key] = true;
        var g = groups[key] || (groups[key] = { title: raw, videos: [] });
        g.videos.push(v);
      });
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  // Repeatedly takes the group with the most videos not yet in a row, until
  // none has `min` left or `max` rows are made. `taken` (video id -> true) is
  // shared between calls, so each video lands in one row only. On a tie the
  // earlier group in the list wins.
  function pick(groups, min, max, taken) {
    var rows = [];
    var left = groups.slice();
    while (rows.length < max) {
      var best = -1, bestFree = [];
      left.forEach(function (g, i) {
        var free = g.videos.filter(function (v) { return !taken[v.id]; });
        if (free.length > bestFree.length) { best = i; bestFree = free; }
      });
      if (best < 0 || bestFree.length < min) break;
      bestFree.forEach(function (v) { taken[v.id] = true; });
      rows.push({ title: left[best].title, videos: bestFree });
      left.splice(best, 1);
    }
    return rows;
  }

  // Keeps the uploader's capitals if they used any ("World of Warcraft"),
  // otherwise capitalises words except small ones ("elden ring" → "Elden Ring").
  var SMALL = ["of", "and", "the", "in", "on", "a", "an", "to", "for", "vs"];
  function titleCase(s) {
    if (/[A-Z]/.test(s)) return s;
    return s.split(" ").map(function (w, i) {
      return i > 0 && SMALL.indexOf(w) >= 0 ? w : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  // videos -> [{title, videos}], specific rows first, then categories for
  // whatever's left.
  YTV.clusters = function (videos) {
    var taken = {};
    var channelNames = {};
    videos.forEach(function (v) { channelNames[norm(v.channel)] = true; });
    var topics = collect(videos, function (v) {
      return (v.topics || []).filter(function (t) { return BROAD_TOPICS.indexOf(norm(t)) < 0; });
    });
    var tags = collect(videos, function (v) {
      return (v.tags || []).filter(function (t) {
        var n = norm(t);
        return n.length > 2 && !/^\d+$/.test(n) && BROAD_TAGS.indexOf(n) < 0 && !channelNames[n];
      });
    }).map(function (g) {
      g.title = titleCase(g.title);
      return g;
    });
    // Tags go first so that on a tie the more specific name wins
    // ("World of Warcraft" over "Role-playing video game").
    var specific = pick(tags.concat(topics), MIN_SPECIFIC, MAX_SPECIFIC, taken);
    var categories = pick(collect(videos, function (v) {
      return CATEGORIES[v.category] ? [CATEGORIES[v.category]] : [];
    }), MIN_CATEGORY, MAX_CATEGORY, taken);
    return specific.concat(categories);
  };
})();
