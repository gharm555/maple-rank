# 메이플 친구 랭킹 🍁

챌린저스 월드든 일반 월드(본섭)든, 친구들 메이플 캐릭터의 **레벨·경험치, 전투력, 주간 보스**를 비교하는 사이트예요.

- **Cloudflare Workers + D1** (무료 요금제로 충분)
- 30분마다 넥슨 Open API를 자동 조회하고, 조회할 때마다 기록을 DB에 쌓아요
- 친구들이 사이트에서 직접 **캐릭터 추가·빼기**, **보스 체크**, **지금 갱신**(10분에 한 번)을 할 수 있어요
- 쓰기 기능은 **친구 코드**를 아는 사람만 쓸 수 있어요. 보는 건 링크만 있으면 누구나 돼요
- 넥슨 API 키는 서버에만 있어서 사이트 방문자에게 보이지 않아요

## 처음 설정 (한 번만)

### 1. Cloudflare 가입
https://dash.cloudflare.com/sign-up 에서 무료 가입 → 왼쪽 메뉴 **Workers & Pages**를 한 번 열어두기 (workers.dev 주소가 자동으로 만들어져요)

### 2. Cloudflare 값 두 개 복사
- **Account ID**: Workers & Pages 화면 오른쪽, 또는 대시보드 주소창 `dash.cloudflare.com/<여기>` 부분
- **API 토큰**: 오른쪽 위 프로필 → My Profile → API Tokens → Create Token
  → 템플릿 **Edit Cloudflare Workers** 선택 → 권한에 **Account · D1 · Edit** 한 줄 추가 → Create

### 3. GitHub Secrets 등록
저장소 Settings → Secrets and variables → Actions → **Secrets** 탭에 4개:

| 이름 | 값 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 2번 API 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | 2번 Account ID |
| `NEXON_API_KEY` | 넥슨 Open API 키 (이미 등록돼 있으면 그대로) |
| `FRIEND_CODE` | 친구들끼리 쓸 비밀 코드 (아무 문자열) |

### 4. 배포
Actions 탭 → **Cloudflare 배포** → Run workflow.
DB 생성, 표 만들기, 배포, 비밀값 등록까지 자동으로 해요. 끝나면 로그의 `https://maple-rank.<계정>.workers.dev` 주소로 접속하세요.

이후엔 `main`에 코드가 올라갈 때마다 자동으로 다시 배포돼요.

## 쓰는 법
- **친구 코드 입력**: 오른쪽 위 버튼. 한 번 넣으면 그 브라우저에 기억돼요
- **캐릭터 추가·빼기**: 랭킹 창 아래 버튼. 닉네임은 게임과 똑같이
- **보스 체크**: 보스 표의 칸을 누르면 체크/해제. 목요일 0시에 새 주로 넘어가요
- **지금 갱신**: 10분에 한 번 누를 수 있어요 (넥슨 API 호출량 보호)

## 알아두면 좋은 점
- 성장량은 경험치 %로 보여줘요. 레벨업하면 1레벨을 100%로 쳐요.
- 환산 주스탯은 넥슨 API에 없어서 인게임 **전투력**으로 비교해요.
- 넥슨 개발 단계 API 키는 하루 호출량 제한이 있어요. 갱신 1번에 캐릭터 1명당 2번 호출하니, 인원이 많아지면 넥슨 개발자 센터에서 키를 서비스 단계로 올리는 걸 고려하세요.
- 하단 "Data based on NEXON Open API" 문구는 넥슨 Open API 이용 조건이라 지우지 마세요.

## 파일 구성
| 경로 | 역할 |
|---|---|
| `public/` | 사이트 화면 (HTML, CSS, JS, 글꼴) |
| `src/worker.js` | API와 30분 자동 조회 |
| `migrations/` | DB 표 구조와 처음 데이터 |
| `wrangler.toml` | Cloudflare 설정 |
| `.github/workflows/deploy.yml` | 자동 배포 |
| `public/fonts/` | 메이플스토리 서체(넥슨 무료 배포), 갈무리11(OFL) |

로컬 실행: `.dev.vars`에 `NEXON_API_KEY=...`, `FRIEND_CODE=...` 를 적고 `npm install && npx wrangler d1 migrations apply maple-rank --local && npm run dev`
