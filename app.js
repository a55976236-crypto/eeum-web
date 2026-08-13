/**
 * 이음(EEUM) — 화면 제어
 *
 * 여기서는 계산을 하지 않습니다. 계산은 route.js/geo.js가, 설명은 ai.js가 합니다.
 * 이 파일은 '무엇을 언제 보여줄지'만 담당합니다.
 */

// ─────────────────────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────────────────────

const state = {
  position: null,      // {lat, lng, accuracy, isFallback?}
  destination: null,
  chosenSpot: null,
  route: null,
  mode: 'normal',      // 'normal' | 'easy'
  chatHistory: [],
  busy: false,
};

const $ = (id) => document.getElementById(id);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ─────────────────────────────────────────────────────────────
// 배지
// ─────────────────────────────────────────────────────────────

function setBadge(id, on, text) {
  const node = $(id);
  if (!node) return;
  node.className = `badge ${on ? 'on' : 'off'}`;
  node.innerHTML = `<span class="dot"></span> ${esc(text)}`;
}

function refreshBadges() {
  if (state.position) {
    setBadge('badge-loc', !state.position.isFallback,
      state.position.isFallback ? '기본 위치 사용 중' : '내 위치 확인됨');
  } else {
    setBadge('badge-loc', false, '위치 확인 전');
  }

  if (aiAvailable()) {
    setBadge('badge-ai', aiState.lastMode !== 'fallback',
      aiState.lastMode === 'fallback' ? 'AI 응답 없음 · 오프라인 안내' : 'AI 연결됨');
  } else {
    setBadge('badge-ai', false, '오프라인 안내 모드');
  }

  const n = dataState.spots.length;
  setBadge('badge-data', true, `스팟 ${n}곳 · 추정 좌표`);
}

// ─────────────────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────────────────

async function init() {
  // 마을 직접 선택 목록
  const selManual = $('sel-manual');
  const byArea = {};
  dataState.spots.forEach((s) => { (byArea[s.area] ||= []).push(s); });
  Object.entries(byArea).forEach(([area, spots]) => {
    const g = document.createElement('optgroup');
    g.label = area;
    spots.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      g.appendChild(o);
    });
    selManual.appendChild(g);
  });

  // 목적지 목록
  const selDest = $('sel-dest');
  dataState.destinations.forEach((d) => {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = `${d.name} (${d.kind})`;
    selDest.appendChild(o);
  });

  bindEvents();
  greetEasyMode();

  // 데이터와 서버 함수 감지를 동시에 — 둘 다 실패해도 앱은 그대로 동작합니다.
  await Promise.all([loadBundledStops(), detectProxy()]);
  refreshBadges();
}

function bindEvents() {
  $('tab-normal').addEventListener('click', () => switchMode('normal'));
  $('tab-easy').addEventListener('click', () => switchMode('easy'));
  $('tab-demo').addEventListener('click', () => switchMode('demo'));

  $('landing-normal').addEventListener('click', () => enterApp('normal'));
  $('landing-easy').addEventListener('click', () => enterApp('easy'));
  $('landing-demo').addEventListener('click', () => enterApp('demo'));
  $('btn-home').addEventListener('click', showLanding);

  $('normal-back-btn').addEventListener('click', () => goNormalStep(0));
  $('easy-back-btn').addEventListener('click', () => goEasyStep(0));

  $('btn-locate').addEventListener('click', handleLocate);
  $('sel-manual').addEventListener('change', handleManualPick);
  $('sel-dest').addEventListener('change', handleDestPick);
  $('btn-route').addEventListener('click', handleFindRoute);

  $('btn-mic').addEventListener('click', handleMic);
  $('btn-send').addEventListener('click', handleSendText);
  $('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSendText();
  });
  $('btn-tts').addEventListener('click', toggleTts);
  $('btn-reset-chat').addEventListener('click', resetChat);

  // iOS 음성 재생 잠금 해제 — 첫 터치 때 한 번만
  document.addEventListener('touchstart', primeTts, { once: true });
  document.addEventListener('click', primeTts, { once: true });
}

// ─────────────────────────────────────────────────────────────
// 시작 화면 (모드 선택)
// ─────────────────────────────────────────────────────────────

function showLanding() {
  $('screen-landing').hidden = false;
  $('app-header').hidden = true;
  $('app-tabs').hidden = true;
  $('app').classList.remove('easy');
  Object.values(MODE_SCREENS).forEach((id) => $(id).classList.remove('active'));
  stopSpeaking();
}

function enterApp(mode) {
  $('screen-landing').hidden = true;
  $('app-header').hidden = false;
  $('app-tabs').hidden = false;
  switchMode(mode);

  // 데모 탭은 원래 tab-demo 클릭에만 지연 빌드가 걸려있어서,
  // 시작 화면의 "데모 보기" 링크로 바로 들어올 때도 빌드되도록 맞춰줍니다.
  if (mode === 'demo' && typeof demoState !== 'undefined' && !demoState.built) {
    buildDemoScreen();
  }
}

// ─────────────────────────────────────────────────────────────
// 일반모드·쉬운모드 — 스텝 전환(스크롤 대신 화면 전환)
// ─────────────────────────────────────────────────────────────

let normalStep = 0;
function goNormalStep(i) {
  normalStep = i;
  $('normal-step-0').hidden = i !== 0;
  $('normal-step-1').hidden = i !== 1;
  document.querySelectorAll('#normal-step-nav .step-dot').forEach((d, idx) => d.classList.toggle('on', idx === i));
  $('normal-back-btn').hidden = i === 0;
  $('screen-normal').scrollTop = 0;
}

let easyStep = 0;
function goEasyStep(i) {
  easyStep = i;
  $('easy-step-0').hidden = i !== 0;
  $('easy-step-1').hidden = i !== 1;
  document.querySelectorAll('#easy-step-nav .step-dot').forEach((d, idx) => d.classList.toggle('on', idx === i));
  $('easy-back-btn').hidden = i === 0;
  $('screen-easy').scrollTop = 0;
}

const MODE_TABS = { normal: 'tab-normal', easy: 'tab-easy', demo: 'tab-demo' };
const MODE_SCREENS = { normal: 'screen-normal', easy: 'screen-easy', demo: 'screen-demo' };

function switchMode(mode) {
  state.mode = mode;

  Object.keys(MODE_TABS).forEach((m) => {
    $(MODE_TABS[m]).setAttribute('aria-selected', String(m === mode));
    $(MODE_SCREENS[m]).classList.toggle('active', m === mode);
  });
  $('app').classList.toggle('easy', mode === 'easy');

  if (mode !== 'easy') stopSpeaking();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─────────────────────────────────────────────────────────────
// 일반모드 — 위치
// ─────────────────────────────────────────────────────────────

async function handleLocate() {
  const btn = $('btn-locate');
  const label = $('locate-label');
  const box = $('locate-result');

  btn.disabled = true;
  label.innerHTML = '<span class="spinner"></span> 위치 확인 중...';
  box.innerHTML = '';

  try {
    state.position = await getCurrentPosition();
    renderNearbySpots();
  } catch (err) {
    // 위치 실패해도 데모는 계속되어야 합니다 → 기본 위치로 진행
    state.position = { ...FALLBACK_POSITION };
    box.appendChild(el(`
      <div class="notice notice-warn">
        <span class="notice-icon">⚠️</span>
        <div>
          ${esc(err.message)}<br>
          <b>시연을 위해 척과마을회관 부근을 기준으로 계속 진행합니다.</b>
        </div>
      </div>`));
    renderNearbySpots(true);
  } finally {
    btn.disabled = false;
    label.textContent = '위치 다시 확인하기';
    refreshBadges();
    updateRouteButton();
  }
}

function handleManualPick(e) {
  const spot = dataState.spots.find((s) => s.id === e.target.value);
  if (!spot) return;

  state.position = { lat: spot.lat, lng: spot.lng, accuracy: null, isManual: true };
  state.chosenSpot = spot;
  $('locate-result').innerHTML = '';
  renderNearbySpots();
  refreshBadges();
  updateRouteButton();
}

/** 근처 스팟 3곳을 거리순으로 보여주고 고르게 합니다. */
function renderNearbySpots(append = false) {
  const box = $('locate-result');
  if (!append) box.innerHTML = '';
  if (!state.position) return;

  const spots = nearest(dataState.spots, state.position.lat, state.position.lng, 3);
  state.chosenSpot = state.chosenSpot || spots[0];

  const acc = state.position.accuracy ? ` · 오차 약 ${state.position.accuracy}m` : '';
  const src = state.position.isManual ? '직접 선택한 마을 기준'
            : state.position.isFallback ? '기본 위치 기준'
            : `현재 위치 기준${acc}`;

  const wrap = el(`
    <div>
      <div class="section-label" style="margin-top:16px">가까운 마실고래버스 스팟 · ${esc(src)}</div>
      <div class="spot-list" id="spot-list"></div>
      <p class="muted" style="margin:8px 0 0">
        거리는 하버사인 공식으로 계산한 직선거리이며, 도보 시간은 분당 67m(교통약자 기준)로 환산했습니다.
      </p>
    </div>`);

  const list = wrap.querySelector('#spot-list');
  spots.forEach((s, i) => {
    const btn = el(`
      <button class="spot" aria-pressed="${s.id === state.chosenSpot.id}" data-id="${esc(s.id)}">
        <span class="spot-rank">${i + 1}</span>
        <span class="spot-body">
          <span class="spot-name">${esc(s.name)}</span>
          <span class="spot-meta">${esc(s.area)} · ${formatDistance(s.distance)} · 도보 ${s.walkMin}분</span>
        </span>
      </button>`);

    btn.addEventListener('click', () => {
      state.chosenSpot = dataState.spots.find((x) => x.id === s.id);
      list.querySelectorAll('.spot').forEach((n) =>
        n.setAttribute('aria-pressed', String(n.dataset.id === s.id)));
      if (state.route) handleFindRoute(); // 이미 경로가 있으면 새 스팟으로 다시 계산
    });
    list.appendChild(btn);
  });

  box.appendChild(wrap);
}

function handleDestPick(e) {
  state.destination = dataState.destinations.find((d) => d.id === e.target.value) || null;
  updateRouteButton();
}

function updateRouteButton() {
  $('btn-route').disabled = !(state.position && state.destination);
}

// ─────────────────────────────────────────────────────────────
// 일반모드 — 경로
// ─────────────────────────────────────────────────────────────

async function handleFindRoute() {
  if (!state.position || !state.destination) return;

  state.route = buildRoute(state.position, state.destination, state.chosenSpot);
  renderRoute(state.route);
  goNormalStep(1); // 스크롤 대신 결과 화면으로 전환

  // AI 지연 설명은 화면을 먼저 그린 뒤 비동기로 채웁니다.
  // (AI가 느려도 경로는 즉시 보이도록)
  fillDelayExplanation(state.route);
}

function renderRoute(route) {
  const box = $('results');
  box.innerHTML = '';

  // ── 요약 ──
  box.appendChild(el(`
    <div class="summary">
      <div class="summary-row">
        <span class="summary-total">${route.totalMin}</span>
        <span class="summary-unit">분 소요 예상</span>
      </div>
      <div class="summary-sub">
        ${esc(route.spot.name)} → ${esc(route.hub.name)} 환승 → ${esc(route.destination.name)}<br>
        지금 출발하면 <b>${formatTime(route.arrivalAt)}</b> 도착 예정
      </div>
    </div>`));

  // ── 지도 ──
  box.appendChild(el(`
    <div class="card">
      <h2 class="card-title">
        <span>🗺️ 지도로 보기</span>
        <span class="tag tag-logic">일반 로직</span>
      </h2>
      <div class="map-box" id="route-map"></div>
      <div class="map-note">직선 경로로 표시했습니다 (실제 도로 경로 아님) · 지도: 카카오맵</div>
    </div>`));
  setTimeout(() => renderRouteMap(route, 'route-map'), 0);

  // ── 타임라인 ──
  const card = el(`
    <div class="card">
      <h2 class="card-title">
        <span>🧭 가는 길</span>
        <span class="tag tag-logic">일반 로직</span>
      </h2>
      <div class="timeline" id="timeline"></div>
    </div>`);

  const tl = card.querySelector('#timeline');
  route.legs.forEach((leg) => {
    tl.appendChild(el(`
      <div class="leg leg-${esc(leg.kind)}">
        <div class="leg-icon">${leg.icon}</div>
        <div class="leg-body">
          <div class="leg-title">${esc(leg.title)}</div>
          <div class="leg-detail">${esc(leg.detail)}</div>
        </div>
        <div class="leg-time">${leg.minutes}분</div>
      </div>`));
  });
  box.appendChild(card);

  // ── AI 지연 설명 자리 ──
  box.appendChild(el(`
    <div class="card" id="delay-card">
      <h2 class="card-title">
        <span>⏱️ 지연 안내</span>
        <span class="tag tag-ai">AI</span>
      </h2>
      <div id="delay-body">
        <div class="notice notice-info">
          <span class="notice-icon"><span class="spinner spinner-dark"></span></span>
          <div>지연 상황을 분석하고 있습니다...</div>
        </div>
      </div>
      <p class="muted" style="margin:10px 0 0">
        지연 여부와 분 단위 숫자는 앱이 계산하고, AI는 그 결과를 사람이 읽기 쉽게 <b>설명만</b> 합니다.
        근거가 없으면 이유를 지어내지 않도록 막아두었습니다.
      </p>
    </div>`));

  // ── DRT 호출 ──
  box.appendChild(renderDrtSection(route));
}

async function fillDelayExplanation(route) {
  const { text, mode } = await explainDelay(route);
  const body = $('delay-body');
  if (!body) return;

  const cls = route.delay.isDelayed ? 'notice-warn' : 'notice-ok';
  const icon = route.delay.isDelayed ? '⏱️' : '✅';

  body.innerHTML = '';
  body.appendChild(el(`
    <div class="notice ${cls}">
      <span class="notice-icon">${icon}</span>
      <div>${esc(text)}</div>
    </div>`));

  if (mode === 'fallback') {
    body.appendChild(el(`
      <div class="notice notice-info" style="margin-top:8px">
        <span class="notice-icon">ℹ️</span>
        <div>지금은 <b>오프라인 안내</b>로 표시하고 있습니다. AI 서버에 연결되면 더 자연스러운 설명이 나옵니다.</div>
      </div>`));
  }
  refreshBadges();
}

// ─────────────────────────────────────────────────────────────
// 지도 (카카오맵 JavaScript API)
// ★ 일반 로직입니다. 좌표를 직선으로 잇기만 할 뿐, AI가 관여하지 않습니다.
// index.html에서 autoload=false로 SDK를 받아오므로, 실제 지도 객체를 쓰기
// 전에 kakao.maps.load()로 한 번 초기화를 마쳐야 합니다(최초 1회만).
// ─────────────────────────────────────────────────────────────

const mapInstances = {};
let kakaoMapsReady = null;

/**
 * 성공한 결과만 캐싱합니다. 실패를 캐싱하면 처음 한 번 타이밍이 꼬여
 * 로딩에 실패했을 때 이후 모든 지도(일반모드·데모 공용)가 재시도 없이
 * 영원히 "불러오지 못했습니다"로 고정되는 문제가 있었습니다.
 */
function waitForKakaoMaps() {
  if (kakaoMapsReady) return kakaoMapsReady;

  const attempt = new Promise((resolve, reject) => {
    if (typeof kakao === 'undefined' || !kakao.maps) {
      reject(new Error('kakao maps SDK 로딩 실패'));
      return;
    }
    try {
      kakao.maps.load(resolve);
    } catch (err) {
      reject(err);
    }
  });

  kakaoMapsReady = attempt;
  attempt.catch(() => {
    if (kakaoMapsReady === attempt) kakaoMapsReady = null; // 다음 호출이 다시 시도할 수 있게
  });
  return attempt;
}

async function renderRouteMap(route, containerId) {
  const box = $(containerId);
  if (!box) return;

  delete mapInstances[containerId];

  // SDK 로딩 실패(오프라인, 도메인 미등록 등)에도 나머지 화면은 그대로 동작해야 합니다.
  try {
    await waitForKakaoMaps();
  } catch (_) {
    box.innerHTML = '';
    box.appendChild(el(`
      <div class="map-fallback">
        <div>
          지도를 불러오지 못했습니다.<br>네트워크 연결을 확인해주세요.<br>
          <button class="btn btn-ghost btn-sm" style="margin-top:10px" id="map-retry-${containerId}">다시 시도</button>
        </div>
      </div>`));
    document.getElementById(`map-retry-${containerId}`)?.addEventListener('click', () => renderRouteMap(route, containerId));
    return;
  }

  // await 동안 사용자가 다른 경로를 다시 조회했을 수 있으니, 지금 그릴 대상이
  // 맞는지 한 번 더 확인합니다.
  if (state.route !== route) return;

  box.innerHTML = '';

  const rawPoints = [
    { lat: route.origin.lat, lng: route.origin.lng, cls: 'origin', icon: '🧍', label: '현재 위치' },
    { lat: route.spot.lat, lng: route.spot.lng, cls: 'spot', icon: '🐋', label: esc(route.spot.name) },
    { lat: route.hub.lat, lng: route.hub.lng, cls: 'hub', icon: '🔄', label: esc(route.hub.name) },
    { lat: route.destination.lat, lng: route.destination.lng, cls: 'dest', icon: '🎯', label: esc(route.destination.name) },
  ];

  // 좌표가 문자열이거나 잘못된 값이면 지도 전체가 깨지지 않도록 그 지점만 건너뜁니다.
  const validPoints = [];
  rawPoints.forEach((p) => {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn(`[renderRouteMap] 잘못된 좌표라 건너뜀: ${p.cls}`, p);
      return;
    }
    validPoints.push({ ...p, lat, lng });
  });

  // 두 지점이 사실상 같은 좌표(마을을 직접 고른 경우의 현재위치=스팟,
  // 스팟과 환승거점이 같은 마을인 경우 등)면 핀이 서로 겹쳐 찍히므로
  // 좌표가 가까운 지점끼리는 핀 하나로 합쳐서 보여줍니다.
  const points = [];
  validPoints.forEach((p) => {
    const same = points.find((q) => Math.abs(q.lat - p.lat) < 0.0005 && Math.abs(q.lng - p.lng) < 0.0005);
    if (same) {
      same.label += ` · ${p.label}`;
    } else {
      points.push({ ...p });
    }
  });

  const map = new kakao.maps.Map(box, {
    center: new kakao.maps.LatLng(route.spot.lat, route.spot.lng),
    level: 7,
  });
  mapInstances[containerId] = map;

  const bounds = new kakao.maps.LatLngBounds();
  const debugPins = new URLSearchParams(location.search).get('debugpins') === '1';

  // Polyline과 핀은 반드시 동일한 points 배열(같은 lat/lng)을 사용합니다.
  points.forEach((p) => {
    const pos = new kakao.maps.LatLng(p.lat, p.lng);
    bounds.extend(pos);

    // 이름표를 띄우지 않고, 동선 위에 고정된 아이콘 핀만 찍습니다.
    // (지점이 가까우면 이름표끼리 부딪히는 문제가 있었고, 이름은 위
    //  요약 카드에 이미 순서대로 적혀 있어서 지도는 위치·순서만 보여주면 됩니다)
    // 핀은 원(circle) + 삼각형(tail)을 세로로 쌓은 비-회전 구조라,
    // yAnchor:1이 가리키는 '콘텐츠 맨 아래'가 곧 삼각형의 뾰족한 끝 = 좌표입니다.
    const content = el(`
      <div class="route-pin ${p.cls}">
        <div class="route-pin-circle"><span>${p.icon}</span></div>
        <div class="route-pin-tail ${p.cls}"></div>
      </div>`);

    new kakao.maps.CustomOverlay({
      position: pos,
      content,
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: p.cls === 'dest' ? 3 : 2,
    }).setMap(map);

    // ?debugpins=1 로 접속하면 실제 좌표에 작은 점을 찍어 핀 끝과 맞는지 눈으로 확인할 수 있습니다.
    if (debugPins) {
      new kakao.maps.Circle({
        center: pos, radius: 2,
        strokeWeight: 1, strokeColor: '#ff0000', strokeOpacity: 1,
        fillColor: '#ff0000', fillOpacity: 1,
      }).setMap(map);
    }
  });

  new kakao.maps.Polyline({
    path: points.map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
    strokeWeight: 3,
    strokeColor: '#0e8f8f',
    strokeOpacity: .8,
    strokeStyle: 'shortdash',
  }).setMap(map);

  // 카드가 막 DOM에 나타난 직후라 컨테이너 크기가 아직 0일 수 있어,
  // 레이아웃이 실제로 자리 잡은 다음 프레임에 딱 한 번만 맞춥니다.
  // (예전엔 즉시 한 번 + 80ms 뒤 또 한 번, 총 두 번 맞췄는데
  //  그 사이에 사용자가 확대·축소하면 두 번째 보정이 그걸 덮어써서
  //  "확대할 때마다 핀이 움직인다"처럼 보였습니다)
  requestAnimationFrame(() => {
    map.relayout();
    map.setBounds(bounds, 64, 64, 64, 64);
  });
}

// ─────────────────────────────────────────────────────────────
// DRT 호출
// ─────────────────────────────────────────────────────────────

const drtCall = new DrtCall(() => renderDrtPanel());

function renderDrtSection(route) {
  const card = el(`
    <div class="card">
      <h2 class="card-title">
        <span>🐋 마실고래버스 호출</span>
        <span class="tag tag-logic">일반 로직</span>
      </h2>
      <div id="drt-body"></div>
    </div>`);

  setTimeout(renderDrtPanel, 0);
  return card;
}

function renderDrtPanel() {
  const body = $('drt-body');
  if (!body || !state.route) return;

  const route = state.route;
  const c = drtCall;

  // 호출 전
  if (c.state === DRT_STATES.IDLE) {
    body.innerHTML = '';
    body.appendChild(el(`
      <div>
        <p class="muted" style="margin:0 0 12px">
          <b>${esc(route.spot.name)}</b>에서 <b>${esc(route.hub.name)}</b>까지 마실고래버스를 부릅니다.
        </p>
        <div class="btn-row" id="call-mode-row">
          <button class="btn btn-teal" id="call-mode-now" type="button">🐋 지금 바로</button>
          <button class="btn btn-ghost" id="call-mode-later" type="button">📅 예약 호출</button>
        </div>
        <div class="field hidden" id="call-time-field">
          <label class="label" for="sel-call-time">몇 시에 타실 건가요?</label>
          <select class="select" id="sel-call-time"></select>
        </div>
        <button class="btn btn-primary" id="btn-call" style="margin-top:10px">🐋 마실고래버스 부르기</button>
        <div class="notice notice-info" style="margin-top:10px">
          <span class="notice-icon">ℹ️</span>
          <div>
            마실고래버스 호출 API는 외부에 공개되어 있지 않아, 실제 운영 흐름
            (호출 → 배차 → 도착 → 탑승)을 그대로 재현합니다.
            실제 서비스에서는 이 버튼이 운영사 배차 시스템으로 연결됩니다.
          </div>
        </div>
      </div>`));

    // ── 지금 호출 / 예약 호출 전환 ──
    // 지금부터 10분 단위로, 90분 뒤까지 예약 슬롯을 만듭니다.
    const slotBase = new Date();
    slotBase.setSeconds(0, 0);
    slotBase.setMinutes(Math.ceil(slotBase.getMinutes() / 10) * 10);

    const timeSelect = $('sel-call-time');
    for (let i = 1; i <= 9; i++) {
      const t = new Date(slotBase.getTime() + i * 10 * 60000);
      timeSelect.appendChild(el(`<option value="${i}">${formatTime(t)}</option>`));
    }

    let isScheduled = false;
    const nowBtn = $('call-mode-now');
    const laterBtn = $('call-mode-later');
    const timeField = $('call-time-field');

    function setCallMode(scheduled) {
      isScheduled = scheduled;
      nowBtn.className = `btn ${scheduled ? 'btn-ghost' : 'btn-teal'}`;
      laterBtn.className = `btn ${scheduled ? 'btn-teal' : 'btn-ghost'}`;
      timeField.classList.toggle('hidden', !scheduled);
    }
    nowBtn.addEventListener('click', () => setCallMode(false));
    laterBtn.addEventListener('click', () => setCallMode(true));

    $('btn-call').addEventListener('click', () => {
      const leg = route.legs.find((l) => l.kind === 'drt');
      const scheduledAt = isScheduled
        ? new Date(slotBase.getTime() + Number(timeSelect.value) * 10 * 60000)
        : null;
      c.requestCall(route.spot, route.destination, leg?.dispatchMin || 8, scheduledAt);
      if (state.mode === 'easy') speak('마실고래버스를 부르고 있습니다. 잠시만 기다려 주세요.');
    });
    return;
  }

  // 호출 후
  const label = DRT_STATE_LABEL[c.state];
  const panel = el(`<div class="drt-panel"></div>`);

  panel.appendChild(el(`
    <div class="drt-state">
      ${c.isActive ? '<span class="pulse"></span>' : '<span>✅</span>'}
      <span>${esc(label)}</span>
    </div>`));

  if (c.state === DRT_STATES.SCHEDULED) {
    panel.appendChild(el(`
      <div class="notice notice-info" style="margin-top:10px">
        <span class="notice-icon">📅</span>
        <div><b>${formatTime(c.scheduledAt)}</b>에 마실고래버스가 배차됩니다. ${esc(c.spot.name)}에서 그 시각에 맞춰 나와주세요.</div>
      </div>`));
  }

  if (c.state === DRT_STATES.REQUESTING) {
    panel.appendChild(el(`
      <p class="muted" style="margin:10px 0 0">
        <span class="spinner spinner-dark"></span> 근처 차량을 찾고 있습니다...
      </p>`));
  }

  if (c.state === DRT_STATES.ARRIVING) {
    panel.appendChild(el(`
      <div class="eta">${c.etaMin}<small>분 뒤 도착</small></div>
      <p class="muted" style="margin:0">
        ${esc(c.spot.name)}에서 기다려주세요.
      </p>`));
  }

  if (c.state === DRT_STATES.MATCHED) {
    panel.appendChild(el(`
      <div class="eta">${c.etaMin}<small>분 뒤 도착</small></div>`));
  }

  if (c.state === DRT_STATES.ARRIVED) {
    panel.appendChild(el(`
      <div class="notice notice-ok" style="margin-top:12px">
        <span class="notice-icon">🐋</span>
        <div><b>차량이 도착했습니다.</b> ${esc(c.spot.name)}에서 탑승해주세요.</div>
      </div>`));
  }

  if (c.state === DRT_STATES.ONBOARD) {
    panel.appendChild(el(`
      <div class="notice notice-ok" style="margin-top:12px">
        <span class="notice-icon">✅</span>
        <div>탑승하셨습니다. <b>${esc(state.route.hub.name)}</b>에서 내려
        <b>${esc(state.route.legs.find((l) => l.kind === 'transfer')?.busRoute || '')}번</b> 버스로 갈아타세요.</div>
      </div>`));
  }

  // 차량 정보
  if (c.vehicle && c.state !== DRT_STATES.DONE) {
    panel.appendChild(el(`
      <dl class="vehicle">
        <dt>차량</dt><dd>${esc(c.vehicle.plate)}</dd>
        <dt>차종</dt><dd>${esc(c.vehicle.model)}</dd>
        <dt>기사님</dt><dd>${esc(c.vehicle.driver)}</dd>
        <dt>호출번호</dt><dd>${esc(c.callId)}</dd>
      </dl>`));
  }

  // 버튼
  const row = el(`<div class="btn-row"></div>`);
  if (c.state === DRT_STATES.ARRIVED) {
    const b = el(`<button class="btn btn-teal">탑승했습니다</button>`);
    b.addEventListener('click', () => {
      c.board();
      if (state.mode === 'easy') speak('탑승 확인되었습니다. 편안히 가세요.');
    });
    row.appendChild(b);
  }
  if (c.state === DRT_STATES.ONBOARD) {
    const b = el(`<button class="btn btn-ghost">하차 완료</button>`);
    b.addEventListener('click', () => c.finish());
    row.appendChild(b);
  }
  if (c.isActive && c.state !== DRT_STATES.ONBOARD) {
    const b = el(`<button class="btn btn-danger">호출 취소</button>`);
    b.addEventListener('click', () => c.cancel());
    row.appendChild(b);
  }
  if (c.state === DRT_STATES.DONE) {
    const b = el(`<button class="btn btn-ghost">다시 호출하기</button>`);
    b.addEventListener('click', () => c.cancel());
    row.appendChild(b);
  }
  if (row.children.length) panel.appendChild(row);

  body.innerHTML = '';
  body.appendChild(panel);

  // 도착 시 음성 알림 (쉬운모드에서 특히 중요)
  if (c.state === DRT_STATES.ARRIVED && state.mode === 'easy') {
    speak(`마실고래버스가 도착했습니다. ${c.spot.name}에서 타세요.`);
  }
}

// ─────────────────────────────────────────────────────────────
// 쉬운모드 — 대화
// ─────────────────────────────────────────────────────────────

function addMessage(role, html, opts = {}) {
  const chat = $('chat');
  const isUser = role === 'user';

  const node = el(`
    <div class="msg msg-${isUser ? 'user' : 'bot'}">
      <div class="msg-avatar">${isUser ? '👤' : '🐋'}</div>
      <div class="bubble">${html}</div>
    </div>`);

  chat.appendChild(node);
  node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return node;
}

function showTyping() {
  return addMessage('bot', '<span class="typing"><i></i><i></i><i></i></span>');
}

function greetEasyMode() {
  const msg = '안녕하세요, 이음입니다. 어디로 가고 싶으신가요?';
  addMessage('bot', esc(msg));
  renderQuickButtons();
}

function renderQuickButtons() {
  const chat = $('chat');
  const old = chat.querySelector('.quick');
  if (old) old.remove();

  const quick = el(`<div class="quick"></div>`);
  ['병원', '시장', '기차역', '군청'].forEach((word) => {
    const b = el(`<button>${word}</button>`);
    b.addEventListener('click', () => sendMessage(`${word} 가고 싶어요`));
    quick.appendChild(b);
  });
  chat.appendChild(quick);
  quick.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function sendMessage(text) {
  if (!text || state.busy) return;
  state.busy = true;

  const quick = $('chat').querySelector('.quick');
  if (quick) quick.remove();

  addMessage('user', esc(text));
  state.chatHistory.push({ role: 'user', content: text });

  const typing = showTyping();

  // 위치가 없으면 조용히 확보 시도 (사용자에게 부담 주지 않기)
  if (!state.position) {
    try { state.position = await getCurrentPosition({ timeout: 6000 }); }
    catch (_) { state.position = { ...FALLBACK_POSITION }; }
    refreshBadges();
  }

  const near = nearest(dataState.spots, state.position.lat, state.position.lng, 1)[0];

  const result = await easyChat(text, state.chatHistory, {
    hasLocation: true,
    nearestSpotName: near.name,
  });

  typing.remove();
  addMessage('bot', esc(result.reply));
  state.chatHistory.push({ role: 'assistant', content: result.reply });
  speak(result.reply);

  if (result.ready && result.destination) {
    state.destination = result.destination;
    state.chosenSpot = near;
    state.route = buildRoute(state.position, result.destination, near);
    renderEasyRoute(state.route);
    goEasyStep(1); // 스크롤 대신 결과 화면으로 전환
  } else {
    renderQuickButtons();
  }

  state.busy = false;
  refreshBadges();
}

/** 쉬운모드용 경로 카드 — 일반모드보다 훨씬 단순하게, 큰 글씨로 */
function renderEasyRoute(route) {
  const box = $('easy-result');
  box.innerHTML = '';

  const card = el(`
    <div class="card">
      <h2 class="card-title"><span>🧭 ${esc(route.destination.name)} 가는 길</span></h2>
      <div class="summary" style="margin-top:0">
        <div class="summary-row">
          <span class="summary-total">${route.totalMin}</span>
          <span class="summary-unit">분이면 도착합니다</span>
        </div>
        <div class="summary-sub">${formatTime(route.arrivalAt)}쯤 도착 예정</div>
      </div>
      <div class="timeline" id="easy-timeline"></div>
      <div id="easy-drt"></div>
    </div>`);

  const tl = card.querySelector('#easy-timeline');
  // 쉬운모드에서는 단계를 3개로 줄여서 보여줍니다 (인지 부담 감소)
  const simple = [
    route.legs[0],
    route.legs[1],
    route.legs[route.legs.length - 1],
  ];
  simple.forEach((leg) => {
    tl.appendChild(el(`
      <div class="leg leg-${esc(leg.kind)}">
        <div class="leg-icon">${leg.icon}</div>
        <div class="leg-body">
          <div class="leg-title">${esc(leg.title)}</div>
          <div class="leg-detail">${esc(leg.detail)}</div>
        </div>
      </div>`));
  });

  const callBtn = el(`<button class="btn btn-teal" style="margin-top:8px">🐋 마실고래버스 부르기</button>`);
  callBtn.addEventListener('click', () => {
    const leg = route.legs.find((l) => l.kind === 'drt');
    drtCall.requestCall(route.spot, route.destination, leg?.dispatchMin || 8);
    speak('마실고래버스를 부르고 있습니다. 잠시만 기다려 주세요.');
    renderEasyDrt();
  });
  card.querySelector('#easy-drt').appendChild(callBtn);

  box.appendChild(card);

  const spoken = `${route.destination.name}까지 약 ${route.totalMin}분 걸립니다. ` +
                 `${route.spot.name}까지 걸어가신 뒤 마실고래버스를 타세요.`;
  speak(spoken);
}

/** 쉬운모드에서 DRT 패널을 easy-drt 영역에 그리기 위한 브리지 */
function renderEasyDrt() {
  const host = $('easy-drt');
  if (!host) return;
  host.innerHTML = '<div id="drt-body"></div>';
  renderDrtPanel();
}

function handleSendText() {
  const input = $('text-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendMessage(text);
}

function resetChat() {
  state.chatHistory = [];
  state.route = null;
  state.destination = null;
  drtCall.cancel();
  $('chat').innerHTML = '';
  $('easy-result').innerHTML = '';
  stopSpeaking();
  greetEasyMode();
  goEasyStep(0);
}

function toggleTts() {
  tts.enabled = !tts.enabled;
  const btn = $('btn-tts');
  btn.setAttribute('aria-pressed', String(tts.enabled));
  btn.textContent = tts.enabled ? '🔊 읽어주기 켜짐' : '🔇 읽어주기 꺼짐';
  if (!tts.enabled) stopSpeaking();
}

// ─────────────────────────────────────────────────────────────
// 쉬운모드 — 마이크
// ─────────────────────────────────────────────────────────────

const recorder = new VoiceRecorder({
  onStart: (mode) => {
    $('btn-mic').classList.add('recording');
    $('mic-hint').textContent = mode === 'whisper'
      ? '듣고 있습니다... 다 말씀하시면 다시 누르세요'
      : '듣고 있습니다... 말씀해주세요';
  },
  onStop: () => {
    $('btn-mic').classList.remove('recording');
    $('mic-hint').textContent = '버튼을 누르고 말씀해주세요';
  },
  onError: (err) => {
    $('mic-hint').textContent = err.message;
  },
});

async function handleMic() {
  primeTts();

  if (recorder.recording) {
    $('mic-hint').innerHTML = '<span class="spinner spinner-dark"></span> 알아듣는 중...';
    recorder.stop();
    return;
  }

  if (!sttAvailable()) {
    $('mic-hint').textContent = '이 기기에서는 음성 입력을 쓸 수 없습니다. 아래에 입력해주세요.';
    return;
  }

  try {
    const text = await recorder.start();
    if (text) {
      sendMessage(text);
    } else {
      $('mic-hint').textContent = '잘 못 들었습니다. 다시 한 번 말씀해주세요.';
    }
  } catch (err) {
    $('mic-hint').textContent = err.message;
  }
}

// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
