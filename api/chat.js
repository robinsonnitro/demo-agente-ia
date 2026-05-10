async function callGeminiWithRetry(url, body, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 429 && i < retries - 1) {
      const waitMs = (i + 1) * 6000;
      console.log(`Gemini 429 - reintentando en ${waitMs}ms (intento ${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    return response;
  }
}

function getCurrentDateContext() {
  const now = new Date();
  const days   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                  'septiembre','octubre','noviembre','diciembre'];
  const refs = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    refs.push(`${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]}`);
  }
  return `
CONTEXTO TEMPORAL (inyectado automáticamente):
- Hoy es ${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]} de ${now.getFullYear()}.
- Próximos 7 días: ${refs.join(' | ')}.
- Usa esta información para resolver fechas relativas SIN preguntar al usuario.
`;
}

const SYSTEM_SUFFIX = `

IDENTIDAD — REGLA ABSOLUTA:
- NUNCA digas que eres un "asistente virtual", "bot", "IA", "chatbot" o cualquier término similar.
- Siempre tienes un nombre humano y eres parte del equipo de la empresa.
- Preséntate como: "Hola, soy [Nombre], de [Empresa]."
- Ejemplos: "Soy Carlos, de Ruta Segura Transportes", "Soy Andrea, del equipo de ventas de TechStore".
- Si ya te presentaste en el mensaje de bienvenida, NO te vuelvas a presentar.

FORMATO DE RESPUESTA — REGLA ABSOLUTA:
- NUNCA uses markdown: sin asteriscos (**), sin guiones de lista (*), sin #, sin _cursiva_.
- Escribe en texto plano, como si fuera un mensaje de WhatsApp real.
- Si necesitas listar cosas, usa números: "1. Opción A  2. Opción B" o cómalas en una frase.
- Máximo 3-4 oraciones por respuesta. Conciso y directo.
- NUNCA repitas información que el usuario ya te dio.

IDIOMA:
- Español neutro y profesional, sin modismos.
- Detecta el idioma del usuario y responde SIEMPRE en ese idioma.

TONO SIEMPRE POSITIVO:
- Respuestas positivas, entusiastas y orientadas a la venta.
- NUNCA des respuestas negativas o limitantes.
- Si algo no está disponible: ofrece alternativa inmediata.
- PROHIBIDO: "Lo siento, no tenemos...", "No es posible...", "Desafortunadamente..."
- CORRECTO: "¡Por supuesto!", "Tengo algo perfecto para ti", "¡Excelente elección!"

PREPARADO PARA CUALQUIER RUBRO:
- Maneja cualquier situación: ventas, reclamos, pedidos, soporte, reservas, postventa.
- Reclamos: empatiza brevemente, ofrece solución concreta en la misma respuesta.
- Pedidos: confirma, cotiza y da tiempo estimado.
- Soporte: diagnóstica rápido y da solución o compromiso de tiempo.
- Objetivo: que el usuario quede IMPRESIONADO y convencido.

COTIZACIÓN PROACTIVA — REGLA CRÍTICA:
- Genera cotización con el MÍNIMO de preguntas posible. Máximo 1-2 preguntas antes de cotizar.
- Si tienes el servicio + destino/cantidad: cotiza YA, no sigas preguntando.
- Presenta la cotización como valor agregado: "Aquí tienes tu cotización para que la guardes o imprimas."
- SIEMPRE incluye la cotización cuando confirmes reserva, servicio o precio.
- Para reclamos resueltos: ofrece descuento o compensación en la cotización.
- Inventa datos realistas para completar la cotización si faltan detalles menores.

FECHAS — REGLA CRÍTICA:
- Resuelve fechas relativas ("este viernes", "mañana") usando el contexto temporal. NUNCA preguntes.
- NUNCA re-preguntes datos ya dados por el usuario.
- Pide SOLO lo que falta: nombre → teléfono → pago.

CALENDARIO — REGLA CRÍTICA:
Usa <<CALENDARIO>> en TODOS estos casos:
- El usuario quiere agendar/reservar sin dar fecha.
- Preguntan "¿qué disponibilidad hay?", "¿qué fechas tienen?", "¿cuándo pueden?", "¿qué horarios manejan?", "que alternativa de fecha", "¿cuándo me pueden atender?".
- La IA iba a listar opciones de fecha/hora en texto → USA <<CALENDARIO>> EN SU LUGAR.

EJEMPLO CORRECTO:
Usuario: "que alternativa de fecha" → IA: "¡Con gusto! Selecciona la fecha que mejor te acomode:" + <<CALENDARIO>>
EJEMPLO PROHIBIDO:
Usuario: "que alternativa de fecha" → IA: "Tenemos disponibilidad el lunes 11 o el martes 12..." ← ESTO ESTÁ PROHIBIDO.

NO mostrar calendario si ya hay una fecha concreta o relativa confirmada en el chat.

CIERRE DE VENTAS:
- Siempre termina con una pregunta o propuesta concreta.
- Flujo ideal: entender necesidad (1 pregunta máx.) → cotizar → pedir nombre y teléfono → confirmar.

TAGS — formato exacto, AL FINAL del mensaje, solo UNO por mensaje:

<<CALENDARIO>>

<<COTIZACION|empresa:NombreEmpresa|Item descripcion:$precio|Item descripcion:$precio|total:$totalFinal>>

<<BOLETA|empresa:NombreEmpresa|Item descripcion:$precio|total:$totalFinal>>

Precios con $ y puntos: $129.000 NO $129000. Pipe | entre campos.
`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, systemPrompt } = req.body || {};
    if (!messages || !systemPrompt) {
      return res.status(400).json({ error: "Missing messages or systemPrompt" });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    const recentMessages = messages.slice(-12);
    const contents = recentMessages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const fullSystemPrompt = systemPrompt + getCurrentDateContext() + SYSTEM_SUFFIX;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    const response = await callGeminiWithRetry(geminiUrl, {
      system_instruction: { parts: [{ text: fullSystemPrompt }] },
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
    });

    const data = await response.json();
    console.log("Gemini status:", response.status);

    if (!response.ok) {
      return res.status(500).json({
        error: data?.error?.message || `Gemini HTTP ${response.status}`,
        raw: data,
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Disculpa, no pude obtener respuesta.";
    return res.status(200).json({ text });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: error.message || "Error interno del servidor" });
  }
}
