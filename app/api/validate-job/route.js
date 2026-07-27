import OpenAI from 'openai';

export async function POST(request) {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { jobText } = await request.json();

    if (!jobText || jobText.trim().length < 20) {
      return Response.json({ success: false, error: 'Texto demasiado corto.' }, { status: 400 });
    }

    const response = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `¿Es el siguiente texto una oferta de trabajo/vacante? Responde SOLO con JSON válido: { "isJob": true|false, "confidence": 0-100, "reason": "razón breve" }\n\nTEXTO:\n${jobText.slice(0, 3000)}`,
      }],
    });

    const parsed = JSON.parse(response.choices?.[0]?.message?.content ?? '{}');
    return Response.json({ success: true, ...parsed });
  } catch (err) {
    console.error('validate-job error', err);
    return Response.json({ success: false, error: err.message ?? 'Error interno.' }, { status: 500 });
  }
}