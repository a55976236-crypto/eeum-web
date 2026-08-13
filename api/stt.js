/**
 * POST /api/stt — 음성을 텍스트로 (Whisper)
 *
 * 왜 브라우저 내장 음성인식을 안 쓰고 이걸 쓰나:
 *   Web Speech API는 안드로이드 크롬에서만 안정적이고 iOS 사파리에서는 불안정합니다.
 *   심사위원이 아이폰을 쓸 수 있으므로, 녹음(MediaRecorder는 iOS도 지원) 후
 *   서버로 보내 Whisper로 변환하는 방식을 기본으로 잡았습니다.
 */

import { json } from './_shared.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'POST만 허용' }, 405);

  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY 미설정');

    const inForm = await request.formData();
    const file = inForm.get('file');
    if (!file) return json({ error: 'file 없음' }, 400);

    const outForm = new FormData();
    outForm.append('file', file, 'voice.webm');
    outForm.append('model', 'whisper-1');
    outForm.append('language', 'ko');
    // 지역 고유명사를 힌트로 주면 인식률이 눈에 띄게 올라갑니다.
    outForm.append(
      'prompt',
      '울산, 울주군, 마실고래버스, 언양, 범서, 척과마을회관, 남창, 덕하, 진하, 봉계, 태화강역, 울산대학교병원, 울주군청'
    );

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: outForm,
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Whisper ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = await res.json();
    return json({ text: data.text || '' });
  } catch (err) {
    return json({ error: String(err.message || err) }, 500);
  }
}
