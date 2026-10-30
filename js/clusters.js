// Groups videos into Home rows by what they're about, using only data YTV
// already fetches (no extra quota):
// - specific rows from topic labels and tags that several videos share
//   (e.g. "World of Warcraft", "Role-playing video game")
// - broad rows from YouTube's own categories (Gaming, News & Politics, ...)
// A video can appear in more than one row, as on YouTube.
(function () {
  "use strict";

  var YTV = window.YTV;
  var MIN_SPECIFIC = 4; // videos needed for a topic or tag row
  var MIN_CATEGORY = 3; // videos needed for a category row
  var MAX_SPECIFIC = 4;
  var MAX_CATEGORY = 6;
  var OVERLAP = 0.7; // rows sharing this much are duplicates; keep the bigger

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

  // How alike two rows are: shared videos over the bigger row's size, so a
  // small row inside a big one (World of Warcraft inside Gaming) isn't a
  // duplicate, but two near-identical rows are.
  function overlap(a, b) {
    var ids = {};
    a.videos.forEach(function (v) { ids[v.id] = true; });
    var shared = b.videos.filter(function (v) { return ids[v.id]; }).length;
    return shared / Math.max(a.videos.length, b.videos.length);
  }

  // Keeps the biggest groups that aren't near-duplicates of ones already kept
  // (or of anything in `against`).
  function pick(groups, min, max, against) {
    var kept = [];
    groups.filter(function (g) { return g.videos.length >= min; })
      .sort(function (a, b) { return b.videos.length - a.videos.length; })
      .forEach(function (g) {
        if (kept.length >= max) return;
        var dup = kept.concat(against).some(function (k) { return overlap(k, g) >= OVERLAP; });
        if (!dup) kept.push(g);
      });
    return kept;
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

  // videos -> [{title, videos}], specific rows first, then categories.
  YTV.clusters = function (videos) {
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
    var specific = pick(tags.concat(topics), MIN_SPECIFIC, MAX_SPECIFIC, []);
    // A category row that's nearly the same as a specific row (all your
    // Gaming is World of Warcraft) is dropped in favour of the specific one.
    var categories = pick(collect(videos, function (v) {
      return CATEGORIES[v.category] ? [CATEGORIES[v.category]] : [];
    }), MIN_CATEGORY, MAX_CATEGORY, specific);

    return specific.concat(categories).map(function (g) { return { title: g.title, videos: g.videos }; });
  };
})();
