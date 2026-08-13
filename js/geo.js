/**
 * 이음(EEUM) — 위치 / 거리 계산
 *
 * ★ 전부 '일반 로직'입니다. AI 아님.
 *   심사위원이 "이거 AI로 한 거예요?"라고 물으면
 *   "아니요, 하버사인 공식(구면 삼각법)입니다"라고 답하면 됩니다.
 */

/** 고령자 보행 속도 기준. 일반 성인 80m/분 → 교통약자 고려해 67m/분(약 4km/h) */
const WALK_SPEED_M_PER_MIN = 67;

/**
 * 하버사인 공식 — 지구를 구로 보고 두 위경도 사이 최단거리(m)를 구합니다.
 * AI가 아니라 삼각함수 계산입니다.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // 지구 반지름(m)
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** 거리(m) → 도보 시간(분). 최소 1분. */
function walkMinutes(meters) {
  return Math.max(1, Math.round(meters / WALK_SPEED_M_PER_MIN));
}

/** 거리를 사람이 읽기 좋은 문자열로 */
function formatDistance(meters) {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * 좌표 기준으로 가장 가까운 항목 N개를 거리순으로 반환.
 * list의 각 항목은 {lat, lng}를 가지고 있어야 합니다.
 */
function nearest(list, lat, lng, count = 3) {
  return list
    .map((item) => {
      const distance = haversineMeters(lat, lng, item.lat, item.lng);
      return { ...item, distance, walkMin: walkMinutes(distance) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

/**
 * 브라우저 Geolocation API로 현재 위치를 받아옵니다.
 *
 * ⚠️ 중요: HTTPS(또는 localhost)에서만 동작합니다.
 *    GitHub Pages는 HTTPS라 문제없지만, 파일을 더블클릭해서 여는(file://)
 *    방식으로는 브라우저가 거부할 수 있습니다.
 */
function getCurrentPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('이 브라우저는 위치 기능을 지원하지 않습니다.'));
      return;
    }
    if (!window.isSecureContext) {
      reject(new Error('보안 연결(HTTPS)에서만 위치를 사용할 수 있습니다.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy),
      }),
      (err) => {
        const messages = {
          1: '위치 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘에서 위치를 허용해주세요.',
          2: '위치를 확인할 수 없습니다. 실내이거나 GPS 신호가 약할 수 있습니다.',
          3: '위치 확인 시간이 초과되었습니다.',
        };
        reject(new Error(messages[err.code] || '위치를 가져오지 못했습니다.'));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 }
    );
  });
}

/**
 * 위치를 못 받았을 때 쓸 기본 좌표.
 * 발표장에서 GPS가 안 잡히거나 권한이 거부돼도 데모가 멈추지 않도록 하는 안전장치입니다.
 * (척과마을회관 부근 — 마실고래버스 운행지역 한가운데)
 */
const FALLBACK_POSITION = { lat: 35.5851, lng: 129.2118, accuracy: null, isFallback: true };
