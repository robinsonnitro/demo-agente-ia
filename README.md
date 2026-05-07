# Demo Agente IA — AgenciaComercial.ai

Chat demo con IA real donde los clientes prueban un agente para su rubro antes de contratar.
Usa **Google Gemini Flash 2.0** (gratis: 1.500 requests/día).

## Estructura

```
demo-vercel/
├── api/
│   └── chat.js          ← Serverless function (llama a Gemini)
├── public/
│   └── index.html       ← Frontend del chat
├── vercel.json          ← Config de Vercel
├── package.json
└── README.md
```

## Setup en 5 minutos

### 1. Obtener API Key de Gemini (gratis)

1. Ir a https://aistudio.google.com/apikey
2. Click en "Create API Key"
3. Copiar la key generada

### 2. Deploy a Vercel

**Opción A — Desde GitHub:**
1. Subir esta carpeta a un repo en GitHub
2. Ir a https://vercel.com/new
3. Importar el repo
4. En "Environment Variables" agregar:
   - `GEMINI_API_KEY` = tu key de Google
5. Click en Deploy

**Opción B — Desde la terminal:**
```bash
npm i -g vercel
cd demo-vercel
vercel --prod
# Cuando pregunte por env vars, agregar GEMINI_API_KEY
```

### 3. Listo

Tu demo estará en algo como: `https://demo-agente-ia.vercel.app`

## Integrar en agenciacomercial.ai

Para embeber el demo en tu web principal, agrega un iframe o un link:

```html
<!-- Como iframe embebido -->
<iframe src="https://demo-agente-ia.vercel.app" 
        width="100%" height="700px" 
        style="border:none;border-radius:24px" />

<!-- O como botón que abre en nueva pestaña -->
<a href="https://demo-agente-ia.vercel.app" target="_blank">
  Probar Demo Gratis →
</a>
```

## Costos

- **Gemini Flash 2.0 free tier:** 1.500 requests/día, 15 por minuto
- **Vercel Hobby:** Gratis (100GB bandwidth)
- **Costo total: $0 USD/mes**

## Personalización

- Editar rubros/industrias: en `public/index.html`, array `INDUSTRIES`
- Cambiar prompts: modificar el campo `prompt` de cada industria
- Agregar nuevos rubros: copiar un objeto del array y personalizar
- Cambiar colores: modificar las CSS variables en `:root`
- Cambiar CTA de WhatsApp: buscar el número `56958329265` y reemplazar
