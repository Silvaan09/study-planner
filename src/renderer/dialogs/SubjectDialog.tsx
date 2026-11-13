import { useState } from 'react';
import { api } from '../api';
import type { Assessment, Id, Subject } from '../../shared/types';
import { formatNumber, GRADE_MAX, GRADE_MIN, MAX_CREDITS, parseDecimal, PASS_GRADE, twoDecimals } from '../../shared/grades';
import { Modal, useUi } from '../ui';
import { useActions } from '../actions';
import { Field, Footer } from './fields';

export const SUBJECT_COLORS = [
  '#4f6bed', '#0ea5e9', '#14b8a6', '#22a55b', '#84cc16', '#eab308',
  '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1',
  '#64748b', '#8b5a2b',
];

export function SubjectDialog({ semesterId, subject, close }: { semesterId: Id; subject?: Subject; close: (s?: Subject) => void }) {
  const ui = useUi();
  const actions = useActions();
  const [name, setName] = useState(subject?.name ?? '');
  const [color, setColor] = useState(subject?.color ?? SUBJECT_COLORS[Math.floor(Math.random() * 12)]);
  const [assessment, setAssessment] = useState<Assessment>(subject?.assessment ?? 'grade');
  const [credits, setCredits] = useState(subject?.credits != null ? formatNumber(subject.credits) : '');
  const [grade, setGrade] = useState(subject?.grade != null ? formatNumber(subject.grade) : '');
  const [passed, setPassed] = useState<boolean | null>(subject?.passed ?? null);
  const personal = !!subject?.personal;

  const creditsValue = parseDecimal(credits);
  const creditsError =
    creditsValue === null
      ? null
      : Number.isNaN(creditsValue) || creditsValue > MAX_CREDITS
        ? 'Enter a number, e.g. 6 or 1.5.'
        : !twoDecimals(creditsValue)
          ? 'At most two decimals.'
          : null;
  const gradeValue = parseDecimal(grade);
  const gradeError =
    gradeValue === null
      ? null
      : Number.isNaN(gradeValue) || gradeValue < GRADE_MIN || gradeValue > GRADE_MAX
        ? `A grade from ${GRADE_MIN} to ${GRADE_MAX}, e.g. 4.75.`
        : !twoDecimals(gradeValue)
          ? 'At most two decimals.'
          : null;
  const invalid = !personal && (creditsError !== null || (assessment === 'grade' && gradeError !== null));

  /** Switching between a grade and pass/fail clears the result (it can't be carried over). */
  const changeAssessment = (a: Assessment) => {
    if (a === assessment) return;
    setAssessment(a);
    setGrade('');
    setPassed(null);
  };

  const save = async () => {
    const input = personal
      ? { semesterId, name, color }
      : {
          semesterId,
          name,
          color,
          assessment,
          credits: creditsValue,
          grade: assessment === 'grade' ? gradeValue : null,
          passed: assessment === 'pass_fail' ? passed : null,
        };
    const s = await ui.run(() => (subject ? api.updateSubject(subject.id, input) : api.createSubject(input)));
    if (s) close(s);
  };
  return (
    <Modal
      title={subject?.personal ? 'Personal tasks' : subject ? 'Edit subject' : 'New subject'}
      onClose={() => close()}
      footer={
        <Footer
          onCancel={() => close()}
          onSave={save}
          disabled={!name.trim() || invalid}
          saveLabel={subject ? 'Save' : 'Create subject'}
          onDelete={subject && !subject.personal ? async () => (await actions.deleteSubject(subject)) && close() : undefined}
        />
      }
    >
      {subject?.personal && (
        <p className="muted small">Tasks that don't belong to a subject. Their name and color show on the timetable like a subject's.</p>
      )}
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mathematics" autoFocus />
      </Field>
      <Field label="Color">
        <div className="swatches">
          {SUBJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${c === color ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={c}
            />
          ))}
          <input type="color" className="swatch-custom" value={color} onChange={(e) => setColor(e.target.value)} title="Custom color" />
        </div>
      </Field>
      <div className="subject-preview" style={{ '--c': color } as React.CSSProperties}>
        <span className="dot" /> {name || 'Subject'}
      </div>
      {!personal && (
        <>
          <Field label="Assessment">
            <div className="segmented full" role="radiogroup" aria-label="Assessment">
              {(
                [
                  ['grade', 'Grade'],
                  ['pass_fail', 'Pass/fail'],
                ] as const
              ).map(([a, label]) => (
                <button key={a} type="button" role="radio" aria-checked={assessment === a} className={`seg ${assessment === a ? 'active' : ''}`} onClick={() => changeAssessment(a)}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <div className="field-row">
            <Field label="Credits" error={creditsError} hint="Optional">
              <input className="input" inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="e.g. 6" />
            </Field>
            {assessment === 'grade' ? (
              <Field label="Grade" error={gradeError} hint={`Passed from ${PASS_GRADE.toFixed(1)}. Empty until you have it.`}>
                <input className="input" inputMode="decimal" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="1–6, e.g. 4.75" />
              </Field>
            ) : (
              <Field label="Result">
                <div className="segmented full compact" role="radiogroup" aria-label="Result">
                  {(
                    [
                      [null, 'Not yet'],
                      [true, 'Passed'],
                      [false, 'Failed'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={passed === v}
                      className={`seg ${passed === v ? 'active' : ''} ${v === true ? 'result-passed' : v === false ? 'result-failed' : ''}`}
                      onClick={() => setPassed(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
