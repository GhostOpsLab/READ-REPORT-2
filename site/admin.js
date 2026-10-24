(function () {
  "use strict";
  var app = document.getElementById("app");
  var topicNames = {};

  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
  function btn(label, cls, fn) { var b = h("button", "btn" + (cls ? " " + cls : ""), label); b.type = "button"; b.addEventListener("click", fn); return b; }
  function api(method, path, body) {
    return fetch("/api" + path, { method: method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) { var e = new Error(d.error || "Fout"); e.status = r.status; throw e; }
          return d;
        });
      });
  }
  function fmt(iso) { if (!iso) return "nooit"; var d = new Date(iso); return d.toLocaleString("af-ZA", { dateStyle: "medium", timeStyle: "short" }); }

  function login(msg) {
    app.textContent = ""; app.className = "wrap narrow";
    add(app, h("h1", null, "Admin"));
    var f = h("form"); f.style.cssText = "display:flex;flex-direction:column;gap:14px";
    var u = h("input"); u.type = "text"; u.id = "au"; u.autocomplete = "username"; u.autocapitalize = "none";
    var p = h("input"); p.type = "password"; p.id = "ap"; p.autocomplete = "current-password";
    var l1 = h("label", null, "Gebruikersnaam"); l1.htmlFor = "au";
    var l2 = h("label", null, "Wagwoord"); l2.htmlFor = "ap";
    var err = h("div", "err", msg || ""); err.setAttribute("role", "alert");
    var go = h("button", "btn", "Teken in"); go.type = "submit";
    add(f, add(h("div", "field"), l1, u), add(h("div", "field"), l2, p), err, go);
    f.addEventListener("submit", function (ev) {
      ev.preventDefault(); go.disabled = true;
      api("POST", "/login", { username: u.value.trim(), password: p.value })
        .then(function () { boot(); }).catch(function (e) { err.textContent = e.message; go.disabled = false; });
    });
    add(app, f);
  }

  function dash() {
    app.textContent = ""; app.className = "wrap wide";
    var bar = h("div", "topbar");
    add(bar, h("div", "brand", "Eksamen Arena Admin"));
    var row = h("div", "row");
    add(row, h("a", "btn ghost small", "Leerder-aansig"), btn("Teken uit", "ghost small", function () { api("POST", "/logout").then(function () { login(); }); }));
    row.firstChild.href = "/";
    row.firstChild.style.textDecoration = "none";
    add(bar, row); add(app, bar);

    var msg = h("div", "err"); msg.setAttribute("role", "status");
    var usersBox = h("section"), resBox = h("section"), progBox = h("section");

    /* create user */
    var cs = h("section");
    add(cs, add(h("div", "sec-title"), h("h2", null, "Nuwe rekening"), h("p", null, "Daar is geen selfregistrasie nie. Net jy maak rekeninge.")));
    var f = h("form", "card"); f.style.marginTop = "12px";
    var grid = h("div", "formgrid");
    function field(label, id, type, ph) {
      var i = h("input"); i.type = type; i.id = id; i.placeholder = ph || ""; i.autocomplete = "off"; i.autocapitalize = "none";
      var l = h("label", null, label); l.htmlFor = id;
      return { el: add(h("div", "field"), l, i), input: i };
    }
    var fName = field("Naam (vertoon)", "cn", "text", "Jacques");
    var fUser = field("Gebruikersnaam", "cu", "text", "jacques");
    var fPass = field("Wagwoord (min. 8)", "cp", "text", "");
    add(grid, fName.el, fUser.el, fPass.el);
    var checks = h("div", "checks");
    var cTest = h("input"); cTest.type = "checkbox"; cTest.id = "ct";
    var cNotify = h("input"); cNotify.type = "checkbox"; cNotify.id = "cn2"; cNotify.checked = true;
    var lt = h("label"); add(lt, cTest, document.createTextNode("Toets-rekening (geen e-pos, nie in verslae)"));
    var ln = h("label"); add(ln, cNotify, document.createTextNode("Stuur uitslae per e-pos"));
    add(checks, lt, ln);
    var submit = h("button", "btn small", "Skep rekening"); submit.type = "submit";
    add(f, grid, checks, submit); f.style.gap = "12px";
    f.addEventListener("submit", function (ev) {
      ev.preventDefault(); msg.textContent = "";
      api("POST", "/admin/users", { username: fUser.input.value, name: fName.input.value, password: fPass.input.value, test: cTest.checked, notify: cNotify.checked })
        .then(function () { fName.input.value = ""; fUser.input.value = ""; fPass.input.value = ""; cTest.checked = false; cNotify.checked = true; loadUsers(); })
        .catch(function (e) { msg.textContent = e.message; });
    });
    add(cs, f);

    add(app, msg, cs, usersBox, progBox, resBox);

    function loadUsers() {
      api("GET", "/admin/users").then(function (d) {
        usersBox.textContent = "";
        add(usersBox, h("div", "sec-title")); add(usersBox.firstChild, h("h2", null, "Rekeninge"));
        var wrap = h("div", "tablewrap"); wrap.style.marginTop = "12px";
        var t = h("table");
        var head = h("tr"); ["Gebruiker", "Naam", "Tipe", "Laaste aanmelding", ""].forEach(function (x) { add(head, h("th", null, x)); });
        add(t, add(h("thead"), head));
        var body = h("tbody");
        d.users.forEach(function (u) {
          var tr = h("tr");
          add(tr, h("td", null, u.username), h("td", null, u.name));
          var tdType = h("td"); add(tdType, h("span", "pill" + (u.test ? " test" : ""), u.test ? "toets" : "regtig"));
          if (!u.notify) add(tdType, document.createTextNode(" "), h("span", "pill", "geen e-pos"));
          add(tr, tdType, h("td", null, fmt(u.lastLogin)));
          var act = h("td"); var r = h("div", "row");
          add(r, btn("Vordering", "ghost small", function () { showProgress(u); }));
          add(r, btn("Nuwe wagwoord", "ghost small", function () {
            var pw = window.prompt("Nuwe wagwoord vir " + u.username + " (min. 8 karakters):");
            if (!pw) return;
            api("POST", "/admin/users/" + encodeURIComponent(u.username) + "/password", { password: pw })
              .then(function () { msg.style.color = "var(--good)"; msg.textContent = "Wagwoord vir " + u.username + " is verander."; })
              .catch(function (e) { msg.style.color = ""; msg.textContent = e.message; });
          }));
          if (u.test) add(r, btn("Stel terug", "ghost small", function () {
            if (!window.confirm("Wis alle vordering en uitslae van " + u.username + "?")) return;
            api("POST", "/admin/users/" + encodeURIComponent(u.username) + "/reset-progress").then(function () { loadResults(); progBox.textContent = ""; })
              .catch(function (e) { msg.textContent = e.message; });
          }));
          add(r, btn("Vee uit", "danger small", function () {
            if (!window.confirm("Vee " + u.username + " en al sy data uit? Dit kan nie ongedaan gemaak word nie.")) return;
            api("DELETE", "/admin/users/" + encodeURIComponent(u.username)).then(function () { loadUsers(); loadResults(); progBox.textContent = ""; })
              .catch(function (e) { msg.textContent = e.message; });
          }));
          add(act, r); add(tr, act); add(body, tr);
        });
        if (!d.users.length) { var tr0 = h("tr"); var td0 = h("td", "muted", "Nog geen rekeninge nie."); td0.colSpan = 5; add(tr0, td0); add(body, tr0); }
        add(t, body); add(wrap, t); add(usersBox, wrap);
      }).catch(function (e) { msg.textContent = e.message; });
    }

    function showProgress(u) {
      api("GET", "/admin/users/" + encodeURIComponent(u.username) + "/progress").then(function (d) {
        var p = d.progress || {};
        progBox.textContent = "";
        add(progBox, add(h("div", "sec-title"), h("h2", null, "Vordering: " + u.name)));
        var meta = h("p", "muted", "XP " + (p.xp || 0) + " | Missies " + (p.runs || 0) + " | Beste reeks " + (p.bestStreak || 0) + " dae");
        add(progBox, meta);
        var wrap = h("div", "tablewrap"); wrap.style.marginTop = "12px";
        var t = h("table"); var head = h("tr");
        ["Onderwerp", "Pogings", "Laaste", "Beste", "Dae 80%+", "Swak kaarte"].forEach(function (x) { add(head, h("th", null, x)); });
        add(t, add(h("thead"), head)); var body = h("tbody");
        Object.keys(p.topics || {}).forEach(function (id) {
          var x = p.topics[id], tr = h("tr");
          var weak = Object.keys(x.tags || {}).filter(function (k) { return x.tags[k] > 0; }).join(", ");
          add(tr, h("td", null, topicNames[id] || id), h("td", null, String(x.attempts)), h("td", null, x.lastPct + "%"), h("td", null, x.best + "%"),
            h("td", null, (x.days || []).join(", ") || "-"), h("td", null, weak || "-"));
          add(body, tr);
        });
        if (!Object.keys(p.topics || {}).length) { var tr0 = h("tr"); var td0 = h("td", "muted", "Nog niks gedoen nie."); td0.colSpan = 6; add(tr0, td0); add(body, tr0); }
        add(t, body); add(wrap, t); add(progBox, wrap);
        progBox.scrollIntoView({ behavior: "smooth", block: "start" });
      }).catch(function (e) { msg.textContent = e.message; });
    }

    function loadResults(includeTest) {
      api("GET", "/admin/results?limit=200" + (includeTest ? "&test=1" : "")).then(function (d) {
        resBox.textContent = "";
        var title = add(h("div", "sec-title"), h("h2", null, "Uitslae"));
        var lab = h("label"); lab.style.cssText = "display:flex;gap:6px;align-items:center;color:var(--ink)";
        var cb = h("input"); cb.type = "checkbox"; cb.checked = !!includeTest;
        cb.addEventListener("change", function () { loadResults(cb.checked); });
        add(lab, cb, document.createTextNode("Wys toets-uitslae"));
        add(title, lab); add(resBox, title);
        var wrap = h("div", "tablewrap"); wrap.style.marginTop = "12px";
        var t = h("table"); var head = h("tr");
        ["Wanneer", "Leerder", "Vak", "Onderwerp", "Telling", "Status", "Foute"].forEach(function (x) { add(head, h("th", null, x)); });
        add(t, add(h("thead"), head)); var body = h("tbody");
        d.results.forEach(function (r) {
          var tr = h("tr");
          add(tr, h("td", null, fmt(r.at)), h("td", null, r.name + (r.test ? " (toets)" : "")), h("td", null, r.subject), h("td", null, r.topic),
            h("td", null, r.score + "/" + r.total + " (" + r.pct + "%)"), h("td", null, r.status), h("td", null, (r.wrong || []).join("; ") || "-"));
          add(body, tr);
        });
        if (!d.results.length) { var tr0 = h("tr"); var td0 = h("td", "muted", "Nog geen uitslae nie."); td0.colSpan = 7; add(tr0, td0); add(body, tr0); }
        add(t, body); add(wrap, t); add(resBox, wrap);
      }).catch(function (e) { msg.textContent = e.message; });
    }

    loadUsers(); loadResults(false);
  }

  function boot() {
    fetch("/content/index.json").then(function (r) { return r.json(); }).then(function (idx) {
      idx.exams.forEach(function (ex) { ex.topics.forEach(function (t) { topicNames[t.id] = ex.name + ": " + t.name; }); });
    }).catch(function () {}).then(function () { return api("GET", "/me"); })
      .then(function (me) { if (me.role !== "admin") login("Hierdie bladsy is net vir admin."); else dash(); })
      .catch(function () { login(); });
  }
  boot();
})();
