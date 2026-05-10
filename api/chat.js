// api/chat.js — Vercel Serverless Function (Gemini Flash - GRATIS)
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, systemPrompt } = req.body || {};

  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: "Missing messages or systemPrompt" });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  try {
    const contents = [];

    const fullSystemPrompt =
      systemPrompt +
      "\n\nINSTRUCCIONES GENERALES:" +
      "\n- Responde SIEMPRE en español chileno natural, como en WhatsApp." +
      "\n- Máximo 3-4 oraciones por respuesta. Conciso pero informativo." +
      "\n- Usa emojis con moderación (1-2 por mensaje máximo)." +
      "\n- NUNCA digas que eres IA, demo, modelo de lenguaje o asistente virtual." +
      "\n- SIEMPRE intenta avanzar hacia el cierre: agendar, reservar, cotizar o vender." +
      "\n- Si dan objeciones de precio, ofrece facilidades de pago o alternativas." +
      "\n- Si dudan, ofrece algo sin compromiso (consulta gratis, cotización, cancelación flexible)." +
      "\n- Pregunta datos concretos para cerrar: fecha, hora, nombre, número de personas." +
      "\n- Sé cálido y profesional. Usa el nombre del cliente si lo menciona." +
      "\n\nFUNCIONES ESPECIALES - TAGS INTERACTIVOS:" +
      "\nPuedes generar documentos y calendarios usando estos tags especiales en tu respuesta:" +
      "\n" +
      "\n1. COTIZACIÓN: Cuando el cliente pide una cotización, presupuesto o quiere saber el costo total de algo, incluye:" +
      '\n<COTIZACION>{"items":[{"concepto":"Habitación doble","cantidad":2,"precio":85000}],"total":170000}</COTIZACION>' +
      '\nEjemplo: <COTIZACION>{"items":[{"concepto":"Tour volcanes","cantidad":2,"precio":45000}],"total":90000}</COTIZACION>' +
      "\n" +
      "\n2. CALENDARIO: Cuando el cliente quiere agendar, reservar fecha o pide disponibilidad, incluye:" +
      '\n<CALENDARIO>{"tipo":"reserva","titulo":"Reserva Hotel Lago Esmeralda"}</CALENDARIO>' +
      "\nEsto muestra un calendario interactivo donde el cliente selecciona fecha y hora." +
      "\n" +
      "\n3. BOLETA: Cuando el cliente confirma una compra/reserva/contratación, incluye:" +
      '\n<BOLETA>{"cliente":"Juan Pérez","detalle":"Reserva habitación doble","total":85000}</BOLETA>' +
      '\nEjemplo: <BOLETA>{"cliente":"María González","detalle":"Tour + traslado","total":120000}</BOLETA>' +
      "\n" +
      "\nREGLAS DE USO DE TAGS:" +
      "\n- Usa COTIZACION cuando: pidan precio, presupuesto, cotización, o pregunten cuánto cuesta algo con múltiples items." +
      "\n- Usa CALENDARIO cuando: quieran agendar, reservar, pidan disponibilidad de fecha/hora, o digan 'quiero una hora'." +
      "\n- Usa BOLETA cuando: confirmen que quieren proceder, digan 'sí confirmo', 'dale', 'reservo', o acepten la cotización." +
      "\n- Pon el tag DESPUÉS de tu texto, no antes. Primero escribe tu mensaje normal, luego el tag." +
      "\n- Solo usa UN tag por mensaje." +
      "\n- Los precios deben ser en pesos chilenos con formato $XX.XXX";

    messages.forEach((msg) => {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: fullSystemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
            topP: 0.9,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok || data.error) {
      console.error("Gemini API error:", data);
      return res.status(500).json({
        error: data?.error?.message || "Gemini API error",
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Disculpa, no pude procesar tu consulta. ¿Puedes intentar de nuevo?";

    return res.status(200).json({ text });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
