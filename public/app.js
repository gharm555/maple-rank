(async function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.style.cssText = v;
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) n.append(k);
    return n;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs = {}) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // ---------- 데이터 불러오기 ----------
  async function loadJson(path, fallback) {
    try {
      const r = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw 0;
      return await r.json();
    } catch { return fallback; }
  }
  const DEMO = !!window.__DATA__;
  const payload = DEMO ? { config: window.__CONFIG__, data: window.__DATA__ } : await loadJson("/api/data", null);
  if (!payload) { document.body.insertAdjacentHTML("afterbegin", '<p style="color:#fff;text-align:center;padding:20px">데이터를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>'); }
  const config = (payload && payload.config) || { members: [] };
  const data = (payload && payload.data) || {};

  // ---------- 친구 코드 + 쓰기 요청 ----------
  const store = {
    get() { try { return localStorage.getItem("friendCode") || ""; } catch { return ""; } },
    set(v) { try { v ? localStorage.setItem("friendCode", v) : localStorage.removeItem("friendCode"); } catch {} },
  };
  function toast(msg, bad) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = "toast"), 3500);
  }
  async function api(method, path, body) {
    if (DEMO) { toast("미리보기에서는 바꿀 수 없어요", true); return null; }
    const code = store.get();
    if (!code) { openCode(); toast("먼저 친구 코드를 입력해 주세요", true); return null; }
    const r = await fetch(path, {
      method, headers: { "content-type": "application/json", "x-friend-code": code },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    if (!r) { toast("서버에 연결하지 못했어요", true); return null; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { store.set(""); renderCodeBtn(); openCode(); }
    if (!r.ok) { toast(j.error || "요청이 실패했어요", true); return null; }
    return j;
  }
  function renderCodeBtn() {
    $("#codeBtn").textContent = store.get() ? "친구 코드 입력됨" : "친구 코드 입력";
    $("#codeBtn").setAttribute("aria-pressed", String(!!store.get()));
  }
  function openCode() { $("#codeForm").hidden = false; $("#codeInput").focus(); }
  $("#codeBtn").addEventListener("click", () => { const f = $("#codeForm"); f.hidden = !f.hidden; if (!f.hidden) $("#codeInput").focus(); });
  $("#codeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("#codeInput").value.trim();
    if (!v) return;
    store.set(v);
    const ok = await api("POST", "/api/auth");
    if (ok) { toast("친구 코드 확인됐어요"); $("#codeForm").hidden = true; $("#codeInput").value = ""; }
    else store.set("");
    renderCodeBtn();
  });
  renderCodeBtn();
  $("#refreshBtn").addEventListener("click", async () => {
    const b = $("#refreshBtn");
    b.disabled = true; b.textContent = "갱신하는 중…";
    const j = await api("POST", "/api/refresh");
    b.disabled = false; b.textContent = "지금 갱신";
    if (j) {
      const bad = j.results.filter((r) => !r.ok);
      toast(bad.length ? `${bad.length}명은 실패했어요: ${bad[0].error}` : "갱신했어요", bad.length > 0);
      setTimeout(() => location.reload(), 900);
    }
  });
  const latest = data.latest || {};
  const history = data.history || {};

  // ---------- 날짜/숫자 도우미 ----------
  const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
  const now = DEMO && data.updatedAt ? new Date(data.updatedAt) : new Date();
  const today = kst(now);
  const weekStart = (() => {
    const k = new Date(now.getTime() + 9 * 3600e3);
    k.setUTCDate(k.getUTCDate() - ((k.getUTCDay() - 4 + 7) % 7));
    return k.toISOString().slice(0, 10);
  })();
  const fmtPower = (v) => {
    if (!v) return "–";
    if (v >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + "억";
    if (v >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만";
    return v.toLocaleString("ko-KR");
  };
  const fmtTick = (v) => (v >= 1e8 ? +(v / 1e8).toFixed(2) + "억" : v >= 1e4 ? +(v / 1e4).toFixed(1) + "만" : String(Math.round(v)));
  // 성장량(레벨 단위)을 경험치 %로: 1레벨 = 100%
  const pctNum = (g) => { const v = g * 100; return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2); };
  const fmtPct = (g) => (g == null ? "–" : (g >= 0 ? "+" : "") + pctNum(g) + "%");
  const progress = (s) => (s ? s.level + s.expRate / 100 : null);
  const shortDate = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

  // 기준일 이전(미포함)의 마지막 기록
  function lastBefore(h, date) {
    const ds = Object.keys(h).filter((d) => d < date).sort();
    return ds.length ? h[ds[ds.length - 1]] : null;
  }

  // ---------- 멤버 정리 (색은 config 순서로 고정) ----------
  const bossWeek = (data.bossWeeks || {})[weekStart];
  const members = config.members.map((m, i) => {
    const name = m.character;
    const L = latest[name] || {};
    const h = history[name] || {};
    const cur = L.level ? L : null;
    const p = progress(cur);
    const pDay = progress(lastBefore(h, today));
    const pWeek = progress(lastBefore(h, weekStart));
    const wDay = lastBefore(h, weekStart);
    return {
      name, nick: m.nickname || "", color: `var(--series-${(i % 8) + 1})`, idx: i,
      cur, p, h,
      today: p != null && pDay != null ? p - pDay : null,
      week: p != null && pWeek != null ? p - pWeek : null,
      powerWeek: cur && wDay ? cur.power - wDay.power : null,
      boss: bossWeek ? (bossWeek.checks[name] || bossWeek.checks[m.nickname] || []) : null,
    };
  });

  // ---------- 헤더 ----------
  if (config.title) { $("#title").textContent = config.title; document.title = config.title; }
  $("#subtitle").textContent = config.subtitle || "";
  $("#updated").textContent = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " 갱신"
    : "아직 갱신 기록이 없어요";

  function ghost(m) {
    return el("div", { class: "ghost", style: `background:${m.color};color:var(--night)` }, m.name.slice(0, 1));
  }
  function avatar(m) {
    const a = el("div", { class: "ava", style: `--c:${m.color}` });
    if (m.cur && m.cur.image) {
      const img = el("img", { src: m.cur.image, alt: "", loading: "lazy" });
      img.onerror = () => img.replaceWith(el("span", { class: "ghost", text: m.name.slice(0, 1) }));
      a.append(img);
    } else a.append(el("span", { class: "ghost", text: m.name.slice(0, 1) }));
    return a;
  }

  // ---------- 오늘의 성장왕 (없으면 최고 레벨) ----------
  function renderMvp() {
    const box = $("#mvp");
    box.innerHTML = "";
    const grown = members.filter((m) => m.today != null && m.today > 0);
    const ranked = members.filter((m) => m.p != null);
    if (!ranked.length) { box.hidden = true; return; }
    const byToday = grown.length > 0;
    const best = (byToday ? grown : ranked).reduce((a, b) => ((byToday ? b.today > a.today : b.p > a.p) ? b : a));
    const sprite = el("div", { class: "sprite" });
    if (best.cur.image) {
      const img = el("img", { src: best.cur.image, alt: "" });
      img.onerror = () => img.replaceWith(ghost(best));
      sprite.append(img);
    } else sprite.append(ghost(best));
    const stage = el("div", { class: "stage" }, sprite, el("div", { class: "ledge" }),
      el("div", { class: "nametag", text: best.name }),
      best.cur.world ? el("div", { class: "worldtag", text: best.cur.world }) : null,
      best.cur.guild ? el("div", { class: "guildtag", text: best.cur.guild }) : null);
    const hit = byToday
      ? el("p", { class: "hit" }, "+" + pctNum(best.today), el("small", { text: "%" }))
      : el("p", { class: "hit" }, String(best.cur.level), el("small", { text: "Lv" }));
    const who = el("p", { class: "who" }, el("b", { text: best.nick || best.name }),
      byToday ? `님이 오늘 제일 많이 컸어요. 지금 ${best.cur.level}레벨 ${best.cur.expRate.toFixed(2)}%.` : "님이 레벨 1등이에요. 오늘은 아직 아무도 안 컸어요.");
    box.append(stage, el("div", {}, el("p", { class: "what", text: byToday ? "오늘의 성장왕" : "현재 1등" }), hit, who));
  }

  // ---------- 랭킹 ----------
  let sortKey = "level";
  const sorters = {
    level: (m) => m.p, today: (m) => m.today, week: (m) => m.week,
    power: (m) => (m.cur ? m.cur.power : null), boss: (m) => (m.boss ? m.boss.length : null),
  };
  function renderBoard() {
    const f = sorters[sortKey];
    const list = [...members].sort((a, b) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity) || a.idx - b.idx);
    const board = $("#board");
    board.innerHTML = "";
    list.forEach((m, i) => {
      const c = m.cur;
      let big, sub;
      const B = (unit, v) => el("div", { class: "big" }, unit ? el("span", { class: "u", text: unit }) : null, v);
      if (!c) { big = B("", "–"); sub = "아직 기록 없음"; }
      else if (sortKey === "power") { big = B("", fmtPower(c.power)); sub = m.powerWeek > 0 ? `이번 주 +${fmtPower(m.powerWeek)}` : ""; }
      else if (sortKey === "today") { big = B("", fmtPct(m.today)); sub = `${c.level}레벨`; }
      else if (sortKey === "week") { big = B("", fmtPct(m.week)); sub = `${c.level}레벨`; }
      else if (sortKey === "boss") { big = B("", m.boss ? `${m.boss.length}마리` : "–"); sub = ""; }
      else { big = B("LV.", String(c.level)); sub = ""; }

      const rankCls = "rank" + (i < 3 && f(m) != null ? " r" + (i + 1) : "");
      const err = latest[m.name] && latest[m.name].error;
      board.append(el("li", { class: "row" },
        el("div", { class: rankCls, text: String(i + 1) }),
        avatar(m),
        el("div", { class: "who" },
          el("div", { class: "n" }, m.name, m.nick ? el("small", { text: m.nick }) : null),
          el("div", { class: "c" },
            c && c.world ? el("span", { class: "w", text: c.world }) : null,
            c && c.class ? el("span", { text: c.class }) : null,
            c && c.guild ? el("span", { class: "g", text: c.guild }) : null,
            m.today != null && m.today > 0 && sortKey !== "today" ? el("span", { class: "gain", text: "오늘 " + fmtPct(m.today) }) : null),
          err ? el("div", { class: "err", text: err }) : null,
          manage ? el("button", { class: "mini danger", "data-del": m.name, text: "랭킹에서 빼기" }) : null),
        el("div", { class: "stat" }, big, el("div", { class: "sub", text: sub })),
        c ? el("div", { class: "exp", title: `경험치 ${c.expRate}%` },
          el("span", { class: "lab", text: "EXP" }),
          el("div", { class: "track" }, el("div", { class: "fill", style: `width:${Math.min(100, c.expRate)}%` }), el("span", { class: "pct", text: c.expRate.toFixed(3) + "%" })))
          : null));
    });
  }
  // ---------- 캐릭터 관리 ----------
  let manage = false;
  $("#manageBtn").addEventListener("click", () => {
    manage = !manage;
    $("#manageBtn").setAttribute("aria-pressed", String(manage));
    $("#manageBtn").textContent = manage ? "관리 닫기" : "캐릭터 추가·빼기";
    $("#addForm").hidden = !manage;
    renderBoard();
    if (manage) $("#addName").focus();
  });
  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const character = $("#addName").value.trim(), nickname = $("#addNick").value.trim();
    if (!character) return;
    const b = $("#addForm button"); b.disabled = true; b.textContent = "찾는 중…";
    const j = await api("POST", "/api/members", { character, nickname });
    b.disabled = false; b.textContent = "추가";
    if (j) { toast(`${character} 추가했어요`); setTimeout(() => location.reload(), 700); }
  });
  $("#board").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const name = b.dataset.del;
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "정말 뺄까요? 기록도 지워져요"; return; }
    const j = await api("DELETE", "/api/members?character=" + encodeURIComponent(name));
    if (j) { toast(`${name}을(를) 뺐어요`); setTimeout(() => location.reload(), 700); }
  });

  $("#sortTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    sortKey = b.dataset.sort;
    $("#sortTabs").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    renderBoard();
  });
  if (!bossWeek) $("#bossTab").remove();

  // ---------- 그래프 ----------
  let metric = "exp", range = 7;
  const hidden = new Set();
    function renderLegend() {
    const lg = $("#legend");
    lg.innerHTML = "";
    if (members.length < 2) return;
    members.forEach((m) => {
      const b = el("button", { "aria-pressed": String(!hidden.has(m.name)) },
        el("span", { class: "sw", style: `background:${m.color}` }), m.name);
      b.onclick = () => { hidden.has(m.name) ? hidden.delete(m.name) : hidden.add(m.name); renderLegend(); renderChart(); };
      lg.append(b);
    });
  }
  function renderChart() {
    const box = $("#chart");
    box.innerHTML = "";
    const isPower = metric === "power";
    const allDates = [...new Set(members.flatMap((m) => Object.keys(m.h)))].sort();
    const from = range ? new Date(Date.parse(today) - (range - 1) * 864e5).toISOString().slice(0, 10) : allDates[0];
    // 맨 앞 칸은 '시작' (기간 직전 기록 = 0 기준)
    const START = "시작";
    const dates = [START, ...allDates.filter((d) => d >= from)];
    const series = members.filter((m) => !hidden.has(m.name)).map((m) => {
      const ds = Object.keys(m.h).sort();
      const before = ds.filter((d) => d < from);
      const baseDate = before.length ? before[before.length - 1] : ds.find((d) => d >= from);
      if (!baseDate) return null;
      const base = m.h[baseDate];
      const pts = [{ i: 0, d: baseDate, v: 0, snap: base }];
      dates.forEach((d, i) => {
        if (i === 0 || !m.h[d] || (d === baseDate && !before.length)) return;
        const sn = m.h[d];
        pts.push({ i, d, snap: sn, v: isPower ? sn.power - base.power : (progress(sn) - progress(base)) * 100 });
      });
      return { m, pts };
    }).filter((x) => x && x.pts.length > 1);
    if (dates.length < 2 || !series.length) {
      box.append(el("div", { class: "empty", text: "이틀 치 기록이 쌓이면 그래프가 그려져요" }));
      return;
    }
    const W = box.clientWidth, H = box.clientHeight;
    const direct = series.length <= 4;
    const pad = { l: 46, r: direct ? 92 : 14, t: 10, b: 26 };
    const all = series.flatMap((s) => s.pts.map((p) => p.v));
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi - lo < 1e-9) hi += isPower ? 1e5 : 10;
    const span = hi - lo; lo -= span * 0.06; hi += span * 0.06;
    const x = (i) => pad.l + (dates.length === 1 ? 0 : (i / (dates.length - 1)) * (W - pad.l - pad.r));
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "친구별 성장 그래프" });

    // 눈금
    const g = sv("g", { class: "grid" }), ax = sv("g", { class: "axis" });
    const raw = (hi - lo) / 5, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepV = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
    const tickVals = [];
    for (let v = Math.ceil(lo / stepV) * stepV; v <= hi + 1e-9; v += stepV) tickVals.push(v);
    for (const v of tickVals) {
      const yy = y(v);
      g.append(sv("line", { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }));
      const t = sv("text", { x: pad.l - 8, y: yy + 4, "text-anchor": "end" });
      t.textContent = isPower ? (v ? fmtTick(v) : "0") : Math.round(v) + "%";
      ax.append(t);
    }
    const step = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor((W - pad.l - pad.r) / 56))));
    dates.forEach((d, i) => {
      const last = dates.length - 1;
      if (i % step && i !== last) return;
      if (i !== last && x(last) - x(i) < 46) return;
      const t = sv("text", { x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : i === last ? "end" : "middle" });
      t.textContent = d === START ? START : shortDate(d);
      ax.append(t);
    });
    svg.append(g, ax);

    // 선 + 끝 라벨 (겹치지 않게 살짝 밀어줌)
    const ends = [];
    series.forEach((s) => {
      const dAttr = s.pts.map((p, k) => (k ? "L" : "M") + x(p.i).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
      svg.append(sv("path", { d: dAttr, fill: "none", stroke: s.m.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      const last = s.pts[s.pts.length - 1];
      svg.append(sv("circle", { cx: x(last.i), cy: y(last.v), r: 3.5, fill: s.m.color, stroke: "var(--surface-1)", "stroke-width": 2 }));
      ends.push({ s, yy: y(last.v), xx: x(last.i) });
    });
    if (direct) {
      ends.sort((a, b) => a.yy - b.yy);
      for (let k = 1; k < ends.length; k++) if (ends[k].yy - ends[k - 1].yy < 15) ends[k].yy = ends[k - 1].yy + 15;
      ends.forEach((e) => {
        const t = sv("text", { class: "lbl", x: e.xx + 8, y: e.yy + 4 });
        t.textContent = e.s.m.name.length > 8 ? e.s.m.name.slice(0, 7) + "…" : e.s.m.name;
        svg.append(t);
      });
    }

    // 호버: 세로선 + 툴팁
    const xh = sv("line", { class: "xhair", y1: pad.t, y2: H - pad.b, visibility: "hidden" });
    const dots = sv("g");
    svg.append(xh, dots);
    const hit = sv("rect", { x: pad.l - 10, y: 0, width: W - pad.l - pad.r + 20, height: H, fill: "transparent" });
    svg.append(hit);
    box.append(svg);
    const tip = el("div", { class: "tip", style: "display:none" });
    box.append(tip);
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(dates.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (dates.length - 1))));
      const xx = x(i);
      xh.setAttribute("x1", xx); xh.setAttribute("x2", xx); xh.setAttribute("visibility", "visible");
      dots.innerHTML = "";
      const rows = series.map((s) => ({ s, p: s.pts.find((p) => p.i === i) })).filter((o) => o.p).sort((a, b) => b.p.v - a.p.v);
      rows.forEach((o) => dots.append(sv("circle", { cx: xx, cy: y(o.p.v), r: 4.5, fill: o.s.m.color, stroke: "var(--surface-1)", "stroke-width": 2 })));
      tip.innerHTML = "";
      tip.append(el("div", { class: "d", text: dates[i] === START ? "기간 시작 기준" : `${+dates[i].slice(5, 7)}월 ${+dates[i].slice(8)}일까지` }));
      rows.forEach((o) => {
        const snap = o.p.snap;
        const txt = isPower ? (o.p.v ? "+" + fmtPower(o.p.v) : "0") + ` (${fmtPower(snap.power)})` : `+${pctNum(o.p.v / 100)}% (${snap.level}레벨)`;
        tip.append(el("div", { class: "li" }, el("span", {}, el("i", { class: "dot", style: `background:${o.s.m.color}` }), o.s.m.name), el("b", { text: txt })));
      });
      if (!rows.length) tip.append(el("div", { class: "li", text: "기록 없음" }));
      tip.style.display = "block";
      const left = xx / (W / r.width);
      const tw = tip.offsetWidth;
      tip.style.left = (left + 14 + tw > r.width ? left - tw - 14 : left + 14) + "px";
      tip.style.top = "8px";
    };
    const leave = () => { tip.style.display = "none"; xh.setAttribute("visibility", "hidden"); dots.innerHTML = ""; };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", leave);
  }

  const segBind = (sel, fn) => $(sel).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $(sel).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    fn(b); renderChart();
  });
  segBind("#metricTabs", (b) => (metric = b.dataset.metric));
  segBind("#rangeTabs", (b) => (range = +b.dataset.range));
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderChart, 120); });

  // ---------- 보스 표 ----------
  function renderBoss() {
    if (!bossWeek) return;
    $("#bossCard").hidden = false;
    $("#bossWeek").textContent = `${shortDate(weekStart)} 목요일부터`;
    const t = $("#bossTable");
    t.innerHTML = "";
    t.append(el("thead", {}, el("tr", {}, el("th", { text: "캐릭터" }), ...bossWeek.bosses.map((b) => el("th", { text: b })), el("th", { text: "합계" }))));
    const tb = el("tbody");
    [...members].sort((a, b) => (b.boss || []).length - (a.boss || []).length).forEach((m) => {
      const got = new Set(m.boss || []);
      tb.append(el("tr", {}, el("td", { text: m.name }),
        ...bossWeek.bosses.map((b) => el("td", {},
          el("button", { class: "chk", "aria-pressed": String(got.has(b)), "data-c": m.name, "data-b": b, title: `${m.name} ${b}` },
            el("span", { class: "sr", text: `${m.name} ${b} ${got.has(b) ? "처치" : "아직"}` })))),
        el("td", { class: "cnt", text: String(got.size) })));
    });
    t.append(tb);
  }

  $("#bossTable").addEventListener("click", async (e) => {
    const b = e.target.closest(".chk"); if (!b) return;
    const checked = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(checked)); // 먼저 바꿔 보여주고
    const j = await api("POST", "/api/boss", { character: b.dataset.c, boss: b.dataset.b, checked });
    if (!j) { b.setAttribute("aria-pressed", String(!checked)); return; }
    const m = members.find((x) => x.name === b.dataset.c);
    m.boss = checked ? [...(m.boss || []), b.dataset.b] : (m.boss || []).filter((x) => x !== b.dataset.b);
    b.closest("tr").querySelector(".cnt").textContent = String(m.boss.length);
  });
  $("#bossEditBtn").addEventListener("click", () => {
    const f = $("#bossForm"); f.hidden = !f.hidden;
    if (!f.hidden) { $("#bossList").value = (bossWeek ? bossWeek.bosses : []).join(", "); $("#bossList").focus(); }
  });
  $("#bossForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bosses = $("#bossList").value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const j = await api("PUT", "/api/bosses", { bosses });
    if (j) { toast("보스 목록을 바꿨어요"); setTimeout(() => location.reload(), 700); }
  });

  if (config.repo) {
    const a = el("a", { href: `https://github.com/${config.repo}/actions/workflows/update.yml`, target: "_blank", rel: "noopener", text: "지금 갱신하기 (관리자)" });
    $("#manual").append(document.createElement("br"), a);
  }
  renderMvp();
  renderBoard();
  renderLegend();
  renderChart();
  renderBoss();
})();
