'use client';

import { useState, useRef, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

const scoreColor = (s) => s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : '#ef4444';
const scoreCls   = (s) => s >= 70 ? 'text-emerald-600' : s >= 40 ? 'text-amber-600' : 'text-rose-600';
const scoreBgCls = (s) => s >= 70 ? 'bg-emerald-50 border-emerald-200' : s >= 40 ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200';
const badgeCls   = (s) => s >= 70 ? 'bg-emerald-100 text-emerald-700' : s >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700';

const cleanCandidateName = (filename = '') => {
  let n = filename
    .replace(/\.pdf$/i, '')
    .replace(/\s*[-_]\s*cv\b/gi, '')
    .replace(/\bcv\s*[-_]\s*/gi, '')
    .replace(/\bcv\b/gi, '')
    .replace(/\b(esp|eng|es|en|cv2|curriculum)\b/gi, '')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\(\d+\)/g, '')
    .replace(/[()[\]{}]/g, '');

  // camelCase → spaces: "AlejandroAparicio" → "Alejandro Aparicio"
  n = n.replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, '$1 $2');

  n = n.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

  // title case preserving accents
  n = n.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

  return n || filename.replace(/\.pdf$/i, '');
};

const normalizeText = (value = '') => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const JOB_TEXT_KEYWORDS = [
  'oferta', 'vacante', 'puesto', 'empleo', 'empresa', 'responsabilidades', 'requisitos',
  'jornada', 'contrato', 'salario', 'beneficios', 'aplicar', 'postular', 'candidato',
  'job', 'job description', 'description', 'role', 'responsibilities', 'requirements',
  'company', 'salary', 'benefits', 'apply', 'candidate', 'business', 'analytics', 'analyst'
];

const CV_TEXT_KEYWORDS = [
  'curriculum', 'cv', 'hoja de vida', 'experiencia', 'formacion', 'educacion', 'estudios',
  'habilidades', 'competencias', 'idiomas', 'perfil', 'resumen profesional', 'referencias',
  'resume', 'work experience', 'education', 'skills', 'summary', 'profile', 'languages'
];

const JOB_FILE_HINTS = ['oferta', 'job', 'vacante', 'puesto', 'descripcion', 'jd', 'position'];
const CV_FILE_HINTS  = ['cv', 'curriculum', 'curriculum vitae', 'resume', 'hoja_de_vida', 'hoja de vida', 'hoja_vida', 'sintesis curricular'];

const containsAnyKeyword = (text, keywords) => {
  const normalized = normalizeText(text);
  return keywords.filter(kw => normalized.includes(normalizeText(kw))).length;
};

const isLikelyJobText = (text) => containsAnyKeyword(text, JOB_TEXT_KEYWORDS) >= 2;
const isLikelyCvText = (text) => containsAnyKeyword(text, CV_TEXT_KEYWORDS) >= 2;

const isCvFilename  = (name) => CV_FILE_HINTS.some(kw => normalizeText(name).includes(normalizeText(kw)));
const isJobFilename = (name) => JOB_FILE_HINTS.some(kw => normalizeText(name).includes(normalizeText(kw)));

const isStrongCvFilename = (name) => {
  const normalized = normalizeText(name);
  return /(\b|_)(cv|resume|curriculum|curriculum vitae|hoja de vida|sintesis curricular)(\b|_)/.test(normalized);
};

// Extractor PDF a nivel de módulo (usable desde UploadView y RecruitAI)
// Opciones: { maxPages } — leer solo primeras N páginas para validacion rapida
const extractPdfText = async (file, { maxPages = 4 } = {}) => {
  if (typeof window === 'undefined') return '';

  // Cargar pdf.js una sola vez y evitar recargas simultaneas
  if (!window.pdfjsLib) {
    if (!window.__pdfJsLoading) {
      window.__pdfJsLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
          try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          } catch (e) {
            // ignore
          }
          resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    await window.__pdfJsLoading;
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const toRead = Math.max(1, Math.min(pdf.numPages, maxPages));
  // Parallelizar carga y extraccion de paginas
  const pagePromises = [];
  for (let i = 1; i <= toRead; i++) pagePromises.push(pdf.getPage(i));
  const pages = await Promise.all(pagePromises);
  const texts = await Promise.all(pages.map(async (page) => {
    const content = await page.getTextContent();
    return content.items.map(item => item.str).join(' ');
  }));

  // Si el pdf tiene mas paginas que las leidas, añadimos un marcador breve
  const more = pdf.numPages > toRead ? `\n...+${pdf.numPages - toRead} paginas omitted...` : '';
  return (texts.join('\n') + more).trim();
};

// ─────────────────────────────────────────────────────────────────────────────
// SVG CHARTS
// ─────────────────────────────────────────────────────────────────────────────

function GaugeChart({ value, width = 220 }) {
  const cx = 100, cy = 100, r = 76, sw = 13;
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const bgD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const angle = Math.PI * (1 - pct / 100);
  const ex = (cx + r * Math.cos(angle)).toFixed(2);
  const ey = (cy - r * Math.sin(angle)).toFixed(2);
  const fgD = pct < 1 ? null : `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;
  const col = scoreColor(pct);
  return (
    <svg viewBox="0 0 200 115" style={{ width }}>
      <path d={bgD} fill="none" stroke="#f1f5f9" strokeWidth={sw} strokeLinecap="round" />
      {fgD && <path d={fgD} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" />}
      <text x="100" y="90" textAnchor="middle" fontSize="38" fontWeight="800" fill={col}
        style={{ fontFamily: 'var(--font-syne)' }}>{pct}</text>
      <text x="100" y="110" textAnchor="middle" fontSize="10" fill="#94a3b8"
        style={{ fontFamily: 'var(--font-dm-sans)' }}>compatibilidad</text>
    </svg>
  );
}

function DonutChart({ data, size = 130 }) {
  const cx = 60, cy = 60, outerR = 52, innerR = 36;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  let a = -Math.PI / 2;
  const paths = data.map((d, i) => {
    const da = (d.value / total) * 2 * Math.PI;
    if (da < 0.01) { a += da; return null; }
    const sa = a, ea = a + da; a = ea;
    const la = da > Math.PI ? 1 : 0;
    const f = (ang) => [(cx + outerR * Math.cos(ang)).toFixed(2), (cy + outerR * Math.sin(ang)).toFixed(2)];
    const fi = (ang) => [(cx + innerR * Math.cos(ang)).toFixed(2), (cy + innerR * Math.sin(ang)).toFixed(2)];
    const [ox1, oy1] = f(sa), [ox2, oy2] = f(ea);
    const [ix1, iy1] = fi(sa), [ix2, iy2] = fi(ea);
    const p = `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${la} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${la} 0 ${ix1} ${iy1} Z`;
    return <path key={i} d={p} fill={d.color} />;
  });
  return (
    <svg viewBox="0 0 120 120" style={{ width: size, height: size }}>
      <circle cx={cx} cy={cy} r={innerR - 2} fill="white" />
      {paths}
    </svg>
  );
}

function HBar({ label, score }) {
  const col = scoreColor(score);
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`text-xs font-bold tabular-nums ${scoreCls(score)}`}>{score}</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: col }} />
      </div>
    </div>
  );
}

function MiniGauge({ value, size = 56 }) {
  const cx = 50, cy = 50, r = 38, sw = 8;
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const bgD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const angle = Math.PI * (1 - pct / 100);
  const ex = (cx + r * Math.cos(angle)).toFixed(2);
  const ey = (cy - r * Math.sin(angle)).toFixed(2);
  const fgD = pct < 1 ? null : `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`;
  const col = scoreColor(pct);
  return (
    <svg viewBox="0 0 100 60" style={{ width: size }}>
      <path d={bgD} fill="none" stroke="#f1f5f9" strokeWidth={sw} strokeLinecap="round" />
      {fgD && <path d={fgD} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round" />}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLTIP
// ─────────────────────────────────────────────────────────────────────────────

function Tooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center ml-1">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(v => !v)}
        className="w-4 h-4 rounded-full border border-slate-300 text-slate-400 text-[10px] font-bold flex items-center justify-center hover:border-blue-400 hover:text-blue-500 transition-colors flex-shrink-0"
        type="button"
      >?</button>
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 leading-relaxed shadow-xl z-50 pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
        </span>
      )}
    </span>
  );
}

function ErrorModal({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4 z-10">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-display font-bold text-slate-900 text-lg">Error</p>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">{message}</p>
            <div className="mt-5 flex justify-end">
              <button onClick={onClose} className="py-2 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingModal({ message }) {
  if (!message) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 z-10">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <div>
            <p className="font-display font-bold text-slate-900 text-lg">Validando</p>
            <p className="text-sm text-slate-600 mt-1">{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG PANEL
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = { precision: 'equilibrado', foco: 'integral', topN: 3, umbralMinimo: 40, modoEstricto: false };

function ConfigPanel({ config, onChange }) {
  const set = (k, v) => onChange({ ...config, [k]: v });
  const Btn = ({ active, onClick, children }) => (
    <button onClick={onClick} type="button"
      className={`py-2 text-xs font-semibold rounded-lg border transition-all ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}>
      {children}
    </button>
  );
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center mb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nivel de analisis</p>
          <Tooltip text="Determina cuanto detalle incluye el informe. Rapido es mas breve; Profundo analiza cada punto con referencias directas al CV." />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[['rapido','Rapido'],['equilibrado','Equilibrado'],['profundo','Profundo']].map(([k,l]) => (
            <Btn key={k} active={config.precision === k} onClick={() => set('precision', k)}>{l}</Btn>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center mb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Enfoque de evaluacion</p>
          <Tooltip text="Define que area pesa mas en la puntuacion final. Tecnico prioriza skills; Experiencia prioriza historial laboral; Integral equilibra todas las areas." />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[['tecnico','Tecnico'],['experiencia','Experiencia'],['integral','Integral']].map(([k,l]) => (
            <Btn key={k} active={config.foco === k} onClick={() => set('foco', k)}>{l}</Btn>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center mb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Candidatos a mostrar</p>
          <Tooltip text="Cuando hay varios CVs, cuantos candidatos apareceran en el ranking de resultados." />
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[3, 5, 10, 'Todos'].map((n) => (
            <Btn key={n} active={config.topN === n} onClick={() => set('topN', n)}>
              {n === 'Todos' ? 'Todos' : `Top ${n}`}
            </Btn>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Compatibilidad minima</p>
            <Tooltip text="Candidatos por debajo de este porcentaje no apareceran en el ranking. Util para filtrar perfiles poco adecuados." />
          </div>
          <span className="text-sm font-bold text-blue-600">{config.umbralMinimo}%</span>
        </div>
        <input type="range" min="0" max="90" step="5" value={config.umbralMinimo}
          onChange={(e) => set('umbralMinimo', Number(e.target.value))}
          className="w-full accent-blue-600 cursor-pointer" />
        <div className="flex justify-between text-xs text-slate-400 mt-1"><span>0%</span><span>90%</span></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE GUARD MODAL
// ─────────────────────────────────────────────────────────────────────────────

function LeaveGuard({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 animate-fadeUp">
        <p className="font-display font-bold text-slate-900 text-lg mb-1">Abandonar evaluacion</p>
        <p className="text-sm text-slate-500 mb-6">El analisis se esta ejecutando. Si abandonas ahora se perderan los resultados parciales.</p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            Continuar
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors">
            Abandonar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD VIEW
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CVS = 10;

function UploadView({ onAnalyze, onClientError }) {
  const [jobMode, setJobMode] = useState('pdf');
  const [jobText, setJobText] = useState('');
  const [jobFile, setJobFile] = useState(null);
  const [cvFiles, setCvFiles] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [error, setError] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationMessage, setValidationMessage] = useState(null);
  const [jobDrag, setJobDrag] = useState(false);
  const [cvDrag, setCvDrag] = useState(false);
  const jobInputRef = useRef();
  const cvInputRef = useRef();

  const reportError = (msg) => {
    setError(msg);
    if (typeof onClientError === 'function') onClientError(msg);
  };

  const validateJobTextClient = async (text) => {
    const resp = await fetch('/api/validate-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobText: text }),
    });
    return resp.json();
  };

  const validateCvTextClient = async (text) => {
    const resp = await fetch('/api/validate-cv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cvText: text }),
    });
    return resp.json();
  };

  

  const handleJobFile = async (f) => {
    if (!f) return;
    if (f.type !== 'application/pdf') { reportError('La oferta debe ser un PDF.'); return; }
    if (isCvFilename(f.name)) {
      reportError('Este archivo no es una oferta de trabajo, por favor sube otro.');
      return;
    }
    setValidationMessage('Comprobando palabras clave de la oferta...');
    try {
      const txt = await extractPdfText(f, { maxPages: 4 });
      if (!isLikelyJobText(txt)) {
        reportError('Este archivo no es una oferta de trabajo, por favor sube otro.');
        return;
      }
      setValidationMessage('Validando oferta con IA...');
      const v = await validateJobTextClient(txt);
      if (!v.success) { reportError(v.error || 'Error al validar la oferta.'); return; }
      if (!v.isJob) {
        reportError('Este archivo no es una oferta de trabajo, por favor sube otro.');
        return;
      }
      setJobFile(f);
      setJobText(txt);
      reportError(null);
    } catch (err) {
      console.error('handleJobFile error', err);
      reportError('Error al leer o validar el PDF de la oferta.');
    } finally {
      setValidationMessage(null);
    }
  };

  const handleCvFiles = async (files) => {
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf');
    if (pdfs.length === 0) { reportError('Solo se aceptan archivos PDF.'); return; }
    const rejected = pdfs.filter(f => isJobFilename(f.name));
    if (rejected.length > 0) {
      reportError('Este archivo no es un CV, por favor sube otro.');
      return;
    }
    setValidationMessage(pdfs.length === 1 ? `Comprobando palabras clave del CV: ${pdfs[0].name}...` : `Comprobando palabras clave de ${pdfs.length} CVs...`);
    try {
      const accepted = [];
      for (const f of pdfs) {
        if (cvFiles.some(existing => existing.name === f.name)) continue;
        if (isStrongCvFilename(f.name)) {
          accepted.push(f);
          continue;
        }

        setValidationMessage(`Validando CV con IA: ${f.name}...`);
        const txt = await extractPdfText(f, { maxPages: 4 });
        if (!isLikelyCvText(txt)) {
          reportError('Este archivo no es un CV, por favor sube otro.');
          continue;
        }
        const v = await validateCvTextClient(txt);
        if (!v.success) { reportError(v.error || `No se pudo validar ${f.name}`); continue; }
        if (!v.isCv) {
          reportError('Este archivo no es un CV, por favor sube otro.');
          continue;
        }
        accepted.push(f);
      }
      if (accepted.length === 0) return;
      setCvFiles(prev => {
        const combined = [...prev, ...accepted];
        if (combined.length > MAX_CVS) {
          reportError(`Maximo ${MAX_CVS} CVs por evaluacion.`);
          return combined.slice(0, MAX_CVS);
        }
        reportError(null);
        return combined;
      });
    } catch (err) {
      console.error('handleCvFiles error', err);
      reportError('Error al leer o validar uno o mas CVs.');
    } finally {
      setValidationMessage(null);
    }
  };

  const removeCv = (name) => setCvFiles(prev => prev.filter(f => f.name !== name));

  const handleSubmit = () => {
    reportError(null);
    const hasJob = jobMode === 'pdf' ? !!jobFile : jobText.trim().length > 20;
    if (!hasJob) { reportError('Sube la oferta de trabajo o pega el texto (minimo 20 caracteres).'); return; }
    if (cvFiles.length === 0) { reportError('Sube al menos un CV en PDF.'); return; }
    setSubmitting(true);
    onAnalyze({ jobMode, jobText, jobFile, cvFiles, config }).finally(() => setSubmitting(false));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 sm:py-14 space-y-8">
      <LoadingModal message={validationMessage} />
      <div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl text-slate-900 leading-tight">Nueva evaluacion</h1>
        <p className="text-slate-400 mt-1.5 text-sm">Sube la oferta y los CVs para comenzar el analisis</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-5">
          {/* Oferta */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="font-display font-bold text-slate-900 text-sm">Oferta de trabajo</p>
                <p className="text-xs text-slate-400 mt-0.5">Una oferta por evaluacion</p>
              </div>
              <div className="flex gap-1">
                {[['pdf','PDF'],['text','Texto']].map(([k,l]) => (
                  <button key={k} type="button" onClick={() => { setJobMode(k); setJobFile(null); setJobText(''); }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${jobMode === k ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-700'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              {jobMode === 'pdf' ? (
                <div
                  onDrop={(e) => { e.preventDefault(); setJobDrag(false); void handleJobFile(e.dataTransfer.files[0]); }}
                  onDragOver={(e) => { e.preventDefault(); setJobDrag(true); }}
                  onDragLeave={() => setJobDrag(false)}
                  onClick={() => jobInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                    jobDrag ? 'border-blue-400 bg-blue-50' :
                    jobFile ? 'border-emerald-400 bg-emerald-50' :
                    'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}>
                  <input ref={jobInputRef} type="file" accept="application/pdf" className="hidden"
                    onChange={(e) => void handleJobFile(e.target.files?.[0])} />
                  {jobFile ? (
                    <div>
                      <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                        <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-emerald-700 truncate max-w-[220px] mx-auto">{jobFile.name}</p>
                      <p className="text-xs text-emerald-500 mt-0.5">Haz clic para cambiar</p>
                    </div>
                  ) : (
                    <div>
                      <svg className="w-8 h-8 text-slate-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      <p className="text-sm font-medium text-slate-600">Arrastra la oferta aqui</p>
                      <p className="text-xs text-slate-400 mt-0.5">o haz clic para seleccionar PDF</p>
                    </div>
                  )}
                </div>
              ) : (
                <textarea value={jobText} onChange={(e) => setJobText(e.target.value)}
                  placeholder="Pega aqui el texto completo de la oferta de trabajo — puesto, requisitos, descripcion..."
                  className="w-full h-36 resize-none text-sm text-slate-700 placeholder-slate-300 border border-slate-200 rounded-xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent leading-relaxed" />
              )}
            </div>
          </div>

          {/* CVs */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="font-display font-bold text-slate-900 text-sm">Candidatos</p>
                <p className="text-xs text-slate-400 mt-0.5">Maximo {MAX_CVS} CVs por evaluacion</p>
              </div>
              {cvFiles.length > 0 && (
                <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full">
                  {cvFiles.length}/{MAX_CVS}
                </span>
              )}
            </div>
            <div className="p-5 space-y-3">
              {cvFiles.length < MAX_CVS && (
                <div
                  onDrop={(e) => { e.preventDefault(); setCvDrag(false); void handleCvFiles(e.dataTransfer.files); }}
                  onDragOver={(e) => { e.preventDefault(); setCvDrag(true); }}
                  onDragLeave={() => setCvDrag(false)}
                  onClick={() => cvInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    cvDrag ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}>
                  <input ref={cvInputRef} type="file" accept="application/pdf" multiple className="hidden"
                    onChange={(e) => void handleCvFiles(e.target.files)} />
                  <svg className="w-7 h-7 text-slate-300 mx-auto mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-600">Arrastra los CVs aqui</p>
                  <p className="text-xs text-slate-400 mt-0.5">Multiples PDFs — max {MAX_CVS}</p>
                </div>
              )}
              {cvFiles.length > 0 && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {cvFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                      <svg className="w-4 h-4 text-rose-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-xs text-slate-600 flex-1 truncate">{f.name}</span>
                      <button type="button" onClick={() => removeCv(f.name)} className="text-slate-300 hover:text-rose-500 transition-colors flex-shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button type="button" onClick={handleSubmit} disabled={submitting}
            className="w-full py-4 bg-slate-900 hover:bg-slate-700 disabled:bg-slate-400 text-white font-display font-bold text-base rounded-xl transition-all active:scale-[0.99] shadow-lg shadow-slate-200 flex items-center justify-center gap-2">
            {submitting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Cargando...
              </>
            ) : (
              <>
                Iniciar evaluacion
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </div>

        {/* Config */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <button type="button" onClick={() => setShowConfig(!showConfig)}
              className="w-full px-5 py-4 flex items-center justify-between text-left lg:cursor-default">
              <div>
                <p className="font-display font-bold text-slate-900 text-sm">Configuracion</p>
                <p className="text-xs text-slate-400 mt-0.5">Ajusta los parametros del analisis</p>
              </div>
              <svg className={`w-4 h-4 text-slate-400 transition-transform lg:hidden ${showConfig ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className={`border-t border-slate-100 p-5 ${showConfig ? 'block' : 'hidden lg:block'}`}>
              <ConfigPanel config={config} onChange={setConfig} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING VIEW — smooth progress
// ─────────────────────────────────────────────────────────────────────────────

function LoadingView({ cvFiles, currentIndex, completed }) {
  const total = cvFiles.length;
  const targetPct = total > 0 ? Math.round((currentIndex / total) * 100) : 0;
  const [displayPct, setDisplayPct] = useState(0);

  useEffect(() => {
    if (displayPct === targetPct) return;
    const step = targetPct > displayPct ? 1 : -1;
    const timer = setInterval(() => {
      setDisplayPct(prev => {
        if (prev === targetPct) { clearInterval(timer); return prev; }
        return prev + step;
      });
    }, 18);
    return () => clearInterval(timer);
  }, [targetPct]);

  return (
    <div className="max-w-lg mx-auto px-4 py-20 flex flex-col items-center">
      <div className="w-full">
        <p className="font-display font-bold text-2xl text-slate-900 mb-1">Evaluando candidatos</p>
        <p className="text-slate-400 text-sm mb-8">
          {currentIndex < total ? `Procesando ${currentIndex + 1} de ${total}` : 'Finalizando...'}
        </p>
        <div className="bg-slate-100 rounded-full h-1.5 mb-1.5 overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full transition-none" style={{ width: `${displayPct}%` }} />
        </div>
        <p className="text-xs text-slate-400 tabular-nums text-right mb-8">{displayPct}%</p>
        <div className="space-y-2">
          {cvFiles.map((f, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                active ? 'bg-blue-50 border-blue-200' : done ? 'bg-white border-slate-200' : 'bg-slate-50 border-transparent'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${
                  done ? 'bg-emerald-100 text-emerald-600' :
                  active ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-400'}`}>
                  {done ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : i + 1}
                </div>
                <span className={`text-sm flex-1 truncate ${active ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
                  {f.name}
                </span>
                {active && (
                  <svg className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CANDIDATE DETAIL
// ─────────────────────────────────────────────────────────────────────────────

const CAT_LABELS = { formacion: 'Formacion', experiencia: 'Experiencia', conocimientos_tecnicos: 'Conocimientos tecnicos', soft_skills: 'Soft skills' };
const CAT_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'];

const IQ_LABELS = {
  habilidades: { label: 'Habilidades técnicas', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  experiencia: { label: 'Experiencia', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  soft_skills: { label: 'Soft skills', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
};

function InterviewQuestionsPanel({ candidateName, result, jobSummary, onGenerated }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error
  const [preguntas, setPreguntas] = useState(null);

  const generate = async () => {
    setState('loading');
    try {
      const resp = await fetch('/api/interview-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName,
          resumen: result.resumen,
          skills_gap: result.skills_gap,
          categorias: result.categorias,
          jobSummary,
        }),
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.error);
      setPreguntas(json.preguntas);
      onGenerated?.(json.preguntas);
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-display font-semibold text-slate-900 text-sm">Preguntas para la entrevista</p>
          <p className="text-xs text-slate-400 mt-0.5">Generadas a partir de las habilidades no detectadas en el CV</p>
        </div>
        {state === 'idle' && (
          <button type="button" onClick={generate}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Generar preguntas
          </button>
        )}
        {state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Generando...
          </div>
        )}
        {state === 'error' && (
          <button type="button" onClick={generate} className="text-xs text-rose-500 hover:text-rose-700 underline">
            Error — reintentar
          </button>
        )}
      </div>

      {state === 'done' && preguntas && (
        <div className="space-y-4">
          {Object.entries(preguntas).map(([key, questions]) => {
            if (!questions?.length) return null;
            const meta = IQ_LABELS[key] ?? { label: key, color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' };
            return (
              <div key={key} className={`rounded-xl border p-4 ${meta.bg}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${meta.color}`}>{meta.label}</p>
                <ol className="space-y-2">
                  {questions.map((q, i) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2">
                      <span className={`font-bold flex-shrink-0 ${meta.color}`}>{i + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CandidateDetail({ result, name, onBack, showInterviewQuestions = false, jobSummary = null, onQuestionsGenerated }) {
  const cats = Object.entries(CAT_LABELS).map(([k, l], i) => ({
    label: l, key: k,
    score: result.categorias?.[k]?.score ?? 0,
    comentario: result.categorias?.[k]?.comentario ?? '',
    color: CAT_COLORS[i],
  }));
  const donutData = cats.map(c => ({ label: c.label, value: c.score, color: c.color }));

  return (
    <div className="space-y-6 animate-fadeUp">
      {onBack && (
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-700 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
          </svg>
          Volver al ranking
        </button>
      )}
      <div className={`rounded-2xl border p-6 ${scoreBgCls(result.match_percentage)}`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-shrink-0"><GaugeChart value={result.match_percentage} width={180} /></div>
          <div className="flex-1">
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              {name && <p className="font-display font-bold text-lg text-slate-900">{name}</p>}
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${badgeCls(result.match_percentage)}`}>{result.nivel}</span>
            </div>
            {result.resumen && <p className="text-sm text-slate-600 leading-relaxed">{result.resumen}</p>}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <p className="font-display font-semibold text-slate-900 text-sm mb-4">Distribucion por area</p>
          <div className="flex items-center gap-4">
            <DonutChart data={donutData} size={120} />
            <div className="space-y-2 flex-1">
              {cats.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                  <span className="text-xs text-slate-500 flex-1 truncate">{c.label}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: c.color }}>{c.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <p className="font-display font-semibold text-slate-900 text-sm">Puntuacion por categoria</p>
          {cats.map((c) => <HBar key={c.key} label={c.label} score={c.score} />)}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cats.map((c) => (
          <div key={c.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-700">{c.label}</p>
              <span className={`text-sm font-bold tabular-nums ${scoreCls(c.score)}`}>{c.score}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{c.comentario}</p>
            {c.key === 'experiencia' && result.categorias?.experiencia?.años_totales != null && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                {[
                  { label: 'Años totales', value: result.categorias.experiencia.años_totales, peso: result.exp_split?.años },
                  { label: 'Relevancia al puesto', value: result.categorias.experiencia.relevancia, peso: result.exp_split?.relevancia },
                ].map(({ label, value, peso }) => (
                  <div key={label}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs text-slate-400">
                        {label}
                        {peso != null && <span className="ml-1 text-slate-300">({Math.round(peso * 100)}%)</span>}
                      </span>
                      <span className={`text-xs font-bold tabular-nums ${scoreCls(value)}`}>{value}</span>
                    </div>
                    <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: scoreColor(value) }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {((result.skills_match?.length ?? 0) > 0 || (result.skills_gap?.length ?? 0) > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {result.skills_match?.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs font-semibold text-slate-700 mb-3">Habilidades coincidentes</p>
              <div className="flex flex-wrap gap-1.5">
                {result.skills_match.map((s, i) => (
                  <span key={i} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-full border border-emerald-200">{s}</span>
                ))}
              </div>
            </div>
          )}
          {result.skills_gap?.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs font-semibold text-slate-700 mb-3">Habilidades no detectadas</p>
              <div className="flex flex-wrap gap-1.5">
                {result.skills_gap.map((s, i) => (
                  <span key={i} className="px-2.5 py-1 bg-slate-50 text-slate-500 text-xs font-medium rounded-full border border-slate-200">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {showInterviewQuestions && (
        <InterviewQuestionsPanel
          candidateName={name}
          result={result}
          jobSummary={jobSummary}
          onGenerated={onQuestionsGenerated}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF EXPORT
// ─────────────────────────────────────────────────────────────────────────────

async function generatePDF(candidates, config = {}, questionsMap = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, MARGIN = 16, CONTENT = W - MARGIN * 2;
  let y = 0;

  const scoreRGB = (s) => s >= 70 ? [16, 185, 129] : s >= 40 ? [245, 158, 11] : [239, 68, 68];

  const checkPage = (needed = 10) => {
    if (y + needed > 275) { doc.addPage(); y = MARGIN; }
  };

  const text = (str, x, size = 10, style = 'normal', color = [30, 30, 30]) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    doc.setTextColor(...color);
    doc.text(String(str ?? ''), x, y);
  };

  const wrappedText = (str, x, maxW, size = 9, color = [100, 100, 100]) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(str ?? ''), maxW);
    lines.forEach((line) => { checkPage(5); doc.text(line, x, y); y += 4.5; });
  };

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 28, 'F');
  y = 11;
  text('RecruitAI', MARGIN, 16, 'bold', [255, 255, 255]);
  const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184);
  doc.text(dateStr, W - MARGIN, y, { align: 'right' });
  y = 20;
  text('Informe de evaluacion de candidatos', MARGIN, 9, 'normal', [148, 163, 184]);
  y = 34;

  // ── Config summary ────────────────────────────────────────────────────────
  if (config.foco || config.precision) {
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(MARGIN, y - 4, CONTENT, 10, 2, 2, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
    const meta = [
      candidates.length > 1 ? `${candidates.length} candidatos` : null,
      config.foco ? `Foco: ${config.foco}` : null,
      config.precision ? `Precision: ${config.precision}` : null,
      config.umbralMinimo != null ? `Umbral: ${config.umbralMinimo}%` : null,
    ].filter(Boolean).join('   ·   ');
    doc.text(meta, MARGIN + 4, y + 2);
    y += 14;
  }

  // ── Candidates ────────────────────────────────────────────────────────────
  candidates.forEach((c, idx) => {
    const d = c.data;
    const pct = d.match_percentage ?? 0;
    const rgb = scoreRGB(pct);
    const cats = Object.entries(CAT_LABELS);

    checkPage(40);

    // Card header bar
    doc.setFillColor(...rgb, 0.15);
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.rect(MARGIN, y, 3, 22, 'F');

    // Rank + name
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(100, 116, 139);
    doc.text(`#${idx + 1}`, MARGIN + 6, y + 5);
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
    doc.text(c.name ?? 'Candidato', MARGIN + 16, y + 5);

    // Score badge
    doc.setFillColor(...rgb);
    doc.roundedRect(W - MARGIN - 28, y + 1, 28, 9, 2, 2, 'F');
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
    doc.text(`${pct}%`, W - MARGIN - 14, y + 7, { align: 'center' });

    // Nivel
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...rgb);
    doc.text(d.nivel ?? '', MARGIN + 16, y + 12);

    y += 26;

    // Resumen
    if (d.resumen) {
      checkPage(12);
      wrappedText(d.resumen, MARGIN, CONTENT, 9, [71, 85, 105]);
      y += 2;
    }

    // Category scores
    checkPage(30);
    const barW = (CONTENT - 6) / 2;
    cats.forEach(([k, label], i) => {
      const score = d.categorias?.[k]?.score ?? 0;
      const brgb = scoreRGB(score);
      const col = i % 2 === 0 ? MARGIN : MARGIN + barW + 6;
      if (i % 2 === 0 && i > 0) y += 10;
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
      doc.text(label, col, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...brgb);
      doc.text(`${score}`, col + barW - 8, y);
      doc.setFillColor(226, 232, 240); doc.roundedRect(col, y + 1.5, barW - 10, 2.5, 1, 1, 'F');
      doc.setFillColor(...brgb); doc.roundedRect(col, y + 1.5, Math.max(1, (barW - 10) * score / 100), 2.5, 1, 1, 'F');
    });
    y += 12;

    // Skills match / gap
    const hasSkills = (d.skills_match?.length ?? 0) + (d.skills_gap?.length ?? 0) > 0;
    if (hasSkills) {
      checkPage(16);
      if (d.skills_match?.length > 0) {
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(16, 185, 129);
        doc.text('Habilidades coincidentes:', MARGIN, y); y += 4;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105);
        doc.text(d.skills_match.join('  ·  '), MARGIN, y); y += 5;
      }
      if (d.skills_gap?.length > 0) {
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(100, 116, 139);
        doc.text('No detectadas:', MARGIN, y); y += 4;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184);
        doc.text(d.skills_gap.join('  ·  '), MARGIN, y); y += 5;
      }
      y += 2;
    }

    // Puntos fuertes / areas mejora / recomendaciones
    const sections = [
      { key: 'puntos_fuertes', label: 'Puntos fuertes', color: [16, 185, 129] },
      { key: 'areas_mejora', label: 'Areas de mejora', color: [245, 158, 11] },
      { key: 'recomendaciones', label: 'Recomendaciones', color: [59, 130, 246] },
    ];
    sections.forEach(({ key, label, color }) => {
      const items = d[key] ?? [];
      if (!items.length) return;
      checkPage(8 + items.length * 5);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...color);
      doc.text(label, MARGIN, y); y += 4;
      items.forEach((item) => {
        doc.setFont('helvetica', 'normal'); doc.setTextColor(71, 85, 105); doc.setFontSize(8);
        const lines = doc.splitTextToSize(`— ${item}`, CONTENT - 4);
        lines.forEach((line) => { checkPage(5); doc.text(line, MARGIN + 2, y); y += 4.5; });
      });
      y += 2;
    });

    // Interview questions
    const preguntas = questionsMap[c.name];
    if (preguntas && Object.keys(preguntas).length > 0) {
      const qLabels = { habilidades: 'Habilidades técnicas', experiencia: 'Experiencia', soft_skills: 'Soft skills' };
      const qColors = { habilidades: [59, 130, 246], experiencia: [139, 92, 246], soft_skills: [245, 158, 11] };
      checkPage(16);
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(MARGIN, y - 2, CONTENT, 8, 2, 2, 'F');
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
      doc.text('Preguntas para la entrevista', MARGIN + 4, y + 4);
      y += 12;

      Object.entries(preguntas).forEach(([key, questions]) => {
        if (!questions?.length) return;
        checkPage(10 + questions.length * 8);
        const color = qColors[key] ?? [100, 116, 139];
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...color);
        doc.text(qLabels[key] ?? key, MARGIN, y); y += 5;
        questions.forEach((q, qi) => {
          doc.setFont('helvetica', 'normal'); doc.setTextColor(51, 65, 85); doc.setFontSize(8.5);
          const lines = doc.splitTextToSize(`${qi + 1}. ${q}`, CONTENT - 4);
          lines.forEach((line) => { checkPage(5); doc.text(line, MARGIN + 2, y); y += 5; });
        });
        y += 3;
      });
    }

    // Separator between candidates
    if (idx < candidates.length - 1) {
      checkPage(16);
      doc.setDrawColor(226, 232, 240); doc.line(MARGIN, y, W - MARGIN, y);
      y += 10;
    }
  });

  // Footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(203, 213, 225);
    doc.text('Generado por RecruitAI', MARGIN, 292);
    doc.text(`${p} / ${totalPages}`, W - MARGIN, 292, { align: 'right' });
  }

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const aa = String(now.getFullYear()).slice(2);
  const dateSuffix = `${dd}${mm}${aa}`;
  const nameSlug = (candidates[0].name ?? 'candidato').replace(/\s+/g, '_');
  const filename = `recruitai_${nameSlug}_${dateSuffix}.pdf`;
  doc.save(filename);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS VIEW
// ─────────────────────────────────────────────────────────────────────────────

function ResultsView({ results, config, onReset, jobSummary }) {
  const [selected, setSelected] = useState(null);
  const [questionsMap, setQuestionsMap] = useState({});
  const saveQuestions = (name, q) => setQuestionsMap(prev => ({ ...prev, [name]: q }));
  const topN = config.topN === 'Todos' ? results.length : Math.min(config.topN, results.length);
  const sorted = [...results]
    .sort((a, b) => b.data.match_percentage - a.data.match_percentage)
    .slice(0, topN)
    .filter(r => r.data.match_percentage >= config.umbralMinimo);

  if (results.length === 1) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <p className="font-display font-bold text-2xl text-slate-900">Informe de evaluacion</p>
            <p className="text-slate-400 text-sm mt-0.5">{results[0].name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => generatePDF(results, config, questionsMap)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Exportar PDF
            </button>
            <button type="button" onClick={onReset} className="text-sm text-slate-400 hover:text-slate-700 transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
              </svg>
              Nueva evaluacion
            </button>
          </div>
        </div>
        <CandidateDetail result={results[0].data} name={results[0].name} onBack={null} showInterviewQuestions jobSummary={jobSummary} onQuestionsGenerated={(q) => saveQuestions(results[0].name, q)} />
      </div>
    );
  }

  if (selected !== null) {
    const candidate = sorted[selected];
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <button type="button" onClick={() => setSelected(null)} className="text-sm text-slate-400 hover:text-slate-700 transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            Volver al ranking
          </button>
          <button type="button" onClick={() => generatePDF([candidate], config, questionsMap)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Exportar PDF
          </button>
        </div>
        <CandidateDetail result={candidate.data} name={candidate.name} onBack={null} showInterviewQuestions={selected < 3} jobSummary={jobSummary} onQuestionsGenerated={(q) => saveQuestions(candidate.name, q)} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <p className="font-display font-bold text-2xl text-slate-900">Ranking de candidatos</p>
          <p className="text-slate-400 text-sm mt-0.5">{sorted.length} candidato{sorted.length !== 1 ? 's' : ''} — por encima del {config.umbralMinimo}%</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onReset} className="text-sm text-slate-400 hover:text-slate-700 transition-colors flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            Nueva evaluacion
          </button>
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
          <p className="text-slate-400 font-medium">Ningun candidato supera el umbral del {config.umbralMinimo}%</p>
          <button type="button" onClick={onReset} className="mt-4 text-sm text-blue-600 underline underline-offset-2">Nueva evaluacion</button>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((c, i) => {
            const pct = c.data.match_percentage;
            const cats = Object.entries(CAT_LABELS).map(([k, l]) => ({ label: l, score: c.data.categorias?.[k]?.score ?? 0 }));
            return (
              <button key={i} type="button" onClick={() => setSelected(i)}
                className="w-full bg-white rounded-2xl border border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md transition-all p-5 text-left animate-fadeUp"
                style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-center gap-5 flex-wrap">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-sm flex-shrink-0 ${
                    i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-100 text-slate-600' :
                    i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-50 text-slate-400'}`}>{i + 1}</div>
                  <div className="flex-shrink-0 -mt-1">
                    <MiniGauge value={pct} size={52} />
                    <p className={`text-center text-xs font-bold tabular-nums -mt-1 ${scoreCls(pct)}`}>{pct}%</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <p className="font-display font-semibold text-slate-900 text-sm truncate">{c.name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badgeCls(pct)}`}>{c.data.nivel}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {cats.map(cat => <HBar key={cat.label} label={cat.label} score={cat.score} />)}
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-slate-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────

export default function RecruitAI() {
  const [view, setView] = useState('upload');
  const [results, setResults] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedResults, setCompletedResults] = useState([]);
  const [activeConfig, setActiveConfig] = useState(DEFAULT_CONFIG);
  const [activeCvFiles, setActiveCvFiles] = useState([]);
  const [activeJobSummary, setActiveJobSummary] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);
  const [leaveTarget, setLeaveTarget] = useState(null); // pending navigation when analyzing

  const navigateSafe = (target) => {
    if (view === 'analyzing') { setLeaveTarget(target); return; }
    setView(target);
  };

  const confirmLeave = () => { setView(leaveTarget); setLeaveTarget(null); };
  const cancelLeave = () => setLeaveTarget(null);

  

  const handleAnalyze = async ({ jobMode, jobText, jobFile, cvFiles, config }) => {
    setError(null);

    // Extract & validate job BEFORE switching view
    let jobFinalText = jobText;
    if (jobMode === 'pdf') {
      try {
        jobFinalText = await extractPdfText(jobFile);
      } catch (err) {
        setError('Error al leer el PDF de la oferta. Prueba pegando el texto.');
        return;
      }
    }



    // All good — switch to analyzing
    setView('analyzing');
    setActiveCvFiles(cvFiles);
    setActiveConfig(config);
    setCurrentIndex(0);
    setCompletedResults([]);

    // Step 1: Pre-summarize job ONCE (saves 1 GPT call per CV)
    let jobSummary = null;
    try {
      const preResp = await fetch('/api/pre-summarize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobText: jobFinalText }),
      });
      const preJson = await preResp.json();
      if (preJson.success) { jobSummary = preJson.jobSummary; setActiveJobSummary(jobSummary); }
    } catch (err) {
      console.warn('Pre-summarize fallida, continuando sin resumen:', err);
    }

    // Step 2: Extract text from all CVs in parallel
    const cvTexts = await Promise.all(cvFiles.map(cv => extractPdfText(cv).catch(() => '')));

    // Step 3: Analyze CVs in parallel batches of 3
    const BATCH = 3;
    const finalResults = new Array(cvFiles.length).fill(null);

    for (let b = 0; b < cvFiles.length; b += BATCH) {
      const batch = cvFiles.slice(b, b + BATCH);
      setCurrentIndex(b);

      await Promise.all(batch.map(async (cv, bi) => {
        const i = b + bi;
        try {
          const resp = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobText: jobFinalText,
              cvText: cvTexts[i],
              config,
              ...(jobSummary ? { jobSummary } : {}),
            }),
          });
          const json = await resp.json();
          if (!json.success) throw new Error(json.error);
          finalResults[i] = { name: cleanCandidateName(cv.name), data: json.data };
        } catch (err) {
          finalResults[i] = { name: cleanCandidateName(cv.name), data: null, error: err.message };
        }
      }));

      setCurrentIndex(b + BATCH);
      setCompletedResults([...finalResults]);
    }

    setCurrentIndex(cvFiles.length);
    await new Promise(r => setTimeout(r, 600));

    const validResults = finalResults.filter(r => r?.data);

    setResults(validResults);
    setView('results');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {leaveTarget && <LeaveGuard onConfirm={confirmLeave} onCancel={cancelLeave} />}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <button type="button" onClick={() => navigateSafe('upload')} className="flex items-center gap-2.5 hover:opacity-70 transition-opacity">
            <div className="w-7 h-7 bg-slate-900 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <span className="font-display font-bold text-lg text-slate-900 tracking-tight">RecruitAI</span>
          </button>
        </div>
      </header>

      <ErrorModal message={error} onClose={() => setError(null)} />
      {warning && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-sm text-amber-700 text-center">
          {warning}
          <button type="button" onClick={() => setWarning(null)} className="ml-3 underline">Cerrar</button>
        </div>
      )}

      <main>
        {view === 'upload' && <UploadView onAnalyze={handleAnalyze} onClientError={setError} />}
        {view === 'analyzing' && <LoadingView cvFiles={activeCvFiles} currentIndex={currentIndex} completed={completedResults} />}
        {view === 'results' && <ResultsView results={results} config={activeConfig} onReset={() => setView('upload')} jobSummary={activeJobSummary} />}
      </main>
    </div>
  );
}