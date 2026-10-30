/**
 * BCS Grok realtime voice (xAI Speech-to-Speech, server VAD).
 * Loads via ChatWidget Hablar — no API keys in this file.
 */
(function (global) {
  'use strict';

  var SAMPLE_RATE = 24000;
  var TOKEN_URL = '/api/voice-token';
  var CHAT_URL = '/api/chat';

  function langHint() {
    var lang = document.documentElement.getAttribute('data-lang') || 'es';
    return lang === 'en' ? 'en-US' : 'es-MX';
  }

  function uiLang() {
    return (document.documentElement.getAttribute('data-lang') || 'es') === 'en' ? 'en' : 'es';
  }

  function buildInstructions() {
    var lang = uiLang();
    return [
      'You are the BCS 2050 territorial intelligence assistant for the Baja California Sur 2050 portal.',
      'Answer from portal knowledge about Baja California Sur (not Baja California Norte).',
      'Never mention internal tools, vendors, offices or platform names.',
      'Speak in ' + (lang === 'en' ? 'English' : 'Spanish (Mexico)') + ' matching the user; switch if they switch.',
      'Keep answers concise and natural for voice — short paragraphs, no markdown lists unless asked.',
      'Never repeat or paraphrase the user question. Never say you will look something up or search — call portal_ask silently when needed, then answer directly.',
      'When you need catalog documents, water/tourism/growth facts, foresights, ontology, or stakeholders, call the tool portal_ask with a clear question (do not narrate the tool call).',
      'Do not invent figures; prefer tool results. If estimating, say it is an estimate and name the data-gap briefly.',
    ].join(' ');
  }

  function float32ToBase64PCM16(float32Array) {
    var pcm16 = new Int16Array(float32Array.length);
    for (var i = 0; i < float32Array.length; i++) {
      var s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    var bytes = new Uint8Array(pcm16.buffer);
    var chunk = 0x8000;
    var binary = '';
    for (var offset = 0; offset < bytes.length; offset += chunk) {
      var slice = bytes.subarray(offset, offset + chunk);
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  function base64PCM16ToFloat32(base64String) {
    var binaryString = atob(base64String);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    var pcm16 = new Int16Array(bytes.buffer);
    var float32 = new Float32Array(pcm16.length);
    for (var j = 0; j < pcm16.length; j++) float32[j] = pcm16[j] / 32768.0;
    return float32;
  }

  function BcsGrokVoice(opts) {
    this.onState = opts && opts.onState;
    this.onTranscript = opts && opts.onTranscript;
    this.onError = opts && opts.onError;
    this.ws = null;
    this.audioCtx = null;
    this.mediaStream = null;
    this.processor = null;
    this.source = null;
    this.playing = false;
    this.playQueue = [];
    this.nextPlayTime = 0;
    this.active = false;
    this.pendingToolCalls = 0;
    this.playbackDrainResolvers = [];
  }

  BcsGrokVoice.prototype._emit = function (state) {
    if (typeof this.onState === 'function') this.onState(state);
  };

  BcsGrokVoice.prototype._err = function (msg, detail) {
    if (typeof this.onError === 'function') this.onError(msg, detail);
  };

  BcsGrokVoice.prototype._transcript = function (role, text) {
    if (!text) return;
    if (typeof this.onTranscript === 'function') this.onTranscript(role, text);
  };

  BcsGrokVoice.prototype._waitPlayback = function () {
    var self = this;
    if (!self.playing && self.playQueue.length === 0) return Promise.resolve();
    return new Promise(function (resolve) {
      self.playbackDrainResolvers.push(resolve);
    });
  };

  BcsGrokVoice.prototype._maybeDrain = function () {
    if (this.playing || this.playQueue.length) return;
    var resolvers = this.playbackDrainResolvers.splice(0);
    resolvers.forEach(function (r) { try { r(); } catch (e) {} });
  };

  BcsGrokVoice.prototype._enqueueAudio = function (float32) {
    var self = this;
    if (!self.audioCtx || !float32 || !float32.length) return;
    if (self.audioCtx.state === 'suspended') {
      try { self.audioCtx.resume(); } catch (e) {}
    }
    var buf = self.audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
    buf.copyToChannel(float32, 0);
    var src = self.audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(self.audioCtx.destination);
    var now = self.audioCtx.currentTime;
    var startAt = Math.max(now + 0.02, self.nextPlayTime || now);
    src.start(startAt);
    self.nextPlayTime = startAt + buf.duration;
    self.playing = true;
    self._emit('speaking');
    src.onended = function () {
      if (self.audioCtx && self.nextPlayTime <= self.audioCtx.currentTime + 0.05) {
        self.playing = false;
        if (self.active) self._emit('listening');
        self._maybeDrain();
      }
    };
  };

  BcsGrokVoice.prototype._sessionUpdate = function () {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          voice: 'eve',
          instructions: buildInstructions(),
          turn_detection: {
            type: 'server_vad',
            silence_duration_ms: 1000,
            threshold: 0.5,
            prefix_padding_ms: 300,
          },
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: SAMPLE_RATE },
              transcription: { language_hint: langHint() },
            },
            output: {
              format: { type: 'audio/pcm', rate: SAMPLE_RATE },
            },
          },
          tools: [
            {
              type: 'function',
              name: 'portal_ask',
              description:
                'Ask the BCS 2050 portal RAG chat for catalog, guides, ontology, foresights, growth, stakeholders, and territorial facts.',
              parameters: {
                type: 'object',
                properties: {
                  question: {
                    type: 'string',
                    description: 'Natural-language question for the portal knowledge base',
                  },
                },
                required: ['question'],
              },
            },
          ],
        },
      })
    );
  };

  BcsGrokVoice.prototype._handleTool = async function (event) {
    var self = this;
    var name = event.name;
    var callId = event.call_id;
    var args = {};
    try {
      args = JSON.parse(event.arguments || '{}');
    } catch (e) {
      args = {};
    }
    var output = { error: 'unknown tool' };
    if (name === 'portal_ask') {
      self._emit('processing');
      try {
        var q = String(args.question || '').trim();
        var r = await fetch(CHAT_URL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: q,
            lang: uiLang(),
            history: [],
            place:
              (global.BCSPlace && global.BCSPlace.get && global.BCSPlace.get()) || null,
            voice: true,
            session: (function () {
              try {
                var k = 'bcs_chat_sid';
                var sid = sessionStorage.getItem(k);
                if (sid && sid.length >= 8) return sid;
                sid = (crypto.randomUUID && crypto.randomUUID()) ||
                  ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
                sessionStorage.setItem(k, sid);
                return sid;
              } catch (e) { return null; }
            })(),
          }),
        });
        var j = await r.json().catch(function () { return {}; });
        if (!r.ok) {
          output = {
            error: 'portal_ask_http_' + r.status,
            message:
              (j && (j.error || j.answer)) ||
              (uiLang() === 'en'
                ? 'Portal chat error (' + r.status + '). Try again.'
                : 'Error del chat del portal (' + r.status + '). Intenta de nuevo.'),
          };
        } else {
          output = {
            answer: j.answer || (uiLang() === 'en' ? 'No answer.' : 'Sin respuesta.'),
            sources: (j.sources || []).slice(0, 4).map(function (s) {
              return s.title || '';
            }),
            gap: !!(j.memory_log && j.memory_log.gap),
          };
        }
      } catch (err) {
        output = {
          error: 'portal_ask_failed',
          message:
            uiLang() === 'en'
              ? 'Portal chat request failed. Please retry.'
              : 'Falló la consulta al chat del portal. Reintenta.',
        };
      }
    }
    if (!self.ws || self.ws.readyState !== 1) return;
    self.ws.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(output),
        },
      })
    );
    await self._waitPlayback();
    if (self.ws && self.ws.readyState === 1) {
      self.ws.send(JSON.stringify({ type: 'response.create' }));
    }
  };

  BcsGrokVoice.prototype._onMessage = function (raw) {
    var self = this;
    var event;
    try {
      event = JSON.parse(raw);
    } catch (e) {
      return;
    }
    var type = event.type || '';
    if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
      var delta = event.delta || event.audio;
      if (delta) {
        try {
          self._enqueueAudio(base64PCM16ToFloat32(delta));
        } catch (e) {}
      }
      return;
    }
    if (
      type === 'conversation.item.input_audio_transcription.completed' ||
      type === 'conversation.item.input_audio_transcription.done'
    ) {
      self._transcript('user', event.transcript || event.text || '');
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.updated') {
      /* cumulative interim — ignore until completed if present */
      return;
    }
    if (
      type === 'response.output_audio_transcript.delta' ||
      type === 'response.audio_transcript.delta'
    ) {
      /* stream assistant text optionally */
      return;
    }
    if (
      type === 'response.output_audio_transcript.done' ||
      type === 'response.audio_transcript.done'
    ) {
      self._transcript('assistant', event.transcript || event.text || '');
      return;
    }
    if (type === 'response.function_call_arguments.done') {
      self._handleTool(event);
      return;
    }
    if (type === 'input_audio_buffer.speech_started') {
      /* barge-in: stop local playback */
      self.nextPlayTime = 0;
      self.playing = false;
      if (self.audioCtx) {
        try {
          /* soft barge-in: recreate destination schedule by advancing clock */
          self.nextPlayTime = self.audioCtx.currentTime;
        } catch (e) {}
      }
      self._emit('listening');
      return;
    }
    if (type === 'error') {
      var msg =
        (event.error && (event.error.message || event.error.code)) ||
        event.message ||
        'Voice error';
      self._err(msg, event);
    }
  };

  BcsGrokVoice.prototype._startMic = async function () {
    var self = this;
    self.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    self.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: SAMPLE_RATE,
    });
    self.source = self.audioCtx.createMediaStreamSource(self.mediaStream);
    self.processor = self.audioCtx.createScriptProcessor(4096, 1, 1);
    self.processor.onaudioprocess = function (e) {
      if (!self.active || !self.ws || self.ws.readyState !== 1) return;
      var input = e.inputBuffer.getChannelData(0);
      var b64 = float32ToBase64PCM16(input);
      try {
        self.ws.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: b64,
          })
        );
      } catch (err) {}
    };
    self.source.connect(self.processor);
    self.processor.connect(self.audioCtx.destination);
  };

  BcsGrokVoice.prototype.start = async function () {
    var self = this;
    if (self.active) return;
    self._emit('connecting');
    var tokenRes;
    try {
      tokenRes = await fetch(TOKEN_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch (e) {
      self._err('voice_token_network');
      self._emit('error');
      throw e;
    }
    var body = await tokenRes.json().catch(function () { return {}; });
    if (!tokenRes.ok || !body.token) {
      var code =
        tokenRes.status === 401
          ? 'voice_unauthorized'
          : tokenRes.status === 503
            ? 'voice_not_configured'
            : 'voice_token_failed';
      self._err(code, body);
      self._emit('error');
      throw new Error(code);
    }
    var wsUrl = body.url || 'wss://api.x.ai/v1/realtime?model=grok-voice-latest';
    await self._startMic();
    await new Promise(function (resolve, reject) {
      try {
        self.ws = new WebSocket(wsUrl, ['xai-client-secret.' + body.token]);
      } catch (e) {
        reject(e);
        return;
      }
      var opened = false;
      self.ws.onopen = function () {
        opened = true;
        self.active = true;
        self._sessionUpdate();
        self._emit('listening');
        resolve();
      };
      self.ws.onmessage = function (ev) {
        self._onMessage(ev.data);
      };
      self.ws.onerror = function () {
        if (!opened) reject(new Error('ws_error'));
        else self._err('voice_ws_error');
      };
      self.ws.onclose = function () {
        if (self.active) {
          self.active = false;
          self._emit('');
        }
      };
    });
  };

  BcsGrokVoice.prototype.stop = function () {
    this.active = false;
    try {
      if (this.ws) this.ws.close();
    } catch (e) {}
    this.ws = null;
    try {
      if (this.processor) this.processor.disconnect();
    } catch (e) {}
    try {
      if (this.source) this.source.disconnect();
    } catch (e) {}
    this.processor = null;
    this.source = null;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (e) {}
      });
      this.mediaStream = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch (e) {}
      this.audioCtx = null;
    }
    this.playing = false;
    this.nextPlayTime = 0;
    this._emit('');
  };

  global.BcsGrokVoice = BcsGrokVoice;
})(typeof window !== 'undefined' ? window : globalThis);
