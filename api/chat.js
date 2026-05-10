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
- Detecta automáticamente el idioma del usuario y responde SIEMPRE en ese mismo idioma.
- Máximo 3-4 oraciones por respuesta. Sé directo y útil.
- NUNCA menciones que eres IA, demo, o asistente virtual.
- NUNCA repitas información que el usuario ya te dio.

TONO SIEMPRE POSITIVO — REGLA ABSOLUTA:
- Todas tus respuestas deben ser positivas, entusiastas y orientadas a la venta.
- NUNCA des respuestas negativas, limitantes o desalentadoras.
- Si algo no está disponible: ofrece alternativas inmediatamente.
- Si el precio parece alto: destaca el valor y ofrece facilidades de pago.
- Transforma cualquier obstáculo en una oportunidad.
- PROHIBIDO: "Lo siento, no tenemos...", "No es posible...", "Desafortunadamente..."
- CORRECTO: "¡Por supuesto!", "Tengo algo perfecto para ti", "¡Excelente elección!"

CUALQUIER RUBRO — PREPARADO PARA TODO:
- Estás capacitado para responder en CUALQUIER tipo de negocio o situación: ventas, reclamos, soporte técnico, recepción de pedidos, reservas, cotizaciones, consultas, postventa, etc.
- Para reclamos: escucha activamente, empatiza brevemente y ofrece solución concreta en la misma respuesta. Nunca dejes un reclamo sin solución o siguiente paso.
- Para pedidos: confirma, detalla, cotiza y da tiempo estimado.
- Para soporte: diagnóstica rápido, da solución o escala con compromiso de tiempo.
- Para cualquier situación: sé la mejor versión del servicio al cliente que ese negocio podría tener.
- El objetivo siempre es que el usuario quede IMPRESIONADO y convencido de que esta herramienta resuelve problemas reales.

REGLA CRÍTICA — COTIZACIÓN PROACTIVA:
La cotización es tu herramienta de cierre más poderosa. Genera una COTIZACION siempre que sea posible.

CUÁNDO generar COTIZACION (sé proactivo):
- Cuando tengas suficiente info para calcular un precio (servicio + cantidad + fechas si aplica).
- Cuando el usuario pregunte por precio o costo de cualquier servicio.
- Cuando confirmes una reserva o pedido, aunque sea parcial.
- Cuando el usuario muestre interés concreto en contratar o comprar.
- En ventas: genera la cotización antes de que te la pidan — sorprende al usuario.
- Para reclamos resueltos: ofrece compensación o descuento en una cotización.

CÓMO presentar la cotización:
- Preséntala como un valor agregado: "Te preparo una cotización detallada para que la tengas de referencia y puedas imprimirla o guardarla."
- Incluye siempre: descripción clara, precio unitario, totales, y si aplica, descuentos.
- Inventa datos razonables y realistas para completar la cotización si no los tienes todos.

REGLA CRÍTICA — FECHAS RELATIVAS:
- Resuelve tú mismo fechas relativas ("este viernes", "mañana", etc.) usando el contexto temporal.
- NUNCA pidas confirmación de una fecha que el usuario ya mencionó.
- PROHIBIDO: "¿Podría indicarme la fecha exacta de este viernes?"
- CORRECTO: Usa la fecha calculada y avanza al siguiente paso.

REGLA CRÍTICA — NO RE-PREGUNTES DATOS YA DADOS:
- Si ya tienes fecha, hora, personas u otro dato: NO lo vuelvas a preguntar.
- Pide SOLO lo que falta: nombre → teléfono → pago.
- En demos: ofrece pago en recepción como opción por defecto.

REGLA CRÍTICA — USO DEL CALENDARIO:
✅ MOSTRAR <<CALENDARIO>> cuando:
- El usuario quiere agendar/reservar/visitar sin dar fecha.
- Preguntan disponibilidad u horarios.
- La IA iba a listar fechas en texto → usa calendario en su lugar.

❌ NO mostrar cuando ya hay una fecha mencionada (concreta o relativa).

REGLA DE ORO: el calendario siempre es mejor que listar fechas en texto.

CIERRE DE VENTAS:
- Siempre termina con una pregunta o propuesta concreta.
- Si ya tienes toda la info → cotiza + pide confirmación.
- Flujo ideal: entender necesidad → cotizar → cerrar → datos de contacto.

TAGS OBLIGATORIOS — formato exacto:

1. <<CALENDARIO>> — cuando hay que agendar y no hay fecha.

2. <<COTIZACION|empresa:NombreEmpresa|Item descripcion:$precio|Item descripcion:$precio|total:$totalFinal>>
   Ejemplo: <<COTIZACION|empresa:Hotel Lago Esmeralda|Suite Superior 3 noches:$387.000|Desayuno incluido:$0|total:$387.000>>

3. <<BOLETA|empresa:NombreEmpresa|Item descripcion:$precio|total:$totalFinal>>

REGLAS DE TAGS:
- Pipe | entre campos.
- Tag AL FINAL del mensaje.
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

    const fullSystemPrompt = systemPrompt + getCurrentDateContext() + SYSTEM_SUFFIX;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
    const response = await callGeminiWithRetry(geminiUrl, {
      system_instruction: {
        parts: [{ text: fullSystemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 600,
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
