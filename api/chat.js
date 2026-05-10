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

function normalizeText(text = "") {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

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

    if (!messages || !Array.isArray(messages) || !systemPrompt) {
      return res.status(400).json({ error: "Missing messages or systemPrompt" });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    }

    const recentMessages = messages.slice(-12);

    const conversationText = recentMessages
      .map((m) => `${m.role === "assistant" ? "IA" : "CLIENTE"}: ${m.content}`)
      .join("\n");

    const norm = normalizeText(conversationText);

    const wantsQuote =
      norm.includes("cotizacion") ||
      norm.includes("cotizar") ||
      norm.includes("presupuesto") ||
      norm.includes("dame la cotizacion") ||
      norm.includes("me das cotizacion") ||
      norm.includes("cuanto sale") ||
      norm.includes("cuanto cuesta");

    const wantsCalendar =
      norm.includes("agendar") ||
      norm.includes("agenda") ||
      norm.includes("reservar") ||
      norm.includes("reserva") ||
      norm.includes("disponibilidad") ||
      norm.includes("quiero una hora") ||
      norm.includes("quiero reservar");

    const wantsReceipt =
      norm.includes("boleta") ||
      norm.includes("comprobante") ||
      norm.includes("pagar") ||
      norm.includes("pago");

    const strictFormatRules = `
RESPONDE SIEMPRE EN ESPAÑOL CHILENO.

REGLAS CRITICAS DE ESTA DEMO:
- No repitas preguntas ya respondidas por el cliente.
- Si ya tienes datos suficientes, avanza.
- No uses markdown.
- No uses **asteriscos**.
- No uses tablas.
- No uses bloques de código.
- No expliques etiquetas especiales.

FORMATO OBLIGATORIO PARA ACTIVAR LA INTERFAZ:

A) Si el cliente quiere cotización, presupuesto o precio final, y ya hay datos suficientes, responde con:
COTIZACION(empresa: NOMBRE EMPRESA; item: DESCRIPCION 1 - $PRECIO; item: DESCRIPCION 2 - $PRECIO; total: $TOTAL)

B) Si el cliente quiere agendar, reservar o ver disponibilidad y corresponde mostrar fechas/horas, responde con:
CALENDARIO

C) Si el cliente pide boleta, comprobante o ya confirmó el pago, responde con:
BOLETA(empresa: NOMBRE EMPRESA; item: DESCRIPCION 1 - $PRECIO; item: DESCRIPCION 2 - $PRECIO; total: $TOTAL)

REGLAS DE NEGOCIO:
- Si el cliente ya dijo fechas y cantidad de personas, no vuelvas a pedirlas.
- Si en hotelería el cliente pide cotización y ya dijo fechas y personas, calcula las noches y ofrece una habitación lógica.
- Para 3 personas en hotel, prioriza Suite Familiar o Suite Premium.
- Si falta un detalle menor, asume la opción más razonable y avanza.
- Primero puedes escribir una frase breve y luego la etiqueta especial en una línea aparte.

EJEMPLOS VALIDOS:
Perfecto, te dejo la cotización estimada.
COTIZACION(empresa: Hotel Lago Esmeralda; item: Suite Familiar 3 noches - $477.000; item: Descuento estadía 3 noches - -$47.700; total: $429.300)

Perfecto, te muestro horarios disponibles.
CALENDARIO

Claro, te dejo la boleta demo.
BOLETA(empresa: Hotel Lago Esmeralda; item: Reserva Suite Familiar 3 noches - $429.300; total: $429.300)
`;

    let dynamicInstruction = "";

    if (wantsReceipt) {
      dynamicInstruction = `
EL CLIENTE ESTA PIDIENDO BOLETA O PAGO.
Si existen datos suficientes, emite BOLETA(...) obligatoriamente.
`;
    } else if (wantsQuote) {
      dynamicInstruction = `
EL CLIENTE ESTA PIDIENDO UNA COTIZACION.
Si en el historial ya existen fechas, noches aproximables y cantidad de personas, emite COTIZACION(...) obligatoriamente.
No vuelvas a preguntar lo mismo si ya aparece en el historial.
`;
    } else if (wantsCalendar) {
      dynamicInstruction = `
EL CLIENTE ESTA PIDIENDO RESERVA, AGENDA O DISPONIBILIDAD.
Si corresponde mostrar selección de fecha u hora, responde con CALENDARIO.
Si ya hay suficientes datos para cotizar, cotiza en vez de preguntar de nuevo.
`;
    }

    const fullSystemPrompt = `
${systemPrompt}

${strictFormatRules}

${dynamicInstruction}
`.trim();

    const contents = recentMessages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    const response = await callGeminiWithRetry(geminiUrl, {
      system_instruction: {
        parts: [{ text: fullSystemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 420,
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

    let text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "Perdón, tuve un problema para responder. ¿Me repites tu solicitud?";

    text = text.replace(/\*\*/g, "").trim();

    return res.status(200).json({ text });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({
      error: error.message || "Error interno del servidor",
    });
  }
}
