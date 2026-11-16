-- 친구 본인 넥슨 API 키 (스케줄러 조회용, 화면에는 절대 내보내지 않음)
ALTER TABLE members ADD COLUMN user_key TEXT;
ALTER TABLE members ADD COLUMN user_ocid TEXT;

-- 스케줄러 최신 상태
CREATE TABLE scheduler (
  character   TEXT PRIMARY KEY,
  clear_count INTEGER,
  clear_limit INTEGER,
  bosses      TEXT,      -- JSON [{name, difficulty, cycle, order, registered, done}]
  fetched_at  INTEGER,
  error       TEXT
);
