// YouTube Data API v3. Every call costs "quota units" from a free daily
// allowance of 10,000: search 100, most others 1. Results are cached on the
// TV to keep within it.
(function () {
  "use strict";

  var YTV = window.YTV;
  var BASE = "https://www.googleapis.com/youtube/v3/";
  var FEED_TTL = 30 * 60 * 1000;
  var SUBS_TTL = 6 * 60 * 60 * 1000;
  var PER_CHANNEL = 5;

  function today() { return new Date().toISOString().slice(0, 10); }

  function spend(units) {
    var q = YTV.store.get("quota", {});
    if (q.day !== today()) q = { day: today(), used: 0 };
    q.used += units;
    YTV.store.set("quota", q);
  }

  YTV.quotaToday = function () {
    var q = YTV.store.get("quota", {});
    return q.day === today() ? q.used : 0;
  };

  function call(path, params, units, auth) {
    if (YTV.MOCK) return YTV.mock(path, params);
    if (!YTV.config.apiKey) return Promise.reject(new Error("No API key set up yet"));
    params.key = YTV.config.apiKey;
    var qs = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    var headers = {};
    var ready = auth ? YTV.auth.token().then(function (t) { headers.Authorization = "Bearer " + t; }) : Promise.resolve();
    return ready.then(function () {
      spend(units);
      return fetch(BASE + path + "?" + qs, { headers: headers });
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          var reason = body.error && body.error.errors && body.error.errors[0] ? body.error.errors[0].reason : res.status;
          throw new Error(reason === "quotaExceeded" ? "Daily YouTube quota used up (resets at 8am UK time)" : "YouTube API error: " + reason);
        }
        return body;
      });
    });
  }

  // Normalised video: {id, title, channel, channelId, published, thumb, seconds}
  function fromSnippet(id, sn) {
    var th = sn.thumbnails || {};
    var t = th.medium || th.high || th["default"] || {};
    return {
      id: id, title: YTV.decode(sn.title), channel: YTV.decode(sn.channelTitle || sn.videoOwnerChannelTitle),
      channelId: sn.videoOwnerChannelId || sn.channelId, published: sn.publishedAt, thumb: t.url, seconds: null,
      live: sn.liveBroadcastContent === "live"
    };
  }

  // Adds durations, spots Shorts, and records what each video is about, and
  // drops videos that no longer exist. 1 unit per 50, whatever parts are
  // asked for.
  // - Shorts: the API has no "is a Short" flag, so a Short is a vertical video
  //   of 3 minutes or less; the player's size (with maxWidth set) gives the
  //   video's shape.
  // - Category rows: YouTube's category, the uploader's tags (first 15) and
  //   YouTube's topic labels (Wikipedia page names).
  function addDetails(videos) {
    var chunks = [];
    for (var i = 0; i < videos.length; i += 50) chunks.push(videos.slice(i, i + 50));
    return Promise.all(chunks.map(function (chunk) {
      return call("videos", {
        part: "snippet,contentDetails,player,topicDetails", maxWidth: 1000,
        id: chunk.map(function (v) { return v.id; }).join(","), maxResults: 50
      }, 1);
    })).then(function (pages) {
      var info = {};
      pages.forEach(function (p) {
        (p.items || []).forEach(function (it) {
          var pl = it.player || {}, sn = it.snippet || {};
          info[it.id] = {
            seconds: YTV.isoSeconds(it.contentDetails.duration),
            vertical: pl.embedHeight && pl.embedWidth ? +pl.embedHeight > +pl.embedWidth : null,
            category: sn.categoryId || null,
            tags: (sn.tags || []).slice(0, 15),
            topics: ((it.topicDetails || {}).topicCategories || []).map(function (u) {
              return decodeURIComponent(u.split("/wiki/")[1] || "").replace(/_/g, " ");
            })
          };
        });
      });
      return videos.filter(function (v) { return v.id in info; }).map(function (v) {
        var d = info[v.id];
        v.seconds = d.seconds;
        v.short = !v.live && (d.vertical === null ? d.seconds <= 60 : d.vertical && d.seconds <= 180);
        v.category = d.category;
        v.tags = d.tags;
        v.topics = d.topics;
        return v;
      });
    });
  }

  function dropShorts(videos) {
    if (!YTV.store.get("hideShorts", true)) return videos;
    return videos.filter(function (v) { return !v.short; });
  }

  YTV.api = {
    search: function (q, pageToken) {
      var p = { part: "snippet", type: "video", maxResults: 24, q: q, safeSearch: "none" };
      if (pageToken) p.pageToken = pageToken;
      return call("search", p, 100).then(function (body) {
        var vids = (body.items || []).map(function (it) { return fromSnippet(it.id.videoId, it.snippet); });
        return addDetails(vids).then(function (v) { return { videos: dropShorts(v), next: body.nextPageToken }; });
      });
    },

    // Every channel you subscribe to, A–Z.
    subscriptions: function (force) {
      var cached = YTV.store.get("subs", null);
      if (!force && cached && Date.now() - cached.at < SUBS_TTL) return Promise.resolve(cached.channels);
      var channels = [];
      function page(token) {
        var p = { part: "snippet", mine: "true", maxResults: 50, order: "alphabetical" };
        if (token) p.pageToken = token;
        return call("subscriptions", p, 1, true).then(function (body) {
          (body.items || []).forEach(function (it) {
            var sn = it.snippet;
            channels.push({ id: sn.resourceId.channelId, title: YTV.decode(sn.title), thumb: (sn.thumbnails["default"] || {}).url });
          });
          return body.nextPageToken ? page(body.nextPageToken) : channels;
        });
      }
      return page().then(function (list) {
        YTV.store.set("subs", { at: Date.now(), channels: list });
        return list;
      });
    },

    // A channel's uploads, newest first. The uploads playlist is "UU" + the
    // channel id without its "UC" prefix, which saves a lookup.
    uploads: function (channelId, pageToken, max) {
      var p = { part: "snippet", playlistId: "UU" + channelId.slice(2), maxResults: max || 24 };
      if (pageToken) p.pageToken = pageToken;
      return call("playlistItems", p, 1).then(function (body) {
        var vids = (body.items || []).filter(function (it) { return it.snippet.resourceId; })
          .map(function (it) { return fromSnippet(it.snippet.resourceId.videoId, it.snippet); });
        return { videos: vids, next: body.nextPageToken };
      });
    },

    // Newest uploads across all subscriptions, Shorts included (each video
    // has .short). Costs about 1 unit per subscribed channel, so it's cached
    // for 30 minutes.
    feed: function (force) {
      var cached = YTV.store.get("feed", null);
      if (!force && cached && cached.v === 3 && Date.now() - cached.at < FEED_TTL) return Promise.resolve(cached.videos);
      return YTV.api.subscriptions(force).then(function (channels) {
        var all = [];
        var queue = channels.slice();
        function worker() {
          var ch = queue.shift();
          if (!ch) return Promise.resolve();
          return YTV.api.uploads(ch.id, null, PER_CHANNEL)
            .then(function (r) { all = all.concat(r.videos); }, function () { /* channel without uploads */ })
            .then(worker);
        }
        var workers = [];
        for (var i = 0; i < 6; i++) workers.push(worker());
        return Promise.all(workers).then(function () {
          all.sort(function (a, b) { return a.published < b.published ? 1 : -1; });
          return addDetails(all.slice(0, 160));
        });
      }).then(function (videos) {
        var longs = videos.filter(function (v) { return !v.short; }).slice(0, 80);
        var shorts = videos.filter(function (v) { return v.short; }).slice(0, 40);
        videos = longs.concat(shorts);
        YTV.store.set("feed", { v: 3, at: Date.now(), videos: videos });
        return videos;
      });
    },

    channelVideos: function (channelId, pageToken) {
      return YTV.api.uploads(channelId, pageToken, 24).then(function (r) {
        return addDetails(r.videos).then(function (v) { return { videos: dropShorts(v), next: r.next }; });
      });
    },

    me: function () {
      return call("channels", { part: "snippet", mine: "true" }, 1, true).then(function (body) {
        var it = (body.items || [])[0];
        return it ? YTV.decode(it.snippet.title) : "your account";
      });
    },

    // Your playlist called "TV" (any case), or null. 1 unit, cached.
    tvPlaylist: function (force) {
      var cached = YTV.store.get("tvPlaylist", null);
      if (!force && cached) return Promise.resolve(cached);
      var found = null;
      function page(token) {
        var p = { part: "snippet", mine: "true", maxResults: 50 };
        if (token) p.pageToken = token;
        return call("playlists", p, 1, true).then(function (body) {
          (body.items || []).forEach(function (it) {
            if (!found && it.snippet.title.trim().toLowerCase() === "tv") found = it.id;
          });
          return found || !body.nextPageToken ? found : page(body.nextPageToken);
        });
      }
      return page().then(function (id) {
        if (id) YTV.store.set("tvPlaylist", id);
        return id;
      });
    },

    // Everything in a playlist: [{item, addedAt, video}], newest addition
    // first. 1 unit per 50 items. Deleted and private videos are skipped.
    playlistQueue: function (playlistId) {
      var out = [];
      function page(token) {
        var p = { part: "snippet", playlistId: playlistId, maxResults: 50 };
        if (token) p.pageToken = token;
        return call("playlistItems", p, 1, true).then(function (body) {
          (body.items || []).forEach(function (it) {
            var sn = it.snippet;
            if (!sn.resourceId || !sn.videoOwnerChannelTitle) return; // deleted or private
            out.push({ item: it.id, addedAt: sn.publishedAt, video: fromSnippet(sn.resourceId.videoId, sn) });
          });
          return body.nextPageToken && out.length < 200 ? page(body.nextPageToken) : out;
        });
      }
      return page().then(function (items) {
        items.sort(function (a, b) { return a.addedAt < b.addedAt ? 1 : -1; });
        return items;
      });
    }
  };
})();
