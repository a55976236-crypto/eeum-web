/**
 * 이음(EEUM) — 서버 함수 공용 코드
 *
 * 파일 이름이 _ 로 시작하면 Vercel이 이걸 API 주소로 만들지 않습니다.
 * (즉 /api/_shared 로는 접근할 수 없고, 다른 함수들이 가져다 쓰기만 합니다)
 *
 * 이 코드는 브라우저가 아니라 Vercel 서버에서 실행됩니다.
 * 그래서 API 키가 사용자에게 절대 노출되지 않습니다.
 */

export const OPENAI_MODEL = 'gpt-4o-mini';
export const BIS_BASE = 'http://openapi.its.ulsan.kr/UlsanAPI';

/** JSON 응답 만들기 */
export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * OpenAI 호출 (JSON 강제 모드).
 * 응답을 반드시 JSON 형태로 받게 해서 화면에 바로 연결할 수 있게 합니다.
 */
export async function askOpenAI(systemPrompt, userPrompt, temperature = 0.3) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY 미설정');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
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

/**
 * 울산 BIS API의 XML 응답을 객체 배열로 바꿉니다.
 *
 * 서버 환경에는 DOMParser가 없어서 직접 파싱합니다.
 * BIS 응답이 <list><row><태그>값</태그>...</row></list> 로 고정 구조라
 * 이 정도로 충분합니다.
 */
export function parseBisXml(xml) {
  const result = { rows: [], resultCode: null, resultMsg: null, totalCnt: null, error: null };

  const pick = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : null;
  };

  result.resultCode = pick('resultCode');
  result.resultMsg = pick('resultMsg');
  result.totalCnt = pick('totalCnt');

  // 인증키 오류 등 게이트웨이 에러 감지
  if (result.resultMsg && /NOT REGISTERED|INVALID|ERROR/i.test(result.resultMsg)) {
    result.error = result.resultMsg;
  }

  const rowRe = /<row>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml)) !== null) {
    const row = {};
    const fieldRe = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let f;
    while ((f = fieldRe.exec(m[1])) !== null) row[f[1]] = f[2].trim();
    result.rows.push(row);
  }

  return result;
}

/**
 * BIS API 호출.
 *
 * 여기가 중요한 지점입니다 — BIS는 http:// 만 지원해서
 * 브라우저에서 직접 부르면 HTTPS 페이지에서 차단됩니다.
 * 서버(여기)에서 부르면 그 제약이 없습니다.
 */
export async function callBis(operation, params) {
  const key = process.env.BIS_SERVICE_KEY;
  if (!key) throw new Error('BIS_SERVICE_KEY 미설정');

  const qs = new URLSearchParams({ ...params, serviceKey: key });
  const res = await fetch(`${BIS_BASE}/${operation}.xo?${qs}`);
  const xml = await res.text();
  return parseBisXml(xml);
}
