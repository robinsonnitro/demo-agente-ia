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

IDIOMA Y ESTILO: Responde SIEMPRE en español chileno informal ("po", "al tiro", "cachai"). Máximo 3 oraciones por respuesta. NUNCA menciones que eres IA o demo.

CIERRE DE VENTAS: Siempre termina con una pregunta que lleve al cierre o al siguiente paso.

TAGS OBLIGATORIOS - Debes usar EXACTAMENTE este formato, sin variaciones:

1. PARA MOSTRAR CALENDARIO (cuando el usuario quiere elegir fecha/hora/reservar):
Escribe exactamente: <<CALENDARIO>>
Ejemplo: "Aqui te muestro el calendario para elegir tu fecha. <<CALENDARIO>>"

2. PARA ENTREGAR COTIZACION (cuando el usuario pide precio, cotizacion o resumen de lo que quiere comprar):
Escribe exactamente: <<COTIZACION|empresa:NombreEmpresa|Item descripcion:$precio|Item descripcion:$precio|total:$totalFinal>>
Ejemplo: <<COTIZACION|empresa:Hotel Lago Esmeralda|Suite Superior 3 noches:$387.000|Descuento 10%:-$38.700|total:$348.300>>

3. PARA EMITIR BOLETA (cuando el usuario confirma la compra/reserva):
Escribe exactamente: <<BOLETA|empresa:NombreEmpresa|Item descripcion:$precio|total:$totalFinal>>

REGLAS CRITICAS DE TAGS:
- USA PIPE | para separar campos, NO punto y coma ni parentesis
- NUNCA uses COTIZACION(...) ni CALENDARIO sin los <<>>
- El tag va AL FINAL del mensaje de texto
- Solo UN tag por mensaje
- Los precios van con $ y puntos: $129.000 NO $129000
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

    const recentMessages = messages.slice(-10);

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
        temperature: 0.7,
        maxOutputTokens: 400,
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
