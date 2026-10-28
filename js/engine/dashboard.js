// Cálculos del panel de inicio (#/, js/views/dashboard.js, como ../maquetas/01_inicio.png).
// No toca el DOM: se prueba con `node --test`.
// Los totales salen siempre de los datos cargados (el contenido crece por tareas), nunca de cifras
// fijas. Solo cuentan las preguntas de práctica que existen: las respuestas a preguntas retiradas o
// del banco de simulacros no suman en «Questions answered» ni en «Accuracy».

import { sectionStats } from "./questions.js";
import { sectionStats as exerciseStats } from "./exercises.js";
import { activeMock, finishedMocks, isExpired, isAnswered } from "./mock.js";
import { projectProgress } from "./projects.js";
import { srsSummary } from "../srs.js";

// Datos del panel.
// - sections: secciones de data/sections.json (ordenadas por id).
// - questionBanks / exerciseBanks: listas de preguntas y ejercicios de cada sección, en el mismo
//   orden que `sections`.
// - mockBank: banco exclusivo de simulacros (sus fallos también entran en «My mistakes»).
// - projects: proyectos que existen (data/projects), en orden.
// Devuelve { empty, questions, sections, exercises, bestMock, mock, review, projects, next }.
export function dashboardData({ sections, questionBanks = [], exerciseBanks = [], mockBank = [], projects = [], state, now = new Date() }) {
  const answers = state.answers || {};

  const rows = sections.map((s, i) => {
    const st = sectionStats(questionBanks[i] || [], answers);
    return { id: s.id, title: s.title, ...st, pct: st.total ? Math.round((st.answered / st.total) * 100) : 0 };
  });
  const total = rows.reduce((n, r) => n + r.total, 0);
  const answered = rows.reduce((n, r) => n + r.answered, 0);
  const correct = rows.reduce((n, r) => n + r.correct, 0);

  const ex = sections.map((s, i) => exerciseStats(exerciseBanks[i] || [], state.exercises || {}));
  const exercises = {
    total: ex.reduce((n, e) => n + e.total, 0),
    solved: ex.reduce((n, e) => n + e.solved, 0),
  };

  // Mejor nota de los simulacros terminados (a igualdad, el más reciente).
  let bestMock = null;
  for (const m of finishedMocks(state)) {
    if (!m.score) continue;
    if (!bestMock || m.score.percent >= bestMock.percent) {
      bestMock = { number: m.number, percent: m.score.percent, passed: Boolean(m.score.passed) };
    }
  }

  // Simulacro en curso. Si ya se le acabó el tiempo, la portada (#/mock) lo cierra al abrirla.
  const active = activeMock(state);
  const mock = active
    ? { active: true, expired: isExpired(active, now), number: active.number, next: (active.questions.findIndex((id) => !isAnswered(active, id)) + 1) || 1 }
    : { active: false };

  // Repaso de hoy: solo las tarjetas cuya pregunta existe (como en «My mistakes»).
  const known = new Set([...questionBanks.flat(), ...mockBank].map((q) => q.id));
  const srs = Object.fromEntries(Object.entries(state.srs || {}).filter(([id]) => known.has(id)));
  const review = srsSummary(srs, now);

  const projectInfo = projectsSummary(projects, state.projects || {});

  const empty = answered === 0 && exercises.solved === 0 && finishedMocks(state).length === 0
    && !mock.active && projectInfo.started === 0;

  return {
    empty,
    questions: { total, answered, correct, accuracy: answered ? Math.round((correct / answered) * 100) : null },
    sections: rows,
    exercises,
    bestMock,
    mock,
    review,
    projects: projectInfo,
    next: nextStep({ rows, answered, review, bestMock }),
  };
}

// Proyectos: cuántos hay, cuántos terminados y empezados, y cuál seguir.
// `current`: el primer proyecto en curso; si no hay ninguno, el primero sin empezar; si están
// todos terminados, null. Devuelve { total, done, started, current: { project, progress } | null }.
export function projectsSummary(projects, stateProjects = {}) {
  const list = projects.map((p) => ({ project: p, progress: projectProgress(p, stateProjects[p.id]) }));
  const done = list.filter((x) => x.progress.status === "done").length;
  const started = list.filter((x) => x.progress.status !== "new").length;
  const current = list.find((x) => x.progress.status === "progress")
    || list.find((x) => x.progress.status === "new")
    || null;
  return { total: list.length, done, started, current };
}

// El siguiente paso que se propone al alumno, siempre en positivo:
// - { kind: "review", count }: hay errores que repasar hoy (lo primero, porque es lo que más ayuda);
// - { kind: "start", section }: aún no ha respondido nada; empieza por la primera sección con preguntas;
// - { kind: "focus", section }: la sección con menos preguntas hechas (a igualdad, la primera);
// - { kind: "mock" }: ha respondido todas las preguntas de práctica (o aún no hay): toca un simulacro.
// `section` es la fila de la sección ({ id, title, total, answered, correct, pct }).
export function nextStep({ rows, answered, review, bestMock }) {
  if (review.due > 0) return { kind: "review", count: review.due };
  const withQuestions = rows.filter((r) => r.total > 0);
  if (answered === 0 && withQuestions.length) return { kind: "start", section: withQuestions[0] };
  const open = withQuestions.filter((r) => r.answered < r.total);
  if (open.length) {
    const section = open.reduce((low, r) => (r.pct < low.pct ? r : low));
    return { kind: "focus", section };
  }
  return { kind: "mock", passed: Boolean(bestMock?.passed) };
}
