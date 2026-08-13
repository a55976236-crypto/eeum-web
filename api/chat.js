/**
 * POST /api/chat — 쉬운모드 대화
 *
 * ★ AI가 쓰이는 지점 ②
 *
 * 고령자는 "출발지/도착지 입력" 같은 정형 입력 자체가 장벽입니다.
 * 그래서 "지금 병원 가고 싶어요" 같은 자유로운 말을 알아듣고,
 * 부족한 정보는 하나씩 되물어서 채우는 역할을 AI가 맡습니다.
 *
 * 안전장치: AI가 고른 목적지는 프론트(ai.js)에서 우리 데이터와 대조합니다.
 * 없는 장소를 지어내면 그 단계에서 걸러집니다.
 */

import { json, askOpenAI } from './_shared.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'POST만 허용' }, 405);

  try {
    const { message, history = [], context = {} } = await request.json();

    const system = [
      "당신은 고령자·교통약자를 위한 대중교통 안내 챗봇 '이음 쉬운모드'입니다.",
      '아주 짧고 친절한 존댓말로 대화하세요. 한 번에 한 가지만 물어보세요.',
      '어려운 낱말(환승, 경유, 배차 등)은 쉬운 말로 풀어서 쓰세요.',
      '',
      '목표: 사용자가 어디로 가고 싶은지 알아내는 것입니다.',
      `선택 가능한 목적지: ${(context.available_destinations || []).join(', ')}`,
      'destination에는 위 목록에 있는 이름을 정확히 그대로 쓰세요.',
      '목록에 없는 장소를 지어내지 마세요. 애매하면 null로 두고 되물으세요.',
      '',
      context.has_location
        ? `사용자 위치는 이미 확인되었고 가장 가까운 승차 지점은 '${context.nearest_spot}'입니다. 출발지는 다시 묻지 마세요.`
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
      system,
      `${historyText}사용자가 방금 말한 것: "${message}"`,
      0.5
    );

    return json({
      reply: parsed.reply || '',
      destination: parsed.destination || null,
      ready: Boolean(parsed.ready),
    });
  } catch (err) {
    return json({ error: String(err.message || err) }, 500);
  }
}
