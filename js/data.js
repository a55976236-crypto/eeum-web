/**
 * 이음(EEUM) — 데이터 계층
 *
 * ★ 이 파일은 전부 '일반 로직'입니다. AI 아님.
 *
 * 데이터 이중화 설계:
 *   1) SEED_* : 앱에 번들된 정적 데이터. 네트워크가 죽어도 100% 동작합니다.
 *   2) 울산 BIS API : 인증키가 열리면 Worker 프록시를 통해 실시간 데이터를 덮어씁니다.
 *
 * 발표장 와이파이를 믿을 수 없으므로 항상 (1)이 먼저 뜨고,
 * (2)가 성공하면 조용히 갱신되는 방식입니다.
 *
 * ※ 좌표 정확도 안내
 *   마실고래버스(DRT) 스팟의 공식 좌표 목록은 공개 API로 제공되지 않아,
 *   아래 스팟 좌표는 울주군 각 마을 중심부 기준 '근사값'입니다.
 *   실제 서비스에서는 울주군 DRT 운영 데이터로 교체되어야 합니다.
 *   화면에도 '추정 좌표' 배지로 표시합니다.
 */

/** DRT(마실고래버스) 승하차 스팟 — 울주군 */
const SEED_SPOTS = [
  // 범서읍
  { id: 'BS01', name: '척과마을회관',   area: '범서읍', lat: 35.5851, lng: 129.2118 },
  { id: 'BS02', name: '구영리 정류장',   area: '범서읍', lat: 35.5661, lng: 129.2352 },
  { id: 'BS03', name: '서사리 마을회관', area: '범서읍', lat: 35.6015, lng: 129.2270 },
  { id: 'BS04', name: '굴화 정류장',     area: '범서읍', lat: 35.5462, lng: 129.2607 },
  // 언양읍
  { id: 'EY01', name: '언양터미널',      area: '언양읍', lat: 35.5665, lng: 129.1257 },
  { id: 'EY02', name: '남부리 경로당',   area: '언양읍', lat: 35.5628, lng: 129.1224 },
  { id: 'EY03', name: '반천 정류장',     area: '언양읍', lat: 35.5836, lng: 129.1785 },
  // 삼남읍
  { id: 'SN01', name: '교동리 마을회관', area: '삼남읍', lat: 35.5502, lng: 129.1160 },
  { id: 'SN02', name: '신화리 정류장',   area: '삼남읍', lat: 35.5352, lng: 129.1049 },
  { id: 'SN03', name: '울산역 앞',       area: '삼남읍', lat: 35.5513, lng: 129.1360 },
  // 상북면
  { id: 'SB01', name: '궁근정리 회관',   area: '상북면', lat: 35.5960, lng: 129.0840 },
  { id: 'SB02', name: '산전리 정류장',   area: '상북면', lat: 35.6079, lng: 129.1088 },
  { id: 'SB03', name: '등억온천단지',    area: '상북면', lat: 35.5850, lng: 129.0605 },
  // 두동면
  { id: 'DD01', name: '봉계리 시장',     area: '두동면', lat: 35.6802, lng: 129.1612 },
  { id: 'DD02', name: '이전리 마을회관', area: '두동면', lat: 35.6620, lng: 129.1795 },
  // 두서면
  { id: 'DS01', name: '구량리 경로당',   area: '두서면', lat: 35.6570, lng: 129.1300 },
  { id: 'DS02', name: '인보리 정류장',   area: '두서면', lat: 35.6435, lng: 129.1447 },
  // 삼동면
  { id: 'SD01', name: '하잠리 마을회관', area: '삼동면', lat: 35.4895, lng: 129.1710 },
  { id: 'SD02', name: '조일리 정류장',   area: '삼동면', lat: 35.4760, lng: 129.1520 },
  // 웅촌면
  { id: 'UC01', name: '곡천리 경로당',   area: '웅촌면', lat: 35.4540, lng: 129.2210 },
  { id: 'UC02', name: '대복리 마을회관', area: '웅촌면', lat: 35.4660, lng: 129.2360 },
  // 청량읍
  { id: 'CR01', name: '율리 정류장',     area: '청량읍', lat: 35.4990, lng: 129.2830 },
  { id: 'CR02', name: '덕하시장',        area: '청량읍', lat: 35.4850, lng: 129.2960 },
  // 온양읍
  { id: 'OY01', name: '남창시장',        area: '온양읍', lat: 35.4352, lng: 129.2970 },
  { id: 'OY02', name: '발리 마을회관',   area: '온양읍', lat: 35.4470, lng: 129.2810 },
  // 온산읍
  { id: 'OS01', name: '덕신 정류장',     area: '온산읍', lat: 35.4280, lng: 129.3340 },
  { id: 'OS02', name: '이진리 경로당',   area: '온산읍', lat: 35.4130, lng: 129.3560 },
  // 서생면
  { id: 'SS01', name: '진하해수욕장',    area: '서생면', lat: 35.3940, lng: 129.3340 },
  { id: 'SS02', name: '신암리 마을회관', area: '서생면', lat: 35.3760, lng: 129.3450 },
];

/**
 * 환승 거점 — DRT에서 내려 시내버스/기차로 갈아타는 지점.
 * routes: 이 거점에서 탈 수 있는 주요 노선 (시연용 대표 노선)
 */
const SEED_HUBS = [
  { id: 'H1', name: '언양터미널',   lat: 35.5665, lng: 129.1257, routes: ['807', '1713', '337'] },
  { id: 'H2', name: '울산역(KTX)',  lat: 35.5513, lng: 129.1360, routes: ['5001', '337', '807'] },
  { id: 'H3', name: '구영리',       lat: 35.5661, lng: 129.2352, routes: ['327', '807', '1127'] },
  { id: 'H4', name: '덕하역',       lat: 35.4850, lng: 129.2960, routes: ['715', '405', '525'] },
  { id: 'H5', name: '남창역',       lat: 35.4352, lng: 129.2970, routes: ['715', '405'] },
  { id: 'H6', name: '공업탑로터리', lat: 35.5372, lng: 129.3170, routes: ['401', '507', '133'] },
];

/** 자주 가는 목적지 프리셋 (쉬운모드에서 '병원', '시장' 같은 말로도 매칭) */
const SEED_DESTINATIONS = [
  { id: 'D1', name: '울산대학교병원', kind: '병원', lat: 35.5163, lng: 129.4162, keywords: ['병원', '대학병원', '울산대병원', '진료', '의사'] },
  { id: 'D2', name: '울주군보건소',   kind: '병원', lat: 35.5222, lng: 129.2422, keywords: ['보건소', '주사', '예방접종'] },
  { id: 'D3', name: '울산역(KTX)',    kind: '역',   lat: 35.5513, lng: 129.1360, keywords: ['기차', 'ktx', '울산역', '서울'] },
  { id: 'D4', name: '태화강역',       lat: 35.5525, lng: 129.3550, kind: '역',   keywords: ['태화강', '전철', '동해선'] },
  { id: 'D5', name: '언양시장',       kind: '시장', lat: 35.5672, lng: 129.1235, keywords: ['언양시장', '장', '장보기'] },
  { id: 'D6', name: '남창시장',       kind: '시장', lat: 35.4352, lng: 129.2970, keywords: ['남창', '남창시장'] },
  { id: 'D7', name: '울주군청',       kind: '관공서', lat: 35.5222, lng: 129.2422, keywords: ['군청', '행정', '서류', '민원'] },
  { id: 'D8', name: '울산대학교',     kind: '학교', lat: 35.5537, lng: 129.2597, keywords: ['울산대', '대학교', '학교'] },
  { id: 'D9', name: '공업탑',         kind: '중심가', lat: 35.5372, lng: 129.3170, keywords: ['공업탑', '시내', '번화가'] },
  { id: 'D10', name: '구영운동장',    kind: '체육시설', lat: 35.5668, lng: 129.2308, keywords: ['구영운동장', '운동장', '체육관', '축구장', '경기장'] },
];

/**
 * 실시간 데이터 상태.
 * live.enabled 가 true 가 되면 화면 상단 배지가 '실시간'으로 바뀝니다.
 */
const dataState = {
  spots: SEED_SPOTS.slice(),
  hubs: SEED_HUBS.slice(),
  destinations: SEED_DESTINATIONS.slice(),
  live: { enabled: false, stopCount: 0, checkedAt: null, error: null },
};

/**
 * 번들된 실데이터 파일(data/stops.json)이 있으면 읽어서 환승 거점을 보강합니다.
 * 이 파일은 tools/fetch-stops.ps1 로 BIS API에서 미리 받아 생성합니다.
 * 없으면 조용히 시드 데이터로 계속 동작합니다.
 */
async function loadBundledStops() {
  try {
    const res = await fetch('data/stops.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const json = await res.json();
    if (!Array.isArray(json.stops) || json.stops.length === 0) return false;

    dataState.bundledStops = json.stops;
    dataState.live.stopCount = json.stops.length;
    dataState.live.generatedAt = json.generatedAt || null;
    return true;
  } catch (_) {
    return false; // 파일 없음 = 정상. 시드로 진행.
  }
}

/** 목적지 이름/키워드로 찾기 (쉬운모드의 자연어 매칭에 사용) */
function findDestination(text) {
  if (!text) return null;
  const q = String(text).toLowerCase().replace(/\s+/g, '');

  // 1) 이름 정확/부분 일치
  for (const d of dataState.destinations) {
    if (q.includes(d.name.toLowerCase().replace(/\s+/g, ''))) return d;
  }
  // 2) 키워드 일치
  for (const d of dataState.destinations) {
    for (const k of d.keywords) {
      if (q.includes(k.toLowerCase())) return d;
    }
  }
  return null;
}

/** 스팟 이름으로 찾기 */
function findSpotByName(text) {
  if (!text) return null;
  const q = String(text).toLowerCase().replace(/\s+/g, '');
  for (const s of dataState.spots) {
    const n = s.name.toLowerCase().replace(/\s+/g, '');
    if (q.includes(n) || n.includes(q)) return s;
  }
  // 지역명으로도 매칭 (예: "척과" -> 척과마을회관)
  for (const s of dataState.spots) {
    const base = s.name.replace(/(마을회관|정류장|경로당|시장|앞)$/, '');
    if (base && q.includes(base.toLowerCase())) return s;
  }
  return null;
}
