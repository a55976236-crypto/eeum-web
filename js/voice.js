/**
 * 이음(EEUM) — 음성 입출력
 *
 * ── 왜 이렇게 만들었는지 (중요) ──
 * 브라우저 내장 음성인식(Web Speech API)은 안드로이드 크롬에서는 잘 되지만
 * iOS 사파리에서는 지원이 불안정합니다. 심사위원이 아이폰을 쓸 수 있으므로,
 * 기본 경로를 '녹음 → Whisper 전송'으로 잡았습니다. (MediaRecorder는 iOS에서도 동작)
 *
 * 우선순위:
 *   1) Whisper (프록시 있음)  → iOS/안드로이드 모두 동작. 정확도 높음.
 *   2) Web Speech API        → 프록시가 없을 때. 안드로이드에서 동작.
 *   3) 둘 다 불가            → 마이크 버튼을 숨기고 키보드 입력만 안내.
 *
 * 읽어주기(TTS)는 SpeechSynthesis가 iOS 포함 대부분에서 잘 동작합니다.
 * 고령자 대상 서비스라 읽어주기는 사실상 필수 기능입니다.
 */

// ─────────────────────────────────────────────────────────────
// 읽어주기 (TTS)
// ─────────────────────────────────────────────────────────────

const tts = {
  enabled: true,
  primed: false,
  voice: null,
};

/**
 * iOS는 '사용자가 화면을 터치한 흐름' 안에서만 음성 재생을 허용합니다.
 * 첫 터치 때 빈 소리를 한 번 재생해 잠금을 풀어둡니다.
 */
function primeTts() {
  if (tts.primed || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    speechSynthesis.speak(u);
    tts.primed = true;
  } catch (_) { /* 무시 */ }
}

function pickKoreanVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'ko-KR') ||
    voices.find((v) => v.lang && v.lang.startsWith('ko')) ||
    null
  );
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { tts.voice = pickKoreanVoice(); };
  tts.voice = pickKoreanVoice();
}

/** 문장을 소리내어 읽습니다. */
function speak(text) {
  if (!tts.enabled || !text || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel(); // 이전 문장이 남아있으면 끊고 새로 읽기
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 0.95; // 고령자 대상이라 조금 천천히
    u.pitch = 1.0;
    if (tts.voice) u.voice = tts.voice;
    speechSynthesis.speak(u);
  } catch (_) { /* 무시 */ }
}

function stopSpeaking() {
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch (_) { /* 무시 */ }
  }
}

// ─────────────────────────────────────────────────────────────
// 음성 인식 (STT)
// ─────────────────────────────────────────────────────────────

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

/** 이 기기/설정에서 음성 입력이 가능한가? */
function sttAvailable() {
  const canRecord = Boolean(navigator.mediaDevices && window.MediaRecorder && window.isSecureContext);
  return (aiAvailable() && canRecord) || Boolean(SpeechRecognitionAPI);
}

/** 어떤 방식이 쓰이는지 (화면 안내용) */
function sttMode() {
  if (aiAvailable() && navigator.mediaDevices && window.MediaRecorder && window.isSecureContext) return 'whisper';
  if (SpeechRecognitionAPI) return 'browser';
  return 'none';
}

/**
 * 녹음기. start() 후 stop()을 부르면 인식된 텍스트를 돌려줍니다.
 *
 * @param {object} handlers { onStart, onStop, onError, onLevel }
 */
class VoiceRecorder {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.recording = false;
    this._recorder = null;
    this._chunks = [];
    this._stream = null;
    this._recognition = null;
    this._resolve = null;
    this._autoStopTimer = null;
  }

  /** 녹음 시작. 인식 결과 텍스트로 resolve되는 Promise를 반환합니다. */
  start() {
    if (this.recording) return Promise.resolve('');
    const mode = sttMode();

    if (mode === 'whisper') return this._startWhisper();
    if (mode === 'browser') return this._startBrowser();

    const err = new Error('이 기기에서는 음성 입력을 사용할 수 없습니다. 아래 버튼이나 키보드로 입력해주세요.');
    if (this.handlers.onError) this.handlers.onError(err);
    return Promise.reject(err);
  }

  stop() {
    if (!this.recording) return;
    clearTimeout(this._autoStopTimer);

    if (this._recorder && this._recorder.state !== 'inactive') {
      this._recorder.stop();
    }
    if (this._recognition) {
      try { this._recognition.stop(); } catch (_) { /* 무시 */ }
    }
  }

  _cleanup() {
    this.recording = false;
    clearTimeout(this._autoStopTimer);
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    if (this.handlers.onStop) this.handlers.onStop();
  }

  // ── 방식 1: 녹음 후 Whisper로 전송 ──────────────────
  async _startWhisper() {
    return new Promise(async (resolve, reject) => {
      try {
        stopSpeaking(); // 읽어주는 중이면 멈추고 (마이크에 들어가면 안 되므로)

        this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._chunks = [];

        // 브라우저마다 지원 포맷이 달라 순서대로 시도합니다.
        const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
        const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';

        this._recorder = new MediaRecorder(this._stream, mimeType ? { mimeType } : undefined);

        this._recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) this._chunks.push(e.data);
        };

        this._recorder.onerror = (e) => {
          this._cleanup();
          reject(new Error('녹음 중 오류가 발생했습니다.'));
        };

        this._recorder.onstop = async () => {
          this._cleanup();
          try {
            const blob = new Blob(this._chunks, { type: this._recorder.mimeType || 'audio/webm' });
            if (blob.size < 1000) { // 너무 짧으면 무음으로 간주
              resolve('');
              return;
            }
            const text = await this._transcribe(blob);
            resolve(text);
          } catch (err) {
            reject(err);
          }
        };

        this._recorder.start();
        this.recording = true;
        if (this.handlers.onStart) this.handlers.onStart('whisper');

        // 너무 길게 녹음되면 자동 종료
        this._autoStopTimer = setTimeout(() => this.stop(), CONFIG.MAX_RECORD_MS);
      } catch (err) {
        this._cleanup();
        const msg = err && err.name === 'NotAllowedError'
          ? '마이크 권한이 거부되었습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용해주세요.'
          : '마이크를 사용할 수 없습니다.';
        const e = new Error(msg);
        if (this.handlers.onError) this.handlers.onError(e);
        reject(e);
      }
    });
  }

  /** 녹음된 오디오를 프록시(→Whisper)로 보내 텍스트로 변환 */
  async _transcribe(blob) {
    const form = new FormData();
    const ext = (blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm');
    form.append('file', blob, `voice.${ext}`);

    const res = await fetchWithTimeout(`${CONFIG.PROXY_URL}/stt`, { method: 'POST', body: form }, 20000);
    if (!res.ok) throw new Error('음성을 알아듣지 못했습니다. 다시 말씀해주세요.');

    const data = await res.json();
    return (data.text || '').trim();
  }

  // ── 방식 2: 브라우저 내장 음성인식 ──────────────────
  _startBrowser() {
    return new Promise((resolve, reject) => {
      stopSpeaking();

      const rec = new SpeechRecognitionAPI();
      this._recognition = rec;
      rec.lang = 'ko-KR';
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      let done = false;

      rec.onresult = (e) => {
        done = true;
        const text = e.results[0][0].transcript || '';
        this._cleanup();
        resolve(text.trim());
      };

      rec.onerror = (e) => {
        done = true;
        this._cleanup();
        const msg = e.error === 'not-allowed'
          ? '마이크 권한이 거부되었습니다.'
          : '음성을 알아듣지 못했습니다. 다시 시도해주세요.';
        const err = new Error(msg);
        if (this.handlers.onError) this.handlers.onError(err);
        reject(err);
      };

      rec.onend = () => {
        if (!done) { this._cleanup(); resolve(''); }
      };

      try {
        rec.start();
        this.recording = true;
        if (this.handlers.onStart) this.handlers.onStart('browser');
        this._autoStopTimer = setTimeout(() => this.stop(), CONFIG.MAX_RECORD_MS);
      } catch (err) {
        this._cleanup();
        reject(new Error('음성 인식을 시작할 수 없습니다.'));
      }
    });
  }
}
