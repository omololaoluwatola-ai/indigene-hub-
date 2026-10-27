// INDIGENE protect: stops long-press copy, text selection, right-click menu,
// drag-saving images and common copy/save/print shortcuts.
// Link it once per page, as high up as you can:  <script src="/protect.js"></script>
// Typing boxes (email, password, search, admin forms) still work normally.
(function () {
  var css = document.createElement('style');
  css.textContent =
    'html,body,body *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}' +
    'input,textarea,select,[contenteditable="true"],[contenteditable="true"] *{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;}' +
    'img,svg,canvas,video{-webkit-user-drag:none;user-drag:none;}' +
    '@media print{body{display:none!important}}';
  (document.head || document.documentElement).appendChild(css);

  function typing(t) {
    return t && t.closest && t.closest('input,textarea,select,[contenteditable="true"]');
  }
  function block(e) { if (!typing(e.target)) e.preventDefault(); }

  ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart'].forEach(function (n) {
    document.addEventListener(n, block, true);
  });

  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (k === 'f12' || (c && e.shiftKey && ['i', 'j', 'c'].indexOf(k) > -1) || (c && ['u', 's', 'p'].indexOf(k) > -1) ||
        (c && !typing(e.target) && ['c', 'x', 'a'].indexOf(k) > -1)) {
      e.preventDefault();
    }
  }, true);
})();
