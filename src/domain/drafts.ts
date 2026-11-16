// Životní cyklus draftu (§5.5): každá změna je nová revize téhož draftu, aktivace je atomická.
import { z } from 'zod';
import { formatDay, isIsoDate, DOW_LONG } from './dates';
import { generateWeeks } from './generator';
import { newId, REST } from './schedule';
import { workoutSpecSchema } from './commands';
import type { Author, Dow, DraftParams, PlanDraftRevision, PlanTemplate, TemplateDay, TemplateWeek, WorkoutSpec } from './types';

const dow = z.number().int().min(0).max(6);
const isoDate = z.string().refine(isIsoDate, 'Neplatné datum');

export const draftParamsSchema = z.object({
  intent: z.enum(['maintain', 'improve', 'race']),
  weeks: z.number().int().min(1).max(52),
  startDate: isoDate,
  weeklyKm: z.number().min(5).max(250),
  runsPerWeek: z.number().int().min(1).max(7),
  restDows: z.array(dow).max(6),
  longRunDow: dow,
  raceDate: isoDate.optional(),
  raceDistanceM: z.number().positive().max(200_000).optional(),
  assumptions: z.array(z.string()).default([]),
});

const daySelector = z.object({ week: z.number().int().min(1), dow });

export const draftChangeSchema = z.discriminatedUnion('op', [
  /** Přegeneruje kostru s novými parametry; zamčené dny zůstanou. */
  z.object({ op: z.literal('set_params'), params: draftParamsSchema.partial() }),
  z.object({ op: z.literal('scale_week'), week: z.number().int().min(1), factor: z.number().min(0.3).max(1.6) }),
  daySelector.extend({ op: z.literal('set_day'), workout: workoutSpecSchema }),
  z.object({ op: z.literal('swap_days'), week: z.number().int().min(1), a: dow, b: dow }),
  daySelector.extend({ op: z.literal('lock_day'), locked: z.boolean() }),
  /** Obnoví část starší revize: celý týden, jeden den, nebo jednotky daného typu. */
  z.object({
    op: z.literal('restore_part'),
    fromRevisionId: z.string(),
    week: z.number().int().min(1).optional(),
    dow: dow.optional(),
    type: workoutSpecSchema.shape.type.optional(),
  }),
]);
export type DraftChange = z.infer<typeof draftChangeSchema>;

export type DraftResult =
  | { ok: true; revision: PlanDraftRevision; summary: string[] }
  | { ok: false; code: 'invalid' | 'stale' | 'not_found' | 'locked' | 'noop'; message: string };

const fail = (code: Exclude<DraftResult, { ok: true }>['code'], message: string): DraftResult => ({ ok: false, code, message });

export function createDraftRevision(draftId: string, rawParams: unknown, meta: { author: Author; now: string; reason: string }): DraftResult {
  const p = draftParamsSchema.safeParse(rawParams);
  if (!p.success) return fail('invalid', `Návrh nejde sestavit: ${p.error.issues[0]?.message ?? 'neplatné údaje'}`);
  const params = p.data as DraftParams;
  return {
    ok: true,
    revision: { id: newId(), draftId, seq: 1, parentId: null, at: meta.now, author: meta.author, reason: meta.reason, params, weeks: generateWeeks(params) },
    summary: [`Návrh na ${params.weeks} ${params.weeks === 1 ? 'týden' : params.weeks < 5 ? 'týdny' : 'týdnů'} od ${formatDay(params.startDate)}`],
  };
}

const scale = (w: WorkoutSpec, f: number): WorkoutSpec =>
  w.distanceM != null && w.type !== 'race' ? { ...w, distanceM: Math.max(1000, Math.round((w.distanceM * f) / 1000) * 1000) } : w;

export function applyDraftChanges(
  current: PlanDraftRevision,
  rawChanges: unknown,
  history: PlanDraftRevision[],
  meta: { author: Author; now: string; reason: string; expectedRevisionId?: string },
): DraftResult {
  if (meta.expectedRevisionId && meta.expectedRevisionId !== current.id) {
    return fail('stale', 'Návrh se mezitím změnil. Úprava vycházela ze starší verze.');
  }
  const parsed = z.array(draftChangeSchema).min(1).max(40).safeParse(rawChanges);
  if (!parsed.success) return fail('invalid', `Úprava návrhu nemá platný tvar: ${parsed.error.issues[0]?.message ?? ''}`.trim());

  let params: DraftParams = structuredClone(current.params);
  let weeks: TemplateWeek[] = structuredClone(current.weeks);
  const summary: string[] = [];
  const findDay = (week: number, d: number): TemplateDay | undefined => weeks.find((w) => w.index === week)?.days.find((x) => x.dow === d);

  for (const c of parsed.data) {
    switch (c.op) {
      case 'set_params': {
        const next = draftParamsSchema.safeParse({ ...params, ...c.params });
        if (!next.success) return fail('invalid', `Parametry návrhu nejsou platné: ${next.error.issues[0]?.message ?? ''}`.trim());
        params = next.data as DraftParams;
        const regenerated = generateWeeks(params);
        // Zamčené dny přežijí přegenerování; nic se z nich tiše neztratí.
        for (const w of regenerated) {
          const old = weeks.find((x) => x.index === w.index);
          if (!old) continue;
          w.days = w.days.map((d) => old.days.find((o) => o.dow === d.dow && o.locked) ?? d);
        }
        weeks = regenerated;
        summary.push('Kostra přepočítaná podle nových parametrů, zamčené dny zůstaly.');
        break;
      }
      case 'scale_week': {
        const w = weeks.find((x) => x.index === c.week);
        if (!w) return fail('not_found', `Týden ${c.week} v návrhu není.`);
        w.days = w.days.map((d) => (d.locked ? d : { ...d, workout: scale(d.workout, c.factor) }));
        summary.push(`Týden ${c.week}: objem ${c.factor < 1 ? 'snížen' : 'zvýšen'} na ${Math.round(c.factor * 100)} %`);
        break;
      }
      case 'set_day': {
        const d = findDay(c.week, c.dow);
        if (!d) return fail('not_found', `Týden ${c.week} v návrhu není.`);
        if (d.locked) return fail('locked', `${DOW_LONG[c.dow]} v týdnu ${c.week} je zamčená.`);
        d.workout = c.workout as WorkoutSpec;
        d.source = { method: meta.author === 'coach' ? 'generated' : 'manual', review: meta.author === 'user' ? 'edited' : 'unreviewed', issues: [] };
        summary.push(`Týden ${c.week}, ${DOW_LONG[c.dow]}: ${c.workout.title}`);
        break;
      }
      case 'swap_days': {
        const a = findDay(c.week, c.a);
        const b = findDay(c.week, c.b);
        if (!a || !b) return fail('not_found', `Týden ${c.week} v návrhu není.`);
        if (a.locked || b.locked) return fail('locked', 'Jeden z dnů je zamčený.');
        [a.workout, b.workout] = [b.workout, a.workout];
        [a.source, b.source] = [b.source, a.source];
        summary.push(`Týden ${c.week}: prohozeno ${DOW_LONG[c.a]} a ${DOW_LONG[c.b]}`);
        break;
      }
      case 'lock_day': {
        const d = findDay(c.week, c.dow);
        if (!d) return fail('not_found', `Týden ${c.week} v návrhu není.`);
        d.locked = c.locked;
        summary.push(`Týden ${c.week}, ${DOW_LONG[c.dow]}: ${c.locked ? 'zamčeno' : 'odemčeno'}`);
        break;
      }
      case 'restore_part': {
        const from = history.find((r) => r.id === c.fromRevisionId);
        if (!from) return fail('not_found', 'Starší verze návrhu nebyla nalezena.');
        let restored = 0;
        for (const w of weeks) {
          if (c.week != null && w.index !== c.week) continue;
          const old = from.weeks.find((x) => x.index === w.index);
          if (!old) continue;
          if (c.type) {
            // Obnovení podle typu vrací jednotku na den, kde byla ve starší verzi.
            const olds = old.days.filter((d) => d.workout.type === c.type);
            if (olds.length === 0) continue;
            for (const d of w.days) {
              if (d.locked) continue;
              const src = olds.find((o) => o.dow === d.dow);
              if (src) { d.workout = structuredClone(src.workout); restored += 1; }
              else if (d.workout.type === c.type) d.workout = structuredClone(REST);
            }
          } else {
            for (const d of w.days) {
              if (c.dow != null && d.dow !== c.dow) continue;
              if (d.locked) continue;
              const src = old.days.find((o) => o.dow === d.dow);
              if (src) { d.workout = structuredClone(src.workout); restored += 1; }
            }
          }
        }
        if (restored === 0) return fail('noop', 'Ve starší verzi není nic, co by šlo obnovit.');
        summary.push(`Obnoveno z verze ${from.seq}: ${restored} ${restored === 1 ? 'jednotka' : restored < 5 ? 'jednotky' : 'jednotek'}`);
        break;
      }
    }
  }

  return {
    ok: true,
    revision: { id: newId(), draftId: current.draftId, seq: current.seq + 1, parentId: current.id, at: meta.now, author: meta.author, reason: meta.reason, params, weeks },
    summary,
  };
}

/** Kontrola před aktivací (INV-11): neúplná nebo nevalidní verze se neaktivuje. */
export function validateDraftRevision(rev: PlanDraftRevision): string[] {
  const problems: string[] = [];
  if (rev.weeks.length === 0) problems.push('Návrh nemá žádný týden.');
  if (rev.weeks.length !== rev.params.weeks) problems.push('Počet týdnů neodpovídá zadání.');
  for (const w of rev.weeks) {
    if (w.days.length !== 7) problems.push(`Týden ${w.index} není úplný.`);
    for (const d of w.days) if (!workoutSpecSchema.safeParse(d.workout).success) problems.push(`Týden ${w.index}, ${DOW_LONG[d.dow as Dow]}: neplatná jednotka.`);
    if (w.days.every((d) => d.workout.type === 'rest')) problems.push(`Týden ${w.index} nemá žádný běh.`);
  }
  return problems;
}

export function templateFromDraft(rev: PlanDraftRevision, title: string, now: string): PlanTemplate {
  return {
    id: newId(),
    name: title,
    origin: 'draft',
    draftRevisionId: rev.id,
    createdAt: now,
    verifiedAt: now,
    units: 'km',
    goalDistanceM: rev.params.raceDistanceM,
    weeks: structuredClone(rev.weeks).map((w) => ({ ...w, days: w.days.map((d) => ({ ...d, source: { ...d.source, review: 'confirmed' as const } })) })),
  };
}

export const INTENT_LABEL = { maintain: 'Udržování', improve: 'Postupné zlepšení', race: 'Příprava na závod' } as const;
