# 메이플 친구 랭킹 🍁

챌린저스 월드든 일반 월드(본섭)든 상관없이, 친구들 메이플 캐릭터의 **레벨·경험치%, 전투력, 주간 보스**를 한 페이지에서 비교하는 사이트입니다.

- 넥슨 Open API로 **2시간마다 자동 갱신** (GitHub Actions)
- 매일의 기록이 쌓여서 **오늘/이번 주 성장량 랭킹**과 **성장 그래프**가 생깁니다
- 주간 보스는 API에 없어서 **구글 시트 체크**로 받습니다 (선택)
- 서버·비용 없음: GitHub Pages(무료)에 올리면 끝. API 키는 GitHub Secret에만 저장돼서 사이트 방문자에게 노출되지 않아요.

---

## 설치 (15분)

### 1. 넥슨 Open API 키 발급
1. https://openapi.nexon.com 접속 → 넥슨 계정으로 로그인
2. **애플리케이션 등록** → 게임: 메이플스토리, 단계: 개발 단계로 충분
3. 발급된 **API Key** 복사 (`test_...` 또는 `live_...`로 시작)

### 2. GitHub 저장소 만들기
1. https://github.com/new → 이름 예: `maple-rank`, **Public** 선택 (무료 Pages는 공개 저장소에서 가능)
2. 이 폴더의 파일을 전부 올리기 — 웹에서 **Add file → Upload files**로 드래그하면 됩니다.
   - 점(.)으로 시작하는 `.github` 폴더도 꼭 포함! (안 보이면 숨김 파일 표시를 켜세요. 업로드가 안 되면 `.github/workflows/update.yml`은 **Add file → Create new file**에서 경로를 그대로 입력하고 내용을 붙여넣으세요)

### 3. API 키 등록
저장소 **Settings → Secrets and variables → Actions → New repository secret**
- Name: `NEXON_API_KEY`
- Secret: 1번에서 복사한 키

### 4. 친구 캐릭터 입력
`config.json`을 열어 연필 아이콘으로 수정:
```json
{
  "title": "메이플 친구 랭킹",
  "subtitle": "2026 겨울 챌린저스 월드에서 누가 제일 빨리 크나",
  "members": [
    { "character": "내캐릭명", "nickname": "나" },
    { "character": "민수캐릭", "nickname": "민수" }
  ],
  "bossSheetCsv": ""
}
```
- `character`: 게임 닉네임 그대로 (대소문자·띄어쓰기 정확히). 월드는 상관없어요. 챌섭 캐릭과 본섭 캐릭을 섞어도 되고, 한 사람이 둘 다 넣어도 돼요.
- `nickname`: 실제 친구 이름 (선택)
- 순서대로 그래프 색이 정해져요 (최대 8명까지 색 구분이 잘 됨)

### 5. 사이트 켜기
1. **Settings → Pages** → Build and deployment의 Source를 **GitHub Actions**로 선택
2. **Actions** 탭 → `데이터 갱신` → **Run workflow** 버튼 (첫 데이터 수집 + 사이트 배포)
   - Actions 탭에서 "workflows aren't being run" 안내가 보이면 **I understand… enable** 버튼 클릭
3. 1~2분 뒤 `https://<깃허브아이디>.github.io/maple-rank/` 접속 → 친구들에게 링크 공유 🎉

이후엔 2시간마다 알아서 갱신되고, 하루 지나면 "오늘 성장", 이틀 이상 쌓이면 그래프가 나옵니다.

---

## 주간 보스 체크 (선택)

넥슨 API는 보스 클리어 기록을 주지 않아서, 친구들이 함께 편집하는 구글 시트를 씁니다.

1. 구글 시트를 새로 만들고 `boss-sheet-template.csv` 내용을 붙여넣기
   - 첫 줄: `캐릭터, 보스1, 보스2, ...` (보스는 자유롭게 바꾸세요)
   - 첫 칸: config.json의 캐릭터명(또는 nickname)
   - 잡은 보스 칸에 **체크박스(삽입 → 체크박스)** 또는 `O`, `v`, `✅`, `1` 입력
2. 친구들에게 **편집 권한**으로 공유
3. **파일 → 공유 → 웹에 게시** → 해당 시트 선택, 형식 **쉼표로 구분된 값(.csv)** → 게시 → 나온 링크 복사
4. 저장소 **Settings → Secrets and variables → Actions → Variables 탭 → New repository variable**
   - Name: `BOSS_SHEET_CSV`, Value: 3번 링크
   (또는 config.json의 `bossSheetCsv`에 넣어도 됩니다)

사이트가 매주 목요일 0시 기준으로 주를 나눠 기록해요. **목요일마다 시트 체크를 해제**하면 새 주가 시작됩니다. (해제를 깜빡해도 지난주 기록은 이미 저장돼 있어요)

---

## 알아두면 좋은 점

- **성장량 계산**: `레벨 + 경험치%/100`의 차이입니다. 271레벨 40% → 272레벨 10%면 +0.70Lv. 고레벨일수록 1레벨이 무거워서 완벽한 경험치량 비교는 아니에요.
- **환산 주스탯**은 넥슨 API가 제공하지 않아 **인게임 전투력**으로 비교합니다.
- 넥슨 API 데이터는 실시간보다 조금 늦게 반영될 수 있어요.
- GitHub 예약 실행은 서버가 붐비면 몇십 분 늦어질 수 있어요. 바로 보고 싶으면 Actions에서 **Run workflow**.
- 닉네임을 바꾸면 config.json도 바꿔주세요. 랭킹에 ⚠ 표시가 뜨면 캐릭터를 못 찾은 것입니다.
- 사이트 하단의 "Data based on NEXON Open API" 문구는 넥슨 Open API 이용 조건이라 지우지 마세요.

## 파일 구성
| 파일 | 역할 |
|---|---|
| `index.html`, `style.css`, `app.js` | 사이트 화면 |
| `config.json` | 친구 목록·제목 설정 |
| `fonts/` | 메이플스토리 서체(넥슨 무료 배포), 갈무리11(OFL) |
| `data/data.json` | 자동으로 쌓이는 기록 (직접 수정 X) |
| `scripts/update.mjs` | 넥슨 API 조회 스크립트 |
| `.github/workflows/update.yml` | 2시간마다 조회 → 기록 저장 → 사이트 배포 |
