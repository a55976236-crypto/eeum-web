/**
 * POST /api/delay — 지연 원인 설명 생성
 *
 * ★ AI가 쓰이는 지점 ①
 *
 * 중요: AI에게 숫자를 계산시키지 않습니다.
 * 지연 여부와 몇 분 늦는지는 앱(route.js)이 이미 계산해서 넘겨주고,
 * AI는 그 결과를 사람이 읽기 쉬운 문장으로 바꾸기만 합니다.
 * 근거(known_cause)가 없으면 이유를 지어내지 못하도록 프롬프트에서 막았습니다.
 */

import { json, askOpenAI } from './_shared.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'POST만 허용' }, 405);

  try {
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
      system,
      `다음 데이터를 근거로 설명해주세요:\n${JSON.stringify(evidence, null, 2)}`,
      0.3
    );

    return json({ explanation: parsed.explanation || '' });
  } catch (err) {
    // 실패해도 앱은 자동으로 오프라인 안내로 넘어가므로 화면은 멈추지 않습니다.
    return json({ error: String(err.message || err) }, 500);
  }
}
