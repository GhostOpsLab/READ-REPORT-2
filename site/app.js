(function () {
  "use strict";

  var QUIZ_SIZE = 6;
  var PASS_PCT = 80;
  var DAYS_NEEDED = 2;
  var LEVEL_XP = 50;
  var MONTHS = ["Januarie", "Februarie", "Maart", "April", "Mei", "Junie", "Julie", "Augustus", "September", "Oktober", "November", "Desember"];
  var DAYS = ["Sondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrydag", "Saterdag"];

  var S = { me: null, index: null, progress: null, content: {}, run: null, view: null };
  var app = document.getElementById("app");

  /* ---------- helpers ---------- */
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function btn(label, cls, fn) {
    var b = h("button", "btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function clear() { app.textContent = ""; return app; }
  function shuffle(a) {
    var b = a.slice();
    for (var i = b.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = b[i]; b[i] = b[j]; b[j] = t; }
    return b;
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dateStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return dateStr(new Date()); }
  function parseDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function longDate(d) { return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  function shortDate(d) { return DAYS[d.getDay()].slice(0, 3) + " " + d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3); }
  function daysUntil(d) { var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / 86400000); }
  function toast(msg) {
    var t = h("div", "toast", msg);
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }

  function api(method, path, body) {
    return fetch("/api" + path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || "Fout"); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  /* ---------- progress model ---------- */
  function defaultProgress() { return { v: 1, xp: 0, runs: 0, days: [], bestStreak: 0, topics: {} }; }
  function tp(id) {
    var t = S.progress.topics[id];
    if (!t) t = S.progress.topics[id] = { attempts: 0, lastPct: 0, best: 0, days: [], q: {}, tags: {} };
    return t;
  }
  function save() {
    return api("PUT", "/progress", { progress: S.progress }).catch(function (e) {
      if (e.status === 401) { toast("Jy is uitgeteken. Teken weer in."); setTimeout(showLogin, 1500); }
      else toast("Kon nie vordering stoor nie. Probeer weer.");
    });
  }
  function isMastered(id) { var t = S.progress.topics[id]; return !!t && t.days.length >= DAYS_NEEDED; }
  function streak() {
    var set = {}, d = new Date(), n = 0;
    S.progress.days.forEach(function (x) { set[x] = true; });
    if (!set[dateStr(d)]) d.setDate(d.getDate() - 1);
    while (set[dateStr(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function allTopics() {
    var out = [];
    S.index.exams.forEach(function (ex) { ex.topics.forEach(function (t) { out.push({ exam: ex, topic: t }); }); });
    return out;
  }
  function findTopic(id) {
    var all = allTopics();
    for (var i = 0; i < all.length; i++) if (all[i].topic.id === id) return all[i];
    return null;
  }
  function status(t) {
    if (!t.file) return { cls: "soon", text: "Inhoud kom" };
    var p = S.progress.topics[t.id];
    if (!p || !p.attempts) return { cls: "todo", text: "Nog nie begin nie" };
    if (p.days.length >= DAYS_NEEDED) return { cls: "go", text: "Klaar" };
    if (p.days.length === 1 && p.lastPct >= PASS_PCT) return { cls: "go", text: "Dag 1 gehaal" };
    if (p.lastPct < PASS_PCT) return { cls: "focus", text: "Fokus nodig" };
    return { cls: "go", text: "Dag 1 gehaal" };
  }
  function examStats(ex) {
    var done = 0;
    ex.topics.forEach(function (t) { if (isMastered(t.id)) done++; });
    return { done: done, total: ex.topics.length };
  }
  function totals() {
    var all = allTopics(), done = 0;
    all.forEach(function (x) { if (isMastered(x.topic.id)) done++; });
    return { done: done, total: all.length };
  }
  function nextExam() {
    for (var i = 0; i < S.index.exams.length; i++) if (daysUntil(parseDate(S.index.exams[i].date)) >= 0) return S.index.exams[i];
    return null;
  }
  function recommended() {
    var exams = S.index.exams.filter(function (e) { return daysUntil(parseDate(e.date)) >= 0; });
    for (var i = 0; i < exams.length; i++) {
      var list = exams[i].topics.filter(function (t) { return t.file && !isMastered(t.id); });
      var focus = list.filter(function (t) { return status(t).cls === "focus"; });
      var pick = focus[0] || list[0];
      if (pick) return { exam: exams[i], topic: pick, reason: focus[0] ? "Hier het jy nog fokus nodig." : "Dit is die volgende eksamen met inhoud gereed." };
    }
    return null;
  }

  /* ---------- goals and badges ---------- */
  function goals() {
    var t = totals(), p = S.progress;
    var wholeExam = S.index.exams.some(function (ex) { var s = examStats(ex); return s.total > 0 && s.done === s.total; });
    var most = t.total > 0 && t.done / t.total >= 0.8;
    return [
      { text: "Voltooi jou eerste missie", ok: p.runs >= 1 },
      { text: "Maak 3 onderwerpe klaar", ok: t.done >= 3 },
      { text: "Studeer 5 dae in 'n ry", ok: (p.bestStreak || 0) >= 5 },
      { text: "Maak een hele eksamen klaar", ok: wholeExam },
      { text: "Maak 80% van al die onderwerpe klaar", ok: most }
    ];
  }
  function badges() {
    var t = totals();
    var wholeExam = S.index.exams.some(function (ex) { var s = examStats(ex); return s.total > 0 && s.done === s.total; });
    return [
      { l: "B", cls: "b1", ok: t.done >= 1, tip: "Brons: 1 onderwerp klaar" },
      { l: "S", cls: "b2", ok: t.done >= 5, tip: "Silwer: 5 onderwerpe klaar" },
      { l: "G", cls: "b3", ok: wholeExam, tip: "Goud: een hele eksamen klaar" },
      { l: "M", cls: "b4", ok: t.total > 0 && t.done / t.total >= 0.8, tip: "Meester: 80% klaar" }
    ];
  }

  /* ---------- screens ---------- */
  function topbar(root) {
    var bar = h("div", "topbar");
    add(bar, h("div", "brand", "Eksamen Arena"));
    var right = h("div", "row");
    var out = h("button", "btn ghost small", "Teken uit");
    out.type = "button";
    out.addEventListener("click", function () { api("POST", "/logout").then(function () { S.me = null; showLogin(); }); });
    add(right, out);
    add(bar, right);
    add(root, bar);
    if (S.me.test) add(root, h("div", "note warn", "TOETS-rekening. Geen e-pos word gestuur nie en die uitslae word nie in die verslae getel nie. Pa kan hierdie rekening terugstel."));
  }

  function showLogin(msg) {
    var root = clear();
    root.className = "wrap narrow";
    add(root, h("h1", null, "Eksamen Arena"));
    add(root, h("p", "muted", "Teken in om te begin leer."));
    var f = h("form");
    var u = h("input"); u.type = "text"; u.autocomplete = "username"; u.autocapitalize = "none"; u.id = "u"; u.required = true;
    var p = h("input"); p.type = "password"; p.autocomplete = "current-password"; p.id = "p"; p.required = true;
    var l1 = h("label", null, "Gebruikersnaam"); l1.htmlFor = "u";
    var l2 = h("label", null, "Wagwoord"); l2.htmlFor = "p";
    var err = h("div", "err", msg || ""); err.setAttribute("role", "alert");
    var go = h("button", "btn", "Teken in"); go.type = "submit";
    var fld1 = add(h("div", "field"), l1, u), fld2 = add(h("div", "field"), l2, p);
    f.style.display = "flex"; f.style.flexDirection = "column"; f.style.gap = "14px";
    add(f, fld1, fld2, err, go);
    f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      go.disabled = true; err.textContent = "";
      api("POST", "/login", { username: u.value.trim(), password: p.value }).then(function () { boot(); })
        .catch(function (e) { err.textContent = e.message; go.disabled = false; });
    });
    add(root, f);
    u.focus();
  }

  function renderHome() {
    var root = clear();
    root.className = "wrap";
    S.run = null; S.view = null;
    topbar(root);

    var xp = S.progress.xp, lvl = 1 + Math.floor(xp / LEVEL_XP), into = xp % LEVEL_XP;
    var hud = h("section", "hud");
    add(hud, h("div", "avatar", (S.me.name || "?").charAt(0).toUpperCase()));
    var mid = h("div");
    var top = add(h("div", "hud-top"), h("span", "hud-name", S.me.name), h("span", "hud-lvl", "Vlak " + lvl));
    var bar = h("div", "bar"); var fill = h("i"); fill.style.width = Math.round(into / LEVEL_XP * 100) + "%"; add(bar, fill);
    bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", "XP tot volgende vlak");
    bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(LEVEL_XP)); bar.setAttribute("aria-valuenow", String(into));
    add(mid, top, bar);
    var tt = totals();
    var meta = h("div", "hud-meta");
    [["XP", xp], ["Missies", S.progress.runs], ["Reeks", streak() + " dae"], ["Klaar", tt.done + "/" + tt.total]].forEach(function (m) {
      var s = h("span", null, m[0] + " "); add(s, h("b", null, String(m[1]))); add(meta, s);
    });
    add(hud, mid, meta);
    add(root, hud);

    var nx = nextExam();
    var storm = h("section", "storm");
    var left = h("div");
    if (nx) {
      add(left, h("small", null, "Storm kom nader"), h("h2", null, nx.name), h("div", "muted", longDate(parseDate(nx.date))));
      add(storm, left, add(h("div", "days"), document.createTextNode(String(daysUntil(parseDate(nx.date)))), h("span", null, "dae oor")));
    } else {
      add(left, h("h2", null, "Eksamens is verby"), h("div", "muted", "Goed gedoen!"));
      add(storm, left);
    }
    add(root, storm);

    var rec = recommended();
    var mission = h("section", "mission");
    var head = h("div", "mission-head");
    var hl = h("div");
    if (rec) {
      add(hl, h("h2", null, "Vandag se missie"), h("p", null, rec.topic.name + " (" + rec.exam.name + "). " + rec.reason));
      add(head, hl, btn("Begin", null, function () { location.hash = "#/t/" + rec.topic.id; }));
    } else {
      add(hl, h("h2", null, "Vandag se missie"), h("p", null, "Daar is nog geen onderwerp met inhoud gereed nie. Wag vir Pa se nuwe inhoud."));
      add(head, hl);
    }
    add(mission, head);
    add(root, mission);

    var sec = h("section");
    add(sec, add(h("div", "sec-title"), h("h2", null, "Eksamen-kaart"), h("p", null, "Maak 'n sone oop om die onderwerpe te sien.")));
    var map = h("div", "map");
    S.index.exams.forEach(function (ex) {
      var past = daysUntil(parseDate(ex.date)) < 0;
      var z = h("details", "zone" + (nx && ex.id === nx.id ? " next" : ""));
      if (nx && ex.id === nx.id) z.open = true;
      var sm = h("summary");
      var st = examStats(ex);
      var b = h("div", "bar thin"); var f = h("i"); f.style.width = (st.total ? Math.round(st.done / st.total * 100) : 0) + "%"; add(b, f);
      add(sm, h("div", "zone-date", shortDate(parseDate(ex.date)) + (past ? " (verby)" : "")), h("div", "zone-name", ex.name), b,
        add(h("div", "zone-foot"), h("span", null, st.done + " van " + st.total + " klaar"), h("span", null, ex.bring || "")));
      add(z, sm);
      var body = h("div", "zone-body");
      if (ex.note) add(body, h("div", "zone-note", ex.note));
      ex.topics.forEach(function (t) {
        var s = status(t);
        var row = h("button", "trow"); row.type = "button";
        add(row, h("span", null, t.name), h("span", "chip " + s.cls, s.text));
        row.addEventListener("click", function () { location.hash = "#/t/" + t.id; });
        add(body, row);
      });
      add(z, body);
      add(map, z);
    });
    add(sec, map);
    add(root, sec);

    var g = goals(), allOk = g.every(function (x) { return x.ok; });
    var rs = h("section");
    add(rs, add(h("div", "sec-title"), h("h2", null, "Prys en doelwitte"), h("p", null, "Haal al die doelwitte om die prys te wen.")));
    var cards = h("div", "rewards");
    var c1 = h("div", "card");
    add(c1, h("h3", null, "Die prys"), h("div", "prize" + (allOk ? "" : " locked"), allOk ? S.index.meta.prize : "Gesluit"),
      h("p", null, allOk ? "Jy het dit verdien! Wys vir Pa." : "Word ontsluit wanneer al die doelwitte gehaal is."));
    var c2 = h("div", "card"); var ul = h("ul", "tasks");
    g.forEach(function (x) { add(ul, h("li", x.ok ? "done" : "", x.text)); });
    add(c2, h("h3", null, "Doelwitte"), ul);
    var c3 = h("div", "card"); var bg = h("div", "badges");
    badges().forEach(function (x) { var e = h("div", "badge " + x.cls + (x.ok ? " on" : ""), x.l); e.title = x.tip; e.setAttribute("aria-label", x.tip + (x.ok ? " (verdien)" : " (nog nie)")); add(bg, e); });
    add(c3, h("h3", null, "Medaljes"), bg, h("p", null, "Brons, silwer, goud en meester."));
    add(cards, c1, c2, c3);
    add(rs, cards);
    add(root, rs);
  }

  /* ---------- topic flow ---------- */
  function loadContent(t) {
    if (S.content[t.id]) return Promise.resolve(S.content[t.id]);
    return fetch("/content/" + t.file, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("Kon nie die inhoud laai nie");
      return r.json();
    }).then(function (c) { S.content[t.id] = c; return c; });
  }

  function renderTopic(id) {
    var found = findTopic(id);
    if (!found) { location.hash = "#/"; return; }
    var root = clear();
    root.className = "wrap";
    topbar(root);
    var back = btn("Terug na die kaart", "ghost small", function () { location.hash = "#/"; });
    add(root, back);
    var panel = h("section", "mission");
    panel.setAttribute("aria-live", "polite");
    add(root, panel);
    S.view = { id: id, exam: found.exam, topic: found.topic, panel: panel, content: null };
    if (!found.topic.file) { introScreen(); return; }
    add(panel, h("p", "muted", "Laai..."));
    loadContent(found.topic).then(function (c) { S.view.content = c; introScreen(); })
      .catch(function (e) { panel.textContent = ""; add(panel, h("p", "err", e.message)); });
  }

  function titleBlock(panel, V, sub) {
    var head = h("div", "mission-head");
    var l = h("div");
    add(l, h("h2", null, V.topic.name), h("p", null, V.exam.name + (V.topic.pages ? " | " + V.topic.pages : "") + (sub ? " | " + sub : "")));
    add(head, l);
    add(panel, head);
    return head;
  }

  function introScreen() {
    var V = S.view, panel = V.panel;
    panel.textContent = "";
    var head = titleBlock(panel, V);
    var s = status(V.topic);
    add(head, h("span", "chip " + s.cls, s.text));
    if (!V.topic.file) {
      add(panel, h("p", null, "Die inhoud vir hierdie onderwerp is nog nie gereed nie. Stuur Pa die foto's van die bladsye, dan maak ons dit gereed."));
      return;
    }
    if (V.content.sample) add(panel, h("div", "note warn", "Voorbeeld-inhoud. Dit is nog nie uit jou handboek nie en is nog nie deur Pa goedgekeur nie."));
    var p = S.progress.topics[V.id];
    var gotDays = p ? p.days.length : 0;
    add(panel, h("p", "hint", "Om hierdie onderwerp te klaar, haal jy " + PASS_PCT + "% of meer op " + DAYS_NEEDED + " verskillende dae. Dae gehaal: " + gotDays + " van " + DAYS_NEEDED + "."));
    var weak = p ? Object.keys(p.tags).filter(function (k) { return p.tags[k] > 0; }) : [];
    var row = h("div", "row");
    if (weak.length) {
      add(row, btn("Lees notas oor my swak plekke", null, function () { startRead(weak); }));
      add(row, btn("Lees al die notas", "ghost", function () { startRead(null); }));
      add(row, btn("Gaan reguit na die toets", "ghost", startQuiz));
    } else {
      add(row, btn("Begin met die notas", null, function () { startRead(null); }));
      add(row, btn("Slaan oor na die toets", "ghost", startQuiz));
    }
    add(panel, row);
  }

  function startRead(tags) {
    var V = S.view;
    var cards = V.content.cards;
    if (tags) {
      var f = cards.filter(function (c) { return tags.indexOf(c.id) >= 0; });
      if (f.length) cards = f;
    }
    V.cards = cards; V.ci = 0;
    readScreen();
  }

  function readScreen() {
    var V = S.view, panel = V.panel, c = V.cards[V.ci];
    panel.textContent = "";
    titleBlock(panel, V, "Notas " + (V.ci + 1) + " van " + V.cards.length);
    var bar = h("div", "bar"); var f = h("i"); f.style.width = Math.round((V.ci + 1) / V.cards.length * 100) + "%"; add(bar, f); add(panel, bar);
    var card = h("div", "rcard");
    add(card, h("h3", null, c.title));
    (c.body || []).forEach(function (line) { add(card, h("p", null, line)); });
    if (c.points && c.points.length) { var ul = h("ul"); c.points.forEach(function (x) { add(ul, h("li", null, x)); }); add(card, ul); }
    if (c.example) add(card, h("div", "eg", c.example));
    add(panel, card);
    var row = h("div", "row");
    if (V.ci > 0) add(row, btn("Terug", "ghost", function () { V.ci--; readScreen(); }));
    if (V.ci < V.cards.length - 1) add(row, btn("Volgende", null, function () { V.ci++; readScreen(); }));
    else add(row, btn("Gaan toets", null, startQuiz));
    add(row, btn("Slaan oor na toets", "ghost", startQuiz));
    add(panel, row);
  }

  function pickQuestions(V) {
    var p = S.progress.topics[V.id];
    var scored = V.content.questions.map(function (q) {
      var rec = p && p.q[q.id];
      var s = Math.random();
      if (!rec) s += 2;
      else { if (rec.last === false) s += 3; s += Math.min(rec.wrong || 0, 3) * 0.5; }
      return { q: q, s: s };
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    return shuffle(scored.slice(0, Math.min(QUIZ_SIZE, scored.length)).map(function (x) {
      var q = x.q;
      return { id: q.id, q: q.q, opts: shuffle(q.options), a: q.answer, hint: q.hint, why: q.why, tags: q.tags || [] };
    }));
  }

  function startQuiz() {
    var V = S.view;
    S.run = { i: 0, score: 0, hints: 0, wrong: [], start: Date.now(), items: pickQuestions(V), answered: false, hintShown: false };
    quizScreen();
  }

  function quizScreen() {
    var V = S.view, r = S.run, it = r.items[r.i], panel = V.panel;
    r.answered = false; r.hintShown = false;
    panel.textContent = "";
    var meta = h("div", "qmeta");
    add(meta, h("span", null, "Vraag " + (r.i + 1) + " van " + r.items.length), h("span", null, "Reg: " + r.score));
    add(panel, meta);
    var bar = h("div", "bar"); var f = h("i"); f.style.width = Math.round(r.i / r.items.length * 100) + "%"; add(bar, f); add(panel, bar);
    add(panel, h("div", "qtext", it.q));
    var opts = h("div", "opts");
    it.opts.forEach(function (o) {
      var b = h("button", "opt", o); b.type = "button";
      b.addEventListener("click", function () { answer(b, o); });
      add(opts, b);
    });
    add(panel, opts);
    var area = h("div"); area.id = "fb"; add(panel, area);
    var row = h("div", "row"); row.id = "actions";
    var hb = h("button", "btn ghost", "Wenk"); hb.type = "button";
    hb.addEventListener("click", function () {
      if (r.answered || r.hintShown) return;
      r.hintShown = true; r.hints++; hb.disabled = true;
      add(area, h("div", "hint", "Wenk: " + it.hint));
    });
    add(row, hb); add(panel, row);
  }

  function answer(b, chosen) {
    var V = S.view, r = S.run, it = r.items[r.i];
    if (r.answered) return;
    r.answered = true;
    var all = V.panel.querySelectorAll(".opt");
    for (var k = 0; k < all.length; k++) { all[k].disabled = true; if (all[k].textContent === it.a) all[k].classList.add("right"); }
    var ok = chosen === it.a;
    var rec = tp(V.id).q[it.id] || (tp(V.id).q[it.id] = { seen: 0, wrong: 0, last: true });
    rec.seen++; rec.last = ok;
    var tags = tp(V.id).tags;
    if (ok) {
      r.score++;
      it.tags.forEach(function (t) { if (tags[t] > 0) tags[t]--; });
    } else {
      b.classList.add("wrong");
      rec.wrong++;
      r.wrong.push(it);
      it.tags.forEach(function (t) { tags[t] = (tags[t] || 0) + 1; });
    }
    var fb = document.getElementById("fb"); fb.textContent = "";
    var box = h("div", "feedback " + (ok ? "good" : "bad"));
    add(box, h("b", null, ok ? "Reg!" : "Nie heeltemal nie."), document.createTextNode(it.why));
    add(fb, box);
    var act = document.getElementById("actions"); act.textContent = "";
    var last = r.i === r.items.length - 1;
    add(act, btn(last ? "Sien my uitslag" : "Volgende vraag", null, function () { if (last) finish(); else { r.i++; quizScreen(); } }));
  }

  function finish() {
    var V = S.view, r = S.run, n = r.items.length;
    var pct = Math.round(r.score / n * 100);
    var t = tp(V.id), td = today();
    var wasMastered = t.days.length >= DAYS_NEEDED;
    var gotDay = false, already = false;
    t.attempts++; t.lastPct = pct; if (pct > t.best) t.best = pct;
    if (pct >= PASS_PCT) {
      if (t.days.indexOf(td) < 0) { t.days.push(td); gotDay = true; } else already = true;
    }
    var nowMastered = t.days.length >= DAYS_NEEDED;
    var gained = Math.max(0, r.score * 10 - r.hints * 3);
    var bonus = (!wasMastered && nowMastered) ? 20 : 0;
    S.progress.xp += gained + bonus;
    S.progress.runs++;
    if (S.progress.days.indexOf(td) < 0) S.progress.days.push(td);
    var st = streak();
    if (st > (S.progress.bestStreak || 0)) S.progress.bestStreak = st;

    var statusText;
    if (nowMastered) statusText = "Klaar (80%+ op 2 dae)";
    else if (pct >= PASS_PCT && gotDay) statusText = "Dag 1 gehaal, hertoets op 'n ander dag nodig";
    else if (pct >= PASS_PCT) statusText = "80%+ maar dit is dieselfde dag, hertoets môre";
    else if (pct >= 50) statusText = "Amper, kort leesrondte nodig";
    else statusText = "Fokus nodig, begin by die notas";

    save();
    sendReport(V, r, n, pct, statusText);

    var panel = V.panel; panel.textContent = "";
    titleBlock(panel, V, "Uitslag");
    var go = pct >= PASS_PCT;
    var sc = h("div", "score");
    add(sc, h("div", "score-big " + (go ? "go" : "focus"), r.score + "/" + n));
    var side = h("div");
    var guide;
    if (nowMastered) guide = "Klaar! Jy het hierdie onderwerp onder die knie.";
    else if (go && gotDay) guide = "Dag 1 gehaal! Kom 'n ander dag terug vir die hertoets.";
    else if (go) guide = "Mooi so! Jy het dit vandag reeds gehaal. Kom môre terug vir die hertoets.";
    else if (pct >= 50) guide = "Amper daar. Lees die notas oor die foute, dan toets ons weer.";
    else guide = "Ons gaan stadiger. Eers die notas, dan probeer ons weer.";
    add(side, h("div", "guide", guide), h("div", "hint", "+" + (gained + bonus) + " XP" + (bonus ? " (bonus vir Klaar)" : "") + (r.hints ? " (wenke het " + (r.hints * 3) + " XP gekos)" : "")));
    add(sc, side); add(panel, sc);
    if (r.wrong.length) {
      var wl = h("div", "feedback");
      add(wl, h("b", null, "Om weer te kyk:"));
      var ul = h("ul"); ul.style.margin = "8px 0 0"; ul.style.paddingLeft = "20px";
      r.wrong.forEach(function (w) { add(ul, h("li", null, w.q + " = " + w.a)); });
      add(wl, ul); add(panel, wl);
    }
    var row = h("div", "row");
    var weak = Object.keys(t.tags).filter(function (k) { return t.tags[k] > 0; });
    if (!go && weak.length) add(row, btn("Lees notas oor my foute", null, function () { startRead(weak); }));
    if (!nowMastered) add(row, btn("Nog 'n rondte", "ghost", startQuiz));
    add(row, btn("Terug na die kaart", "ghost", function () { location.hash = "#/"; }));
    add(panel, row);
    S.run = null;
  }

  function sendReport(V, r, n, pct, statusText) {
    var body = {
      subject: V.exam.name, topic: V.topic.name, topicId: V.id, score: r.score, total: n, pct: pct,
      status: statusText, seconds: Math.round((Date.now() - r.start) / 1000),
      device: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "foon" : "rekenaar",
      wrongTags: [].concat.apply([], r.wrong.map(function (w) { return w.tags; })),
      wrong: r.wrong.map(function (w) { return w.q + " = " + w.a; })
    };
    api("POST", "/result", body).catch(function () {});
    if (!S.me.notify) return;
    var detail = body.wrong.length ? body.wrong.join("\n") : "Geen foute nie.";
    var verslag = S.me.name + " het 'n toets gedoen: " + V.topic.name + " (" + V.exam.name + ")\n" +
      "Uitslag: " + r.score + "/" + n + " (" + pct + "%)\nWenke gebruik: " + r.hints + "\nStatus: " + statusText + "\n" +
      (body.wrong.length ? "Foute:\n" + detail : "Geen foute nie.");
    var params = new URLSearchParams({
      "form-name": "uitslag", "bot-field": "",
      gebruiker: S.me.username, vak: V.exam.name, onderwerp: V.topic.name,
      telling: r.score + "/" + n, persentasie: String(pct), status: statusText, wenke: String(r.hints),
      foute: String(body.wrong.length), tyd_sekondes: String(body.seconds), dag: today(), toestel: body.device,
      detail: detail, verslag: verslag
    });
    fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }).catch(function () {});
  }

  /* ---------- routing and boot ---------- */
  function route() {
    if (!S.me || !S.index || !S.progress) return;
    var m = /^#\/t\/([a-z0-9-]+)$/.exec(location.hash);
    if (m) renderTopic(m[1]); else renderHome();
    window.scrollTo({ top: 0 });
  }

  function boot() {
    api("GET", "/me").then(function (me) {
      if (me.role === "admin") { location.href = "/admin.html"; return null; }
      S.me = me;
      return Promise.all([
        fetch("/content/index.json", { credentials: "same-origin" }).then(function (r) { return r.json(); }),
        api("GET", "/progress")
      ]);
    }).then(function (res) {
      if (!res) return;
      S.index = res[0];
      var p = res[1].progress;
      S.progress = (p && p.topics) ? p : defaultProgress();
      route();
    }).catch(function (e) {
      if (e.status === 401) showLogin(); else { clear(); add(app, h("p", "err", "Kon nie laai nie: " + e.message)); }
    });
  }

  window.addEventListener("hashchange", route);
  boot();
})();
