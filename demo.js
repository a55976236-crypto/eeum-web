/**
 * 이음(EEUM) — 발표용 데모 시나리오
 *
 *   성암파출소 --(마실고래버스)--> 다운교 환승 --(구영운동장행 버스)--> 구영운동장
 *
 * ★ 이 파일은 '가짜 화면'이 아닙니다.
 *   거리·시간 계산은 geo.js/route.js의 동일한 함수를 그대로 재사용하고(일반 로직),
 *   지연 설명·대화는 ai.js의 explainDelay()/easyChat()을 그대로 호출합니다(AI 또는 동일한 폴백).
 *   DRT 호출도 drt.js의 DrtCall을 그대로 재사용합니다.
 *   즉, 실제 앱 로직을 정해진 시나리오 좌표 하나로 고정해서 보여주는 것뿐입니다.
 *   (실 좌표는 추정값입니다 — data.js의 다른 스팟들과 동일한 수준의 근사치)
 */

/** 마스코트 이미지 경로 — 프로젝트 루트 기준 img/mascot.png 에 파일을 넣어주세요. */
const MASCOT_SRC = 'img/mascot.png';

/** 구간 종류별 경로선 색상 — css/style.css의 --demo-drt/--demo-bus/--demo-walk와 맞춰뒀습니다. */
const DEMO_LEG_COLORS = { drt: '#7b2ff7', bus: '#17a673', walk: '#ff4d5e' };

const DEMO_SCENARIO = {
  spot: { id: 'DEMO-SPOT', name: '성암파출소', area: '남구 성암동', lat: 35.5238, lng: 129.3418 },
  hub: { id: 'DEMO-HUB', name: '다운교', lat: 35.5392, lng: 129.3125, routes: ['126'] },
  destination: { id: 'DEMO-DEST', name: '구영운동장', kind: '체육시설', lat: 35.5668, lng: 129.2308 },
  persona: {
    name: '박순자', age: 68, emoji: '👵',
    facts: ['울주군 성암동 인근 거주', '구영운동장 조기축구회 참석', '마실고래버스 첫 이용', '쉬운모드로 이용'],
  },
};

/** route.js/geo.js의 계산 함수를 그대로 써서 이 시나리오의 경로를 만듭니다. 숫자를 지어내지 않습니다. */
function buildDemoRoute() {
  const now = new Date();
  const { spot, hub, destination } = DEMO_SCENARIO;

  const legDrt = haversineMeters(spot.lat, spot.lng, hub.lat, hub.lng);
  const legBus = haversineMeters(hub.lat, hub.lng, destination.lat, destination.lng);

  const dispatchMin = estimateDrtDispatchMinutes(now);
  const drtRideMin = roadMinutes(legDrt, DRT_SPEED_M_PER_MIN);
  const actualWaitMin = dispatchMin; // 데모 인물은 이미 스팟(파출소 앞)에 서 있다고 가정 → 도보시간 0

  const delay = estimateBusDelay(now);
  const busRideMin = roadMinutes(legBus, BUS_SPEED_M_PER_MIN);
  const busRoute = hub.routes[0];
  const finalWalkMin = 2;

  const totalMin = actualWaitMin + drtRideMin + delay.actual + busRideMin + finalWalkMin;
  const arrivalAt = new Date(now.getTime() + totalMin * 60000);

  return {
    createdAt: now,
    spot, hub, destination,
    legDrt, legBus,
    dispatchMin, drtRideMin, actualWaitMin,
    delay, busRideMin, busRoute, finalWalkMin,
    totalMin, arrivalAt,
  };
}

// ─────────────────────────────────────────────────────────────
// 공용 카운트다운 유틸 — DRT 탑승 후 이동, 버스 대기·이동에 재사용
// (drt.js의 DEMO_TICK_MS와 동일한 박자로 압축됩니다)
// ─────────────────────────────────────────────────────────────

function startDemoCountdown(totalMin, { onTick, onDone }) {
  let remaining = totalMin;
  let cancelled = false;
  let timerId = null;

  function fire() {
    if (cancelled) return;
    onTick(remaining, totalMin);
    if (remaining <= 0) { onDone(); return; }
    timerId = setTimeout(() => { remaining -= 1; fire(); }, DEMO_TICK_MS);
  }
  fire();
  return () => { cancelled = true; clearTimeout(timerId); };
}

function lerpLatLng(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// ─────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────

const DEMO_STEPS = ['intro', 'locate', 'chat', 'journey', 'summary'];

const demoState = {
  built: false,
  stepIndex: 0,
  route: null,
  chatHistory: [],
  journeyPhase: 'ready', // ready → requesting → matched → arriving → arrived_spot → riding_drt → hub_arrived → bus_waiting → bus_arrived → riding_bus → done
  cancelTicker: null,
};

let demoDrt = null;
let demoMap = null;
let demoVehicleOverlay = null;
let demoPinOverlays = [];

// ─────────────────────────────────────────────────────────────
// 탭 연결 (lazy init — 데모 탭을 처음 누를 때 한 번만 화면을 만듭니다)
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const tab = document.getElementById('tab-demo');
  if (tab) tab.addEventListener('click', () => { if (!demoState.built) buildDemoScreen(); });
});

function buildDemoScreen() {
  demoState.built = true;
  const root = document.getElementById('demo-root');
  if (!root) return;

  root.appendChild(el(`
    <div class="demo-progress" id="demo-progress">
      ${DEMO_STEPS.map((_, i) => `<span class="demo-dot" data-i="${i}"></span>`).join('')}
    </div>`));
  root.appendChild(el(`<div class="demo-stage" id="demo-stage"></div>`));

  demoDrt = new DrtCall(onDemoDrtChange);
  goDemoStep(0);
}

function goDemoStep(index) {
  demoState.stepIndex = index;
  document.querySelectorAll('#demo-progress .demo-dot').forEach((d, i) => {
    d.classList.toggle('on', i === index);
    d.classList.toggle('done', i < index);
  });

  const stage = document.getElementById('demo-stage');
  if (!stage) return;
  stage.innerHTML = '';
  stage.classList.remove('demo-enter');
  void stage.offsetWidth; // 리플로우 강제 — 스텝 전환 애니메이션이 매번 다시 재생되도록
  stage.classList.add('demo-enter');

  const renderers = {
    intro: renderDemoIntro,
    locate: renderDemoLocate,
    chat: renderDemoChat,
    journey: renderDemoJourney,
    summary: renderDemoSummary,
  };
  renderers[DEMO_STEPS[index]](stage);
}

function resetDemo() {
  if (demoState.cancelTicker) demoState.cancelTicker();
  demoState.route = null;
  demoState.chatHistory = [];
  demoState.journeyPhase = 'ready';
  if (demoDrt) demoDrt.cancel();
  demoMap = null;
  demoVehicleOverlay = null;
  demoPinOverlays = [];
  goDemoStep(0);
}

// ─────────────────────────────────────────────────────────────
// 스텝 1 — 인트로
// ─────────────────────────────────────────────────────────────

function renderDemoIntro(stage) {
  const p = DEMO_SCENARIO.persona;
  stage.appendChild(el(`
    <div class="demo-hero">
      <div class="demo-hero-emoji">${p.emoji}</div>
      <div class="demo-hero-title">${esc(p.name)} (${p.age}세)</div>
      <ul class="demo-facts">
        ${p.facts.map((f) => `<li>${esc(f)}</li>`).join('')}
      </ul>
    </div>`));
  stage.appendChild(el(`
    <div class="demo-sheet">
      <div class="demo-sheet-title">오늘의 이동을 함께 안내합니다</div>
      <p class="demo-sheet-desc">
        <b>${esc(DEMO_SCENARIO.spot.name)}</b>에서 마실고래버스를 타고
        <b>${esc(DEMO_SCENARIO.hub.name)}</b>에서 환승,
        <b>${esc(DEMO_SCENARIO.destination.name)}</b>까지 이동하는 과정을
        처음부터 끝까지 이 화면 하나로 보여드립니다.
      </p>
      <button class="demo-btn" id="demo-intro-next">시작하기</button>
    </div>`));

  document.getElementById('demo-intro-next').addEventListener('click', () => goDemoStep(1));
}

// ─────────────────────────────────────────────────────────────
// 스텝 2 — 출발지 확인 (마실고래버스 스팟 추천 · 일반 로직)
// ─────────────────────────────────────────────────────────────

function renderDemoLocate(stage) {
  const spot = DEMO_SCENARIO.spot;
  const dispatchMin = estimateDrtDispatchMinutes(new Date());

  stage.appendChild(el(`
    <div class="demo-hero demo-hero-sm">
      <div class="demo-hero-emoji">📍</div>
      <div class="demo-hero-title">${esc(spot.name)}</div>
      <div class="demo-hero-sub">${esc(spot.area)}</div>
    </div>`));
  stage.appendChild(el(`
    <div class="demo-sheet">
      <div class="demo-sheet-title">가장 가까운 마실고래버스 스팟
        <span class="demo-tag demo-tag-logic">일반 로직</span>
      </div>
      <p class="demo-sheet-desc">
        현재 위치에서 가장 가까운 호출 스팟은 <b>${esc(spot.name)}</b>입니다.
        지금 호출하면 약 <b>${dispatchMin}분</b> 뒤 배차되며, 현재 지연은 없습니다.
      </p>
      <button class="demo-btn" id="demo-locate-next">목적지 말하기</button>
    </div>`));

  document.getElementById('demo-locate-next').addEventListener('click', () => goDemoStep(2));
}

// ─────────────────────────────────────────────────────────────
// 스텝 3 — 쉬운모드 대화로 목적지 확정 (AI)
// ─────────────────────────────────────────────────────────────

function renderDemoChat(stage) {
  stage.appendChild(el(`
    <div class="demo-hero demo-hero-sm">
      <div class="demo-hero-emoji"><img src="${MASCOT_SRC}" alt="이음이"></div>
      <div class="demo-hero-title">쉬운모드로 말해보세요</div>
      <div class="demo-hero-sub">AI 대화형 인터페이스</div>
    </div>`));
  stage.appendChild(el(`
    <div class="demo-sheet demo-sheet-chat">
      <div class="demo-sheet-title">어디로 가고 싶으신가요?
        <span class="demo-tag demo-tag-ai">AI</span>
      </div>
      <div class="demo-chat" id="demo-chat"></div>
      <div class="demo-quick" id="demo-quick">
        <button type="button">구영운동장 가고 싶어요</button>
      </div>
      <div class="demo-input-row">
        <input class="demo-input" id="demo-chat-input" placeholder="직접 입력해도 됩니다" autocomplete="off">
        <button class="demo-send" id="demo-chat-send">전송</button>
      </div>
    </div>`));

  const log = document.getElementById('demo-chat');
  const botAvatar = `<img src="${MASCOT_SRC}" alt="이음이">`;
  const addBubble = (role, text) => {
    log.appendChild(el(`
      <div class="demo-msg demo-msg-${role === 'user' ? 'user' : 'bot'}">
        <div class="demo-msg-avatar">${role === 'user' ? '👤' : botAvatar}</div>
        <div class="demo-bubble">${esc(text)}</div>
      </div>`));
    log.scrollTop = log.scrollHeight;
  };

  addBubble('bot', '안녕하세요, 이음입니다. 어디로 가고 싶으신가요?');

  async function send(text) {
    if (!text.trim()) return;
    addBubble('user', text);
    demoState.chatHistory.push({ role: 'user', content: text });
    document.getElementById('demo-chat-input').value = '';

    const typing = el(`
      <div class="demo-msg demo-msg-bot">
        <div class="demo-msg-avatar">${botAvatar}</div>
        <div class="demo-bubble"><span class="demo-typing"><i></i><i></i><i></i></span></div>
      </div>`);
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;

    const result = await easyChat(text, demoState.chatHistory, {
      hasLocation: true,
      nearestSpotName: DEMO_SCENARIO.spot.name,
    });
    typing.remove();
    addBubble('bot', result.reply);
    demoState.chatHistory.push({ role: 'assistant', content: result.reply });

    if (result.ready && result.destination) {
      setTimeout(() => goDemoStep(3), 700);
    }
  }

  document.querySelector('#demo-quick button').addEventListener('click', (e) => send(e.target.textContent));
  document.getElementById('demo-chat-send').addEventListener('click', () => send(document.getElementById('demo-chat-input').value));
  document.getElementById('demo-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') send(e.target.value);
  });
}

// ─────────────────────────────────────────────────────────────
// 스텝 4 — 여정 (지도 + 바텀시트, 실제 대기시간·환승 안내·DRT 호출·AI 지연 설명·
//           환승 버스까지 지도 위에서 함께 이동)
// ─────────────────────────────────────────────────────────────

function renderDemoJourney(stage) {
  demoState.route = demoState.route || buildDemoRoute();
  const route = demoState.route;

  stage.appendChild(el(`<div class="demo-map-wrap"><div class="demo-map" id="demo-map"></div></div>`));
  stage.appendChild(el(`<div class="demo-sheet demo-sheet-journey" id="demo-journey-panel"></div>`));

  setTimeout(() => initDemoMap(route), 0);
  renderJourneyPanel(route);
}

async function initDemoMap(route) {
  const box = document.getElementById('demo-map');
  if (!box) return;

  try {
    await waitForKakaoMaps();
  } catch (_) {
    box.innerHTML = '';
    box.appendChild(el(`
      <div class="map-fallback">
        <div>
          지도를 불러오지 못했습니다.<br>네트워크 연결을 확인해주세요.<br>
          <button class="demo-btn demo-btn-ghost" style="margin-top:10px" id="demo-map-retry">다시 시도</button>
        </div>
      </div>`));
    document.getElementById('demo-map-retry')?.addEventListener('click', () => initDemoMap(route));
    return;
  }
  if (!document.getElementById('demo-map')) return; // 그새 다른 스텝으로 넘어갔으면 중단

  box.innerHTML = '';
  demoMap = new kakao.maps.Map(box, {
    center: new kakao.maps.LatLng(route.hub.lat, route.hub.lng),
    level: 8,
  });

  const bounds = new kakao.maps.LatLngBounds();
  demoPinOverlays = [];

  // CustomOverlay(DOM+CSS) 대신 카카오맵 네이티브 Marker + MarkerImage(SVG,
  // 중심점 offset)를 씁니다. 원의 중심이 곧 앵커라 좌표·경로선과 어긋날 여지가 없습니다.
  [
    { p: route.spot, cls: 'spot', icon: '🐋', color: '#7b2ff7' },
    { p: route.hub, cls: 'hub', icon: '🔄', color: '#5b2c82' },
    { p: route.destination, cls: 'dest', icon: '🎯', color: '#d6249f' },
  ].forEach(({ p, icon, color }) => {
    const pos = new kakao.maps.LatLng(p.lat, p.lng);
    bounds.extend(pos);

    const size = 28;
    const half = size / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
      + `<circle cx="${half}" cy="${half}" r="${half - 2}" fill="${color}" stroke="#fff" stroke-width="2.5"/>`
      + `<text x="${half}" y="${half + 5}" font-size="14" text-anchor="middle">${icon}</text>`
      + `</svg>`;
    const image = new kakao.maps.MarkerImage(
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      new kakao.maps.Size(size, size),
      { offset: new kakao.maps.Point(half, half) },
    );

    const marker = new kakao.maps.Marker({ position: pos, image, zIndex: 2 });
    marker.setMap(demoMap);
    demoPinOverlays.push(marker);
  });

  // 구간별로 선을 나눠 그립니다 — DRT 구간(보라)과 버스 구간(초록)을 색으로 구분합니다.
  new kakao.maps.Polyline({
    path: [route.spot, route.hub].map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
    strokeWeight: 5, strokeColor: DEMO_LEG_COLORS.drt, strokeOpacity: .9, strokeStyle: 'solid',
  }).setMap(demoMap);
  new kakao.maps.Polyline({
    path: [route.hub, route.destination].map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
    strokeWeight: 5, strokeColor: DEMO_LEG_COLORS.bus, strokeOpacity: .9, strokeStyle: 'solid',
  }).setMap(demoMap);

  // 레이아웃이 실제로 자리 잡은 다음 프레임에 딱 한 번만 크기를 맞춥니다.
  // (즉시+80ms 뒤 이중 보정이 사용자의 확대·축소를 덮어쓰는 문제가 있었습니다)
  requestAnimationFrame(() => {
    demoMap.relayout();
    demoMap.setBounds(bounds, 64, 64, 64, 64);
  });
}

/** 지도 위를 이동하는 마커 — 사람 아이콘 대신 마스코트가 여정을 함께합니다. */
function setDemoVehicle(pos) {
  if (!demoMap) return;
  const latlng = new kakao.maps.LatLng(pos.lat, pos.lng);
  if (!demoVehicleOverlay) {
    const size = 40;
    const image = new kakao.maps.MarkerImage(
      MASCOT_SRC,
      new kakao.maps.Size(size, size),
      { offset: new kakao.maps.Point(size / 2, size / 2) },
    );
    demoVehicleOverlay = new kakao.maps.Marker({ position: latlng, image, zIndex: 5 });
    demoVehicleOverlay.setMap(demoMap);
  } else {
    demoVehicleOverlay.setPosition(latlng);
  }
}

function clearDemoVehicle() {
  if (demoVehicleOverlay) { demoVehicleOverlay.setMap(null); demoVehicleOverlay = null; }
}

/** 여정 바텀시트 — journeyPhase에 따라 내용만 바뀌고 지도는 그대로 유지됩니다. */
function renderJourneyPanel(route) {
  const panel = document.getElementById('demo-journey-panel');
  if (!panel) return;
  panel.innerHTML = '';
  const phase = demoState.journeyPhase;

  // el()은 템플릿의 첫 번째 최상위 요소만 반환하므로, 형제로 여러 블록을
  // 넣어야 하는 화면은 전부 하나의 <div>로 감싸서 단일 루트로 만듭니다.

  // ── 준비: 실제 대기시간 계산 + 환승 안내 (일반 로직) ──
  if (phase === 'ready') {
    panel.appendChild(el(`
      <div>
        <div class="demo-sheet-title">${route.totalMin}분 뒤 도착 예상
          <span class="demo-tag demo-tag-logic">일반 로직</span>
        </div>
        <div class="demo-route-line">
          ${esc(route.spot.name)} → ${esc(route.hub.name)} 환승 → ${esc(route.destination.name)}
        </div>
        <div class="demo-metric-row">
          <div class="demo-metric"><b>${route.actualWaitMin}분</b><span>실제 대기시간</span></div>
          <div class="demo-metric"><b>${route.busRoute}번</b><span>환승 버스 노선</span></div>
          <div class="demo-metric"><b>${route.delay.actual}분</b><span>환승 후 도착까지</span></div>
        </div>
        <p class="demo-sheet-desc">
          배차 ${route.dispatchMin}분 − 도보 0분(이미 스팟) = 실제 대기 ${route.actualWaitMin}분.
          체감이 아니라 배차시간에서 도보시간을 뺀 값입니다.
        </p>
        <button class="demo-btn" id="demo-call-btn">🐋 마실고래버스 부르기</button>
      </div>`));
    document.getElementById('demo-call-btn').addEventListener('click', () => {
      demoState.journeyPhase = 'requesting';
      demoDrt.requestCall(route.spot, route.destination, route.dispatchMin);
      renderJourneyPanel(route);
    });
    return;
  }

  // ── DRT 요청 중 / 배차 완료 / 스팟으로 접근 중 ──
  if (phase === 'requesting' || phase === 'matched' || phase === 'arriving') {
    const label = { requesting: '근처 차량을 찾고 있습니다...', matched: '차량이 배정되었습니다', arriving: '차량이 오고 있습니다' }[phase];
    panel.appendChild(el(`
      <div>
        <div class="demo-sheet-title"><span class="demo-pulse"></span> ${esc(label)}</div>
        ${demoDrt.etaMin != null ? `<div class="demo-eta">${demoDrt.etaMin}<small>분 뒤 도착</small></div>` : '<p class="demo-sheet-desc">잠시만 기다려주세요.</p>'}
        ${demoDrt.vehicle ? `
          <dl class="demo-vehicle-info">
            <dt>차량</dt><dd>${esc(demoDrt.vehicle.plate)}</dd>
            <dt>기사님</dt><dd>${esc(demoDrt.vehicle.driver)}</dd>
          </dl>` : ''}
      </div>`));
    return;
  }

  // ── 스팟 도착, 탑승 대기 ──
  if (phase === 'arrived_spot') {
    panel.appendChild(el(`
      <div>
        <div class="demo-sheet-title">🐋 차량이 도착했습니다</div>
        <p class="demo-sheet-desc">${esc(route.spot.name)}에서 탑승해주세요.</p>
        <button class="demo-btn" id="demo-board-btn">탑승했습니다</button>
      </div>`));
    document.getElementById('demo-board-btn').addEventListener('click', () => {
      demoDrt.board();
      demoState.journeyPhase = 'riding_drt';
      renderJourneyPanel(route);
      startDrtRide(route);
    });
    return;
  }

  // ── DRT 이동 중 ──
  if (phase === 'riding_drt') {
    panel.appendChild(el(`
      <div>
        <div class="demo-sheet-title">🐋 ${esc(route.hub.name)}(으)로 이동 중</div>
        <div class="demo-eta" id="demo-drt-ride-eta">${route.drtRideMin}<small>분 남음</small></div>
      </div>`));
    return;
  }

  // ── 다운교 도착 → AI 지연 설명 → 버스 대기 ──
  if (phase === 'hub_arrived' || phase === 'bus_waiting') {
    panel.appendChild(el(`
      <div>
        <div class="demo-sheet-title">${esc(route.hub.name)} 도착
          <span class="demo-tag demo-tag-logic">일반 로직</span>
        </div>
        <p class="demo-sheet-desc">여기서 <b>${route.busRoute}번 버스</b>로 환승합니다.</p>
        <div class="demo-sheet-title" style="margin-top:14px">지연 안내
          <span class="demo-tag demo-tag-ai">AI</span>
        </div>
        <div id="demo-delay-body">
          <div class="demo-notice"><span class="demo-spinner"></span> 지연 상황을 분석하고 있습니다...</div>
        </div>
        <div class="demo-eta" style="margin-top:14px">${demoState.busEtaMin ?? route.delay.actual}<small>분 뒤 버스 도착</small></div>
      </div>`));

    if (phase === 'hub_arrived') {
      demoState.journeyPhase = 'bus_waiting';
      explainDelay(route).then(({ text, mode }) => {
        const body = document.getElementById('demo-delay-body');
        if (!body) return;
        body.innerHTML = '';
        body.appendChild(el(`
          <div class="demo-notice ${route.delay.isDelayed ? 'demo-notice-warn' : 'demo-notice-ok'}">
            ${route.delay.isDelayed ? '⏱️' : '✅'} ${esc(text)}
          </div>`));
        if (mode === 'fallback') {
          body.appendChild(el(`<div class="demo-notice demo-notice-info" style="margin-top:8px">ℹ️ 오프라인 안내로 표시 중입니다.</div>`));
        }
      });
      startBusWait(route);
    }
    return;
  }

  // ── 버스 도착, 탑승 대기 ──
  if (phase === 'bus_arrived') {
    panel.appendChild(el(`
      <div>
        <div class="demo-sheet-title">🚌 ${route.busRoute}번 버스가 도착했습니다</div>
        <p class="demo-sheet-desc">${esc(route.hub.name)}에서 탑승해주세요.</p>
        <button class="demo-btn" id="demo-bus-board-btn">탑승했습니다</button>
      </div>`));
    document.getElementById('demo-bus-board-btn').addEventListener('click', () => {
      demoState.journeyPhase = 'riding_bus';
      renderJourneyPanel(route);
      startBusRide(route);
    });
    return;
  }

  // ── 버스 이동 중 ──
  if (phase === 'riding_bus') {
    panel.appendChild(el(`
      <div>
        <div class="demo-sheet-title">🚌 ${esc(route.destination.name)}(으)로 이동 중</div>
        <div class="demo-eta" id="demo-bus-ride-eta">${route.busRideMin}<small>분 남음</small></div>
      </div>`));
    return;
  }

  // ── 최종 도착 — 마스코트가 나와서 축하해줍니다 ──
  if (phase === 'done') {
    panel.appendChild(el(`
      <div>
        <div class="demo-celebrate">
          <div class="demo-celebrate-mascot"><img src="${MASCOT_SRC}" alt="이음이"></div>
          <div class="demo-celebrate-title">${esc(route.destination.name)} 도착!</div>
          <div class="demo-celebrate-sub">총 이동시간 약 ${route.totalMin}분, 직원에게 묻지 않고 혼자 완료했습니다.</div>
        </div>
        <button class="demo-btn" id="demo-arrived-next">여정 요약 보기</button>
      </div>`));
    document.getElementById('demo-arrived-next').addEventListener('click', () => goDemoStep(4));
    return;
  }
}

function onDemoDrtChange(c) {
  if (!demoState.route) return;
  const route = demoState.route;

  if (c.state === 'requesting') demoState.journeyPhase = 'requesting';
  if (c.state === 'matched') demoState.journeyPhase = 'matched';
  if (c.state === 'arriving') {
    demoState.journeyPhase = 'arriving';
    if (!demoState._drtArrivingTotal) demoState._drtArrivingTotal = c.etaMin;
    const t = 1 - c.etaMin / demoState._drtArrivingTotal;
    const approach = lerpLatLng(route.hub, route.spot, 1.2); // 스팟 너머에서 다가오는 것처럼
    setDemoVehicle(lerpLatLng(approach, route.spot, t));
  }
  if (c.state === 'arrived') {
    demoState.journeyPhase = 'arrived_spot';
    demoState._drtArrivingTotal = null;
    setDemoVehicle(route.spot);
  }
  renderJourneyPanel(route);
}

function startDrtRide(route) {
  setDemoVehicle(route.spot);
  demoState.cancelTicker = startDemoCountdown(route.drtRideMin, {
    onTick: (remaining, total) => {
      const t = total > 0 ? 1 - remaining / total : 1;
      setDemoVehicle(lerpLatLng(route.spot, route.hub, t));
      const eta = document.getElementById('demo-drt-ride-eta');
      if (eta) eta.innerHTML = `${remaining}<small>분 남음</small>`;
    },
    onDone: () => {
      demoDrt.finish();
      clearDemoVehicle();
      demoState.journeyPhase = 'hub_arrived';
      renderJourneyPanel(route);
    },
  });
}

function startBusWait(route) {
  demoState.busEtaMin = route.delay.actual;
  demoState.cancelTicker = startDemoCountdown(route.delay.actual, {
    onTick: (remaining) => {
      demoState.busEtaMin = remaining;
      const eta = document.querySelector('#demo-journey-panel .demo-eta');
      if (eta && demoState.journeyPhase === 'bus_waiting') eta.innerHTML = `${remaining}<small>분 뒤 버스 도착</small>`;
    },
    onDone: () => {
      demoState.journeyPhase = 'bus_arrived';
      renderJourneyPanel(route);
    },
  });
}

function startBusRide(route) {
  setDemoVehicle(route.hub);
  demoState.cancelTicker = startDemoCountdown(route.busRideMin, {
    onTick: (remaining, total) => {
      const t = total > 0 ? 1 - remaining / total : 1;
      setDemoVehicle(lerpLatLng(route.hub, route.destination, t));
      const eta = document.getElementById('demo-bus-ride-eta');
      if (eta) eta.innerHTML = `${remaining}<small>분 남음</small>`;
    },
    onDone: () => {
      clearDemoVehicle();
      demoState.journeyPhase = 'done';
      renderJourneyPanel(route);
    },
  });
}

// ─────────────────────────────────────────────────────────────
// 스텝 5 — 요약
// ─────────────────────────────────────────────────────────────

function renderDemoSummary(stage) {
  const route = demoState.route;
  stage.appendChild(el(`
    <div class="demo-hero demo-hero-sm">
      <div class="demo-hero-emoji"><img src="${MASCOT_SRC}" alt="이음이"></div>
      <div class="demo-hero-title">여정 완료</div>
    </div>`));
  stage.appendChild(el(`
    <div class="demo-sheet">
      <div class="demo-sheet-title">${esc(DEMO_SCENARIO.persona.name)}님의 오늘 여정</div>
      <ol class="demo-summary-list">
        <li>쉬운모드로 "구영운동장 가고 싶어요" 대화 시작 — AI가 목적지를 확인</li>
        <li>${esc(route.spot.name)}에서 마실고래버스 탑승 · 실제 대기 ${route.actualWaitMin}분</li>
        <li>${esc(route.hub.name)}에서 ${route.busRoute}번 버스로 환승 · AI가 지연 사유까지 설명</li>
        <li>${esc(route.destination.name)} 도착 · 총 이동시간 약 ${route.totalMin}분</li>
      </ol>
      <button class="demo-btn demo-btn-ghost" id="demo-restart-btn">처음부터 다시 보기</button>
    </div>`));
  document.getElementById('demo-restart-btn').addEventListener('click', resetDemo);
}
