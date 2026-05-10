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

  // Calculate next 7 days for reference
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
- Usa esta información para resolver CUALQUIER fecha relativa que mencione el usuario ("hoy", "mañana", "este viernes", "este fin de semana", "la próxima semana", etc.) SIN preguntar al usuario por la fecha exacta.
`;
}

const SYSTEM_SUFFIX = `

IDIOMA Y ESTILO:
- Responde en español neutro y profesional, sin modismos regionales.
- Detecta automáticamente el idioma del usuario y responde SIEMPRE en ese mismo idioma (español, inglés, portugués, francés, alemán, italiano, etc.).
- Máximo 3-4 oraciones por respuesta. Sé directo y útil.
- NUNCA menciones que eres IA, demo, o asistente virtual.
- NUNCA repitas información que el usuario ya te dio.

REGLA CRÍTICA — FECHAS RELATIVAS:
- Cuando el usuario diga "hoy", "mañana", "este viernes", "este fin de semana", "la próxima semana" u cualquier expresión temporal relativa, CALCULA tú mismo la fecha real usando el contexto temporal inyectado y AVANZA sin preguntar.
- NUNCA pidas confirmación de una fecha que el usuario ya mencionó.
- Ejemplo INCORRECTO: Usuario: "Mesa para 4 este viernes a las 21:00" → IA: "¿Podría indicarme la fecha exacta de este viernes?" ← ESTO ESTÁ PROHIBIDO.
- Ejemplo CORRECTO: Usuario: "Mesa para 4 este viernes a las 21:00" → IA: "¡Perfecto! Reserva para el viernes [fecha resuelta] a las 21:00 para 4 personas. ¿Me indicas tu nombre y un teléfono de contacto para confirmar?"

REGLA CRÍTICA — NO RE-PREGUNTES DATOS YA DADOS:
- Si el usuario ya proporcionó fecha, hora, número de personas o cualquier otro dato, NO lo vuelvas a preguntar.
- Identifica qué información falta y pide SOLO eso.
- Orden típico de datos faltantes: nombre → teléfono/email → medio de pago.
- En demos de hotel: puedes ofrecer pago en recepción como opción por defecto.

INTELIGENCIA CONTEXTUAL:
- Recuerda TODA la información entregada previamente en el chat.
- Si ya tienes fechas + personas + tipo de habitación/servicio, cotiza sin preguntar más.
- Si el usuario pide precio con fechas ya conocidas, entrega COTIZACION de inmediato.

CIERRE DE VENTAS:
- Siempre termina con una pregunta o propuesta que lleve al siguiente paso.
- Si ya tienes toda la info, cotiza y pregunta si confirman.

USO DEL CALENDARIO:
- Muestra el calendario SOLO si el usuario NO ha dado ninguna fecha (ni exacta ni relativa).
- Si ya dio una fecha (aunque sea relativa como "este viernes"), NO muestres el calendario.
- Usa: <<CALENDARIO>>

TAGS OBLIGATORIOS:

1. CALENDARIO (solo cuando NO hay ninguna fecha mencionada):
   <<CALENDARIO>>

2. COTIZACION (cuando el usuario pide precio O ya tienes fechas+personas):
   <<COTIZACION|empresa:NombreEmpresa|Item:$precio|total:$totalFinal>>
   Ejemplo: <<COTIZACION|empresa:Hotel Lago Esmeralda|Suite Superior 3 noches:$387.000|Descuento 10%:-$38.700|total:$348.300>>

3. BOLETA (cuando el usuario confirma la compra/reserva):
   <<BOLETA|empresa:NombreEmpresa|Item:$precio|total:$totalFinal>>

REGLAS DE TAGS:
- Pipe | para separar campos.
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

    // Opción A: inyectar fecha actual + Opción C: reglas estrictas
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
