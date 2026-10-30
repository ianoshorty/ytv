// Groups videos into Home rows by what they're about, using only data YTV
// already fetches (no extra quota):
// - specific rows from topic labels and tags that several videos share
//   (e.g. "Formula 1", "World of Warcraft")
// - then broad rows from YouTube's own categories (Gaming, News & Politics, ...)
// Each video goes in one row only, and bigger groups are picked first, so
// "Formula 1" takes the F1 videos rather than one row per driver.
// Biases (rules, not hard-coded names):
// - a topic or tag row needs videos from 2+ channels, so one channel's
//   habits don't make a row and its videos fall through to a category row
// - a tag that's part of the uploader's own name ("TLDR" on "TLDR News")
//   is ignored for that channel's videos
// - a category row is named after a subject that makes up a good share of
//   it (e.g. News & Politics with lots of weather → "News & Weather")
(function () {
  "use strict";

  var YTV = window.YTV;
  var MIN_SPECIFIC = 4; // videos needed for a topic or tag row
  var MIN_SPECIFIC_CHANNELS = 2; // channels needed for a topic or tag row
  var MIN_CATEGORY = 3; // videos needed for a category row
  var MAX_SPECIFIC = 4;
  var MAX_CATEGORY = 6;
  var NAME_SHARE = 0.25; // share of a category row a subject needs to be in its name

  // YouTube's categories: full name, and a short one for "<short> & <subject>".
  var CATEGORIES = {
    1: ["Film & Animation", "Film"], 2: ["Cars & Vehicles", "Cars"], 10: ["Music", "Music"],
    15: ["Pets & Animals", "Animals"], 17: ["Sport", "Sport"], 19: ["Travel & Events", "Travel"],
    20: ["Gaming", "Gaming"], 22: ["People & Blogs", "Vlogs"], 23: ["Comedy", "Comedy"],
    24: ["Entertainment", "Entertainment"], 25: ["News & Politics", "News"], 26: ["How-to & Style", "How-to"],
    27: ["Education", "Learning"], 28: ["Science & Technology", "Tech"], 29: ["Non-profits", "Non-profits"]
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

  function channelOf(v) { return v.channelId || v.channel; }

  // Keeps the uploader's capitals if they used any ("World of Warcraft"),
  // otherwise capitalises words except small ones ("elden ring" → "Elden Ring"),
  // and writes other two-letter words as abbreviations ("uk politics" → "UK Politics").
  var SMALL = ["of", "and", "the", "in", "on", "a", "an", "to", "for", "vs"];
  function titleCase(s) {
    if (/[A-Z]/.test(s)) return s;
    return s.split(" ").map(function (w, i) {
      if (SMALL.indexOf(w) >= 0) return i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1);
      if (w.length <= 2) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  // The tags and topic labels of a video that say something about it. A tag
  // that's part of the uploader's own name ("TLDR" from "TLDR News") names the
  // channel, not the subject, so it's skipped for that channel's videos.
  function subjects(v) {
    var channel = norm(v.channel);
    var tags = (v.tags || []).filter(function (t) {
      var n = norm(t);
      return n.length > 2 && !/^\d+$/.test(n) && BROAD_TAGS.indexOf(n) < 0 &&
        !(channel && (channel.indexOf(n) >= 0 || n.indexOf(channel) >= 0));
    }).map(titleCase);
    var topics = (v.topics || []).filter(function (t) { return BROAD_TOPICS.indexOf(norm(t)) < 0; });
    return { tags: tags, topics: topics };
  }

  // One group {key, title, videos[]} per key any video has.
  function collect(videos, keysOf) {
    var groups = {};
    videos.forEach(function (v) {
      var seen = {};
      keysOf(v).forEach(function (raw) {
        var key = norm(raw);
        if (!key || seen[key]) return;
        seen[key] = true;
        var g = groups[key] || (groups[key] = { key: key, title: raw, videos: [] });
        g.videos.push(v);
      });
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  function channelCount(videos) {
    var seen = {};
    videos.forEach(function (v) { seen[channelOf(v)] = true; });
    return Object.keys(seen).length;
  }

  // Repeatedly takes the group with the most videos not yet in a row, until
  // none qualifies or `max` rows are made. `taken` (video id -> true) is
  // shared between calls, so each video lands in one row only. On a tie the
  // earlier group in the list wins.
  function pick(groups, min, minChannels, max, taken) {
    var rows = [];
    var left = groups.slice();
    while (rows.length < max) {
      var best = -1, bestFree = [];
      left.forEach(function (g, i) {
        var free = g.videos.filter(function (v) { return !taken[v.id]; });
        if (free.length > bestFree.length && channelCount(free) >= minChannels) { best = i; bestFree = free; }
      });
      if (best < 0 || bestFree.length < min) break;
      bestFree.forEach(function (v) { taken[v.id] = true; });
      rows.push({ key: left[best].key, title: left[best].title, videos: bestFree });
      left.splice(best, 1);
    }
    return rows;
  }

  // "News & Politics" with lots of weather → "News & Weather". Picks the
  // most common subject in the row if it covers NAME_SHARE of it (and 2+
  // videos), but not the whole row (then the category name says enough).
  // Subjects sharing a word with the category's name ("UK politics" in News
  // & Politics) add nothing, so they're skipped.
  function nameCategory(row) {
    var names = CATEGORIES[row.key];
    var nameWords = norm(names[0]).split(/[^a-z]+/);
    var groups = collect(row.videos, function (v) {
      var s = subjects(v);
      return s.tags.concat(s.topics);
    }).filter(function (g) {
      var sharesWord = g.key.split(" ").some(function (w) { return w.length > 2 && nameWords.indexOf(w) >= 0; });
      return !sharesWord && g.videos.length >= 2 && g.videos.length >= row.videos.length * NAME_SHARE &&
        g.videos.length < row.videos.length;
    }).sort(function (a, b) { return b.videos.length - a.videos.length; });
    return groups.length ? names[1] + " & " + groups[0].title : names[0];
  }

  // videos -> [{title, videos}], specific rows first, then categories for
  // whatever's left.
  YTV.clusters = function (videos) {
    var taken = {};
    var tags = collect(videos, function (v) { return subjects(v).tags; });
    var topics = collect(videos, function (v) { return subjects(v).topics; });
    // Tags go first so that on a tie the more specific name wins
    // ("World of Warcraft" over "Role-playing video game").
    var specific = pick(tags.concat(topics), MIN_SPECIFIC, MIN_SPECIFIC_CHANNELS, MAX_SPECIFIC, taken);
    var categories = pick(collect(videos, function (v) {
      return CATEGORIES[v.category] ? [String(v.category)] : [];
    }), MIN_CATEGORY, 1, MAX_CATEGORY, taken).map(function (row) {
      return { title: nameCategory(row), videos: row.videos };
    });
    return specific.map(function (r) { return { title: r.title, videos: r.videos }; }).concat(categories);
  };
})();
