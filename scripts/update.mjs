// 넥슨 Open API에서 친구들 캐릭터 정보를 가져와 data/data.json 에 쌓는 스크립트
// GitHub Actions 에서 몇 시간마다 실행됩니다. 로컬 실행: NEXON_API_KEY=... node scripts/update.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(ROOT, "config.json");
const DATA_PATH = join(ROOT, "data", "data.json");
const API = "https://open.api.nexon.com/maplestory/v1";
const API_KEY = process.env.NEXON_API_KEY;
const BOSS_CSV = process.env.BOSS_SHEET_CSV; // 저장소 변수로 넣어도 되고 config.json 에 넣어도 됨

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 날짜 (한국 시간 기준) ----
export function kstDate(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}
// 주간 보스 초기화 기준: 목요일 00시(KST). 해당 주 목요일 날짜를 키로 사용
export function weekKey(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const day = k.getUTCDay(); // 0=일 ... 4=목
  const back = (day - 4 + 7) % 7;
  k.setUTCDate(k.getUTCDate() - back);
  return k.toISOString().slice(0, 10);
}

async function call(path, params) {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "x-nxopen-api-key": API_KEY } });
    if (res.ok) return res.json();
    const body = await res.json().catch(() => ({}));
    const name = body?.error?.name || `HTTP ${res.status}`;
    // 429(호출 한도)·500 은 잠시 후 재시도
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(`${name} ${body?.error?.message || ""}`.trim());
  }
  throw new Error("API 재시도 실패");
}

// ---- CSV (구글 시트 '웹에 게시' 결과) ----
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((s) => s.trim()));
}
const CHECKED = new Set(["true", "o", "v", "✔", "✔️", "✅", "1", "y", "yes", "ㅇ"]);
export function parseBossSheet(text) {
  const rows = parseCsv(text).filter((r) => r.some((c) => c));
  if (rows.length < 2) return null;
  const bosses = rows[0].slice(1).filter(Boolean);
  const checks = {};
  for (const r of rows.slice(1)) {
    const name = r[0];
    if (!name) continue;
    checks[name] = bosses.filter((_, i) => CHECKED.has((r[i + 1] || "").toLowerCase()));
  }
  return { bosses, checks };
}

export async function main() {
  if (!API_KEY) throw new Error("NEXON_API_KEY 환경변수가 없습니다 (저장소 Settings > Secrets 에 등록).");
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  let data;
  try { data = JSON.parse(await readFile(DATA_PATH, "utf8")); }
  catch { data = {}; }
  data.ocid ??= {};
  data.latest ??= {};
  data.history ??= {};
  data.bossWeeks ??= {};

  const today = kstDate();
  for (const m of config.members) {
    const name = m.character;
    try {
      if (!data.ocid[name]) {
        data.ocid[name] = (await call("/id", { character_name: name }).catch(() => {
          throw new Error("캐릭터를 찾을 수 없어요 (닉네임/띄어쓰기 확인)");
        })).ocid;
        await sleep(250);
      }
      const ocid = data.ocid[name];
      const basic = await call("/character/basic", { ocid });
      await sleep(250);
      const stat = await call("/character/stat", { ocid });
      await sleep(250);
      const power = Number(
        stat.final_stat?.find((s) => s.stat_name === "전투력")?.stat_value ?? 0
      );
      const snap = {
        level: basic.character_level,
        expRate: Number(basic.character_exp_rate),
        exp: basic.character_exp,
        power,
      };
      data.latest[name] = {
        ...snap,
        class: basic.character_class,
        world: basic.world_name,
        guild: basic.character_guild_name,
        image: basic.character_image,
        fetchedAt: new Date().toISOString(),
        error: null,
      };
      (data.history[name] ??= {})[today] = snap; // 하루 중 마지막 값으로 덮어씀
      console.log(`✓ ${name} Lv.${snap.level} ${snap.expRate}% 전투력 ${power.toLocaleString()}`);
    } catch (e) {
      // 닉변/삭제 등으로 실패하면 ocid 캐시를 지우고 이전 값은 유지
      if (/identifier|OPENAPI00003/i.test(e.message)) delete data.ocid[name];
      (data.latest[name] ??= {}).error = e.message;
      console.warn(`✗ ${name}: ${e.message}`);
    }
  }

  const csvUrl = BOSS_CSV || config.bossSheetCsv;
  if (csvUrl) {
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseBossSheet(await res.text());
      if (parsed) {
        data.bossWeeks[weekKey()] = parsed;
        console.log(`✓ 보스 시트 ${Object.keys(parsed.checks).length}명`);
      }
    } catch (e) {
      console.warn(`✗ 보스 시트: ${e.message}`);
    }
  }

  data.updatedAt = new Date().toISOString();
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(data, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
