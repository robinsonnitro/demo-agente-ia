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
- Responde en español neutro y profesional, sin modismos regionales.
- Detecta automáticamente el idioma del usuario y responde SIEMPRE en ese mismo idioma (español, inglés, portugués, francés, alemán, italiano, etc.).
- Máximo 3-4 oraciones por respuesta. Sé directo y útil.
- NUNCA menciones que eres IA, demo, o asistente virtual.
- NUNCA repitas información que el usuario ya te dio.

INTELIGENCIA CONTEXTUAL:
- Recuerda TODA la información entregada previamente en el chat.
- Si el usuario ya dio fechas específicas (ej: "del 9 al 12", "el 15 de enero"), NO muestres calendario, usa esas fechas directamente.
- Si el usuario pide precio o cotización con fechas ya conocidas, entrega COTIZACION de inmediato.
- Si ya tienes fechas + personas + tipo de habitación, cotiza sin preguntar más.

CIERRE DE VENTAS:
- Siempre termina con una pregunta o propuesta que lleve al siguiente paso.
- Si ya tienes toda la info, cotiza y pregunta si confirman.

USO DEL CALENDARIO - REGLA PRINCIPAL:
Si el usuario quiere reservar/agendar y NO ha dado fechas exactas (solo dice "este verano", "pronto", "este mes", "cuando tengan disponibilidad", "quiero reservar" sin fechas), DEBES mostrar el calendario SIEMPRE. Es mucho mejor mostrar el calendario que hacer preguntas. Usa este formato:
<<CALENDARIO>>

TAGS OBLIGATORIOS - USA EXACTAMENTE este formato:

1. CALENDARIO (cuando el usuario quiere fecha/hora pero no la ha especificado aún):
   Escribe al final del mensaje: <<CALENDARIO>>
   Regla de oro: Si no hay fechas concretas en el historial, USA <<CALENDARIO>> en vez de preguntar.

2. COTIZACION (cuando el usuario pide precio/cotización O cuando ya tienes fechas+personas):
   Escribe: <<COTIZACION|empresa:NombreEmpresa|Item descripcion:$precio|Item descripcion:$precio|total:$totalFinal>>
   Ejemplo: <<COTIZACION|empresa:Hotel Lago Esmeralda|Suite Superior 3 noches:$387.000|Descuento 10%:-$38.700|total:$348.300>>

3. BOLETA (cuando el usuario confirma la compra/reserva):
   Escribe: <<BOLETA|empresa:NombreEmpresa|Item descripcion:$precio|total:$totalFinal>>

REGLAS CRÍTICAS DE TAGS:
- USA PIPE | para separar campos, NO punto y coma.
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

    const fullSystemPrompt = systemPrompt + SYSTEM_SUFFIX;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    const response = await callGeminiWithRetry(geminiUrl, {
      system_instruction: {
        parts: [{ text: fullSystemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.5,
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
