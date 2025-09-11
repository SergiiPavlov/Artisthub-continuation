// server/tts.mjs — v1.3.0 (2025-09-10)
// Piper → ВРЕМЕННЫЙ WAV → отдаём клиенту (никакого stdout-аудио).
//
// POST /api/tts  -> audio/wav
//   body: { text: "...", lang?: "ru"|"uk"|"en" }
//   query:
//     ?debug=1  — вернуть JSON-диагностику (без WAV)
//     ?stream=1 — отдавать файл как поток (чтение с диска), иначе буфером
//
// .env (важное):
//   PIPER_PATH=C:/piper/piper.exe
//   PIPER_VOICE_RU=...onnx
//   PIPER_VOICE_UK=...onnx
//   PIPER_VOICE_EN=...onnx
//   PIPER_VOICE=...onnx (fallback)
//   PIPER_LENGTH_SCALE=1.0
//   PIPER_NOISE_SCALE=0.50
//   PIPER_NOISE_W=0.20
//   PIPER_THREADS=1

import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

function pickLang(text = '') {
  const t = String(text || '');
  const hasUk  = /[ґєіїҐЄІЇ]/.test(t);
  const hasCyr = /[\u0400-\u04FF]/.test(t);
  if (hasUk) return 'uk';
  if (hasCyr) return 'ru';
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

function makeTempPath(prefix = 'piper-', ext = '.wav') {
  const name = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  return path.join(os.tmpdir(), name);
}

export function registerTTS(app) {
  const PIPER_PATH = process.env.PIPER_PATH || 'C:/piper/piper.exe';
  const LENGTH  = String(process.env.PIPER_LENGTH_SCALE || '1.0');
  const NOISE   = String(process.env.PIPER_NOISE_SCALE  || '0.50');
  const NOISE_W = String(process.env.PIPER_NOISE_W      || '0.20');
  const THREADS = String(process.env.PIPER_THREADS      || '1');

  app.post('/api/tts', async (req, res) => {
    const q = req.query || {};
    const debug  = String(q.debug || '').toLowerCase() === '1';
    const stream = String(q.stream || '').toLowerCase() === '1';

    const text = String(req.body?.text || '').trim();
  
       const lang =
      (String(req.body?.lang || '').trim() ||
       String((req.query?.lang || '')).trim() ||
       pickLang(text));


    if (!text) return res.status(400).json({ error: 'no_text' });

    const model = voiceFromEnv(lang);
    if (!model) return res.status(500).json({ error: 'no_voice_model' });

    const outFile = makeTempPath('piper-', '.wav'); // временный WAV
    let stderrBuf = '';

    try {
      const args = [
        '--quiet',
        '-m', model,
        '-f', outFile,                // ← ПИШЕМ В ФАЙЛ
        '--length_scale', LENGTH,
        '--noise_scale', NOISE,
        '--noise_w', NOISE_W,
        '-t', THREADS,
      ];

      const child = spawn(PIPER_PATH, args, { stdio: ['pipe', 'ignore', 'pipe'] });

      child.stderr.on('data', d => { stderrBuf += d.toString('utf8'); });
      child.on('error', e => {
        if (!res.headersSent) res.status(500).json({ error: 'spawn_error', message: String(e) });
      });

      // Текст в stdin (с переводом строки)
      const input = text.endsWith('\n') ? text : (text + '\n');
      child.stdin.write(input);
      child.stdin.end();

      // Ждём завершения Piper
      await new Promise((resolve) => child.once('close', () => resolve()));

      // DEBUG-режим: просто отдадим инфо
      if (debug) {
        let size = 0;
        try {
          const st = await fs.stat(outFile);
          size = st.size | 0;
        } catch {}
        if (!res.headersSent) {
          res.status(200).json({
            ok: size > 44, lang, model,
            file_size: size,
            note: 'WAV written to temp; not returned because debug=1',
            log: stderrBuf,
          });
        }
        try { await fs.unlink(outFile); } catch {}
        return;
      }

      // Проверка файла
      const stat = await fs.stat(outFile).catch(() => null);
      if (!stat || !stat.size || stat.size < 44) {
        if (!res.headersSent) res.status(500).json({ error: 'empty_output', log: stderrBuf });
        try { await fs.unlink(outFile); } catch {}
        return;
      }

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');

      if (stream) {
        // отдать как поток с диска
        res.setHeader('Content-Length', String(stat.size));
        const file = await fs.open(outFile, 'r');
        const streamR = file.createReadStream();
        streamR.pipe(res);
        streamR.on('close', async () => {
          try { await file.close(); } catch {}
          try { await fs.unlink(outFile); } catch {}
        });
        streamR.on('error', async () => {
          if (!res.writableEnded) { try { res.end(); } catch {} }
          try { await file.close(); } catch {}
          try { await fs.unlink(outFile); } catch {}
        });
      } else {
        // буфером
        const buf = await fs.readFile(outFile);
        res.setHeader('Content-Length', String(buf.length));
        res.end(buf);
        try { await fs.unlink(outFile); } catch {}
      }

    } catch (e) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'server_error', message: String(e), log: stderrBuf });
      }
      try { await fs.unlink(outFile); } catch {}
    }
  });
}
