# 이음(EEUM) — 작업 인수인계 문서

> 이 문서 하나만 읽으면 이어서 작업할 수 있도록 정리했습니다.
> 최종 갱신: 2026-08-13

---

## 1. 이 프로젝트가 뭔가

울주군 주민이 마을에서 도시로 이동할 때, **DRT(마실고래버스)와 시내버스가 서로 연결되지 않아
"언제 집을 나서야 하는지" 알 수 없는 문제**를 해결하는 웹 서비스입니다.

기존 앱들은 DRT와 시내버스를 각각 따로 보여줍니다. 이음은 이 둘을 하나의 경로로 잇습니다.

**해커톤 발표용 프로토타입**이며, 심사위원이 QR로 접속해 직접 써보는 것이 사용 시나리오입니다.

### 두 가지 모드

| 모드 | 대상 | 흐름 |
|---|---|---|
| 일반모드 | 일반 이용자 | 현재위치 → 근처 DRT 스팟 3곳 → 목적지 선택 → 5단계 경로 → DRT 호출 |
| 쉬운모드 | 고령자·교통약자 | 음성으로 말하기 → AI가 알아듣고 되물음 → 경로 안내 + 읽어주기 → DRT 호출 |

쉬운모드는 글씨·버튼이 통째로 커집니다(`.easy` 클래스, 16px→21px).

---

## 2. 현재 배포 상태

| 항목 | 값 |
|---|---|
| 배포 주소 | https://eeum-web-umber.vercel.app/ |
| GitHub | https://github.com/a55976236-crypto/eeum-web |
| Vercel 팀 | `dream` (Hobby) |
| 로컬 경로 | `C:\Users\Administrator\Documents\해커톤\eeum-web` |

### 동작 확인된 것

- ✅ 웹 배포, 서버 함수(`/api/*`) 정상
- ✅ 경로 생성 (거리·시간 계산)
- ✅ DRT 호출 전체 흐름 (요청→배차→도착→탑승)
- ✅ 오프라인 폴백 대화 (키워드 매칭, 10개 중 9개 인식)
- ✅ 모바일 레이아웃 (375px에서 가로스크롤 없음, 터치영역 44px+)

### 아직 안 되는 것

| 문제 | 상태 | 영향 |
|---|---|---|
| `OPENAI_API_KEY` 미설정 | `/api/health` → `openai:false` | **음성 인식 불가**, AI 대화가 키워드 매칭으로 대체 |
| BIS 인증키 미등록 | `SERVICE KEY IS NOT REGISTERED (코드 30)` | 실시간 버스 도착정보 대신 시간대별 추정치 사용 |

**둘 다 없어도 앱은 완전히 동작합니다.** 자동으로 폴백합니다.

---

## 3. 기술 선택 이유 (되돌리기 전에 읽어주세요)

### 왜 빌드 도구가 없는 정적 웹인가

작업 PC에 **Node.js도 Python도 설치되어 있지 않습니다.** (winget도 없음)
발표까지 하루뿐이라 런타임 설치부터 시작하는 것이 리스크라고 판단해,
브라우저가 바로 읽는 HTML/CSS/JS로 만들었습니다.

빌드 단계가 없으므로 파일을 고치면 즉시 반영됩니다. 번들러·트랜스파일러 없음.

### 왜 Vercel인가

원래 Cloudflare Worker로 프록시를 만들었으나(`worker/worker.js`에 남아있음),
Vercel은 **화면과 서버 함수가 같은 도메인에 함께 배포**되어:

- CORS 처리가 아예 필요 없음
- 배포 대상이 하나로 줄어듦
- 로컬 Node 없이 클라우드에서 빌드

`worker/worker.js`는 GitHub Pages 등 서버 함수가 없는 곳에 올릴 때를 위한 대안으로 남겨뒀습니다.

### 왜 음성인식에 Whisper를 쓰나

브라우저 내장 Web Speech API는 **iOS 사파리에서 불안정**합니다.
심사위원이 아이폰을 쓸 확률이 절반이므로, iOS에서도 동작하는
`MediaRecorder` 녹음 → 서버 → Whisper 경로를 기본으로 잡았습니다.
Web Speech API는 프록시가 없을 때의 폴백입니다.

읽어주기(TTS)는 `SpeechSynthesis`가 iOS 포함 대부분에서 잘 동작합니다.

---

## 4. 파일 구조

```
eeum-web/
├── index.html            화면 구조 (단일 페이지, 두 모드가 탭으로 전환)
├── vercel.json           배포 설정 + 위치·마이크 권한 헤더
├── css/style.css         스타일 (CSS 변수 --fs, --tap 으로 쉬운모드 확대)
│
├── js/                   ── 브라우저에서 실행 ──
│   ├── config.js         PROXY_URL 설정 + /api/health 자동 감지
│   ├── data.js           스팟 29곳, 환승거점 6곳, 목적지 9곳     [일반 로직]
│   ├── geo.js            Geolocation, 하버사인 거리 계산          [일반 로직]
│   ├── route.js          경로 생성, 환승지 선택, 시간 계산        [일반 로직]
│   ├── drt.js            DRT 호출 상태 머신                       [일반 로직]
│   ├── ai.js         ★  AI 호출 + 오프라인 폴백                  [AI]
│   ├── voice.js          STT(Whisper/WebSpeech) + TTS
│   └── app.js            화면 제어 (계산 안 함, 표시만)
│
├── api/                  ── Vercel 서버에서 실행 (키가 여기만 있음) ──
│   ├── _shared.js        공용: OpenAI 호출, BIS XML 파싱
│   ├── health.js         배포 상태 확인
│   ├── delay.js      ★  지연 원인 설명 생성                      [AI]
│   ├── chat.js       ★  쉬운모드 대화                            [AI]
│   ├── stt.js        ★  음성 → 텍스트 (Whisper)                  [AI]
│   └── bis/
│       ├── stops.js      정류장 목록                              [울산 BIS]
│       └── arrival.js    실시간 도착정보                          [울산 BIS]
│
├── tools/
│   ├── serve.ps1         로컬 미리보기 서버 (Node 불필요)
│   └── fetch-stops.ps1   BIS 정류장 데이터 받아 data/stops.json 생성
│
└── worker/worker.js      (대안) Cloudflare Worker — Vercel 쓰면 미사용
```

---

## 5. AI와 일반 로직의 분리 — 이 프로젝트의 설계 원칙

**심사위원이 "이거 AI로 만든 거예요?"라고 물을 때 답할 수 있도록 파일 단위로 나눴습니다.**
화면에도 <kbd>AI</kbd> / <kbd>일반 로직</kbd> 배지가 붙습니다.

| 기능 | 파일 | AI? | 실제 구현 |
|---|---|---|---|
| 근처 스팟 찾기 | `geo.js` | ❌ | 하버사인 공식 |
| 도보 시간 | `geo.js` | ❌ | 거리 ÷ 67m/분 (교통약자 기준) |
| 환승지 선택 | `route.js` | ❌ | 조건 필터 + 최솟값 탐색 |
| 대기시간 | `route.js` | ❌ | 배차시간 − 도보시간 (뺄셈) |
| DRT 호출 | `drt.js` | ❌ | 상태 머신 |
| **지연 원인 설명** | `ai.js` → `api/delay.js` | ✅ | GPT |
| **쉬운모드 대화** | `ai.js` → `api/chat.js` | ✅ | GPT |
| **음성 인식** | `voice.js` → `api/stt.js` | ✅ | Whisper |

### 지켜야 할 규칙

**숫자는 절대 AI에게 계산시키지 않습니다.**
`route.js`가 계산한 값을 프롬프트에 넣어주고, AI는 그것을 문장으로 바꾸기만 합니다.

**AI가 근거 없이 지어내지 못하게 막아뒀습니다.**
- `known_cause`가 없으면 "정확한 원인은 확인되지 않았습니다"라고 답하도록 프롬프트에 명시
- AI가 고른 목적지는 `ai.js`에서 `findDestination()`으로 우리 데이터와 대조 → 없는 장소면 버림

이 구조를 바꾸면 발표에서 설명하기 어려워집니다.

---

## 6. 핵심 로직 설명

### 경로 생성 (`route.js`)

```
[현재위치] --도보--> [DRT 스팟] --마실고래버스--> [환승거점] --시내버스--> [목적지]
```

**환승지 선택 규칙** — 단순히 총거리 최소화를 하면 안 됩니다.

초기 구현은 `legDrt + legBus` 최소화였는데, 그러면 목적지에 가까운 거점을 골라
**마실고래버스가 12km를 달리는 비현실적 경로**가 나왔습니다.
DRT는 마을 셔틀이지 시내버스가 아닙니다.

현재 규칙:
1. `legDrt <= MAX_DRT_METERS` (8km) 인 거점만 후보
2. `legBus < 직선거리` (목적지에 실제로 가까워지는 거점만)
3. 남은 후보 중 총거리 최소
4. 후보가 없으면(오지) 최근접 거점

### DRT 호출 (`drt.js`)

```
idle → requesting → matched → arriving → arrived → onboard → done
```

**마실고래버스 호출 API는 외부에 공개되어 있지 않습니다.**
그래서 실제 운영 흐름을 시간 순서대로 재현합니다.
실제 연동 시 `requestCall()` 내부의 `setTimeout` 부분만 운영사 API 호출로 교체하면
UI와 나머지 흐름은 그대로 동작합니다.

⚠️ **`DEMO_TICK_MS = 4000`** — 발표 시간을 고려해 1분을 4초로 압축했습니다.
실서비스에서는 `60000`으로 바꾸세요.

### 폴백 구조 (`ai.js`)

모든 AI 호출은 8초 타임아웃이 걸려 있고, 실패하면 즉시 규칙 기반으로 넘어갑니다.
`fallbackChat()`은 `data.js`의 목적지별 `keywords` 배열로 문자열 매칭을 합니다.

**주의**: 폴백은 미리 넣어둔 단어만 인식합니다.
"허리가 아파서 봐야겠는데" 같은 표현은 AI가 있어야 병원으로 이해합니다.

---

## 7. 로컬에서 실행하기

Node.js 없이 PowerShell만으로 됩니다.

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

→ http://localhost:8080

**`file://`로 직접 열면 안 됩니다.** 브라우저가 위치·마이크를 차단합니다.
`localhost`는 보안 컨텍스트로 취급되어 배포 환경과 동일하게 테스트됩니다.

로컬에서는 `/api`가 없으므로 자동으로 오프라인 모드로 동작합니다(정상).

---

## 8. 함정 (실제로 겪은 것들)

### PowerShell 5.1 + 한글 파일

`.ps1` 파일을 **BOM 없는 UTF-8**로 저장하면 PowerShell 5.1이 한글을 ANSI로 잘못 읽어
`Missing closing '}'` 같은 엉뚱한 구문 오류가 납니다.

`.ps1` 파일을 수정할 때는 **UTF-8 BOM을 유지**하세요.

```powershell
$t=[System.IO.File]::ReadAllText($p,[System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($true)))
```

### CSS 변수와 `.easy`

`.easy`는 `#app`에 붙는데 `--fs`를 `body`에서만 쓰면 적용되지 않습니다
(`body`가 `#app`의 상위이므로). `.app`에 `font-size: var(--fs)`가 반드시 있어야 합니다.
한 번 이 문제로 쉬운모드 확대가 조용히 죽어 있었습니다.

### Vercel 환경변수

환경변수를 배포 **후에** 추가하면 자동 반영되지 않습니다.
**Deployments → 최신 항목 → Redeploy** 를 해야 합니다.

### 울산 BIS API

- **HTTPS 미지원** (`http://`만). 브라우저에서 직접 호출하면 mixed content로 차단됩니다.
  반드시 서버 함수를 경유해야 합니다.
- **XML만 반환** (JSON 미지원). `_shared.js`의 `parseBisXml()`이 정규식으로 파싱합니다.
- 문서상 오퍼레이션명은 `AllBusArrivalInfo`인데 예제 URL은 `getBusArrivalInfo`입니다.
  `arrival.js`에서 둘 다 순서대로 시도합니다.

---

## 9. 발표 사고 방지 장치

발표장 와이파이를 믿을 수 없다는 전제로 만들었습니다.

| 상황 | 대응 |
|---|---|
| AI 응답 없음 / 8초 초과 | 규칙 기반으로 자동 전환 |
| 위치 권한 거부 | 척과마을회관 기준으로 자동 진행 |
| 마이크 불가 | 키보드 입력 + 빠른 선택 버튼 |
| BIS 죽음 | 시간대별 추정치 사용 |

**긴급 스위치** (주소 뒤에 붙임)

| URL | 효과 |
|---|---|
| `?demo=1` | 네트워크를 아예 안 쓰는 완전 오프라인 모드 |
| `?proxy=https://...` | 프록시 주소 즉석 교체 |
| `?proxy=` | 프록시 해제 |

---

## 10. 남은 작업 (우선순위 순)

### 1순위 — OpenAI 키 설정
Vercel → Settings → Environment Variables → `OPENAI_API_KEY` → **Redeploy**
확인: `/api/health` 가 `"openai":true`

이게 없으면 **음성 시연이 불가능**합니다.

### 2순위 — 실제 폰에서 검증
아직 실기기 테스트를 못 했습니다. 확인할 것:
- 위치 권한 허용 → 근처 스팟이 실제 위치 기준으로 뜨는가
- 마이크 권한 → 녹음 → Whisper 인식 정확도
- iOS에서 TTS가 첫 터치 후 재생되는가 (`primeTts()` 동작 확인)

### 3순위 — BIS 인증키
`SERVICE KEY IS NOT REGISTERED`. data.go.kr에서 **"울산광역시_BIS정보"** 활용신청
승인 여부 확인 필요. 승인되면:

```
powershell -ExecutionPolicy Bypass -File tools\fetch-stops.ps1 -ServiceKey "Decoding키"
```

→ `data/stops.json` 생성 → 커밋하면 앱이 자동으로 읽습니다.

### 그 다음 (여유 있으면)

- **실시간 도착정보 연결**: `route.js`의 `estimateBusDelay()`를 `/api/bis/arrival` 결과로 교체.
  환승 거점에 `stopid`를 매핑해두어야 합니다.
- **지도 표시**: 현재는 텍스트 타임라인만. Leaflet + OSM 타일이면 키 없이 가능.
- **DRT 스팟 실좌표**: 현재 좌표는 마을 중심부 기준 **추정값**입니다.
  울주군에서 실제 스팟 목록을 받으면 `data.js`의 `SEED_SPOTS`만 교체하면 됩니다.
- **`.gitignore` 업로드**: 웹 업로드 시 숨김 파일이라 누락되었습니다.

---

## 11. 데이터 정확도 — 정직하게 밝힐 것

발표에서 실데이터인 척하면 안 되는 항목들입니다.

- **DRT 스팟 좌표 29곳** = 울주군 각 마을 중심부 기준 **추정값**.
  공식 스팟 목록이 공개 API로 제공되지 않습니다. 화면에도 `추정 좌표` 배지 표시.
- **DRT 배차 시간** = 시간대별 규칙 기반 추정치. 실제 운영 데이터 아님.
- **DRT 호출** = 시뮬레이션. 호출 API 미공개.
- **시내버스 지연** = BIS 키가 열리기 전까지는 추정치.
- **환승 거점의 버스 노선번호** = 시연용 대표값.

---

## 12. 보안

- API 키는 **저장소에 절대 넣지 마세요.** Vercel 환경변수에만 둡니다.
- 개발 중 BIS 인증키가 채팅에 노출된 적이 있습니다. **발표 후 재발급 권장**.
- `data/stops.json`은 공개 데이터라 커밋해도 됩니다.
