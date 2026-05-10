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

function hasAny(text, phrases = []) {
  return phrases.some((p) => text.includes(p));
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
    const lastUserMessage = normalizeText(
      [...recentMessages].reverse().find((m) => m.role === "user")?.content || ""
    );

    const wantsQuote =
      hasAny(norm, [
        "cotizacion",
        "cotizar",
        "presupuesto",
        "dame la cotizacion",
        "me das cotizacion",
        "cuanto sale",
        "cuanto cuesta",
        "precio total",
        "valor total",
      ]) || hasAny(lastUserMessage, [
        "cotizacion",
        "cotizar",
        "presupuesto",
        "dame la cotizacion",
        "me das cotizacion",
      ]);

    const wantsCalendar =
      hasAny(norm, [
        "agendar",
        "agenda",
        "reservar",
        "reserva",
        "disponibilidad",
        "quiero una hora",
        "quiero reservar",
        "agendame",
        "muestrame horarios",
        "muéstrame horarios",
      ]) || hasAny(lastUserMessage, [
        "agendar",
        "reservar",
        "disponibilidad",
        "muestrame horarios",
        "muéstrame horarios",
      ]);

    const wantsReceipt =
      hasAny(norm, [
        "boleta",
        "comprobante",
        "pagar",
        "pago",
        "ya pague",
        "ya pagué",
        "confirmar compra",
      ]) || hasAny(lastUserMessage, [
        "boleta",
        "comprobante",
        "pagar",
        "pago",
      ]);

    const strictFormatRules = `
RESPONDE SIEMPRE EN ESPAÑOL CHILENO, BREVE, NATURAL Y COMERCIAL.

REGLAS CRITICAS:
- No repitas preguntas que el cliente ya respondió.
- Si ya tienes suficientes datos, avanza sin pedir lo mismo otra vez.
- No uses markdown.
- No uses asteriscos.
- No uses tablas.
- No uses bloques de código.
- No expliques las etiquetas especiales.
- No cortes frases a la mitad.
- Si el cliente responde "si", "sí", "dale", "ok", "perfecto", interpreta eso como confirmación para avanzar.

FORMATO OBLIGATORIO DE SALIDA PARA ACTIVAR LA INTERFAZ:

1) COTIZACION
Si el cliente pide cotización, presupuesto o precio final, y ya hay suficientes datos, responde con una frase breve y luego en una línea aparte:
COTIZACION(empresa: NOMBRE EMPRESA; item: DESCRIPCION 1 - $PRECIO; item: DESCRIPCION 2 - $PRECIO; total: $TOTAL)

2) CALENDARIO
Si el cliente quiere reservar, agendar o ver horarios/fechas disponibles, y corresponde mostrar selección de fecha u hora, responde con una frase breve y luego en una línea aparte:
CALENDARIO

3) BOLETA
Si el cliente pide boleta, comprobante o ya confirmó pago/compra, responde con una frase breve y luego en una línea aparte:
BOLETA(empresa: NOMBRE EMPRESA; item: DESCRIPCION 1 - $PRECIO; item: DESCRIPCION 2 - $PRECIO; total: $TOTAL)

REGLAS DE AVANCE:
- Si el cliente ya dijo fechas y cantidad de personas, no vuelvas a pedirlas.
- Si ya hay contexto suficiente para una propuesta razonable, genera la cotización.
- Si falta solo un detalle menor, asume la opción más lógica y avanza.
- En hotelería, si son 3 personas y no especifican habitación, prioriza Suite Familiar. Si no aplica, Suite Premium.
- En hotelería, si el cliente da rango de fechas, calcula las noches de forma lógica.
- En clínica, restaurante, automotriz, abogados, ecommerce, gym e inmobiliaria, cuando pidan cotización, entrega una propuesta concreta.
- Si solo preguntan por precio de un producto o servicio puntual, responde ese precio de forma directa.
- Si después de eso piden cotización formal, ahí sí usa COTIZACION(...).

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
INTENCION DETECTADA: el cliente quiere boleta, comprobante o pago.
Si hay datos suficientes, debes emitir BOLETA(...) en esta respuesta.
`;
    } else if (wantsQuote) {
      dynamicInstruction = `
INTENCION DETECTADA: el cliente quiere cotización o presupuesto.
Si en el historial ya hay suficientes datos, debes emitir COTIZACION(...) en esta respuesta.
No vuelvas a pedir fechas o personas si ya aparecen en el historial.
`;
    } else if (wantsCalendar) {
      dynamicInstruction = `
INTENCION DETECTADA: el cliente quiere reservar, agendar o ver disponibilidad.
Si corresponde mostrar selección de fecha u hora, debes responder con CALENDARIO.
Si ya hay suficientes datos para cotizar, cotiza en vez de preguntar otra vez.
`;
    } else {
      dynamicInstruction = `
Si el cliente solo hace una consulta simple de precio, responde directo.
Si luego pide cotización formal, usa COTIZACION(...).
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

    const geminiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    const response = await callGeminiWithRetry(geminiUrl, {
      system_instruction: {
        parts: [{ text: fullSystemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.3,
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
