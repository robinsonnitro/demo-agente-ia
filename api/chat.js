// api/chat.js — Vercel Serverless Function (Gemini 2.5 Flash - GRATIS)
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, systemPrompt } = req.body;
  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: "Missing messages or systemPrompt" });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  try {
    const fullSystemPrompt = systemPrompt +
      "\n\nIMPORTANTE: Responde siempre en español, conciso (2-3 oraciones). " +
      "Natural como WhatsApp. Emojis ocasionales. Nunca digas que eres IA o demo.";

    const contents = messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const body = {
      system_instruction: { parts: [{ text: fullSystemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Gemini error:", JSON.stringify(data.error));
      return res.status(500).json({ error: data.error.message || "Gemini API error", detail: data.error });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Disculpa, no pude procesar tu consulta.";

    return res.status(200).json({ text });
  } catch (error) {
    console.error("Server error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
