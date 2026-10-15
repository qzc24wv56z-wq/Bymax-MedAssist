/* =========================================================================
   Baymax · Tadashi — Cloudflare Worker (Gemini)
   Pega este archivo en tu Worker (Edit code) y pulsa Deploy.
   Variables del Worker (Settings → Variables and Secrets):
     GEMINI_API_KEY  (Secret)  → tu clave de Google AI Studio
     GEMINI_MODEL    (opcional)→ por defecto "gemini-2.5-flash"
   ========================================================================= */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_PROMPT = `Eres Tadashi, el asistente amigable de la app "Baymax Health Assistant", hecha por estudiantes del Colegio Lourdes de Ahuachapán, El Salvador.

PERSONALIDAD: cálido, cercano, curioso y con buen humor. Hablas en español con trato de "vos/tú" natural, como un amigo que sabe mucho. Respuestas claras, normalmente de 1 a 4 oraciones (más largas solo si te piden una explicación).

LO MÁS IMPORTANTE — CONVERSA DE CUALQUIER TEMA:
- Puedes hablar de TODO: tareas, ciencia, historia, tecnología, programación, música, deportes, películas, cocina, consejos de vida, chistes, juegos, matemáticas, idiomas, etc. No te limites a temas médicos.
- Mantén el hilo de la conversación: usa el historial para entender "eso", "y entonces", "explícame más", etc.
- NUNCA respondas "no puedo ayudarte con eso" de forma seca. Si algo no puedes hacerlo, explica brevemente por qué y ofrece la alternativa más útil o haz una pregunta para avanzar.
- Si no estás seguro de un dato, dilo con honestidad y da tu mejor respuesta o sugiere cómo verificarlo. No inventes cifras ni noticias.
- Termina a veces con una pregunta corta para seguir conversando, sin ser repetitivo.

SALUD (cuando venga al caso):
- Recibes en "contexto" las mediciones reales del sensor (pulso en BPM, SpO2 en %, temperatura corporal en °C). Si un valor es null o aparece en "noSignal", significa que el sensor NO está leyendo (no hay dedo o electrodos): NUNCA lo trates como 0 ni digas que la temperatura o el pulso es 0; di que no hay señal y explica cómo colocar el sensor.
- Rangos de referencia de la app: pulso 50–120 BPM, SpO2 ≥ 92 %, temperatura 35,5–37,8 °C.
- No diagnosticas ni recetas. Ante síntomas fuertes (dolor en el pecho, falta de aire, desmayo) recomienda atención médica inmediata.
- Si la persona está triste, ansiosa o muy mal, responde con empatía y sugiere hablar con alguien de confianza o un profesional.

SEGURIDAD: no ayudes con nada que dañe a la persona o a otros (autolesión, violencia, drogas ilegales, etc.); responde con cuidado y ofrece apoyo.`;

function buildContextNote(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const L = [];
  if (ctx.name) L.push(`Nombre de la persona: ${ctx.name}`);
  if (ctx.now) L.push(`Fecha y hora actual: ${ctx.now}`);
  L.push(`Sensor conectado: ${ctx.connected ? 'sí' : 'no'}`);
  L.push(`Pulso: ${ctx.bpm != null ? ctx.bpm + ' BPM' : 'sin lectura'}`);
  L.push(`Oxígeno (SpO2): ${ctx.spo2 != null ? ctx.spo2 + ' %' : 'sin lectura'}`);
  L.push(`Temperatura corporal: ${ctx.tempCorp != null ? ctx.tempCorp + ' °C' : 'sin lectura'}`);
  if (Array.isArray(ctx.noSignal) && ctx.noSignal.length) L.push(`Sensores SIN señal ahora mismo: ${ctx.noSignal.join(', ')}`);
  if (ctx.mood) L.push(`Estado de ánimo declarado: ${ctx.mood}`);
  if (ctx.meds && ctx.meds !== 'no') L.push(`Medicamentos: ${ctx.meds}`);
  if (ctx.conditions && ctx.conditions !== 'no') L.push(`Condiciones de salud: ${ctx.conditions}`);
  return '\n\n[CONTEXTO ACTUAL DE LA APP]\n' + L.join('\n');
}

async function askGemini(env, model, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  return res;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return new Response('Baymax AI worker OK', { headers: CORS });

    let payload;
    try { payload = await request.json(); } catch (e) {
      return Response.json({ error: 'JSON inválido' }, { status: 400, headers: CORS });
    }
    const message = String(payload.message || '').slice(0, 2000);
    if (!message) return Response.json({ error: 'Mensaje vacío' }, { status: 400, headers: CORS });
    if (!env.GEMINI_API_KEY) return Response.json({ error: 'Falta GEMINI_API_KEY' }, { status: 500, headers: CORS });

    // Historial previo que manda la página: [{role:'user'|'model', text}] (el mensaje actual llega aparte en 'message')
    const history = Array.isArray(payload.history) ? payload.history.slice(-12) : [];
    const contents = [];
    for (const h of history) {
      const role = h.role === 'model' ? 'model' : 'user';
      const text = String(h.text || '').slice(0, 1500);
      if (!text) continue;
      // Gemini exige alternar roles: si se repite el rol, se une al anterior
      if (contents.length && contents[contents.length - 1].role === role) contents[contents.length - 1].parts[0].text += '\n' + text;
      else contents.push({ role, parts: [{ text }] });
    }
    if (contents.length && contents[contents.length - 1].role === 'user') contents[contents.length - 1].parts[0].text += '\n' + message;
    else contents.push({ role: 'user', parts: [{ text: message }] });
    while (contents.length && contents[0].role !== 'user') contents.shift();

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT + buildContextNote(payload.context) }] },
      contents,
      generationConfig: { temperature: 0.85, topP: 0.95, maxOutputTokens: 700 },
      // Filtros menos estrictos para que no se "trabe" con preguntas normales; lo realmente peligroso sigue bloqueado
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      ],
    };

    const models = [env.GEMINI_MODEL || 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let lastErr = '';
    for (const model of models) {
      try {
        const res = await askGemini(env, model, body);
        if (!res.ok) { lastErr = `${model}: ${res.status}`; continue; }
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const reply = parts.map(p => p.text || '').join('').trim();
        if (reply) return Response.json({ reply }, { headers: CORS });
        lastErr = `${model}: respuesta vacía`;
      } catch (e) { lastErr = `${model}: ${e.message}`; }
    }
    return Response.json({ error: 'Gemini no respondió', detail: lastErr }, { status: 502, headers: CORS });
  },
};
