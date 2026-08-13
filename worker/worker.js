/**
 * 이음(EEUM) — Cloudflare Worker 프록시
 *
 * 이 파일 전체를 복사해서 Cloudflare Workers 대시보드의 편집기에 붙여넣으세요.
 * (CLI도, Node.js 설치도 필요 없습니다. 배포 방법은 README.md 참고)
 *
 * ── 이 프록시가 해결하는 문제 4가지 ──
 *
 *  1. API 키 은닉
 *     정적 웹페이지에 OpenAI 키를 넣으면 누구나 소스보기로 훔쳐갑니다.
 *     키는 여기 Worker의 환경변수(Secret)에만 저장되고 브라우저로 내려가지 않습니다.
 *
 *  2. Mixed Content 차단 우회
 *     울산 BIS API는 http:// 만 지원합니다(SSL 없음).
 *     HTTPS 페이지에서 HTTP를 부르면 브라우저가 막습니다.
 *     Worker(HTTPS)가 대신 HTTP로 불러서 결과만 돌려줍니다.
 *
 *  3. CORS
 *     공공 API는 보통 CORS 헤더를 안 줘서 브라우저가 응답을 못 읽습니다.
 *     여기서 헤더를 붙여줍니다.
 *
 *  4. XML → JSON 변환
 *     BIS API는 XML만 반환합니다. 프론트에서 쓰기 편하게 JSON으로 바꿔줍니다.
 *
 * ── 필요한 환경변수 (대시보드 > Settings > Variables) ──
 *   OPENAI_API_KEY   : 해커톤에서 받은 OpenAI 키   (반드시 'Encrypt' 체크)
 *   BIS_SERVICE_KEY  : data.go.kr 인증키 (Decoding 값) (반드시 'Encrypt' 체크)
 *   ALLOWED_ORIGIN   : (선택) 배포한 GitHub Pages 주소. 없으면 * 허용.
 */

const OPENAI_MODEL = 'gpt-4o-mini';
const BIS_BASE = 'http://openapi.its.ulsan.kr/UlsanAPI';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    // 브라우저가 본 요청 전에 보내는 사전 확인 요청
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      switch (url.pathname) {
        case '/':
        case '/health':
          return json({
            ok: true,
            service: 'eeum-proxy',
            openai: Boolean(env.OPENAI_API_KEY),
            bis: Boolean(env.BIS_SERVICE_KEY),
          }, 200, cors);

        case '/delay':   return await handleDelay(request, env, cors);
        case '/chat':    return await handleChat(request, env, cors);
        case '/stt':     return await handleStt(request, env, cors);
        case '/bis/stops':   return await handleBisStops(request, env, cors);
        case '/bis/arrival': return await handleBisArrival(url, env, cors);

        default:
          return json({ error: 'not found' }, 404, cors);
      }
    } catch (err) {
      // 프론트는 실패 시 자동으로 시나리오 모드로 넘어가므로,
      // 여기서 에러가 나도 앱 자체는 멈추지 않습니다.
      return json({ error: String(err && err.message || err) }, 500, cors);
    }
  },
};

// ─────────────────────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────────────────────

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*'
    ? env.ALLOWED_ORIGIN
    : origin;

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

/** OpenAI Chat Completions 호출 (JSON 강제 모드) */
async function askOpenAI(env, systemPrompt, userPrompt, temperature = 0.3) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 미설정');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ─────────────────────────────────────────────────────────────
// ① 지연 원인 설명
// ─────────────────────────────────────────────────────────────

async function handleDelay(request, env, cors) {
  const evidence = await request.json();

  const system = [
    "당신은 대중교통 안내 서비스 '이음'의 지연 안내 도우미입니다.",
    '주어진 JSON 데이터만 근거로, 한국어 한두 문장으로 짧고 쉽게 설명하세요.',
    '고령자도 이해할 수 있게 쉬운 낱말을 쓰고, 존댓말로 씁니다.',
    '데이터에 없는 이유는 절대 지어내지 마세요.',
    "known_cause가 null이면 '정확한 원인은 확인되지 않았습니다'라고 솔직히 쓰세요.",
    '숫자는 주어진 값만 그대로 쓰고 새로 계산하지 마세요.',
    '반드시 {"explanation": "..."} 형식의 JSON으로만 답하세요.',
  ].join(' ');

  const parsed = await askOpenAI(
    env,
    system,
    `다음 데이터를 근거로 설명해주세요:\n${JSON.stringify(evidence, null, 2)}`,
    0.3
  );

  return json({ explanation: parsed.explanation || '' }, 200, cors);
}

// ─────────────────────────────────────────────────────────────
// ② 쉬운모드 대화
// ─────────────────────────────────────────────────────────────

async function handleChat(request, env, cors) {
  const { message, history = [], context = {} } = await request.json();

  const system = [
    "당신은 고령자·교통약자를 위한 대중교통 안내 챗봇 '이음 쉬운모드'입니다.",
    '아주 짧고 친절한 존댓말로 대화하세요. 한 번에 한 가지만 물어보세요.',
    '어려운 낱말(환승, 경유, 배차 등)은 쉬운 말로 풀어서 쓰세요.',
    '',
    '목표: 사용자가 어디로 가고 싶은지 알아내는 것입니다.',
    `선택 가능한 목적지: ${(context.available_destinations || []).join(', ')}`,
    '사용자 말에서 목적지를 알아냈다면 destination에 위 목록 중 하나를 정확히 그대로 쓰세요.',
    '목록에 없는 장소를 지어내지 마세요. 애매하면 destination은 null로 두고 되물으세요.',
    '',
    context.has_location
      ? `사용자의 현재 위치는 이미 확인되었고, 가장 가까운 승차 지점은 '${context.nearest_spot}'입니다. 출발지는 다시 묻지 마세요.`
      : '사용자의 위치를 아직 모릅니다. 위치 확인이 필요하면 안내하세요.',
    '',
    '구체적인 시간·요금은 지어내지 마세요. 그건 앱 화면이 계산해서 보여줍니다.',
    '',
    'JSON 형식으로만 답하세요:',
    '{"reply": "사용자에게 할 말", "destination": "목적지 이름 또는 null", "ready": true/false}',
    'ready는 목적지가 확정되어 경로를 보여줘도 될 때만 true입니다.',
  ].join('\n');

  const historyText = history.length
    ? `지금까지 대화:\n${history.map((h) => `${h.role === 'user' ? '사용자' : '이음'}: ${h.content}`).join('\n')}\n\n`
    : '';

  const parsed = await askOpenAI(
    env,
    system,
    `${historyText}사용자가 방금 말한 것: "${message}"`,
    0.5
  );

  return json({
    reply: parsed.reply || '',
    destination: parsed.destination || null,
    ready: Boolean(parsed.ready),
  }, 200, cors);
}

// ─────────────────────────────────────────────────────────────
// ③ 음성 → 텍스트 (Whisper)
// ─────────────────────────────────────────────────────────────

async function handleStt(request, env, cors) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 미설정');

  const inForm = await request.formData();
  const file = inForm.get('file');
  if (!file) return json({ error: 'file 없음' }, 400, cors);

  const outForm = new FormData();
  outForm.append('file', file, 'voice.webm');
  outForm.append('model', 'whisper-1');
  outForm.append('language', 'ko');
  // 이 힌트를 주면 지역 고유명사 인식률이 눈에 띄게 올라갑니다.
  outForm.append('prompt', '울산, 울주군, 마실고래버스, 언양, 범서, 척과마을회관, 남창, 덕하, 진하, 봉계, 태화강역, 울산대학교병원');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: outForm,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Whisper ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  return json({ text: data.text || '' }, 200, cors);
}

// ─────────────────────────────────────────────────────────────
// ④ 울산 BIS 프록시 (HTTP → HTTPS, XML → JSON)
// ─────────────────────────────────────────────────────────────

/**
 * BIS API의 XML 응답에서 <row> 항목들을 뽑아 객체 배열로 바꿉니다.
 * Cloudflare Workers에는 DOMParser가 없어서 직접 파싱합니다.
 * BIS 응답 구조가 <list><row><태그>값</태그>...</row></list> 로 고정이라
 * 이 정도로 충분합니다.
 */
function parseBisXml(xml) {
  const result = { rows: [], resultCode: null, resultMsg: null, totalCnt: null };

  const pick = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : null;
  };

  result.resultCode = pick('resultCode');
  result.resultMsg = pick('resultMsg');
  result.totalCnt = pick('totalCnt');

  // 게이트웨이 에러 응답 (<Response><error>...)
  const errMsg = xml.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/);
  if (/NOT REGISTERED|INVALID|ERROR/i.test(errMsg ? errMsg[1] : '')) {
    result.error = errMsg[1].trim();
  }

  const rowRe = /<row>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml)) !== null) {
    const row = {};
    const fieldRe = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let f;
    while ((f = fieldRe.exec(m[1])) !== null) {
      row[f[1]] = f[2].trim();
    }
    result.rows.push(row);
  }

  return result;
}

async function callBis(env, operation, params) {
  if (!env.BIS_SERVICE_KEY) throw new Error('BIS_SERVICE_KEY 미설정');

  const qs = new URLSearchParams({ ...params, serviceKey: env.BIS_SERVICE_KEY });
  const res = await fetch(`${BIS_BASE}/${operation}.xo?${qs}`, {
    // 공공 API 서버가 느릴 수 있어 Cloudflare 캐시를 활용합니다.
    cf: { cacheTtl: 30, cacheEverything: true },
  });

  const xml = await res.text();
  return parseBisXml(xml);
}

/** 정류장 목록 — 좌표 포함. 앱 빌드 시 한 번만 받아 번들해두는 용도. */
async function handleBisStops(request, env, cors) {
  const url = new URL(request.url);
  const pageNo = url.searchParams.get('pageNo') || '1';
  const numOfRows = url.searchParams.get('numOfRows') || '1000';

  const parsed = await callBis(env, 'BusStopInfo', { pageNo, numOfRows });

  if (parsed.error) return json({ error: parsed.error, rows: [] }, 502, cors);

  const stops = parsed.rows.map((r) => ({
    id: r.STOPID,
    name: r.STOPNAME,
    lat: parseFloat(r.STOPY),
    lng: parseFloat(r.STOPX),
    remark: r.STOPREMARK === '-' ? null : r.STOPREMARK,
  })).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));

  return json({ totalCnt: parsed.totalCnt, count: stops.length, stops }, 200, cors);
}

/** 실시간 버스 도착정보 — 특정 정류장에 몇 초 뒤 어떤 버스가 오는지 */
async function handleBisArrival(url, env, cors) {
  const stopid = url.searchParams.get('stopid');
  if (!stopid) return json({ error: 'stopid 필요' }, 400, cors);

  // 문서상 오퍼레이션명은 AllBusArrivalInfo인데 예제 URL은 getBusArrivalInfo입니다.
  // 어느 쪽이 맞는지 확실치 않아 순서대로 시도합니다.
  let parsed = await callBis(env, 'getBusArrivalInfo', { stopid, pageNo: '1', numOfRows: '10' });
  if (parsed.error || parsed.rows.length === 0) {
    const alt = await callBis(env, 'AllBusArrivalInfo', { stopid, pageNo: '1', numOfRows: '10' });
    if (!alt.error && alt.rows.length > 0) parsed = alt;
  }

  if (parsed.error) return json({ error: parsed.error, arrivals: [] }, 502, cors);

  const arrivals = parsed.rows.map((r) => ({
    route: r.ROUTENM,
    seconds: parseInt(r.ARRIVALTIME, 10),
    minutes: Math.max(1, Math.round(parseInt(r.ARRIVALTIME, 10) / 60)),
    stopsLeft: parseInt(r.PREVSTOPCNT, 10),
    currentStop: r.PRESENTSTOPNM,
    stopName: r.STOPNM,
  })).filter((a) => Number.isFinite(a.seconds));

  arrivals.sort((a, b) => a.seconds - b.seconds);

  return json({ stopid, count: arrivals.length, arrivals }, 200, cors);
}
