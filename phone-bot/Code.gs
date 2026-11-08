/**
 * The Garden's phone bot (issue #38, decided in #15). It runs in YOUR Google Apps Script, never on the Mac.
 *
 * What it does: you message a private Telegram bot; it saves each message as ONE FOLDER in a Google Drive folder that syncs to
 * your Mac. The folder holds the photos, plus a description file `capture.json` written LAST (the Garden only takes a folder
 * once that file exists). Shape, read by src/server/inbox.ts:
 *   { messageId, sentAt (ISO), private?, text?, links?, forward?: { text, author, url? }, files?: [{ name }] }
 * It answers "✓ Saved · link · 14:02" (or "✗ Not saved, please send it again"). Every ~10 minutes it checks whether a capture
 * has left Drive (the Garden deletes the folder after taking it), then deletes your message and edits the receipt to
 * "✓ In your Garden". Once a day it refreshes `heartbeat.txt` so the Garden can tell Drive is syncing.
 *
 * Settings live in Project Settings → Script Properties, never in this code:
 *   BOT_TOKEN        the key BotFather gave you
 *   INBOX_FOLDER_ID  the id of the Drive folder (the last part of its address)
 *   WEBHOOK_SECRET   the secret shown in the Garden (it goes on the web-app address, so only Telegram can call it)
 *   SETUP_CODE       the one-time code shown in the Garden; the bot forgets it after /start succeeds
 * The bot sets CHAT_ID itself: the one account that sent `/start <code>`. Everyone else is ignored.
 * Run `installTriggers`, `connectBot` and `checkSetup` once from the editor (see docs/phone-bot-setup.md).
 */

var MAX_BYTES = 20 * 1024 * 1024; // Telegram's limit for bots
var TEXT_WAIT_MS = 5500;   // a comment is held this long in case a forward follows it (Telegram sends the comment first)
var JOIN_SECONDS = 5;      // a forward joins a comment sent at most this long before it
var ALBUM_WAIT_MS = 5000;  // an album is finished once no new photo has arrived for this long
var HEARTBEAT_FILE = 'heartbeat.txt';
var DESCRIPTION_FILE = 'capture.json';
var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, heic: 1, heif: 1, gif: 1, webp: 1, tif: 1, tiff: 1 };
var MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/gif': 'gif', 'image/webp': 'webp', 'image/tiff': 'tif' };

var HELP_TEXT = 'Send me a link, a photo or a thought and I save it for your Garden.\n' +
  '• Add #private anywhere and no AI will ever read it.\n' +
  '• Other #hashtags become Tags.\n' +
  '• Forward a post to keep it; text you send just before it becomes your comment.\n' +
  '• I can\'t keep voice notes, PDFs, videos or files over 20 MB yet.\n\n' +
  '/waiting – what is still waiting for your Mac\n/help – this message';

// ------------------------------------------------------------------ Telegram + settings

function setting_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function props_() { return PropertiesService.getScriptProperties(); }

function tg_(method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + setting_('BOT_TOKEN') + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true
  });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false }; }
}
function say_(chatId, text) { return tg_('sendMessage', { chat_id: chatId, text: text }); }

function locked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function getJson_(k) { var v = setting_(k); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
function setJson_(k, v) { props_().setProperty(k, JSON.stringify(v)); }
function inbox_() { return DriveApp.getFolderById(setting_('INBOX_FOLDER_ID')); }

// ------------------------------------------------------------------ the web-app entry point (Telegram calls this)

function doPost(e) {
  try {
    var secret = setting_('WEBHOOK_SECRET');
    if (!secret || !e || !e.parameter || e.parameter.secret !== secret) return out_('no');
    handleUpdate_(JSON.parse(e.postData.contents));
  } catch (err) { console.error(String(err && err.message ? err.message : err)); }
  return out_('ok'); // always 200, so Telegram never re-sends
}
function doGet() { return out_('ok'); }
function out_(s) { return ContentService.createTextOutput(s); }

function handleUpdate_(u) {
  var m = u && u.message;
  if (!m || !m.from || !m.chat || m.chat.type !== 'private') return;
  var cache = CacheService.getScriptCache();
  if (cache.get('u' + u.update_id)) return; // Telegram sent the same update again
  cache.put('u' + u.update_id, '1', 21600);

  var cmd = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec((m.text || '').trim());
  var owner = setting_('CHAT_ID');
  if (!owner) { if (cmd && cmd[1] === 'start') pair_(m, cmd[2]); return; } // nobody is paired yet: only /start <code> does anything
  if (String(m.chat.id) !== owner || String(m.from.id) !== owner) return; // not the owner: no answer at all

  if (cmd) {
    if (cmd[1] === 'waiting') return say_(m.chat.id, waitingText_());
    if (cmd[1] === 'start') return say_(m.chat.id, 'You\'re already connected.\n\n' + HELP_TEXT);
    return say_(m.chat.id, HELP_TEXT);
  }
  capture_(m);
}

// ------------------------------------------------------------------ pairing

function normCode_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function pair_(m, given) {
  var chat = m.chat.id;
  var code = normCode_(setting_('SETUP_CODE'));
  if (!code) return say_(chat, 'This bot isn\'t waiting to be connected.');
  if (normCode_(given) !== code) {
    var tries = Number(setting_('SETUP_TRIES') || 0) + 1;
    if (tries >= 5) { props_().deleteProperty('SETUP_CODE'); props_().deleteProperty('SETUP_TRIES'); return say_(chat, 'Too many wrong codes. Make a new code in the Garden and put it in the script settings again.'); }
    props_().setProperty('SETUP_TRIES', String(tries));
    return say_(chat, 'That code doesn\'t match. Send /start followed by the code shown in your Garden.');
  }
  props_().setProperty('CHAT_ID', String(m.chat.id));
  props_().deleteProperty('SETUP_CODE'); // one-time
  props_().deleteProperty('SETUP_TRIES');
  say_(chat, 'Connected. Only this account can use this bot.\n\n' + HELP_TEXT);
}

// ------------------------------------------------------------------ reading a message

function isForward_(m) { return !!(m.forward_origin || m.forward_from || m.forward_from_chat || m.forward_sender_name || m.forward_date); }
function isImageDoc_(m) { return !!(m.document && ((m.document.mime_type || '').indexOf('image/') === 0 || IMAGE_EXT[extOf_(m.document.file_name)])); }
function extOf_(name) { var x = /\.([A-Za-z0-9]{1,5})$/.exec(name || ''); return x ? x[1].toLowerCase() : ''; }

/** Why the Garden can't keep this message, or null when it can. */
function refusal_(m) {
  var what = null;
  if (m.voice) what = 'voice notes';
  else if (m.audio) what = 'audio files';
  else if (m.video || m.animation) what = 'videos';
  else if (m.video_note) what = 'video messages';
  else if (m.sticker) what = 'stickers';
  else if (m.location || m.venue) what = 'locations';
  else if (m.contact) what = 'contacts';
  else if (m.poll || m.dice || m.game) what = 'that kind of message';
  else if (m.document && !isImageDoc_(m)) what = 'PDFs and other documents';
  else if (!m.text && !m.photo && !m.document) what = 'that kind of message';
  if (what) return 'I can\'t keep ' + what + ' yet, nothing was saved.';
  var size = m.photo ? (m.photo[m.photo.length - 1].file_size || 0) : m.document ? (m.document.file_size || 0) : 0;
  if (size > MAX_BYTES) return 'I can\'t keep files over 20 MB, nothing was saved.';
  return null;
}

function trimUrl_(u) {
  u = u.replace(/[.,;:!?'"]+$/, '');
  if (u.charAt(u.length - 1) === ')' && u.indexOf('(') < 0) u = u.slice(0, -1);
  return u;
}
/** The owner's words with their links taken out: { text, links }. */
function wordsOf_(m) {
  var raw = m.text || m.caption || '';
  var links = [];
  (m.entities || m.caption_entities || []).forEach(function (en) { if (en.type === 'text_link' && en.url) links.push(en.url); });
  var text = raw.replace(/https?:\/\/[^\s<>"]+/gi, function (u) { var t = trimUrl_(u); links.push(t); return ' '; });
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
  return { text: text, links: links.filter(function (l, i) { return links.indexOf(l) === i; }) };
}
function hasPrivate_(s) { return /(^|\s)#private(?![\p{L}\p{N}_-])/iu.test(s || ''); }

function nameOf_(u) { return u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || '' : ''; }
function forwardOf_(m) {
  var o = m.forward_origin, author = '', url = '';
  if (o) {
    if (o.type === 'user') author = nameOf_(o.sender_user);
    else if (o.type === 'hidden_user') author = o.sender_user_name || '';
    else if (o.type === 'chat') author = (o.sender_chat && o.sender_chat.title) || '';
    else if (o.type === 'channel') { author = (o.chat && o.chat.title) || ''; if (o.chat && o.chat.username && o.message_id) url = 'https://t.me/' + o.chat.username + '/' + o.message_id; }
  } else if (m.forward_from) author = nameOf_(m.forward_from);
  else if (m.forward_from_chat) { author = m.forward_from_chat.title || ''; if (m.forward_from_chat.username && m.forward_from_message_id) url = 'https://t.me/' + m.forward_from_chat.username + '/' + m.forward_from_message_id; }
  else author = m.forward_sender_name || '';
  var f = { text: m.text || m.caption || '', author: author };
  if (url) f.url = url;
  return f;
}

// ------------------------------------------------------------------ photos

function fetchImage_(m) {
  var fileId, name;
  if (m.photo) { fileId = m.photo[m.photo.length - 1].file_id; name = 'photo-' + m.message_id + '.jpg'; }
  else {
    fileId = m.document.file_id;
    var ext = extOf_(m.document.file_name) || MIME_EXT[m.document.mime_type] || 'jpg';
    name = 'photo-' + m.message_id + '.' + ext;
  }
  var info = tg_('getFile', { file_id: fileId });
  if (!info.ok || !info.result || !info.result.file_path) throw new Error('Telegram would not give the file');
  var res = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + setting_('BOT_TOKEN') + '/' + info.result.file_path, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('The photo could not be downloaded');
  var blob = res.getBlob();
  if (blob.getBytes().length > MAX_BYTES) throw new Error('too big');
  blob.setName(name);
  return blob;
}

// ------------------------------------------------------------------ saving a capture

function capture_(m) {
  var chat = m.chat.id;
  var no = refusal_(m);
  if (no) return say_(chat, no);
  if (m.media_group_id) return albumPart_(m);
  var hasImage = !!(m.photo || m.document);
  var w = wordsOf_(m);
  var cap = { chat: chat, ids: [m.message_id], sentAt: m.date, text: isForward_(m) ? '' : w.text, links: isForward_(m) ? [] : w.links, images: [], forward: null };
  cap.messageId = String(m.message_id);
  try { if (hasImage) cap.images.push(fetchImage_(m)); }
  catch (e) { return say_(chat, e.message === 'too big' ? 'I can\'t keep files over 20 MB, nothing was saved.' : '✗ Not saved, please send it again'); }

  if (isForward_(m)) {
    cap.forward = forwardOf_(m);
    // Telegram sends the owner's comment as a separate message just before a forward: join it.
    var held = locked_(function () {
      var h = getJson_('hold');
      if (h && m.date - h.date <= JOIN_SECONDS && m.date - h.date >= -1) { props_().deleteProperty('hold'); return h; }
      return null;
    });
    if (held) { cap.text = held.text; cap.ids.unshift(held.id); }
    return finish_(cap);
  }
  if (!hasImage && !cap.links.length) {
    // Words alone might be the comment to a forward that follows: wait a moment before saving.
    locked_(function () { setJson_('hold', { id: m.message_id, date: m.date, text: w.text }); });
    Utilities.sleep(TEXT_WAIT_MS);
    var mine = locked_(function () { var h = getJson_('hold'); if (h && h.id === m.message_id) { props_().deleteProperty('hold'); return true; } return false; });
    if (!mine) return; // a forward took it: that capture sends the receipt
  }
  finish_(cap);
}

function albumPart_(m) {
  var chat = m.chat.id, gid = 'g' + m.media_group_id, stateKey = 'a:' + gid, marker = Utilities.getUuid();
  var blob = null, failed = null;
  try { blob = fetchImage_(m); } catch (e) { failed = e.message === 'too big' ? 'big' : 'fail'; }
  locked_(function () {
    var s = getJson_(stateKey) || { ids: [], files: [], text: '', sentAt: m.date, failed: null };
    s.ids.push(m.message_id);
    s.sentAt = Math.min(s.sentAt, m.date);
    if (failed) s.failed = failed;
    else {
      try {
        if (!s.folderId) s.folderId = inbox_().createFolder('tg-' + gid).getId();
        DriveApp.getFolderById(s.folderId).createFile(blob);
        s.files.push({ name: blob.getName() });
      } catch (e) { s.failed = 'fail'; }
    }
    var w = wordsOf_(m);
    if (w.text) { s.text = s.text ? s.text + '\n' + w.text : w.text; }
    if (w.links.length) s.links = (s.links || []).concat(w.links);
    s.marker = marker;
    setJson_(stateKey, s);
  });
  Utilities.sleep(ALBUM_WAIT_MS);
  var s = locked_(function () { var x = getJson_(stateKey); if (!x || x.marker !== marker) return null; props_().deleteProperty(stateKey); return x; });
  if (!s) return; // a later photo of the album finishes it
  if (s.failed) {
    if (s.folderId) try { DriveApp.getFolderById(s.folderId).setTrashed(true); } catch (e) {}
    return say_(chat, s.failed === 'big' ? 'I can\'t keep files over 20 MB, nothing was saved.' : '✗ Not saved, please send it again');
  }
  var cap = { chat: chat, ids: s.ids, sentAt: s.sentAt, text: s.text, links: s.links || [], images: [], forward: null, messageId: gid, folderId: s.folderId, files: s.files };
  finish_(cap);
}

function receiptText_(cap, priv) {
  var kinds = [];
  if (cap.forward) kinds.push('forwarded post');
  var n = cap.links.length;
  if (n) kinds.push(n === 1 ? 'link' : n + ' links');
  var p = cap.files ? cap.files.length : cap.images.length;
  if (p) kinds.push(p === 1 ? 'photo' : p + ' photos');
  if (!kinds.length) kinds.push('note');
  var when = Utilities.formatDate(new Date(cap.sentAt * 1000), Session.getScriptTimeZone(), 'HH:mm');
  return '✓ Saved · ' + kinds.join(', ') + ' · ' + when + (priv ? ' · Private' : '');
}

/** Put the capture in Drive (photos, then the description last), answer, and remember to tidy up once the Garden has it. */
function finish_(cap) {
  var name = 'tg-' + cap.messageId, priv = hasPrivate_(cap.text);
  var folder = null;
  try {
    var parent = inbox_();
    if (getJson_('p:' + name) || (!cap.folderId && parent.getFoldersByName(name).hasNext())) return; // already saved: kept once
    if (cap.folderId) folder = DriveApp.getFolderById(cap.folderId);
    else {
      folder = parent.createFolder(name);
      cap.images.forEach(function (b) { folder.createFile(b); });
      cap.files = cap.images.map(function (b) { return { name: b.getName() }; });
    }
    var desc = { messageId: cap.messageId, sentAt: new Date(cap.sentAt * 1000).toISOString(), links: cap.links, files: cap.files };
    if (cap.text) desc.text = cap.text;
    if (priv) desc.private = true;
    if (cap.forward) desc.forward = cap.forward;
    folder.createFile(Utilities.newBlob(JSON.stringify(desc), 'application/json', DESCRIPTION_FILE)); // LAST
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    if (folder) try { folder.setTrashed(true); } catch (e2) {}
    return say_(cap.chat, '✗ Not saved, please send it again');
  }
  var r = say_(cap.chat, receiptText_(cap, priv));
  setJson_('p:' + name, { chat: cap.chat, ids: cap.ids, receipt: r && r.ok ? r.result.message_id : null, sentAt: cap.sentAt });
}

// ------------------------------------------------------------------ after the Garden has taken a capture

/** Runs every ~10 minutes: for each capture that has left Drive, delete the owner's message and edit the receipt. */
function checkPickedUp() {
  var parent;
  try { parent = inbox_(); } catch (e) { return; } // Drive unreachable: never guess that a capture was taken
  var all = props_().getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('p:') !== 0) return;
    var name = k.slice(2), p = getJson_(k);
    if (!p) return props_().deleteProperty(k);
    if (parent.getFoldersByName(name).hasNext()) return; // still waiting for the Mac
    (p.ids || []).forEach(function (id) { tg_('deleteMessage', { chat_id: p.chat, message_id: id }); }); // Telegram refuses after 48 h: then it stays
    if (p.receipt) tg_('editMessageText', { chat_id: p.chat, message_id: p.receipt, text: '✓ In your Garden' });
    props_().deleteProperty(k);
  });
}

function dayWord_(sec) {
  var tz = Session.getScriptTimeZone(), f = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var d = new Date(sec * 1000), now = new Date(), y = new Date(now.getTime() - 864e5);
  var day = f(d) === f(now) ? 'today' : f(d) === f(y) ? 'yesterday' : Utilities.formatDate(d, tz, 'd MMM');
  return day + ' ' + Utilities.formatDate(d, tz, 'HH:mm');
}
function waitingText_() {
  var parent;
  try { parent = inbox_(); } catch (e) { return 'I can\'t reach the Drive folder right now.'; }
  var all = props_().getProperties(), waiting = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('p:') !== 0) return;
    var p = getJson_(k);
    if (p && parent.getFoldersByName(k.slice(2)).hasNext()) waiting.push(p.sentAt);
  });
  if (!waiting.length) return 'Nothing is waiting. Everything you sent is in your Garden.';
  var oldest = Math.min.apply(null, waiting);
  return waiting.length === 1
    ? '1 capture is waiting for your Mac, from ' + dayWord_(oldest)
    : waiting.length + ' captures are waiting for your Mac, the oldest from ' + dayWord_(oldest);
}

// ------------------------------------------------------------------ the heartbeat and setup (run these from the editor)

/** Runs daily. The Garden warns if this file is more than a day old. */
function heartbeat() {
  var parent = inbox_(), files = parent.getFilesByName(HEARTBEAT_FILE), now = new Date().toISOString();
  if (files.hasNext()) files.next().setContent(now); else parent.createFile(HEARTBEAT_FILE, now);
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkPickedUp').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('heartbeat').timeBased().everyDays(1).atHour(6).create();
  heartbeat();
  console.log('Triggers installed and the heartbeat written.');
}

/** Tells Telegram to call this script. Run after "Deploy → New deployment → Web app". */
function connectBot() {
  var url = ScriptApp.getService().getUrl(), secret = setting_('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Deploy the web app first, and set WEBHOOK_SECRET.');
  var r = tg_('setWebhook', { url: url + '?secret=' + encodeURIComponent(secret), allowed_updates: ['message'], drop_pending_updates: true });
  tg_('setMyCommands', { commands: [{ command: 'waiting', description: 'What is waiting for your Mac' }, { command: 'help', description: 'What I can keep' }] });
  console.log(r.ok ? 'Connected: Telegram will now call this script.' : 'Telegram said no: ' + (r.description || 'unknown'));
}

/** Checks every setting without printing any secret. */
function checkSetup() {
  var say = function (ok, what) { console.log((ok ? '✓ ' : '✗ ') + what); };
  ['BOT_TOKEN', 'INBOX_FOLDER_ID', 'WEBHOOK_SECRET'].forEach(function (k) { say(!!setting_(k), k + (setting_(k) ? ' is set' : ' is missing')); });
  say(!!setting_('CHAT_ID'), setting_('CHAT_ID') ? 'Paired with your account' : 'Not paired yet: send /start <code> to the bot' + (setting_('SETUP_CODE') ? '' : ' (SETUP_CODE is missing too)'));
  try { say(true, 'Drive folder: ' + inbox_().getName()); } catch (e) { say(false, 'The Drive folder can\'t be opened: check INBOX_FOLDER_ID'); }
  var me = tg_('getMe');
  say(me.ok, me.ok ? 'Bot: @' + me.result.username : 'Telegram doesn\'t accept the BOT_TOKEN');
  var wh = tg_('getWebhookInfo');
  if (wh.ok) {
    say(!!wh.result.url, wh.result.url ? 'Webhook is connected' : 'Webhook not connected: run connectBot');
    if (wh.result.last_error_message) say(false, 'Telegram\'s last complaint: ' + wh.result.last_error_message);
  }
  say(ScriptApp.getProjectTriggers().length >= 2, 'Triggers: ' + ScriptApp.getProjectTriggers().length + ' installed');
}

// Lets the tests load this file; Apps Script has no `module`, so this does nothing there.
if (typeof module !== 'undefined') module.exports = { doPost: doPost, checkPickedUp: checkPickedUp, heartbeat: heartbeat, installTriggers: installTriggers, connectBot: connectBot, checkSetup: checkSetup, receiptText_: receiptText_, wordsOf_: wordsOf_, hasPrivate_: hasPrivate_ };
