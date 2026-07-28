import OpenAI from 'openai';
import { checkBudget, recordSpend } from '../../../lib/quota';
import { costEUR } from '../../../lib/pricing';

const PROJECT = 'recruitai';
const MODEL = 'gpt-4o-mini'; // scoring: NO se baja de aqui, es la calidad de la demo

const WEIGHTS = {
  integral:    { formacion: 0.20, experiencia: 0.25, conocimientos_tecnicos: 0.40, soft_skills: 0.15 },
  tecnico:     { formacion: 0.10, experiencia: 0.15, conocimientos_tecnicos: 0.60, soft_skills: 0.15 },
  experiencia: { formacion: 0.10, experiencia: 0.50, conocimientos_tecnicos: 0.30, soft_skills: 0.10 },
};

const EXP_SUBFACTOR_WEIGHTS = {
  integral:    { años: 0.50, relevancia: 0.50 },
  tecnico:     { años: 0.30, relevancia: 0.70 },
  experiencia: { años: 0.70, relevancia: 0.30 },
};

const PRECISION_INSTRUCTIONS = {
  flexible:    'Sé generoso. Si el candidato cumple parcialmente un requisito, considera que lo cumple.',
  equilibrado: 'Sé justo y objetivo. Valora el cumplimiento real de cada requisito.',
  estricto:    'Sé muy exigente. Solo puntúa alto si el candidato cumple claramente cada requisito.',
};

const FOCO_INSTRUCTIONS = {
  integral: `Evalúa todas las categorías con igual atención. Ninguna área predomina sobre las demás.`,
  tecnico: `El puesto requiere perfil técnico. En "conocimientos_tecnicos" sé muy riguroso: evalúa cada tecnología y skill técnica mencionada. En "experiencia", prioriza que la experiencia sea técnicamente relevante sobre los años totales.`,
  experiencia: `El puesto valora candidatos con trayectoria. En "experiencia", los años totales de trabajo pesan más que la relevancia sectorial — un candidato con más años debe puntuar más alto aunque su sector no sea idéntico. En "conocimientos_tecnicos" sé más flexible.`,
};

export async function POST(request) {
  try {
    const { jobText, cvText, config = {}, jobSummary } = await request.json();

    if (!jobText || !cvText) {
      return Response.json({ success: false, error: 'Faltan jobText o cvText.' }, { status: 400 });
    }

    // GATE de presupuesto (el gate de IP ya se aplico en pre-summarize).
    const budget = await checkBudget();
    if (!budget.allowed) return Response.json({ success: false, error: 'demo_agotada' }, { status: 503 });

    const foco = config.foco ?? 'integral';
    const precision = config.precision ?? 'equilibrado';
    const weights = WEIGHTS[foco] ?? WEIGHTS.integral;
    const expSplit = EXP_SUBFACTOR_WEIGHTS[foco] ?? EXP_SUBFACTOR_WEIGHTS.integral;
    const precisionNote = PRECISION_INSTRUCTIONS[precision] ?? PRECISION_INSTRUCTIONS.equilibrado;
    const focoNote = FOCO_INSTRUCTIONS[foco] ?? FOCO_INSTRUCTIONS.integral;

    const jobContext = jobSummary ?? jobText.slice(0, 3000);

    const prompt = `Eres un experto en selección de personal. Analiza qué tan bien encaja el CV con la oferta de trabajo.

CRITERIO DE PRECISIÓN: ${precisionNote}

CRITERIO DE FOCO: ${focoNote}

BAREMO DE PUNTUACIÓN — usa estas escalas fijas para cada categoría, no inventes criterios propios:

FORMACIÓN (qué titulación/estudios tiene el candidato vs lo que pide la oferta):
  100 = Tiene exactamente el título requerido o superior, en el campo exacto, con formación adicional relevante (máster, certificaciones).
   80 = Tiene el título requerido o equivalente en campo muy relacionado.
   60 = Tiene título universitario pero en campo diferente, o título inferior al requerido con formación complementaria.
   40 = Formación parcial o en curso, o título muy alejado del requerido.
   20 = Sin formación formal relevante, solo experiencia o cursos sueltos.
    0 = No se menciona ninguna formación.

CONOCIMIENTOS TÉCNICOS (skills, herramientas, tecnologías requeridas en la oferta):
  100 = Cumple el 100% de requisitos obligatorios Y el 100% de los valorados.
   80 = Cumple todos los obligatorios, cumple >60% de los valorados.
   60 = Cumple >75% de los obligatorios, algunos valorados.
   40 = Cumple 50-75% de los obligatorios.
   20 = Cumple <50% de los obligatorios.
    0 = No cumple ningún requisito técnico.

SOFT SKILLS (habilidades blandas mencionadas o evidenciadas en el CV):
  100 = El CV evidencia con ejemplos concretos TODAS las soft skills que pide la oferta.
   80 = Evidencia la mayoría de soft skills requeridas, algunas con ejemplos claros.
   60 = Menciona las soft skills pero sin evidencia clara o ejemplos.
   40 = Menciona algunas soft skills relevantes de forma genérica.
   20 = Apenas hay indicios de soft skills relevantes.
    0 = No hay ninguna mención ni evidencia de soft skills.

OFERTA DE TRABAJO:
${jobContext}

CV DEL CANDIDATO:
${cvText.slice(0, 3000)}

Devuelve SOLO JSON válido con esta estructura exacta:
{
  "match_percentage": <número 0-100 calculado como promedio ponderado: formacion=${Math.round(weights.formacion*100)}%, experiencia=${Math.round(weights.experiencia*100)}%, conocimientos_tecnicos=${Math.round(weights.conocimientos_tecnicos*100)}%, soft_skills=${Math.round(weights.soft_skills*100)}%>,
  "nivel": <"Basico" si match<50, "Medio" si match 50-74, "Avanzado" si match>=75>,
  "resumen": <2-3 frases describiendo al candidato y su encaje con el puesto>,
  "categorias": {
    "formacion": { "score": <0-100 según baremo de formación>, "comentario": <explica qué titulación tiene el candidato y si cubre lo que pide la oferta> },
    "experiencia": {
      "score": <calculado como: años_totales*${expSplit.años} + relevancia*${expSplit.relevancia}>,
      "comentario": <explica brevemente cuántos años tiene el candidato, si cubre lo que pide la oferta, y qué tan relevante es esa experiencia para el puesto>,
      "años_totales": <0-100, valora libremente los años de experiencia del candidato en relación a lo que requiere la oferta>,
      "relevancia": <0-100, valora libremente qué tan aplicable es esa experiencia al puesto concreto>
    },
    "conocimientos_tecnicos": { "score": <0-100 según baremo de conocimientos técnicos>, "comentario": <indica qué requisitos técnicos cumple y cuáles le faltan> },
    "soft_skills": { "score": <0-100 según baremo de soft skills>, "comentario": <indica qué soft skills evidencia el CV y cuáles no aparecen> }
  },
  "skills_match": [<3-6 skills/requisitos que el candidato SÍ cumple>],
  "skills_gap": [<2-5 skills/requisitos que el candidato NO cumple o no se detectan en el CV>]
}`;

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });

    await recordSpend(PROJECT, costEUR(MODEL, response.usage));

    const raw = response.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);

    // Recalculate experiencia score server-side from sub-factors using foco split
    const cats = parsed.categorias ?? {};
    const exp = cats.experiencia ?? {};
    if (exp.años_totales != null && exp.relevancia != null) {
      exp.score = Math.round(exp.años_totales * expSplit.años + exp.relevancia * expSplit.relevancia);
    }

    // Recalculate match_percentage server-side to ensure weights are respected
    const weighted =
      (cats.formacion?.score ?? 0) * weights.formacion +
      (exp.score ?? 0) * weights.experiencia +
      (cats.conocimientos_tecnicos?.score ?? 0) * weights.conocimientos_tecnicos +
      (cats.soft_skills?.score ?? 0) * weights.soft_skills;

    const match_percentage = Math.round(weighted);
    const nivel = match_percentage >= 75 ? 'Avanzado' : match_percentage >= 50 ? 'Medio' : 'Basico';

    return Response.json({
      success: true,
      data: { ...parsed, match_percentage, nivel, exp_split: expSplit },
    });
  } catch (err) {
    console.error('analyze error', err);
    return Response.json({ success: false, error: 'Error interno.' }, { status: 500 });
  }
}