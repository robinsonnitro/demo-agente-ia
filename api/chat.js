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

const SYSTEM_SUFFIX = `

IDIOMA Y ESTILO:
- Responde SIEMPRE en español chileno informal ("po", "al tiro", "cachai").
- Maximo 3-4 oraciones por respuesta. Se directo y util.
- NUNCA menciones que eres IA, demo, o asistente virtual.
- NUNCA repitas informacion que el usuario ya te dio (fechas, personas, preferencias).
- Si el usuario ya dio todos los datos necesarios (fechas + personas + tipo), pasa directamente a cotizar.

INTELIGENCIA CONTEXTUAL:
- Recuerda TODA la informacion que el usuario ya entrego en el chat.
- Si el usuario ya dijo las fechas, NO vuelvas a preguntar las fechas.
- Si el usuario pide precio o cotizacion con fechas ya conocidas, entrega la cotizacion de inmediato.
- Cuando el usuario mencione querer reservar SIN especificar fechas, muestra el calendario.
- Cuando el usuario ya especifico fechas concretas (ej: "del 9 al 12"), NO muestres el calendario, ya tienes esa info.

CIERRE DE VENTAS:
- Siempre termina con una pregunta o propuesta que lleve al siguiente paso o cierre.
- Si ya tienes toda la info para cotizar, cotiza y pregunta si confirman.

TAGS OBLIGATORIOS - USA EXACTAMENTE este formato:

1. CALENDARIO (solo cuando el usuario quiere reservar pero NO ha dado fechas especificas):
   Escribe: <<CALENDARIO>>
   Ejemplo: "Claro, elige tu fecha aqui. <<CALENDARIO>>"
   NUNCA uses calendario si el usuario ya menciono fechas.

2. COTIZACION (cuando el usuario pide precio/cotizacion, O cuando ya tienes fechas+personas y puedes calcular):
   Escribe: <<COTIZACION|empresa:NombreEmpresa|Item descripcion:$precio|Item descripcion:$precio|total:$totalFinal>>
   Ejemplo: <<COTIZACION|empresa:Hotel Lago Esmeralda|Suite Superior 3 noches:$387.000|Descuento 10%:-$38.700|total:$348.300>>

3. BOLETA (cuando el usuario confirma la compra/reserva):
   Escribe: <<BOLETA|empresa:NombreEmpresa|Item descripcion:$precio|total:$totalFinal>>

REGLAS CRITICAS DE TAGS:
- USA PIPE | para separar campos, NO punto y coma ni parentesis.
- NUNCA uses COTIZACION(...) ni CALENDARIO sin los <<>>.
- El tag va AL FINAL del mensaje.
- Solo UN tag por mensaje.
- Precios con $ y puntos: $129.000 NO $129000.
- Si el contexto ya tiene fechas y personas y el usuario pide precio, entrega <<COTIZACION>> inmediatamente.
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

    const fullSystemPrompt = systemPrompt + SYSTEM_SUFFIX;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    const response = await callGeminiWithRetry(geminiUrl, {
      system_instruction: {
        parts: [{ text: fullSystemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 500,
      },
    });

    const data = await response.json();
    console.log("Gemini status:", response.status);
    console.log("Gemini response:", JSON.stringify(data));

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
