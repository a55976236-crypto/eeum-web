/**
 * 이음(EEUM) — 경로 생성
 *
 * ★ 전부 '일반 로직'입니다. AI 아님.
 *   여기서 하는 건 거리 나누기, 시간 더하기, 최솟값 고르기뿐입니다.
 *   AI는 이 결과를 '설명하는' 역할만 맡습니다(ai.js).
 *
 * 이음의 핵심 구조:
 *   [현재위치] --도보--> [DRT 스팟] --마실고래버스--> [환승거점] --시내버스--> [목적지]
 *   기존 앱들이 DRT와 시내버스를 따로 보여줘서 생기는 단절을 하나로 잇는 게 목적입니다.
 */

/** 평균 속도(분당 이동 거리, m). 농촌 지선도로 기준으로 보수적으로 잡았습니다. */
const DRT_SPEED_M_PER_MIN = 500; // 약 30km/h
const BUS_SPEED_M_PER_MIN = 420; // 약 25km/h

/** 도로는 직선이 아니므로 직선거리에 우회계수를 곱합니다. */
const ROAD_DETOUR_FACTOR = 1.35;

function roadMinutes(straightMeters, speedPerMin) {
  return Math.max(1, Math.round((straightMeters * ROAD_DETOUR_FACTOR) / speedPerMin));
}

/**
 * DRT 배차 대기시간(분)을 추정합니다.
 * 수요응답형이라 고정 시간표가 없으므로, 시간대별 수요를 반영한 규칙 기반 추정치입니다.
 * (실제 서비스에서는 운영사 배차 시스템의 실제 값으로 대체되어야 합니다)
 */
function estimateDrtDispatchMinutes(date = new Date()) {
  const h = date.getHours();
  if (h >= 7 && h < 9) return 12;   // 등교·출근 피크
  if (h >= 17 && h < 19) return 11; // 퇴근 피크
  if (h >= 9 && h < 11) return 6;   // 병원·장보기 이동이 많은 시간
  if (h >= 22 || h < 6) return 25;  // 심야 — 배차 자체가 드묾
  return 8;
}

/**
 * 시내버스 지연 상황을 추정합니다.
 * 실시간 BIS 도착정보가 연결되면 이 함수 대신 실제 ARRIVALTIME을 씁니다.
 *
 * @returns {{scheduled:number, actual:number, isDelayed:boolean, delayMinutes:number, cause:string}}
 */
function estimateBusDelay(date = new Date()) {
  const h = date.getHours();
  const scheduled = 5;

  let actual = scheduled;
  let cause = '';

  if (h >= 7 && h < 9) {
    actual = 10;
    cause = '오전 등교·출근 시간대로 도로 정체가 있는 구간입니다.';
  } else if (h >= 17 && h < 19) {
    actual = 9;
    cause = '퇴근 시간대로 차량 통행이 많은 구간입니다.';
  } else if (h >= 11 && h < 13) {
    actual = 7;
    cause = '점심 시간대 통행량이 늘어나는 구간입니다.';
  }

  return {
    scheduled,
    actual,
    isDelayed: actual > scheduled,
    delayMinutes: Math.max(0, actual - scheduled),
    cause, // ← AI에게 넘길 '근거'. 이게 없으면 AI가 이유를 지어내게 됩니다.
  };
}

/**
 * 마실고래버스가 한 번에 갈 수 있는 최대 거리(m).
 *
 * 왜 제한을 두는가:
 *   DRT는 마을 안팎을 도는 '짧은 접근 교통수단'입니다.
 *   단순히 전체 이동거리만 최소화하면, 목적지에 가까운 거점을 골라
 *   DRT가 20km를 달리는 비현실적인 경로가 나옵니다.
 *   실제 마실고래버스는 읍·면 생활권 안에서만 운행하므로 이 값으로 묶습니다.
 */
const MAX_DRT_METERS = 8000;

/**
 * 출발 스팟과 목적지 사이에서 환승 거점을 고릅니다.
 *
 * 규칙 (전부 일반 로직):
 *   1. DRT로 갈 수 있는 거리(MAX_DRT_METERS) 안의 거점만 후보로 봅니다.
 *   2. 그중 '목적지 방향으로 실제로 진전이 있는' 거점만 남깁니다.
 *      (목적지에서 오히려 멀어지는 거점으로 가는 건 역주행이므로 제외)
 *   3. 남은 후보 중 총 이동거리가 가장 짧은 곳을 고릅니다.
 *   4. 조건을 만족하는 곳이 하나도 없으면, 스팟에서 가장 가까운 거점을 씁니다.
 */
function pickTransferHub(spot, destination) {
  const directDistance = haversineMeters(spot.lat, spot.lng, destination.lat, destination.lng);

  const scored = dataState.hubs.map((hub) => {
    const legDrt = haversineMeters(spot.lat, spot.lng, hub.lat, hub.lng);
    const legBus = haversineMeters(hub.lat, hub.lng, destination.lat, destination.lng);
    return { hub, legDrt, legBus, total: legDrt + legBus };
  });

  const eligible = scored.filter((c) =>
    c.legDrt <= MAX_DRT_METERS &&   // DRT가 감당할 거리인가
    c.legBus < directDistance       // 목적지에 실제로 가까워지는가
  );

  if (eligible.length > 0) {
    return eligible.reduce((a, b) => (b.total < a.total ? b : a));
  }

  // 후보가 없으면 (목적지가 아주 가깝거나 외딴 스팟인 경우) 최근접 거점으로
  return scored.reduce((a, b) => (b.legDrt < a.legDrt ? b : a));
}

/**
 * 전체 경로를 만듭니다.
 *
 * @param {{lat:number,lng:number}} origin      현재 위치
 * @param {object} destination                  목적지 (SEED_DESTINATIONS 항목)
 * @param {object} [chosenSpot]                 사용자가 직접 고른 스팟 (없으면 최근접 자동 선택)
 * @returns {object} 화면에 그대로 그릴 수 있는 경로 객체
 */
function buildRoute(origin, destination, chosenSpot = null) {
  const now = new Date();

  // ── 1단계: 도보로 DRT 스팟까지 ──────────────────────
  const candidates = nearest(dataState.spots, origin.lat, origin.lng, 3);
  const spot = chosenSpot
    ? { ...chosenSpot, distance: haversineMeters(origin.lat, origin.lng, chosenSpot.lat, chosenSpot.lng) }
    : candidates[0];
  spot.walkMin = walkMinutes(spot.distance);

  // ── 2단계: DRT로 환승 거점까지 ──────────────────────
  const transfer = pickTransferHub(spot, destination);
  const dispatchMin = estimateDrtDispatchMinutes(now);
  const drtRideMin = roadMinutes(transfer.legDrt, DRT_SPEED_M_PER_MIN);

  // 실제 대기시간 = 배차시간 - 도보시간 (걸어가는 동안 차도 오고 있으므로)
  // 음수면 0 (이미 차가 먼저 도착 → 바로 탑승 가능)
  const actualWaitMin = Math.max(0, dispatchMin - spot.walkMin);

  // ── 3단계: 시내버스로 목적지까지 ────────────────────
  const delay = estimateBusDelay(now);
  const busRideMin = roadMinutes(transfer.legBus, BUS_SPEED_M_PER_MIN);
  const busRoute = transfer.hub.routes[0];

  // ── 4단계: 목적지까지 마지막 도보 ───────────────────
  const finalWalkMin = 3; // 정류장에서 목적지 입구까지 통상 도보

  const firstWalkMin = spot.distance < 150 ? 0 : spot.walkMin;

  const totalMin =
    firstWalkMin + actualWaitMin + drtRideMin + delay.actual + busRideMin + finalWalkMin;

  const arrival = new Date(now.getTime() + totalMin * 60000);

  return {
    createdAt: now,
    origin,
    destination,
    spot,
    spotCandidates: candidates,
    hub: transfer.hub,
    delay,
    totalMin,
    arrivalAt: arrival,
    legs: [
      {
        no: 1,
        kind: 'walk',
        icon: spot.distance < 150 ? '📍' : '🚶',
        // 마을을 직접 고른 경우엔 이미 스팟 위에 서 있는 셈이라 '도보 0m'가 어색합니다.
        title: spot.distance < 150
          ? `${spot.name}에서 출발`
          : `${spot.name}까지 걸어가기`,
        detail: spot.distance < 150
          ? '이곳이 승차 지점입니다'
          : `${formatDistance(spot.distance)} · 약 ${spot.walkMin}분`,
        minutes: spot.distance < 150 ? 0 : spot.walkMin,
        logic: '일반',
      },
      {
        no: 2,
        kind: 'drt',
        icon: '🐋',
        title: '마실고래버스 탑승',
        detail: `배차 약 ${dispatchMin}분 → 도착까지 걸어가면 실제 대기 ${actualWaitMin}분 · 승차 ${drtRideMin}분`,
        minutes: actualWaitMin + drtRideMin,
        logic: '일반',
        waitMin: actualWaitMin,
        dispatchMin,
        rideMin: drtRideMin,
      },
      {
        no: 3,
        kind: 'transfer',
        icon: '🔄',
        title: `${transfer.hub.name}에서 환승`,
        detail: `${busRoute}번 버스 · ${delay.isDelayed ? `${delay.actual}분 뒤 도착 (${delay.delayMinutes}분 지연)` : `${delay.actual}분 뒤 도착 (정시)`}`,
        minutes: delay.actual,
        logic: '일반',
        busRoute,
      },
      {
        no: 4,
        kind: 'bus',
        icon: '🚌',
        title: `${busRoute}번 버스 승차`,
        detail: `${formatDistance(transfer.legBus)} · 약 ${busRideMin}분`,
        minutes: busRideMin,
        logic: '일반',
      },
      {
        no: 5,
        kind: 'arrive',
        icon: '📍',
        title: `${destination.name} 도착`,
        detail: `하차 후 도보 약 ${finalWalkMin}분`,
        minutes: finalWalkMin,
        logic: '일반',
      },
    ],
  };
}

/** 시각을 'HH:MM' 로 */
function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
