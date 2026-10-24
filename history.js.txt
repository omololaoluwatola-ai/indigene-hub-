/* INDIGENE history helper
   Shared by index.html and every CBT / past-question / mock page.
   One record is saved per finished attempt. Stored on this device, keyed by the logged-in user
   (index.html writes the user id to localStorage "indigene_uid" after login).

   How a CBT page saves an attempt, once at the end of the run:

   IndigeneHistory.save({
     course: "PHY101",              // course code, same as on the homepage
     mode: "cbt",                   // "cbt" | "past" | "mock"
     correct: 31,                   // number right
     total: 40,                     // number of questions answered or shown
     secs: 540,                     // time taken in seconds (optional)
     topics: { "Vectors": [4, 6], "Kinematics": [2, 5] }   // topic: [right, total] (optional, powers Weak Topics)
   });
*/
(function () {
  var VERSION = "v1";
  var MAX_ATTEMPTS = 300;

  function uid() {
    try { return localStorage.getItem("indigene_uid") || "guest"; } catch (e) { return "guest"; }
  }

  function key() {
    return "indigene_history_" + VERSION + "_" + uid();
  }

  function getAll() {
    try {
      var list = JSON.parse(localStorage.getItem(key()) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function save(entry) {
    try {
      if (!entry || !entry.course) return false;
      var total = Number(entry.total) || 0;
      if (total <= 0) return false;
      var correct = Math.max(0, Math.min(total, Number(entry.correct) || 0));
      var rec = {
        course: String(entry.course).toUpperCase(),
        mode: entry.mode || "cbt",
        correct: correct,
        total: total,
        score: Math.round((correct / total) * 100),
        secs: Number(entry.secs) || 0,
        topics: entry.topics || {},
        ts: Date.now()
      };
      var list = getAll();
      list.push(rec);
      if (list.length > MAX_ATTEMPTS) list = list.slice(list.length - MAX_ATTEMPTS);
      localStorage.setItem(key(), JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Attempts finished before login was known are saved under "guest". Move them to the real account once it is known.
  function adoptGuest() {
    try {
      var id = uid();
      if (id === "guest") return;
      var gk = "indigene_history_" + VERSION + "_guest";
      var guest = JSON.parse(localStorage.getItem(gk) || "[]");
      if (!Array.isArray(guest) || !guest.length) { localStorage.removeItem(gk); return; }
      var merged = getAll().concat(guest).sort(function (a, b) { return a.ts - b.ts; });
      if (merged.length > MAX_ATTEMPTS) merged = merged.slice(merged.length - MAX_ATTEMPTS);
      localStorage.setItem(key(), JSON.stringify(merged));
      localStorage.removeItem(gk);
    } catch (e) {}
  }

  window.IndigeneHistory = { save: save, getAll: getAll, adoptGuest: adoptGuest };
})();
