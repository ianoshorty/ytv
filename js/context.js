// Video actions and a held-OK gesture. Short OK still plays on release.
(function () {
  'use strict';
  var YTV = window.YTV, dialog = null, held = null, holdTimer = null;
  function cancelHold() { clearTimeout(holdTimer); if (held) held.cancelled = true; }
  function close() {
    if (!dialog) return;
    var previous = dialog.previous;
    dialog.root.remove(); dialog = null;
    if (previous && previous.isConnected && previous.offsetParent !== null) YTV.focus.set(previous);
    else YTV.focus.first();
  }
  function highlight() {
    dialog.buttons.forEach(function (b, i) { b.classList.toggle('focused', i === dialog.index); });
  }
  function show(title, actions, previous) {
    if (dialog) dialog.root.remove();
    var root = YTV.el('div', 'video-actions'), box = YTV.el('div', 'video-actions-box');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', title);
    box.appendChild(YTV.el('h2', null, title));
    var note = YTV.el('div', 'video-actions-note', '↑ ↓ Choose · OK Select · Back Cancel');
    var buttons = actions.map(function (action) {
      var button = YTV.el('div', 'btn', action.label);
      button._select = function () {
        if (!dialog || dialog.busy) return;
        action.run(note);
      };
      button.onclick = button._select;
      box.appendChild(button); return button;
    });
    box.appendChild(note); root.appendChild(box); document.getElementById('app').appendChild(root);
    dialog = { root: root, buttons: buttons, index: 0, previous: previous, busy: false };
    highlight();
  }
  function refresh(id, removed, localOnly) {
    if (removed) Array.prototype.forEach.call(document.querySelectorAll('.card[data-id="' + id + '"]'), function (card) {
      if (card.closest('.screen-recent') || !localOnly && card.closest('.screen-youtubeHistory')) card.remove();
    });
    YTV.ui.refreshProgress(id);
  }
  function run(action, message, id, removed, localOnly) {
    var active = dialog; active.busy = true;
    var note = active.root.querySelector('.video-actions-note'); note.textContent = 'Updating…';
    Promise.resolve().then(action).then(function () {
      refresh(id, removed, localOnly);
      if (dialog === active) close();
      YTV.toast(message);
    }, function (e) {
      active.busy = false; note.textContent = e.message;
      YTV.toast(e.message);
    });
  }
  YTV.context = {
    open: function (card) {
      if (!card || !card._video) return;
      var video = card._video, cloud = YTV.sync.enabled();
      var actions = [{ label: cloud ? 'Mark completely watched on YouTube' : 'Mark completely watched on this TV', run: function () {
        run(function () { return cloud ? YTV.sync.markComplete(video) : YTV.history.complete(video); }, cloud ? 'Marked watched on YouTube' : 'Marked watched on this TV', video.id);
      } }];
      if (cloud) actions.push({ label: 'Remove from YouTube watch history…', run: function () {
        show('Remove “' + video.title + '” from YouTube history?', [
          { label: 'Cancel', run: close },
          { label: 'Remove from YouTube history and this TV', run: function () {
            run(function () { return YTV.sync.removeVideo(video.id); }, 'Removed from YouTube history', video.id, true, false);
          } }
        ], card);
      } });
      actions.push({ label: 'Remove from Recent on this TV only', run: function () {
        run(function () { YTV.history.remove(video.id); }, 'Removed from Recent on this TV', video.id, true, true);
      } });
      actions.push({ label: 'Cancel', run: close });
      show(video.title || 'Video actions', actions, card);
    },
    key: function (code) {
      if (!dialog) return false;
      if (code === 8 || code === 27 || code === 461) { close(); return true; }
      if (dialog.busy) return true;
      if (code === 38) { dialog.index = (dialog.index + dialog.buttons.length - 1) % dialog.buttons.length; highlight(); }
      if (code === 40) { dialog.index = (dialog.index + 1) % dialog.buttons.length; highlight(); }
      if (code === 13) dialog.buttons[dialog.index]._select();
      return true;
    },
    down: function (code) {
      if (code !== 13) { cancelHold(); return false; }
      if (held) return true; // native repeat must never select the new menu
      var card = YTV.focus.get();
      if (dialog) { held = { fired: true, cancelled: true }; return false; }
      if (!card || !card._video || YTV.player.isOpen()) return false;
      held = { card: card, fired: false, cancelled: false };
      holdTimer = setTimeout(function () {
        if (held && !held.cancelled && YTV.focus.get() === card && card.isConnected) {
          held.fired = true; YTV.context.open(card);
        }
      }, 650);
      return true;
    },
    up: function (code) {
      if (code !== 13 || !held) return false;
      var press = held; clearTimeout(holdTimer); held = null;
      if (!press.fired && !press.cancelled && YTV.focus.get() === press.card && press.card.isConnected) press.card._select();
      return true;
    },
    cancel: function () { cancelHold(); held = null; }
  };
})();
