-- 친구 캐릭터 목록
CREATE TABLE members (
  character TEXT PRIMARY KEY,
  nickname  TEXT NOT NULL DEFAULT '',
  ocid      TEXT,
  sort      INTEGER NOT NULL DEFAULT 0,
  added_at  INTEGER NOT NULL
);

-- 캐릭터별 최신 정보 (화면 표시용)
CREATE TABLE latest (
  character  TEXT PRIMARY KEY,
  level      INTEGER,
  exp_rate   REAL,
  exp        INTEGER,
  power      INTEGER,
  class      TEXT,
  world      TEXT,
  guild      TEXT,
  image      TEXT,
  fetched_at INTEGER,
  error      TEXT
);

-- 갱신할 때마다 쌓이는 기록 (30분 단위)
CREATE TABLE snapshots (
  character TEXT NOT NULL,
  ts        INTEGER NOT NULL,   -- ms
  date      TEXT NOT NULL,      -- KST YYYY-MM-DD
  level     INTEGER NOT NULL,
  exp_rate  REAL NOT NULL,
  exp       INTEGER NOT NULL,
  power     INTEGER NOT NULL,
  PRIMARY KEY (character, ts)
);
CREATE INDEX snapshots_date ON snapshots (date);

-- 주간 보스 체크 (week = 그 주 목요일 KST 날짜)
CREATE TABLE boss_checks (
  week      TEXT NOT NULL,
  character TEXT NOT NULL,
  boss      TEXT NOT NULL,
  PRIMARY KEY (week, character, boss)
);

-- 제목, 보스 목록, 마지막 갱신 시각 등
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('title', '메이플 친구 랭킹'),
  ('subtitle', '챌섭이든 본섭이든, 누가 제일 빨리 크나'),
  ('bosses', '["스우","데미안","가디언 엔젤 슬라임","루시드","윌","더스크","듄켈","진 힐라","검은 마법사","세렌","칼로스"]');
