/**
 * 이음(EEUM) — AI 계층
 *
 * ★★ 이 파일이 '진짜 AI'가 쓰이는 유일한 곳입니다. ★★
 *
 * 나머지 파일(data/geo/route/drt)은 전부 규칙 기반 일반 로직이고,
 * AI는 딱 두 가지만 담당합니다:
 *   ① 지연 원인을 사람 말로 설명하기
 *   ② 쉬운모드에서 자유로운 말을 알아듣고 필요한 정보를 되묻기
 *
 * 숫자 계산은 절대 AI에게 시키지 않습니다. 계산은 route.js가 하고,
 * AI는 그 결과를 '설명'만 합니다. (숫자를 지어내는 사고 방지)
 *
 * ── 발표 안전장치 ──
 * 모든 AI 호출은 타임아웃이 걸려 있고, 실패하면 즉시 규칙 기반 응답으로 넘어갑니다.
 * 발표장 와이파이가 끊겨도 화면은 절대 멈추지 않습니다.
 */

/** AI가 지금 실제로 응답하고 있는지 (화면 배지 표시용) */
const aiState = { lastMode: null }; // 'ai' | 'fallback'

/** 타임아웃이 걸린 fetch */
async function fetchWithTimeout(url, options = {}, ms = CONFIG.AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// ① 지연 원인 설명
// ─────────────────────────────────────────────────────────────

/**
 * 지연 상황을 사람이 읽기 쉬운 한두 문장으로 설명합니다.
 *
 * @param {object} route buildRoute()가 만든 경로 객체
 * @returns {Promise<{text:string, mode:'ai'|'fallback'}>}
 */
async function explainDelay(route) {
  const { delay, hub, spot } = route;

  // AI에게 넘길 '근거'. 근거 없이 이유를 물으면 AI가 지어내므로 반드시 함께 넘깁니다.
  const evidence = {
    spot_name: spot.name,
    hub_name: hub.name,
    scheduled_minutes: delay.scheduled,
    actual_minutes: delay.actual,
    is_delayed: delay.isDelayed,
    delay_minutes: delay.delayMinutes,
    known_cause: delay.cause || null,
    time_of_day: `${route.createdAt.getHours()}시`,
  };

  if (!aiAvailable()) return { text: fallbackDelayText(delay, hub), mode: 'fallback' };

  try {
    const res = await fetchWithTimeout(`${CONFIG.PROXY_URL}/delay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidence),
    });
    if (!res.ok) throw new Error(`proxy ${res.status}`);

    const data = await res.json();
    if (!data.explanation) throw new Error('empty');

    aiState.lastMode = 'ai';
    return { text: data.explanation, mode: 'ai' };
  } catch (_) {
    aiState.lastMode = 'fallback';
    return { text: fallbackDelayText(delay, hub), mode: 'fallback' };
  }
}

/** AI 없이도 말이 되는 설명 (규칙 기반) */
function fallbackDelayText(delay, hub) {
  if (!delay.isDelayed) {
    return `${hub.name}에서 타실 버스는 현재 정시 운행 중입니다. 예정대로 ${delay.scheduled}분 뒤 도착합니다.`;
  }
  const because = delay.cause ? ` ${delay.cause}` : ' 정확한 원인은 확인되지 않았습니다.';
  return `${hub.name} 방면 버스가 예정보다 ${delay.delayMinutes}분 늦어지고 있습니다.${because}`;
}

// ─────────────────────────────────────────────────────────────
// ② 쉬운모드 대화
// ─────────────────────────────────────────────────────────────

/**
 * 쉬운모드 대화 한 턴을 처리합니다.
 *
 * @param {string} userText  사용자가 말하거나 입력한 문장
 * @param {Array}  history   [{role, content}, ...]
 * @param {object} ctx       { hasLocation:boolean, nearestSpotName:string|null }
 * @returns {Promise<{reply:string, destination:object|null, ready:boolean, mode:'ai'|'fallback'}>}
 */
async function easyChat(userText, history, ctx) {
  if (!aiAvailable()) return { ...fallbackChat(userText, ctx), mode: 'fallback' };

  try {
    const res = await fetchWithTimeout(`${CONFIG.PROXY_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        history: history.slice(-8), // 토큰 절약 — 최근 8턴만
        context: {
          has_location: ctx.hasLocation,
          nearest_spot: ctx.nearestSpotName,
          available_destinations: dataState.destinations.map((d) => d.name),
        },
      }),
    });
    if (!res.ok) throw new Error(`proxy ${res.status}`);

    const data = await res.json();
    if (!data.reply) throw new Error('empty');

    // AI가 고른 목적지 이름을 우리 데이터와 대조합니다.
    // AI가 없는 장소를 지어내도 여기서 걸러집니다.
    const destination = data.destination ? findDestination(data.destination) : null;

    aiState.lastMode = 'ai';
    return {
      reply: data.reply,
      destination,
      ready: Boolean(destination) && Boolean(data.ready),
      mode: 'ai',
    };
  } catch (_) {
    aiState.lastMode = 'fallback';
    return { ...fallbackChat(userText, ctx), mode: 'fallback' };
  }
}

/**
 * AI 없이 동작하는 규칙 기반 대화.
 * 키워드로 목적지를 찾고, 못 찾으면 되묻습니다.
 * 발표 중 네트워크가 끊겨도 쉬운모드가 계속 굴러가게 하는 안전장치입니다.
 */
function fallbackChat(userText, ctx) {
  const destination = findDestination(userText);

  if (destination) {
    const where = ctx.hasLocation
      ? `현재 계신 곳에서 가장 가까운 ${ctx.nearestSpotName}`
      : '가까운 마실고래버스 스팟';
    return {
      reply: `${destination.name}까지 가는 길을 찾았습니다. ${where}에서 마실고래버스를 타시면 됩니다. 아래 경로를 확인해주세요.`,
      destination,
      ready: true,
    };
  }

  // 인사 / 도움 요청
  if (/안녕|여보세요|도와|시작/.test(userText)) {
    return {
      reply: '안녕하세요. 이음입니다. 어디로 가고 싶으신가요? 병원, 시장, 기차역 중에서 말씀해주셔도 됩니다.',
      destination: null,
      ready: false,
    };
  }

  return {
    reply: '어디로 가고 싶으신지 한 번만 더 말씀해주시겠어요? 예를 들어 "병원 가고 싶어요" 또는 "언양시장 갈래요" 처럼 말씀해주시면 됩니다.',
    destination: null,
    ready: false,
  };
}
