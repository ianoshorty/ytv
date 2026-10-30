// Sample data for trying the app without an API key (add ?mock=1 to the
// address). Answers in the same shape as the YouTube Data API.
(function () {
  "use strict";

  var YTV = window.YTV;
  if (!YTV.MOCK) return;

  var IDS = ["LXb3EKWsInQ", "dQw4w9WgXcQ", "9bZkp7q19f0"];
  var CHANNELS = ["Sample Nature", "Sample Music", "Sample Tech", "Sample Cooking", "Sample Travel", "Sample Science", "Sample Sport", "Sample News"];

  function video(n, channel) {
    var id = IDS[n % IDS.length];
    return {
      id: id, title: "Sample video " + (n + 1) + " from " + channel, channelTitle: channel,
      channelId: "UCsample" + channel.length, publishedAt: new Date(Date.now() - n * 5400000).toISOString(),
      thumbnails: { medium: { url: "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg" } }
    };
  }

  function later(body) { return new Promise(function (r) { setTimeout(function () { r(body); }, 300); }); }

  YTV.mock = function (path, p) {
    if (path === "search") {
      var page = p.pageToken ? 1 : 0;
      return later({
        nextPageToken: page ? undefined : "p2",
        items: Array.apply(null, Array(12)).map(function (_, i) {
          var v = video(page * 12 + i, "Search: " + p.q);
          return { id: { videoId: v.id }, snippet: v };
        })
      });
    }
    // The Gangnam Style sample stands in for a Short: vertical and 45 s.
    // Rick Astley stands in for World of Warcraft videos (Gaming); Costa Rica
    // for travel, so category and topic rows have something to group.
    var ABOUT = {
      dQw4w9WgXcQ: { categoryId: "20", tags: ["World of Warcraft", "WoW", "mmo"], topics: ["Role-playing_video_game", "Video_game_culture"] },
      LXb3EKWsInQ: { categoryId: "19", tags: ["costa rica", "nature", "4K"], topics: ["Tourism", "Nature"] },
      "9bZkp7q19f0": { categoryId: "10", tags: ["PSY"], topics: ["Music"] }
    };
    if (path === "videos") {
      return later({ items: p.id.split(",").map(function (id, i) {
        var short = id === "9bZkp7q19f0";
        var about = ABOUT[id] || { categoryId: "24", tags: [], topics: [] };
        return {
          id: id,
          snippet: { categoryId: about.categoryId, tags: about.tags },
          topicDetails: { topicCategories: about.topics.map(function (t) { return "https://en.wikipedia.org/wiki/" + t; }) },
          contentDetails: { duration: short ? "PT45S" : "PT" + (3 + i % 20) + "M" + (i * 7 % 60) + "S" },
          player: short ? { embedWidth: 563, embedHeight: 1000 } : { embedWidth: 1000, embedHeight: 563 }
        };
      }) });
    }
    if (path === "subscriptions") {
      return later({ items: CHANNELS.map(function (c, i) {
        return { snippet: { title: c, resourceId: { channelId: "UCsample" + i }, thumbnails: { "default": {} } } };
      }) });
    }
    // A "TV" playlist. Tests add to window.mockTvQueue (or the stored
    // mockTvQueue, for items there before YTV opens) to simulate sending.
    if (path === "playlists") return later({ items: [{ id: "PLmockTV", snippet: { title: "TV" } }] });
    if (path === "playlistItems" && p.playlistId === "PLmockTV") {
      return later({ items: (window.mockTvQueue || YTV.store.get("mockTvQueue", [])).map(function (q) {
        var v = video(q.n, "Sample Phone");
        v.publishedAt = q.addedAt;
        v.resourceId = { videoId: q.id || v.id };
        v.videoOwnerChannelTitle = "Sample Phone";
        return { id: q.item, snippet: v };
      }) });
    }
    if (path === "playlistItems") {
      var ch = CHANNELS[+p.playlistId.replace("UUsample", "")] || "Sample channel";
      return later({ items: Array.apply(null, Array(+p.maxResults)).map(function (_, i) {
        var v = video(i * 3 + ch.length, ch);
        v.resourceId = { videoId: v.id };
        v.videoOwnerChannelTitle = ch;
        return { snippet: v };
      }) });
    }
    if (path === "channels") return later({ items: [{ snippet: { title: "Sample User" } }] });
    return later({ items: [] });
  };
})();
