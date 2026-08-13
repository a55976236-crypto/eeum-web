# 🐋 이음 (EEUM)

**마실고래버스와 시내버스를 하나의 길로.**

울주군 주민이 마을에서 도시까지 이동할 때, DRT(마실고래버스)와 시내버스가 따로 놀아서
"언제 나가야 하는지" 알 수 없는 문제를 하나의 경로로 이어주는 웹 서비스입니다.

- 📱 **QR로 접속** — 설치 없이 휴대폰 브라우저에서 바로
- 🗺️ **일반모드** — 현재 위치 → 근처 마실고래버스 스팟 → 환승 → 목적지
- 🗣️ **쉬운모드** — 음성으로 말하면 AI가 알아듣고 경로 안내 + DRT 호출
- 🔇 **오프라인 대비** — 네트워크가 끊겨도 앱이 멈추지 않습니다

---

## 1. 지금 바로 실행해보기

Node.js도 Python도 필요 없습니다. **PowerShell만 있으면 됩니다.**

```bash
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

그다음 브라우저에서 **http://localhost:8080** 으로 접속합니다.

> **왜 파일을 더블클릭하면 안 되나요?**
> `file://` 로 열면 브라우저가 위치·마이크 권한을 막습니다.
> `localhost` 는 '보안 컨텍스트'로 취급되어 실제 배포 환경과 똑같이 테스트됩니다.

---

## 2. 폴더 구조

```
eeum-web/
├── index.html            화면 구조 (한 페이지)
├── css/style.css         스타일 (모바일 우선, 쉬운모드는 .easy로 확대)
├── js/
│   ├── config.js         설정 — PROXY_URL 한 줄만 바꾸면 AI 켜짐
│   ├── data.js           스팟·환승거점·목적지 데이터        [일반 로직]
│   ├── geo.js            위치 확인, 하버사인 거리 계산      [일반 로직]
│   ├── route.js          경로 생성, 대기·소요시간 계산      [일반 로직]
│   ├── drt.js            마실고래버스 호출 상태 흐름        [일반 로직]
│   ├── ai.js         ★  AI 호출 + 오프라인 폴백            [AI]
│   ├── voice.js          음성 입력(STT) / 읽어주기(TTS)
│   └── app.js            화면 제어
├── api/                  Vercel 서버 함수 — 여기서만 API 키를 씁니다
│   ├── _shared.js        공용 코드 (_ 로 시작하면 주소가 안 생김)
│   ├── health.js         배포 상태 확인
│   ├── delay.js      ★  지연 원인 설명                      [AI]
│   ├── chat.js       ★  쉬운모드 대화                       [AI]
│   ├── stt.js        ★  음성 → 텍스트 (Whisper)             [AI]
│   └── bis/              울산 BIS 실시간 데이터             [일반 로직]
├── vercel.json           배포 설정
├── worker/worker.js      (대안) Cloudflare Worker — Vercel 쓰면 불필요
├── tools/
│   ├── serve.ps1         로컬 미리보기 서버
│   └── fetch-stops.ps1   울산 BIS 정류장 데이터 내려받기
└── data/stops.json       (선택) 미리 받아둔 실제 정류장 데이터
```

### AI는 어디에 쓰였나 — 심사위원 질문 대비

이 프로젝트는 **AI를 쓴 곳과 안 쓴 곳을 파일 단위로 분리**했습니다.
화면에도 <kbd>AI</kbd> / <kbd>일반 로직</kbd> 배지가 붙어 있습니다.

| 기능 | 파일 | AI? |
|---|---|---|
| 근처 스팟 찾기, 거리·도보시간 계산 | `geo.js` | ❌ 하버사인 공식 |
| 환승 거점 선택, 총 소요시간 계산 | `route.js` | ❌ 최솟값 탐색 + 사칙연산 |
| DRT 호출 상태 관리 | `drt.js` | ❌ 상태 머신 |
| **지연 원인을 사람 말로 설명** | `ai.js` | ✅ |
| **쉬운모드 자유 발화 이해** | `ai.js` | ✅ |

**숫자는 절대 AI에게 맡기지 않습니다.** 계산은 `route.js`가 하고, AI는 그 결과를 설명만 합니다.
AI가 근거 없는 이유를 지어내지 못하도록 프롬프트에서 막았고, AI가 고른 목적지도
우리 데이터와 대조해 존재하지 않으면 버립니다.

---

## 3. Vercel로 배포하기 (권장)

**화면과 AI 서버가 한 번에 배포됩니다.** 별도 프록시 서버가 필요 없고,
같은 도메인이라 CORS 문제도 없습니다. 로컬에 Node.js가 없어도 됩니다
— 빌드는 Vercel이 클라우드에서 처리합니다.

### 3-1. GitHub에 올리기

GitHub에서 새 저장소 `eeum-web` 을 만든 뒤 (README 추가 옵션은 **체크 해제**):

```bash
git remote add origin https://github.com/<내계정>/eeum-web.git
git branch -M main
git push -u origin main
```

### 3-2. Vercel에 연결하기

1. [vercel.com](https://vercel.com) 에 **GitHub 계정으로 로그인** (무료)
2. **Add New → Project** → 방금 만든 `eeum-web` 저장소 **Import**
3. 설정 화면에서 아무것도 건드리지 마세요:
   - Framework Preset: **Other**
   - Build Command / Output Directory: **비워둠** (`vercel.json`이 알아서 처리)
4. **Environment Variables** 를 펼쳐 아래 두 개를 추가합니다:

   | Name | Value |
   |---|---|
   | `OPENAI_API_KEY` | 해커톤에서 받은 OpenAI 키 |
   | `BIS_SERVICE_KEY` | data.go.kr 인증키 (**Decoding** 값) |

5. **Deploy** 클릭 → 1분쯤 뒤 `https://eeum-web-xxxx.vercel.app` 주소가 나옵니다.

> 환경변수를 나중에 추가했다면 **Deployments → 최신 항목 → Redeploy** 를 해야 반영됩니다.
> (환경변수는 배포 시점에 주입되기 때문입니다)

### 3-3. 배포 확인

브라우저에서 `https://<내주소>.vercel.app/api/health` 에 접속해보세요.

```json
{"ok":true,"service":"eeum-api","openai":true,"bis":true}
```

- `openai: false` → `OPENAI_API_KEY` 가 없거나 Redeploy를 안 한 것입니다
- `bis: false` → `BIS_SERVICE_KEY` 미설정 (없어도 앱은 정상 동작합니다)

앱은 시작할 때 이 주소를 자동으로 확인해서 AI를 켭니다.
**`js/config.js` 를 손댈 필요가 없습니다.** 상단 배지가 `AI 연결됨` 으로 바뀌면 성공입니다.

### 3-4. 서버 함수 구성

| 주소 | 하는 일 | AI? |
|---|---|---|
| `/api/health` | 배포 상태 확인 | — |
| `/api/delay` | 지연 원인 설명 생성 | ✅ GPT |
| `/api/chat` | 쉬운모드 대화 | ✅ GPT |
| `/api/stt` | 음성 → 텍스트 | ✅ Whisper |
| `/api/bis/arrival` | 실시간 버스 도착정보 | ❌ 울산 BIS |
| `/api/bis/stops` | 정류장 목록 | ❌ 울산 BIS |

> **왜 서버 함수를 거치나요?**
> ① 정적 페이지에 API 키를 넣으면 소스보기로 누구나 훔쳐갑니다.
> ② 울산 BIS는 `http://` 만 지원해서 HTTPS 페이지에서 직접 부르면 브라우저가 차단합니다.
> ③ 공공 API는 CORS 헤더가 없어 브라우저가 응답을 못 읽습니다.
> ④ BIS는 XML만 주는데 프론트에서는 JSON이 편합니다.
> 이 네 가지를 서버 함수가 한 번에 해결합니다.

### 3-5. QR 코드 만들기

배포된 `https://...vercel.app` 주소를 QR 생성 사이트에 넣어 이미지를 뽑아
발표 자료에 넣으면 됩니다. (`qr-code-generator.com`, 네이버 QR 등)

> ⚠️ 반드시 HTTPS 주소여야 합니다. 위치·마이크는 HTTPS에서만 동작합니다.
> Vercel은 기본이 HTTPS라 그냥 쓰시면 됩니다.

### (대안) Cloudflare Worker

`worker/worker.js` 는 Cloudflare Workers용으로 만들어둔 **같은 기능의 대안**입니다.
Vercel을 쓴다면 필요 없습니다. GitHub Pages 등 서버 함수가 없는 곳에 올릴 때만 쓰세요.
그 경우 Worker 배포 후 주소를 `js/config.js` 의 `PROXY_URL` 에 넣거나
`?proxy=https://...` 로 지정하면 됩니다.

---

## 4. 울산 BIS API 연동 상태

정류장·노선·**실시간 도착정보**를 제공하는 울산광역시 자체 API입니다.

- **주소**: `http://openapi.its.ulsan.kr/UlsanAPI/`
- **형식**: XML (JSON 미지원)
- **HTTPS 미지원** → Worker 프록시 경유 필수

| 오퍼레이션 | 용도 |
|---|---|
| `BusStopInfo.xo` | 정류장 목록 + 좌표 (약 3,297개) |
| `getBusArrivalInfo.xo` | **실시간 도착정보** (초 단위) |
| `RouteInfo.xo` | 노선 목록 (약 465개) |
| `BusTimetable.xo` | 노선별 시간표 |

### ⚠️ 현재 인증키 문제

테스트 결과 `SERVICE KEY IS NOT REGISTERED ERROR (resultCode 30)` 가 반환됩니다.
키 형식 자체는 정상(88자 Base64)이고 Encoding/Decoding 둘 다 같은 오류이므로,
**오타가 아니라 활용신청 승인 문제**입니다.

**해결 방법**: data.go.kr → 마이페이지 → 활용신청 현황에서
**"울산광역시_BIS정보"** 가 승인 상태인지 확인하세요.
방금 신청했다면 게이트웨이 반영에 최대 1시간 정도 걸립니다.

키가 열리면 정류장 데이터를 미리 받아둘 수 있습니다:

```bash
powershell -ExecutionPolicy Bypass -File tools\fetch-stops.ps1 -ServiceKey "발급받은_Decoding_키"
```

키가 없어도 **앱은 시드 데이터로 정상 동작합니다.**

---

## 5. 발표 중 사고 방지 장치

발표장 와이파이는 믿을 수 없다는 전제로 만들었습니다.

| 상황 | 앱의 대응 |
|---|---|
| AI 서버 응답 없음 / 8초 초과 | 규칙 기반 응답으로 **자동 전환**, 화면은 계속 진행 |
| 위치 권한 거부 / GPS 실패 | 척과마을회관 기준으로 **자동 대체**, 안내 문구 표시 |
| 마이크 사용 불가 | 마이크 대신 키보드 입력 + 빠른 선택 버튼 |
| iOS에서 음성인식 안 됨 | 녹음 후 Whisper 전송 방식이 기본이라 **iOS도 동작** |
| BIS API 죽음 | 번들된 정적 데이터로 계속 동작 |

**긴급 스위치** — 주소 뒤에 붙이면 바로 적용됩니다.

| URL | 효과 |
|---|---|
| `?demo=1` | 네트워크를 아예 쓰지 않는 **완전 오프라인 모드** |
| `?proxy=https://...` | 프록시 주소를 즉석에서 교체 (재배포 불필요) |
| `?proxy=` | 프록시 해제 → 오프라인 모드로 전환 |

---

## 6. 시연 순서 (권장)

1. **QR 스캔** → 심사위원 휴대폰에서 열림
2. **일반모드** → `현재 위치 사용하기` → 근처 스팟 3곳이 거리순으로 뜸
   → *"거리는 하버사인 공식으로 계산합니다. AI 아닙니다."*
3. 목적지 `울산대학교병원` 선택 → `경로 찾기`
   → 총 소요시간, 5단계 경로, 실제 대기시간(도보시간을 뺀 값)
   → *"기존 앱은 DRT와 시내버스를 따로 보여줍니다. 이음은 하나로 잇습니다."*
4. **지연 안내 카드** → *"여기만 AI입니다. 숫자는 우리가 계산하고 AI는 설명만 합니다."*
5. `마실고래버스 부르기` → 배차 → 도착 카운트다운 → 탑승
   *(시연을 위해 1분을 4초로 압축했습니다 — `drt.js`의 `DEMO_TICK_MS`)*
6. **쉬운모드 전환** → 글씨·버튼이 커짐
   → 마이크 누르고 *"병원 가고 싶어요"* → 음성 인식 → 경로 안내 + 읽어주기
   → *"고령자는 출발지·도착지를 입력하는 것 자체가 장벽입니다."*

---

## 7. 데이터 정확도에 대한 정직한 안내

- **마실고래버스 스팟 좌표는 추정값입니다.** 공식 스팟 목록이 공개 API로 제공되지 않아
  울주군 각 마을 중심부 기준으로 시드 데이터를 구성했습니다. 화면에도 `추정 좌표` 로 표시됩니다.
- **DRT 배차 시간은 시간대별 규칙 기반 추정치**입니다. 실제 운영사 배차 데이터가 아닙니다.
- **마실고래버스 호출은 시뮬레이션입니다.** 호출 API가 공개되어 있지 않아
  실제 운영 흐름(호출→배차→도착→탑승)을 재현했습니다.
  실제 서비스에서는 `drt.js`의 `requestCall()` 안쪽만 운영사 API로 교체하면 됩니다.
- **시내버스 도착정보**는 BIS 인증키가 열리면 실시간 값으로 대체됩니다.

---

## 8. 보안

- API 키는 **절대 이 저장소에 넣지 마세요.** Worker의 Secret 환경변수에만 저장합니다.
- `data/stops.json` 은 공개 데이터라 커밋해도 됩니다.
- 발표 후에는 노출된 적 있는 키를 **재발급**하는 것을 권장합니다.
