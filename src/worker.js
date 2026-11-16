// 메이플 친구 랭킹 — Cloudflare Worker
// /api/* 는 여기서 처리하고, 나머지는 public/ 의 정적 파일을 보냅니다.

const MAX_MEMBERS = 20;
const REFRESH_COOLDOWN_MS = 10 * 60 * 1000; // 수동 갱신은 10분에 한 번
const HISTORY_DAYS = 400;

// ---------- 시간 (한국 기준) ----------
const kstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
function weekKey(ms = Date.now()) {
  const k = new Date(ms + 9 * 3600e3);
  k.setUTCDate(k.getUTCDate() - ((k.getUTCDay() - 4 + 7) % 7)); // 목요일 0시 초기화
  return k.toISOString().slice(0, 10);
}

// ---------- 응답 도우미 ----------
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (status, message) => json({ error: message }, status);

// ---------- 넥슨 Open API ----------
class NexonError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}
async function nexon(env, path, params) {
  const base = env.NEXON_API_BASE || "https://open.api.nexon.com/maplestory/v1";
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "x-nxopen-api-key": env.NEXON_API_KEY || "" } });
    if (res.ok) return res.json();
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    throw new NexonError(body?.error?.name || `HTTP ${res.status}`, body?.error?.message || "", res.status);
  }
  throw new NexonError("RETRY", "넥슨 API가 응답하지 않아요", 503);
}
const friendly = (e) =>
  /OPENAPI00005|OPENAPI00002/.test(e.code) ? "넥슨 API 키가 잘못됐어요" :
  /OPENAPI00009/.test(e.code) ? "넥슨에서 데이터를 준비 중이에요" :
  /OPENAPI0001[01]/.test(e.code) ? "넥슨 API 점검 중이에요" :
  e.message || "알 수 없는 오류";

async function lookupOcid(env, character) {
  try {
    return (await nexon(env, "/id", { character_name: character })).ocid;
  } catch (e) {
    if (e.code === "OPENAPI00004" || e.code === "OPENAPI00003") return null; // 없는 캐릭터
    throw e;
  }
}

// 캐릭터 한 명 갱신
async function refreshOne(env, m, now) {
  try {
    let ocid = m.ocid;
    if (!ocid) {
      ocid = await lookupOcid(env, m.character);
      if (!ocid) throw new NexonError("NOTFOUND", "캐릭터를 찾을 수 없어요 (닉변했나요?)");
      await env.DB.prepare("UPDATE members SET ocid = ? WHERE character = ?").bind(ocid, m.character).run();
    }
    const [basic, stat] = await Promise.all([
      nexon(env, "/character/basic", { ocid }),
      nexon(env, "/character/stat", { ocid }),
    ]);
    const power = Number(stat.final_stat?.find((s) => s.stat_name === "전투력")?.stat_value ?? 0);
    const level = Number(basic.character_level);
    const expRate = Number(basic.character_exp_rate);
    const exp = Number(basic.character_exp) || 0;
    if (!Number.isFinite(level) || !Number.isFinite(expRate)) throw new NexonError("BADDATA", "넥슨에서 레벨 정보를 받지 못했어요");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO latest (character, level, exp_rate, exp, power, class, world, guild, image, fetched_at, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)
         ON CONFLICT(character) DO UPDATE SET level=?2, exp_rate=?3, exp=?4, power=?5, class=?6, world=?7,
           guild=?8, image=?9, fetched_at=?10, error=NULL`
      ).bind(m.character, level, expRate, exp, power, basic.character_class, basic.world_name,
        basic.character_guild_name ?? null, basic.character_image ?? null, now),
      env.DB.prepare(
        "INSERT OR REPLACE INTO snapshots (character, ts, date, level, exp_rate, exp, power) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(m.character, now, kstDate(now), level, expRate, exp, power),
    ]);
    return { character: m.character, ok: true };
  } catch (e) {
    // 닉변 등으로 ocid가 무효가 되면 다음번에 다시 찾도록 비움
    if (e.code === "OPENAPI00003" || e.code === "NOTFOUND") {
      await env.DB.prepare("UPDATE members SET ocid = NULL WHERE character = ?").bind(m.character).run();
    }
    const msg = e instanceof NexonError ? friendly(e) : String(e.message || e);
    await env.DB.prepare(
      `INSERT INTO latest (character, error) VALUES (?1, ?2) ON CONFLICT(character) DO UPDATE SET error=?2`
    ).bind(m.character, msg).run();
    return { character: m.character, ok: false, error: msg };
  }
}

async function refreshAll(env) {
  const now = Date.now();
  const { results } = await env.DB.prepare("SELECT character, ocid FROM members ORDER BY sort, added_at").all();
  const out = [];
  // 넥슨 초당 호출 제한을 넘지 않게 한 명씩
  for (const m of results) out.push(await refreshOne(env, m, now));
  await setSetting(env, "last_refresh", String(now));
  return out;
}

async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}
const setSetting = (env, key, value) =>
  env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2")
    .bind(key, value).run();

// ---------- 화면용 데이터 ----------
async function buildData(env) {
  const s = await getSettings(env);
  const since = kstDate(Date.now() - HISTORY_DAYS * 864e5);
  const week = weekKey();
  const [members, latest, hist, boss] = await env.DB.batch([
    env.DB.prepare("SELECT character, nickname FROM members ORDER BY sort, added_at"),
    env.DB.prepare("SELECT * FROM latest"),
    // 날짜별 마지막 기록
    env.DB.prepare(
      `SELECT s.character, s.date, s.level, s.exp_rate, s.exp, s.power FROM snapshots s
       JOIN (SELECT character, date, MAX(ts) AS ts FROM snapshots WHERE date >= ?1 GROUP BY character, date) d
         ON s.character = d.character AND s.ts = d.ts`
    ).bind(since),
    env.DB.prepare("SELECT character, boss FROM boss_checks WHERE week = ?").bind(week),
  ]);
  const history = {};
  for (const r of hist.results) {
    (history[r.character] ??= {})[r.date] = { level: r.level, expRate: r.exp_rate, exp: r.exp, power: r.power };
  }
  const latestMap = {};
  for (const r of latest.results) {
    latestMap[r.character] = {
      level: r.level, expRate: r.exp_rate, exp: r.exp, power: r.power, class: r.class, world: r.world,
      guild: r.guild, image: r.image, fetchedAt: r.fetched_at, error: r.error,
    };
  }
  const checks = {};
  for (const r of boss.results) (checks[r.character] ??= []).push(r.boss);
  const lastRefresh = Number(s.last_refresh || 0);
  return {
    config: {
      title: s.title, subtitle: s.subtitle,
      members: members.results.map((m) => ({ character: m.character, nickname: m.nickname })),
    },
    data: {
      updatedAt: lastRefresh ? new Date(lastRefresh).toISOString() : null,
      refreshAvailableAt: lastRefresh + REFRESH_COOLDOWN_MS,
      latest: latestMap,
      history,
      bossWeeks: { [week]: { bosses: JSON.parse(s.bosses || "[]"), checks } },
    },
  };
}

// ---------- 쓰기 권한: 친구 코드 ----------
function authorized(req, env) {
  const code = req.headers.get("x-friend-code") || "";
  return !!env.FRIEND_CODE && code === env.FRIEND_CODE;
}
async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}
const cleanName = (s) => String(s || "").trim().slice(0, 30);

async function handleApi(req, env, ctx, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === "/api/data" && method === "GET") return json(await buildData(env));

  if (!["POST", "DELETE", "PUT"].includes(method)) return fail(405, "지원하지 않는 요청이에요");
  if (!authorized(req, env)) return fail(401, "친구 코드가 맞지 않아요");

  if (p === "/api/auth") return json({ ok: true });

  if (p === "/api/refresh") {
    const last = Number((await getSettings(env)).last_refresh || 0);
    const wait = last + REFRESH_COOLDOWN_MS - Date.now();
    if (wait > 0) return fail(429, `${Math.ceil(wait / 60000)}분 뒤에 다시 갱신할 수 있어요`);
    await setSetting(env, "last_refresh", String(Date.now())); // 동시에 여러 번 누르는 것 방지
    const results = await refreshAll(env);
    return json({ ok: true, results });
  }

  if (p === "/api/members" && method === "POST") {
    const b = await readBody(req);
    const character = cleanName(b.character);
    const nickname = cleanName(b.nickname);
    if (!character) return fail(400, "캐릭터 닉네임을 입력해 주세요");
    const exists = await env.DB.prepare("SELECT 1 FROM members WHERE character = ?").bind(character).first();
    if (exists) return fail(409, "이미 등록된 캐릭터예요");
    const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM members").first()).n;
    if (count >= MAX_MEMBERS) return fail(400, `최대 ${MAX_MEMBERS}명까지 등록할 수 있어요`);
    let ocid;
    try { ocid = await lookupOcid(env, character); }
    catch (e) { return fail(502, friendly(e)); }
    if (!ocid) return fail(404, "그런 캐릭터가 없어요. 닉네임을 다시 확인해 주세요");
    const now = Date.now();
    await env.DB.prepare("INSERT INTO members (character, nickname, ocid, sort, added_at) VALUES (?, ?, ?, ?, ?)")
      .bind(character, nickname, ocid, count, now).run();
    const r = await refreshOne(env, { character, ocid }, now);
    return json({ ok: true, result: r });
  }

  if (p === "/api/members" && method === "DELETE") {
    const character = cleanName(url.searchParams.get("character"));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM members WHERE character = ?").bind(character),
      env.DB.prepare("DELETE FROM latest WHERE character = ?").bind(character),
      env.DB.prepare("DELETE FROM snapshots WHERE character = ?").bind(character),
      env.DB.prepare("DELETE FROM boss_checks WHERE character = ?").bind(character),
    ]);
    return json({ ok: true });
  }

  if (p === "/api/members" && method === "PUT") {
    const b = await readBody(req);
    await env.DB.prepare("UPDATE members SET nickname = ? WHERE character = ?")
      .bind(cleanName(b.nickname), cleanName(b.character)).run();
    return json({ ok: true });
  }

  if (p === "/api/boss" && method === "POST") {
    const b = await readBody(req);
    const character = cleanName(b.character), boss = cleanName(b.boss), week = weekKey();
    const member = await env.DB.prepare("SELECT 1 FROM members WHERE character = ?").bind(character).first();
    if (!member) return fail(404, "등록되지 않은 캐릭터예요");
    if (b.checked) {
      await env.DB.prepare("INSERT OR IGNORE INTO boss_checks (week, character, boss) VALUES (?, ?, ?)")
        .bind(week, character, boss).run();
    } else {
      await env.DB.prepare("DELETE FROM boss_checks WHERE week = ? AND character = ? AND boss = ?")
        .bind(week, character, boss).run();
    }
    return json({ ok: true });
  }

  if (p === "/api/bosses" && method === "PUT") {
    const b = await readBody(req);
    const list = [...new Set((Array.isArray(b.bosses) ? b.bosses : []).map(cleanName).filter(Boolean))].slice(0, 30);
    if (!list.length) return fail(400, "보스를 하나 이상 적어주세요");
    await setSetting(env, "bosses", JSON.stringify(list));
    return json({ ok: true });
  }

  return fail(404, "없는 주소예요");
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(req, env, ctx, url); }
      catch (e) { return fail(500, "서버 오류: " + (e.message || e)); }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshAll(env));
  },
};

export { kstDate, weekKey };
