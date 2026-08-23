import React from 'react';
import { TOKENS } from '../theme';

const DAY_MS = 86400000;

function parseDate(str) {
  return new Date(str + 'T00:00:00');
}

function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS);
}

function fmtShort(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ROW_HEIGHT = 40;
const LABEL_WIDTH = 180;

// A hand-rolled date-scaled bar chart — no chart library has a range-bar
// primitive here, and building it by hand keeps it themed consistently with
// the rest of the app. Tasks without a `startDate` (the common case for
// anything created before this feature, and optional going forward) render
// as a single-day diamond marker at `due` rather than a fabricated bar, so
// the chart never claims to know a duration it doesn't.
export function GanttChart({ tasks, priorityColor, projectDeadline, onOpenTask }) {
  if (tasks.length === 0) {
    return <p className="text-sm italic" style={{ color: TOKENS.textFaint }}>Nothing on the timeline yet.</p>;
  }

  const rows = tasks
    .map((task) => {
      const due = parseDate(task.due);
      const hasStart = Boolean(task.startDate);
      const start = hasStart ? parseDate(task.startDate) : due;
      return { task, start: start <= due ? start : due, end: due, hasStart };
    })
    .sort((a, b) => a.start - b.start);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let rangeStart = today;
  let rangeEnd = today;
  rows.forEach((r) => {
    if (r.start < rangeStart) rangeStart = r.start;
    if (r.end > rangeEnd) rangeEnd = r.end;
  });
  if (projectDeadline) {
    const d = parseDate(projectDeadline);
    if (d > rangeEnd) rangeEnd = d;
  }
  rangeStart = new Date(rangeStart.getTime() - 2 * DAY_MS);
  rangeEnd = new Date(rangeEnd.getTime() + 3 * DAY_MS);
  const totalDays = Math.max(daysBetween(rangeStart, rangeEnd), 1);

  function pct(date) {
    return Math.min(Math.max((daysBetween(rangeStart, date) / totalDays) * 100, 0), 100);
  }

  const todayPct = pct(today);

  const ticks = [];
  for (let d = new Date(rangeStart); d <= rangeEnd; d = new Date(d.getTime() + 7 * DAY_MS)) {
    ticks.push(new Date(d));
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${TOKENS.border}`, background: TOKENS.surface }}>
      <div className="flex" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
        <div style={{ width: LABEL_WIDTH, flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: 1, height: 28 }}>
          {ticks.map((d, i) => (
            <span
              key={i}
              className="font-mono absolute"
              style={{ left: `${pct(d)}%`, top: 7, fontSize: 10, color: TOKENS.textFaint, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
            >
              {fmtShort(d)}
            </span>
          ))}
        </div>
      </div>

      <div>
        {rows.map(({ task, start, end, hasStart }) => {
          const barLeft = pct(start);
          const barRight = pct(end);
          const barWidth = Math.max(barRight - barLeft, hasStart ? 0.5 : 0);
          const color = priorityColor[task.priority] || TOKENS.blue;
          const title = hasStart
            ? `${task.title} — ${task.startDate} → ${task.due}`
            : `${task.title} — due ${task.due} (no start date set)`;
          return (
            <div
              key={task.id}
              className="flex items-center"
              style={{ height: ROW_HEIGHT, borderTop: `1px solid ${TOKENS.border}` }}
            >
              <div className="px-3 min-w-0" style={{ width: LABEL_WIDTH, flexShrink: 0 }}>
                <p className="text-xs truncate" style={{ color: TOKENS.text }}>{task.title}</p>
              </div>
              <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                {todayPct >= 0 && todayPct <= 100 && (
                  <div
                    style={{ position: 'absolute', left: `${todayPct}%`, top: 0, bottom: 0, width: 1, background: TOKENS.textFaint, opacity: 0.5 }}
                  />
                )}
                {hasStart ? (
                  <button
                    onClick={() => onOpenTask(task.id)}
                    title={title}
                    className="text-left"
                    style={{
                      position: 'absolute', left: `${barLeft}%`, width: `${barWidth}%`, top: '50%', transform: 'translateY(-50%)',
                      height: 14, minWidth: 6, borderRadius: 7, background: color, opacity: 0.85, cursor: 'pointer',
                    }}
                  />
                ) : (
                  <button
                    onClick={() => onOpenTask(task.id)}
                    title={title}
                    aria-label={title}
                    style={{
                      position: 'absolute', left: `${barLeft}%`, top: '50%',
                      width: 10, height: 10, transform: 'translate(-50%, -50%) rotate(45deg)',
                      background: color, opacity: 0.85, cursor: 'pointer', border: `1px solid ${TOKENS.surface}`,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
