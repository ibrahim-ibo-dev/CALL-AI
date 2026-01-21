import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';
import { getCharacter } from './characters.js';

dotenv.config();

console.log(
  JSON.stringify(
    {
      env_loaded: {
        CLAUDE_API_KEY: Boolean(process.env.CLAUDE_API_KEY && String(process.env.CLAUDE_API_KEY).trim()),
        KURDISH_TTS_API_KEY: Boolean(
          process.env.KURDISH_TTS_API_KEY && String(process.env.KURDISH_TTS_API_KEY).trim(),
        ),
        PORT: process.env.PORT ?? null,
      },
    },
    null,
    2,
  ),
);

const app = express();
const PORT = Number(process.env.PORT ?? 3005);

app.use(
  cors({
    origin: (origin, cb) => {
      const allowed = process.env.CORS_ORIGIN;
      if (!origin) {
        cb(null, true);
        return;
      }
      if (allowed && origin === allowed) {
        cb(null, true);
        return;
      }
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? 'dev-secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
    },
  }),
);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/select_character', async (req, res) => {
  try {
    const characterId = String(req.body?.character ?? '');
    const character = getCharacter(characterId);

    if (!character) {
      res.status(400).json({ success: false, error: 'Invalid character' });
      return;
    }

    req.session.selected_character = characterId;
    req.session.conversation_history = [];

    let initialMessage = null;
    try {
      initialMessage = await getInitialGreeting(character);
    } catch (err) {
      console.error(err);
      initialMessage = null;
    }

    if (initialMessage) {
      req.session.conversation_history.push({ role: 'assistant', content: initialMessage });
    }

    const initialAudio = initialMessage
      ? await convertTextToSpeech(initialMessage, character.speaker_id)
      : null;

    res.json({
      success: true,
      character: sanitizeCharacter(character),
      initial_message: initialMessage,
      initial_audio: initialAudio,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err?.message ?? 'Server error' });
  }
});

app.post('/api/send_message', async (req, res) => {
  try {
    const userMessage = String(req.body?.message ?? '').trim();
    const characterId = String(req.session.selected_character ?? '');
    const character = getCharacter(characterId);

    if (!character || !userMessage) {
      res.status(400).json({ success: false, error: 'Invalid request' });
      return;
    }

    if (!Array.isArray(req.session.conversation_history)) {
      req.session.conversation_history = [];
    }

    req.session.conversation_history.push({ role: 'user', content: userMessage });

    let aiResponse = await getClaudeResponse(character, userMessage, req.session.conversation_history);

    let shouldEndCall = false;
    if (aiResponse.includes('[END_CALL]')) {
      shouldEndCall = true;
      aiResponse = aiResponse.replaceAll('[END_CALL]', '').trim();
    }

    req.session.conversation_history.push({ role: 'assistant', content: aiResponse });

    const audio = await convertTextToSpeech(aiResponse, character.speaker_id);

    res.json({ success: true, response: aiResponse, audio, end_call: shouldEndCall });
  } catch (_err) {
    console.error(_err);
    res.status(502).json({ success: false, error: _err?.message ?? 'Server error' });
  }
});

app.post('/api/reset_conversation', (req, res) => {
  req.session.conversation_history = [];
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

function sanitizeCharacter(character) {
  return {
    id: character.id,
    name: character.name,
    gender: character.gender,
    speaker_id: character.speaker_id,
    age: character.age,
  };
}

async function getClaudeResponse(character, userMessage, history) {
  const apiKey = process.env.CLAUDE_API_KEY;
  const apiUrl = process.env.CLAUDE_API_URL ?? 'https://api.anthropic.com/v1/messages';
  const model = process.env.CLAUDE_MODEL ?? 'claude-3-5-haiku-20241022';

  if (!apiKey) {
    throw new Error('Missing CLAUDE_API_KEY. Create .env (rename .env.template) and add your Claude key, then restart the server.');
  }

  const messages = [];
  const historyCount = history.length;

  for (let i = 0; i < historyCount - 1; i++) {
    messages.push({ role: history[i].role, content: history[i].content });
  }

  messages.push({ role: 'user', content: userMessage });

  const body = {
    model,
    max_tokens: 1024,
    system: character.system_prompt,
    messages,
  };

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    throw new Error(`Claude API HTTP ${resp.status}: ${errorText || 'Request failed'}`);
  }

  const json = await resp.json().catch(() => null);
  const text = json?.content?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Claude API returned no text response');
  }
  return text;
}

async function getInitialGreeting(character) {
  const apiKey = process.env.CLAUDE_API_KEY;
  const apiUrl = process.env.CLAUDE_API_URL ?? 'https://api.anthropic.com/v1/messages';
  const model = process.env.CLAUDE_MODEL ?? 'claude-3-5-haiku-20241022';

  if (!apiKey) return null;

  const greetingPrompt =
    character.system_prompt +
    "\n\nزۆر گرنگ: ئێستا کەسێک پەیوەندیت پێوە دەگرێت. تۆ دەبێت سەرەتا قسە بکەیت وەک کاتێک کەسێک تەلەفۆنت بۆ دێت. هەر جارێک بە شێوەیەکی جیاواز سڵاو بکە یان بپرسە کێیە. بۆ نموونە:\n- ئەلۆ؟\n- ئەلۆ کێیە؟\n- بەڵێ فەرموو؟\n- ئەلۆ تۆ کێیت؟\n- هەڵۆ؟\n- ئەلۆ فەرموو؟\n- بەڵێ؟\n\nتەنها یەک ڕستەی کورت بڵێ بە شێوەی سروشتی وەک کاتێک کەسێک تەلەفۆنت بۆ دێت.";

  const body = {
    model,
    max_tokens: 100,
    system: greetingPrompt,
    messages: [{ role: 'user', content: '[پەیوەندی تەلەفۆن دەگرێت]' }],
  };

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    console.error(`Initial greeting failed HTTP ${resp.status}: ${errorText || 'Request failed'}`);
    return null;
  }

  const json = await resp.json().catch(() => null);
  const text = json?.content?.[0]?.text;
  return typeof text === 'string' ? text : null;
}

async function convertTextToSpeech(text, speakerId) {
  const apiKey = process.env.KURDISH_TTS_API_KEY;
  const apiUrl = process.env.KURDISH_TTS_API_URL ?? 'https://www.kurdishtts.com/api/tts-proxy';

  if (!apiKey) return null;

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ text, speaker_id: speakerId }),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    console.error(`Kurdish TTS failed HTTP ${resp.status}: ${errorText || 'Request failed'}`);
    return null;
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
}
