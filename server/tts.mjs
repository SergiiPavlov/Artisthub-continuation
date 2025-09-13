// server/tts.mjs — v1.4.0 (2025-09-12)
// Piper TTS: список голосов + синтез WAV.
// Совместимо с index.mjs (registerTTS(app))

import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function basenameSafe(p) {
  try { return path.basename(String(p||'')); } catch { return String(p||''); }
}

function makeTempPath(prefix = 'piper-', ext = '.wav') {
  const name = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  return path.join(os.tmpdir(), name);
}

function pickLang(text) {
  const t = String(text||'').toLowerCase();
  if (/[а-яёієґ]/.test(t)) {
    if (/[іїєґ]/.test(t)) return 'uk';
    return 'ru';
  }
  return 'en';
}

function voiceFromEnv(lang) {
  const {
    PIPER_VOICE_RU = '',
    PIPER_VOICE_UK = '',
    PIPER_VOICE_EN = '',
    PIPER_VOICE    = '',
  } = process.env;
  if (lang === 'ru' && PIPER_VOICE_RU) return PIPER_VOICE_RU;
  if (lang === 'uk' && PIPER_VOICE_UK) return PIPER_VOICE_UK;
  if (lang === 'en' && PIPER_VOICE_EN) return PIPER_VOICE_EN;
  return PIPER_VOICE || PIPER_VOICE_RU || PIPER_VOICE_EN || PIPER_VOICE_UK || '';
}

function listVoicesFromEnv() {
  const out = [];
  const push = (lang, p) => {
    if (!p) return;
    out.push({ id: basenameSafe(p), lang, path: p });
  };
  push('ru', process.env.PIPER_VOICE_RU);
  push('uk', process.env.PIPER_VOICE_UK);
  push('en', process.env.PIPER_VOICE_EN);
  // fallback/дефолт
  const def = process.env.PIPER_VOICE || out[0]?.path || '';
  return { default: basenameSafe(def), voices: out };
}

function resolveVoice(requested) {
  const req = String(requested||'').trim();
  if (!req) return '';
  // Безопасность: разрешаем только пути, указанные в ENV.
  const cand = [
    process.env.PIPER_VOICE_RU,
    process.env.PIPER_VOICE_UK,
    process.env.PIPER_VOICE_EN,
    process.env.PIPER_VOICE,
  ].filter(Boolean);
  const byId = cand.find(p => basenameSafe(p) === req);
  if (byId) return byId;
  // если прислали полный путь — сверяем на точное совпадение
  if (cand.includes(req)) return req;
  return '';
}

export function registerTTS(app) {
  const PIPER_PATH = process.env.PIPER_PATH || 'piper';
  const LENGTH  = String(process.env.PIPER_LENGTH_SCALE || '1.0');
  const NOISE   = String(process.env.PIPER_NOISE_SCALE  || '0.50');
  const NOISE_W = String(process.env.PIPER_NOISE_W      || '0.20');
  const THREADS = String(process.env.PIPER_THREADS      || '1');

  // Список доступных голосов (из ENV)
  app.get('/api/tts/voices', (_req, res) => {
    const v = listVoicesFromEnv();
    res.json(v);
  });

  // Health с краткой диагностикой
  app.get('/api/tts/health', async (_req, res) => {
    const v = listVoicesFromEnv();
    res.json({
      ok: !!process.env.PIPER_PATH && (v.voices.length > 0 || !!process.env.PIPER_VOICE),
      path: PIPER_PATH,
      voices: v,
    });
  });

  // Синтез (возвращаем audio/wav)
  app.post('/api/tts', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ error: 'no_text' });

      const langParam = String(req.body?.lang || req.query?.lang || '').trim().toLowerCase();
      const lang = langParam || pickLang(text);

      const voiceReq = String(req.body?.voice || '').trim();
      const model = voiceReq ? resolveVoice(voiceReq) : voiceFromEnv(lang);
      if (!model) return res.status(500).json({ error: 'no_voice_model' });

      const outFile = makeTempPath('piper-', '.wav');
      const args = [
        '--quiet',
        '-m', model,
        '-f', outFile,
        '--length_scale', LENGTH,
        '--noise_scale',  NOISE,
        '--noise_w',      NOISE_W,
      ];
      if (+THREADS > 1) { args.push('--threads', String(THREADS)); }

      const p = spawn(PIPER_PATH, args);
      let stderrBuf = '';
      p.stderr.on('data', (d) => { stderrBuf += String(d); });
      p.on('error', (e) => {
        res.status(500).json({ error: 'spawn_failed', detail: String(e) });
      });
      p.on('close', async (code) => {
        if (code !== 0) {
          return res.status(500).json({ error: 'piper_exit', code, log: stderrBuf.slice(-2000) });
        }
        try {
          res.setHeader('content-type', 'audio/wav');
          const stream = fss.createReadStream(outFile);
          stream.pipe(res);
          stream.on('close', () => { try { fss.unlink(outFile, () => {}); } catch {} });
        } catch (e) {
          res.status(500).json({ error: 'read_failed', detail: String(e) });
        }
      });
      // Текст в stdin
      try {
        p.stdin.write(text);
        p.stdin.end();
      } catch {}
    } catch (e) {
      res.status(500).json({ error: 'tts_failed', detail: String(e) });
    }
  });
}
