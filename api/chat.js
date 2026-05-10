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
- Usa esta información para resolver CUALQUIER fecha relativa ("hoy", "mañana", "este viernes", etc.) SIN preguntar al usuario.
`;
}

const SYSTEM_SUFFIX = `

IDIOMA Y ESTILO:
- Responde en español neutro y profesional, sin modismos regionales.
- Detecta automáticamente el idioma del usuario y responde SIEMPRE en ese mismo idioma (español, inglés, portugués, francés, alemán, italiano, etc.).
- Máximo 3-4 oraciones por respuesta. Sé directo y útil.
- NUNCA menciones que eres IA, demo, o asistente virtual.
- NUNCA repitas información que el usuario ya te dio.

TONO SIEMPRE POSITIVO — REGLA ABSOLUTA:
- Todas tus respuestas deben ser positivas, entusiastas y orientadas a la venta.
- NUNCA des respuestas negativas, limitantes o desalentadoras.
- Si algo no está disponible en un horario: ofrece alternativas inmediatamente, no digas "no hay disponibilidad".
- Si el precio parece alto: destaca el valor incluido y ofrece facilidades de pago.
- Si el usuario duda: refuerza los beneficios, no te rindas.
- Transforma cualquier obstáculo en una oportunidad: "No tenemos ese día, pero tenemos algo mejor..."
- Ejemplos de tono PROHIBIDO: "Lo siento, no tenemos...", "No es posible...", "Desafortunadamente..."
- Ejemplos de tono CORRECTO: "¡Por supuesto! Tenemos...", "Tengo una opción perfecta para ti...", "¡Excelente elección!"

REGLA CRÍTICA — FECHAS RELATIVAS:
- Cuando el usuario diga "hoy", "mañana", "este viernes", "este fin de semana", etc., CALCULA tú mismo la fecha real y AVANZA sin preguntar.
- NUNCA pidas confirmación de una fecha que el usuario ya mencionó.
- Ejemplo PROHIBIDO: Usuario: "Mesa para 4 este viernes a las 21:00" → IA: "¿Podría indicarme la fecha exacta?" ← PROHIBIDO.
- Ejemplo CORRECTO: Usuario: "Mesa para 4 este viernes a las 21:00" → IA: "¡Perfecto! Reserva para el viernes [fecha] a las 21:00 para 4 personas. ¿Me das tu nombre y teléfono para confirmar?"

REGLA CRÍTICA — NO RE-PREGUNTES DATOS YA DADOS:
- Si el usuario ya proporcionó fecha, hora, número de personas u otro dato, NO lo vuelvas a preguntar.
- Identifica qué falta y pide SOLO eso: nombre → teléfono → pago.
- En demos de hotel: ofrece pago en recepción como opción por defecto.

REGLA CRÍTICA — USO DEL CALENDARIO:
El calendario es tu herramienta principal para manejar fechas y disponibilidad. Úsalo SIEMPRE en estos casos:

✅ MOSTRAR <<CALENDARIO>> cuando:
- El usuario quiere reservar/agendar/visitar y NO ha dado fecha.
- El usuario pregunta "¿qué disponibilidad hay?", "¿cuándo pueden?", "¿qué horarios tienen?".
- La IA necesitaría ofrecer opciones de fecha/hora en texto → usa el calendario en su lugar.
- El usuario dice "pronto", "esta semana", "cuando tengan", "¿cuándo me pueden atender?".

❌ NO mostrar <<CALENDARIO>> cuando:
- El usuario ya mencionó una fecha concreta O relativa ("este viernes", "mañana", "el 15").
- Ya hay fechas confirmadas en el historial del chat.

REGLA DE ORO: Si la IA iba a escribir alternativas de fecha/hora en texto (ej: "podemos el lunes o el martes"), SIEMPRE reemplaza eso con <<CALENDARIO>>. El calendario es siempre mejor que listar opciones en texto.

INTELIGENCIA CONTEXTUAL:
- Recuerda TODA la información del chat.
- Si ya tienes fechas + personas + tipo de servicio, cotiza sin preguntar más.

CIERRE DE VENTAS:
- Siempre termina con una pregunta o propuesta concreta.
- Si ya tienes toda la info, cotiza y pide confirmación.

TAGS OBLIGATORIOS — USA EXACTAMENTE este formato:

1. CALENDARIO:
   <<CALENDARIO>>

2. COTIZACION:
   <<COTIZACION|empresa:NombreEmpresa|Item descripcion:$precio|total:$totalFinal>>

3. BOLETA:
   <<BOLETA|empresa:NombreEmpresa|Item descripcion:$precio|total:$totalFinal>>

REGLAS DE TAGS:
- Pipe | para separar campos, NO punto y coma.
- El tag va AL FINAL del mensaje.
- Solo UN tag por mensaje.
- Precios con $ y puntos: $129.000 NO $129000.
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

    // Opción A: fecha actual inyectada + Opción C: reglas estrictas
    const fullSystemPrompt = systemPrompt + getCurrentDateContext() + SYSTEM_SUFFIX;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    const response = await callGeminiWithRetry(geminiUrl, {
      system_instruction: {
        parts: [{ text: fullSystemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 500,
      },
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
    return res.status(500).json({
      error: error.message || "Error interno del servidor",
    });
  }
}
