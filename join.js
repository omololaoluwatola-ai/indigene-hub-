// INDIGENE WhatsApp channel card: sits at the top of <main>, styled like the install bar.
// One file, linked with <script src="join.js"></script> on index.html. Nothing else to edit.
// Flow:
//  1. Student taps Join  -> channel opens, we remember "tapped".
//  2. When they come back to the page -> the card asks "Did you join?"
//       Yes, joined -> card slides away for good.
//       Not yet     -> card goes back to normal so they can try again.
// WhatsApp cannot tell us who really joined, so the student's own answer is the signal.
(function () {
  var LINK = 'https://whatsapp.com/channel/0029VbE57zCIt5ryAnEeTN2o';
  var KEY = 'indigene_wa_channel'; // 'joined' | 'tapped'

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { v === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, v); } catch (e) {} }

  if (get() === 'joined') return;

  var WA = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z';

  var css = document.createElement('style');
  css.textContent =
    '#indigeneJoin{position:relative;display:flex;align-items:center;gap:10px;height:44px;padding:0 12px;margin:14px 0 -8px;border-radius:12px;overflow:hidden;' +
    'background:linear-gradient(90deg,rgba(255,122,26,.20),rgba(255,122,26,.06) 70%,rgba(255,122,26,.02));' +
    'border:1px solid rgba(255,122,26,.28);font-family:var(--body,system-ui,sans-serif);color:var(--parchment,#f2e6d8);' +
    'transition:opacity .35s ease,height .35s ease,margin .35s ease;}' +
    '#indigeneJoin.ij-out{opacity:0;height:0;margin:0;border-width:0;}' +
    '#indigeneJoin .ij-ic{width:26px;height:26px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#120b09;border:1px solid rgba(255,122,26,.45);}' +
    '#indigeneJoin .ij-ic svg{width:15px;height:15px;fill:var(--gold,#e8b84b);display:block;}' +
    '#indigeneJoin .ij-t{flex:1;min-width:0;font-size:.8rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '#indigeneJoin .ij-t b{font-weight:600;color:var(--gold,#e8b84b);}' +
    '#indigeneJoin .ij-t i{font-style:normal;color:var(--ash-dim,#7a6a5d);margin-left:6px;font-size:.72rem;}' +
    '#indigeneJoin .ij-b{flex-shrink:0;height:26px;padding:0 14px;display:inline-flex;align-items:center;border:none;border-radius:999px;cursor:pointer;text-decoration:none;font-family:inherit;font-weight:700;font-size:.74rem;letter-spacing:.03em;color:#fff;background:linear-gradient(135deg,var(--ember,#ff7a1a),var(--ember-deep,#8a2c0c));box-shadow:0 0 12px rgba(255,122,26,.35);}' +
    '#indigeneJoin .ij-b:active{transform:scale(.94)}' +
    '#indigeneJoin .ij-b.ij-ghost{background:transparent;color:var(--ash-dim,#a89484);box-shadow:none;border:1px solid rgba(255,255,255,.14);padding:0 11px;}' +
    '#indigeneJoin .ij-sp{display:flex;gap:6px;flex-shrink:0;}' +
    '@media (max-width:340px){#indigeneJoin .ij-t i{display:none}}';
  document.head.appendChild(css);

  var card = null;

  function esc(s) { return s; }

  function viewAsk() {
    card.innerHTML =
      '<span class="ij-ic"><svg viewBox="0 0 24 24"><path d="' + WA + '"/></svg></span>' +
      '<div class="ij-t"><b>Join INDIGENE Channel</b><i>new CBTs &amp; past questions</i></div>' +
      '<a class="ij-b" id="ijGo" href="' + LINK + '" target="_blank" rel="noopener">Join</a>';
    card.querySelector('#ijGo').addEventListener('click', function () { set('tapped'); });
  }

  function viewConfirm() {
    card.innerHTML =
      '<span class="ij-ic"><svg viewBox="0 0 24 24"><path d="' + WA + '"/></svg></span>' +
      '<div class="ij-t"><b>Did you join?</b></div>' +
      '<div class="ij-sp"><button class="ij-b" id="ijYes" type="button">Joined ✓</button>' +
      '<button class="ij-b ij-ghost" id="ijNo" type="button">Not yet</button></div>';
    card.querySelector('#ijYes').addEventListener('click', function () {
      set('joined');
      card.classList.add('ij-out');
      setTimeout(function () { if (card) { card.remove(); card = null; } }, 400);
    });
    card.querySelector('#ijNo').addEventListener('click', function () { set(null); viewAsk(); });
  }

  function build() {
    var host = document.querySelector('main');
    if (!host || document.getElementById('indigeneJoin')) return;
    card = document.createElement('div');
    card.id = 'indigeneJoin';
    host.insertBefore(card, host.firstChild);
    if (get() === 'tapped') viewConfirm(); else viewAsk();
  }

  // Student comes back from WhatsApp -> ask if they joined.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && card && get() === 'tapped') viewConfirm();
  });

  // This script sits at the end of <body>, so build at once: the card is there before the page shows.
  if (document.querySelector('main')) build(); else document.addEventListener('DOMContentLoaded', build);
})();
