import React, { useState, useMemo, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import {
  Users, Clock, AlertTriangle, Calendar, TrendingUp, PieChart as PieChartIcon,
  ChevronLeft, ChevronRight, X, Bell, LayoutGrid, FolderKanban, Plus, Trash2, Building2,
  NotebookPen, LogOut, Copy, Check, Sparkles, Loader2, Search, MessageSquare, Download, Repeat,
  Sun, Moon, ShieldCheck,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import { useTheme, THEME_HEX, TOKENS, hexToRgba } from './theme';
import { useUrlTab } from './hooks/useUrlTab';
import { useCountUp } from './hooks/useCountUp';
import { CommandPalette } from './components/CommandPalette';
import { AdminPanel } from './components/AdminPanel';
import { OnboardingEmptyState } from './components/OnboardingEmptyState';
import { GanttChart } from './components/GanttChart';

/* ---------------------------------- tokens --------------------------------- */

const PRIORITY_COLOR = { high: TOKENS.coral, medium: TOKENS.amber, low: TOKENS.blue };

/* ---------------------------------- data ----------------------------------- */

// Cycled through when a new team member is added, so each gets a distinct color.
const MEMBER_COLORS = [TOKENS.violet, TOKENS.blue, TOKENS.teal, TOKENS.amber, TOKENS.coral, TOKENS.magenta];

function initialsFromName(name) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

// Surfaces members whose recorded skills look relevant to a task title, e.g.
// typing "Cognex C1 calibration" suggests whoever is Certified on Cognex C1.
function suggestAssigneesFromSkills(title, team) {
  const t = title.trim().toLowerCase();
  if (t.length < 3) return [];
  const matches = [];
  for (const member of team) {
    for (const skill of member.skills || []) {
      const skillLower = skill.name.toLowerCase();
      const skillWords = skillLower.split(/\s+/).filter((w) => w.length >= 4);
      if (t.includes(skillLower) || skillWords.some((w) => t.includes(w))) {
        matches.push({ member, skill });
        break; // one suggested skill per member is enough
      }
    }
  }
  return matches;
}

// Wordmark placeholders (short + color) until real logo image files are added — see CustomerLogo.
const CUSTOMERS = [
  { id: 'bytronic', name: 'Bytronic', short: 'BYT', color: TOKENS.blue, note: 'In-house · multiple suppliers' },
  { id: 'cognex', name: 'Cognex', short: 'CGX', color: TOKENS.teal, note: 'Main customer' },
  { id: 'flir', name: 'Teledyne FLIR', short: 'FLIR', color: TOKENS.violet },
  { id: 'zebra', name: 'Zebra', short: 'ZBR', color: TOKENS.amber },
  { id: 'sick', name: 'SICK', short: 'SICK', color: TOKENS.coral },
  { id: 'keyence', name: 'Keyence', short: 'KEY', color: TOKENS.magenta },
];

const STATUSES = ['backlog', 'inprogress', 'review', 'done'];
const STATUS_LABEL = { backlog: 'Backlog', inprogress: 'In Progress', review: 'Review', done: 'Done' };

const TABS = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'timeline', label: 'Timeline', icon: Calendar },
  { id: 'customers', label: 'Customers', icon: Building2 },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'logs', label: 'Logs', icon: NotebookPen },
  { id: 'admin', label: 'Admin', icon: ShieldCheck },
];

// Tabs only management can see — filtered out of nav/palette, and their
// content is gated a second time at the render site (defense in depth; the
// real security boundary is Supabase RLS, not this list).
const MANAGEMENT_ONLY_TABS = new Set(['logs', 'admin']);

const LOG_TAGS = [
  { id: 'progress', label: 'Progress', color: TOKENS.teal },
  { id: 'praise', label: 'Praise', color: TOKENS.blue },
  { id: 'concern', label: 'Concern', color: TOKENS.coral },
  { id: 'general', label: 'General', color: TOKENS.textMuted },
];

const INITIAL_PROJECTS = [];
const INITIAL_TASKS = [];
const INITIAL_LOGS = [];
const INITIAL_TEAM = [];
const INITIAL_COMMENTS = [];

/* --------------------------------- helpers ---------------------------------- */

function daysUntil(dateStr) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function formatDue(dateStr) {
  const d = daysUntil(dateStr);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d}d`;
}

function advanceDueDate(dateStr, repeat) {
  const d = new Date(dateStr + 'T00:00:00');
  if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function dueTone(dateStr) {
  const d = daysUntil(dateStr);
  if (d < 0) return { color: TOKENS.coral, pulse: true };
  if (d <= 3) return { color: TOKENS.amber, pulse: true };
  return { color: TOKENS.textMuted, pulse: false };
}

const inputStyle = { background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, color: TOKENS.text };

function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Builds a minimal .ics (iCalendar) file — one all-day VEVENT per entry — so
// deadlines can be dropped into whatever calendar app someone already uses.
function buildICS(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pulse Dashboard//EN', 'CALSCALE:GREGORIAN'];
  events.forEach((e) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@pulse-dashboard`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`,
      `SUMMARY:${icsEscape(e.title)}`
    );
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Supabase tables use snake_case columns; app state uses camelCase.
function projectFromRow(r) {
  return { id: r.id, name: r.name, subtitle: r.subtitle, deadline: r.deadline, customerId: r.customer_id };
}
function projectToRow(p) {
  return { id: p.id, name: p.name, subtitle: p.subtitle, deadline: p.deadline, customer_id: p.customerId };
}
function taskFromRow(r) {
  return { id: r.id, title: r.title, assignees: r.assignees, priority: r.priority, due: r.due, status: r.status, projectId: r.project_id, repeat: r.repeat || 'none', startDate: r.start_date || null };
}
function taskToRow(t) {
  return { id: t.id, title: t.title, assignees: t.assignees, priority: t.priority, due: t.due, status: t.status, project_id: t.projectId, repeat: t.repeat || 'none', start_date: t.startDate || null };
}
function logFromRow(r) {
  return { id: r.id, personId: r.person_id, note: r.note, tag: r.tag, createdAt: r.created_at };
}
function logToRow(l) {
  return { id: l.id, person_id: l.personId, note: l.note, tag: l.tag, created_at: l.createdAt };
}
function memberFromRow(r) {
  return { id: r.id, name: r.name, role: r.role, color: r.color, initials: r.initials, skills: r.skills || [] };
}
function memberToRow(m) {
  return { id: m.id, name: m.name, role: m.role, color: m.color, initials: m.initials, skills: m.skills };
}
function commentFromRow(r) {
  return { id: r.id, taskId: r.task_id, authorId: r.author_id, body: r.body, createdAt: r.created_at };
}
function commentToRow(c) {
  return { id: c.id, task_id: c.taskId, author_id: c.authorId, body: c.body, created_at: c.createdAt };
}

/* -------------------------------- primitives -------------------------------- */

function Logo() {
  // Placeholder wordmark — swap for the real Bytronic logo file (e.g. an <img> from src/assets)
  // once it's saved into the project.
  return (
    <div className="flex flex-col leading-none select-none flex-shrink-0">
      <span className="font-display font-bold text-lg tracking-tight" style={{ color: TOKENS.text }}>
        bytron
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <span style={{ color: TOKENS.blue }}>i</span>
          {/* Laid over the letter's own tittle so it reads as the dot pulsing — same
              pulse-ring keyframe PulseDot uses, but without its background-colored
              border (which, at this small a size, ate the whole dot under border-box
              sizing and made it invisible). */}
          <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5 }}>
            <span
              style={{
                position: 'absolute', inset: 0, borderRadius: '9999px', background: TOKENS.blue,
                animation: 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
              }}
            />
            <span style={{ position: 'absolute', inset: 0, borderRadius: '9999px', background: TOKENS.blue }} />
          </span>
        </span>
        c
      </span>
      <span className="font-mono mt-0.5" style={{ fontSize: 8, letterSpacing: '0.2em', color: TOKENS.blue }}>
        VISION INTELLIGENCE
      </span>
    </div>
  );
}

function CustomerLogo({ customer, size = 36 }) {
  // Placeholder wordmark badge — swap for the real customer logo file (e.g. an
  // <img> from src/assets) once one is saved into the project.
  return (
    <div
      title={customer.name}
      className="flex items-center justify-center flex-shrink-0 font-display font-bold select-none"
      style={{
        width: size, height: size, borderRadius: 10,
        background: hexToRgba(customer.color, 0.15),
        border: `1px solid ${hexToRgba(customer.color, 0.4)}`,
        color: customer.color,
        fontSize: size * 0.3,
        letterSpacing: '-0.02em',
      }}
    >
      {customer.short}
    </div>
  );
}

function RadialProgress({ pct, size = 56, stroke = 5, color, trackColor = THEME_HEX.dark.border, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(Math.max(pct, 0), 100) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* raw SVG attribute, not a style object — can't resolve a CSS var, so this needs a real resolved hex */}
        <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}

// Counts up to `value` instead of snapping in — its own component (rather
// than calling useCountUp inline at each call site) so it's safe to use
// inside a .map() without breaking the rules of hooks.
function StatNumber({ value, suffix = '%' }) {
  const display = useCountUp(value);
  return <>{display}{suffix}</>;
}

function PulseDot({ color, pulse, size = 8 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      {pulse && (
        <span
          style={{
            position: 'absolute', inset: 0, borderRadius: '9999px', background: color,
            animation: 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
          }}
        />
      )}
      <span style={{ position: 'relative', width: size, height: size, borderRadius: '9999px', background: color, border: `2px solid ${TOKENS.bg}` }} />
    </span>
  );
}

// Loading indicator: a large bold monospace "i" with the same pulsing dot
// as the header wordmark, sized via `size` (font-size in px).
function LoadingMark({ size = 64 }) {
  const dotSize = Math.max(Math.round(size * 0.14), 5);
  return (
    <span role="status" aria-label="Loading" style={{ position: 'relative', display: 'inline-block' }}>
      <span className="font-mono font-bold" style={{ fontSize: size, lineHeight: 1, color: TOKENS.blue }}>i</span>
      <span
        style={{
          position: 'absolute', top: size * 0.32, left: '50%', transform: 'translateX(-50%)',
          width: dotSize, height: dotSize,
        }}
      >
        <span
          style={{
            position: 'absolute', inset: 0, borderRadius: '9999px', background: TOKENS.blue,
            animation: 'pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite',
          }}
        />
        <span style={{ position: 'absolute', inset: 0, borderRadius: '9999px', background: TOKENS.blue }} />
      </span>
    </span>
  );
}

function LoginScreen({ onSignIn, onSignUp }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setSubmitting(true);
    if (mode === 'signin') {
      const { error: signInError } = await onSignIn(email.trim(), password);
      setSubmitting(false);
      if (signInError) setError(signInError.message || 'Sign-in failed');
    } else {
      const { error: signUpError, needsConfirmation } = await onSignUp(email.trim(), password);
      setSubmitting(false);
      if (signUpError) {
        setError(signUpError.message || 'Sign-up failed');
      } else if (needsConfirmation) {
        setInfo('Check your email to confirm your account, then sign in.');
        setMode('signin');
        setPassword('');
      }
      // If no confirmation is required, the auth-state listener elsewhere in
      // the app picks up the new session automatically — nothing else to do.
    }
  }

  function toggleMode() {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError('');
    setInfo('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center font-body px-4" style={{ background: TOKENS.bg, color: TOKENS.text }}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl p-6" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
        <div className="mb-5">
          <Logo />
        </div>
        <h1 className="font-display font-semibold text-lg mb-1">{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
        <p className="text-xs mb-5" style={{ color: TOKENS.textFaint }}>
          {mode === 'signin' ? 'Sign in to continue.' : 'New accounts start with operator-level access.'}
        </p>
        <div className="flex flex-col gap-2 mb-3">
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
        </div>
        {info && <p className="text-xs mb-3" style={{ color: TOKENS.teal }}>{info}</p>}
        {error && <p className="text-xs mb-3" style={{ color: TOKENS.coral }}>{error}</p>}
        <button type="submit" disabled={submitting} className="w-full px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60" style={{ background: TOKENS.blue, color: '#0B0D11' }}>
          {submitting ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : (mode === 'signin' ? 'Sign in' : 'Sign up')}
        </button>
        <button type="button" onClick={toggleMode} className="w-full text-xs mt-3 text-center" style={{ color: TOKENS.textMuted }}>
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}

// Persistent "where am I" context for project-scoped tabs (Board, Timeline) —
// project, its customer, and (Board only) the active member filter.
function Breadcrumb({ project, customer, memberFilter, onClearMember }) {
  if (!project) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs mb-3 flex-wrap" style={{ color: TOKENS.textFaint }}>
      <span style={{ color: TOKENS.textMuted }}>{project.name}</span>
      {customer && (
        <>
          <span>/</span>
          <span>{customer.name}</span>
        </>
      )}
      {memberFilter && (
        <>
          <span>/</span>
          <span className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full" style={{ background: TOKENS.surface2, color: TOKENS.text }}>
            {memberFilter.name}
            <button onClick={onClearMember} aria-label="Clear member filter" style={{ color: TOKENS.textMuted }}><X size={11} /></button>
          </span>
        </>
      )}
    </div>
  );
}

// Small clickable list used to jump from an aggregate count (e.g. "6 overdue")
// to the specific task's project board — tasks here can span several
// projects, so each row shows which project it belongs to.
function TaskListPopover({ tasks, projects, onSelectTask }) {
  return (
    <div
      className="absolute z-20 mt-1 rounded-xl overflow-hidden left-0"
      style={{ width: 240, maxHeight: 240, overflowY: 'auto', background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}
    >
      {tasks.map((t) => {
        const project = projects.find((p) => p.id === t.projectId);
        return (
          <button
            key={t.id}
            onClick={() => onSelectTask(t)}
            className="w-full text-left px-3 py-2"
            style={{ borderBottom: `1px solid ${TOKENS.border}` }}
          >
            <p className="text-xs truncate" style={{ color: TOKENS.text }}>{t.title}</p>
            <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>{project ? project.name : 'Unknown project'} · {formatDue(t.due)}</p>
          </button>
        );
      })}
    </div>
  );
}

function ManagementOnlyNotice({ feature }) {
  return (
    <div className="rounded-xl p-10 text-center" style={{ background: TOKENS.surface, border: `1px dashed ${TOKENS.border}` }}>
      <p className="text-sm" style={{ color: TOKENS.textMuted }}>{feature} is only available to management.</p>
    </div>
  );
}

function EmptyProjectState({ onGo }) {
  return (
    <div className="rounded-xl p-10 text-center" style={{ background: TOKENS.surface, border: `1px dashed ${TOKENS.border}` }}>
      <p className="text-sm mb-3" style={{ color: TOKENS.textMuted }}>No active project selected.</p>
      <button onClick={onGo} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: TOKENS.blue, color: '#0B0D11' }}>
        Go to Projects
      </button>
    </div>
  );
}

function AddProjectForm({ onAdd }) {
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [customerId, setCustomerId] = useState(CUSTOMERS[1].id);

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), subtitle: subtitle.trim(), deadline: deadline || null, customerId });
    setName('');
    setSubtitle('');
    setDeadline('');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
      <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Description (optional)" className="rounded-lg px-3 py-2 text-sm" style={inputStyle} />
      <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="rounded-lg px-3 py-2 text-sm" style={inputStyle}>
        {CUSTOMERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="flex gap-2">
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="rounded-lg px-3 py-2 text-sm flex-1" style={inputStyle} />
        <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium flex-shrink-0 flex items-center gap-1.5" style={{ background: TOKENS.blue, color: '#0B0D11' }}>
          <Plus size={14} /> Add project
        </button>
      </div>
    </form>
  );
}

function AddMemberForm({ onAdd }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ name: name.trim(), role: role.trim() });
    setName('');
    setRole('');
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]" style={inputStyle} />
      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (optional)" className="rounded-lg px-3 py-1.5 text-sm" style={{ ...inputStyle, width: 160 }} />
      <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 flex-shrink-0" style={{ background: TOKENS.blue, color: '#0B0D11' }}>
        <Plus size={14} /> Add member
      </button>
    </form>
  );
}

function AssigneePicker({ team, value, onChange }) {
  const [open, setOpen] = useState(false);

  function toggle(id) {
    if (value.includes(id)) {
      if (value.length === 1) return; // keep at least one assignee
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  }

  const label = value.length === 1
    ? team.find((m) => m.id === value[0])?.name
    : `${value.length} people`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg px-2 py-1.5 text-sm text-left"
        style={{ ...inputStyle, minWidth: 130 }}
      >
        {label}
      </button>
      {open && (
        <div
          className="absolute z-10 mt-1 rounded-lg p-1.5 space-y-0.5"
          style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, minWidth: 180, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}
        >
          {team.map((m) => (
            <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer" style={{ color: TOKENS.text }}>
              <input type="checkbox" checked={value.includes(m.id)} onChange={() => toggle(m.id)} />
              {m.name}
            </label>
          ))}
          <button type="button" onClick={() => setOpen(false)} className="w-full text-xs px-2 py-1 rounded-md mt-1" style={{ color: TOKENS.textMuted }}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function AddTaskForm({ team, onAdd, onCancel }) {
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState(team.length ? [team[0].id] : []);
  const [priority, setPriority] = useState('medium');
  const [due, setDue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [repeat, setRepeat] = useState('none');

  function submit(e) {
    e.preventDefault();
    if (!title.trim() || !due || assignees.length === 0) return;
    onAdd({ title: title.trim(), assignees, priority, due, repeat, startDate: startDate || null });
  }

  const suggestions = useMemo(
    () => suggestAssigneesFromSkills(title, team).filter((s) => !assignees.includes(s.member.id)),
    [title, team, assignees]
  );

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]" style={inputStyle} />
      <AssigneePicker team={team} value={assignees} onChange={setAssignees} />
      <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} title="Start date (optional — used for the Gantt view)" />
      <input type="date" required value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} title="Due date" />
      <select value={repeat} onChange={(e) => setRepeat(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} title="Repeat">
        <option value="none">Doesn't repeat</option>
        <option value="weekly">Repeats weekly</option>
        <option value="monthly">Repeats monthly</option>
      </select>
      <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: TOKENS.blue, color: '#0B0D11' }}>Add</button>
      <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: TOKENS.textMuted }}>Cancel</button>

      {suggestions.length > 0 && (
        <div className="basis-full flex items-center gap-1.5 flex-wrap text-xs" style={{ color: TOKENS.textFaint }}>
          <Sparkles size={12} style={{ color: TOKENS.violet }} /> Suggested:
          {suggestions.map((s) => (
            <button
              key={s.member.id}
              type="button"
              onClick={() => setAssignees((prev) => [...prev, s.member.id])}
              className="flex items-center gap-1 px-2 py-1 rounded-full"
              style={{ background: hexToRgba(s.member.color, 0.12), color: s.member.color, border: `1px solid ${hexToRgba(s.member.color, 0.35)}` }}
            >
              {s.member.name.split(' ')[0]} · {s.skill.name} ({s.skill.level})
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

function TaskCard({ task, members, onMove, onDragStart, onDelete, onOpen, canMoveLeft, canMoveRight, highlighted, commentCount }) {
  const tone = dueTone(task.due);
  const ref = useRef(null);

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      className="rounded-lg p-3 mb-2 cursor-grab"
      style={{
        background: TOKENS.surface2,
        border: `1px solid ${highlighted ? TOKENS.violet : TOKENS.border}`,
        boxShadow: highlighted ? `0 0 0 3px ${hexToRgba(TOKENS.violet, 0.25)}` : 'none',
        transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: PRIORITY_COLOR[task.priority] }}>
          {task.priority}
          {task.repeat && task.repeat !== 'none' && (
            <span title={`Repeats ${task.repeat}`} className="flex items-center" style={{ color: TOKENS.textFaint }}>
              <Repeat size={11} />
            </span>
          )}
        </span>
        <div className="flex gap-1">
          <button onClick={() => onMove(task.id, -1)} disabled={!canMoveLeft} className="p-0.5 rounded disabled:opacity-20" style={{ color: TOKENS.textMuted }} aria-label="Move back">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => onMove(task.id, 1)} disabled={!canMoveRight} className="p-0.5 rounded disabled:opacity-20" style={{ color: TOKENS.textMuted }} aria-label="Move forward">
            <ChevronRight size={14} />
          </button>
          <button onClick={() => onDelete(task.id)} className="p-0.5 rounded" style={{ color: TOKENS.textMuted }} aria-label="Delete task">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <p
        onClick={() => onOpen(task.id)}
        className="font-display font-semibold text-sm leading-snug mb-3 cursor-pointer"
        style={{ color: TOKENS.text }}
      >
        {task.title}
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center" style={{ marginLeft: 2 }}>
          {members.map((member) => (
            <div
              key={member.id}
              title={member.name}
              className="w-5 h-5 rounded-full flex items-center justify-center font-display"
              style={{ fontSize: 8, background: hexToRgba(member.color, 0.2), color: member.color, border: `2px solid ${TOKENS.surface2}`, marginLeft: -6 }}
            >
              {member.initials}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {commentCount > 0 && (
            <button
              onClick={() => onOpen(task.id)}
              className="flex items-center gap-1 font-mono text-xs"
              style={{ color: TOKENS.textFaint }}
              aria-label={`${commentCount} comments`}
            >
              <MessageSquare size={11} /> {commentCount}
            </button>
          )}
          <span className="font-mono text-xs" style={{ color: tone.color }}>{formatDue(task.due)}</span>
        </div>
      </div>
    </div>
  );
}

function TaskDetailModal({ task, project, members, team, comments, onClose, onAddComment, onDeleteComment, onUpdateStartDate }) {
  const [authorId, setAuthorId] = useState(team[0]?.id || '');
  const [body, setBody] = useState('');
  const tone = dueTone(task.due);

  const thread = comments
    .filter((c) => c.taskId === task.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  function submit(e) {
    e.preventDefault();
    if (!body.trim() || !authorId) return;
    onAddComment(authorId, body.trim());
    setBody('');
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden flex flex-col animate-fadein"
        style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: PRIORITY_COLOR[task.priority] }}>
              {task.priority} · {STATUS_LABEL[task.status]}
            </p>
            <h2 className="font-display font-semibold text-base leading-snug" style={{ color: TOKENS.text }}>{task.title}</h2>
            {project && <p className="text-xs mt-1" style={{ color: TOKENS.textFaint }}>{project.name}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: TOKENS.textMuted, flexShrink: 0 }}><X size={16} /></button>
        </div>

        <div className="flex items-center justify-between px-4 py-2.5 flex-wrap gap-2" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {members.map((m) => (
              <span key={m.id} className="px-2 py-1 rounded-full text-xs" style={{ background: hexToRgba(m.color, 0.12), color: m.color }}>
                {m.name}
              </span>
            ))}
            {members.length === 0 && <span className="text-xs italic" style={{ color: TOKENS.textFaint }}>Unassigned</span>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <label className="flex items-center gap-1 text-xs" style={{ color: TOKENS.textFaint }}>
              Start
              <input
                type="date"
                value={task.startDate || ''}
                max={task.due}
                onChange={(e) => onUpdateStartDate(task.id, e.target.value || null)}
                className="rounded px-1.5 py-0.5 text-xs"
                style={inputStyle}
                title="Start date — used for the Gantt view"
              />
            </label>
            <span className="font-mono text-xs" style={{ color: tone.color }}>{formatDue(task.due)}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5" style={{ minHeight: 80 }}>
          {thread.length === 0 && <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>No comments yet.</p>}
          {thread.map((c) => {
            const author = team.find((m) => m.id === c.authorId);
            return (
              <div key={c.id} className="rounded-lg p-2.5" style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-medium" style={{ color: author?.color || TOKENS.text }}>{author?.name || 'Former member'}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono" style={{ fontSize: 10, color: TOKENS.textFaint }}>{formatLogTimestamp(c.createdAt)}</span>
                    <button onClick={() => onDeleteComment(c.id)} aria-label="Delete comment" style={{ color: TOKENS.textMuted }}><Trash2 size={12} /></button>
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap" style={{ color: TOKENS.text }}>{c.body}</p>
              </div>
            );
          })}
        </div>

        {team.length === 0 ? (
          <p className="text-xs italic px-4 py-3" style={{ color: TOKENS.textFaint, borderTop: `1px solid ${TOKENS.border}` }}>
            Add a team member to leave a comment.
          </p>
        ) : (
          <form onSubmit={submit} className="flex items-end gap-2 p-3" style={{ borderTop: `1px solid ${TOKENS.border}` }}>
            <select value={authorId} onChange={(e) => setAuthorId(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm flex-shrink-0" style={inputStyle}>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>)}
            </select>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment…"
              rows={1}
              className="rounded-lg px-3 py-1.5 text-sm flex-1 resize-none"
              style={inputStyle}
            />
            <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-medium flex-shrink-0" style={{ background: TOKENS.blue, color: '#0B0D11' }}>
              Post
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function TimelineSection({ title, icon: Icon, color, items, team }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={15} style={{ color }} />
        <span className="font-display font-semibold text-sm tracking-wide" style={{ color: TOKENS.text }}>{title}</span>
        <span className="font-mono text-xs" style={{ color: TOKENS.textFaint }}>({items.length})</span>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${TOKENS.border}` }}>
        {items.map((task, i) => {
          const members = task.assignees.map((id) => team.find((m) => m.id === id)).filter(Boolean);
          const tone = dueTone(task.due);
          return (
            <div
              key={task.id}
              className="flex items-center gap-3 px-4 py-3"
              style={{ background: TOKENS.surface, borderTop: i > 0 ? `1px solid ${TOKENS.border}` : 'none', borderLeft: `3px solid ${color}` }}
            >
              <div className="flex items-center flex-shrink-0" style={{ marginLeft: 2 }}>
                {members.map((member) => (
                  <div
                    key={member.id}
                    title={member.name}
                    className="w-7 h-7 rounded-full flex items-center justify-center font-display"
                    style={{ fontSize: 10, background: hexToRgba(member.color, 0.18), color: member.color, border: `2px solid ${TOKENS.surface}`, marginLeft: -8 }}
                  >
                    {member.initials}
                  </div>
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: TOKENS.text }}>{task.title}</p>
                <p className="text-xs truncate" style={{ color: TOKENS.textMuted }}>{members.map((m) => m.name).join(', ')} · {STATUS_LABEL[task.status]}</p>
              </div>
              <span className="font-mono text-xs whitespace-nowrap" style={{ color: tone.color }}>{formatDue(task.due)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed z-50 flex flex-col gap-2" style={{ bottom: 16, right: 16, maxWidth: 320 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-lg px-3 py-2.5 text-sm flex items-start gap-2 animate-fadein"
          style={{ background: TOKENS.surface2, border: `1px solid ${hexToRgba(TOKENS.coral, 0.4)}`, color: TOKENS.text, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}
        >
          <AlertTriangle size={14} style={{ color: TOKENS.coral, marginTop: 2, flexShrink: 0 }} />
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} style={{ color: TOKENS.textMuted }} aria-label="Dismiss"><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

const CONFETTI_COLORS = [TOKENS.blue, TOKENS.teal, TOKENS.amber, TOKENS.coral, TOKENS.violet, TOKENS.magenta];

function ConfettiBurst({ pieceCount = 40 }) {
  const pieces = useMemo(
    () => Array.from({ length: pieceCount }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.3,
      duration: 1.3 + Math.random() * 0.9,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 6 + Math.random() * 5,
    })),
    [pieceCount]
  );

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" style={{ overflow: 'hidden' }}>
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            top: -20,
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.5,
            background: p.color,
            borderRadius: 2,
            animation: `confettiFall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

function CelebrationBanner({ message }) {
  return (
    <div className="fixed z-50 animate-fadein" style={{ top: 72, left: '50%', transform: 'translateX(-50%)' }}>
      <div
        className="px-4 py-2.5 rounded-full text-sm font-medium whitespace-nowrap"
        style={{ background: TOKENS.surface, border: `1px solid ${hexToRgba(TOKENS.teal, 0.4)}`, color: TOKENS.text, boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}
      >
        {message}
      </div>
    </div>
  );
}

function GlobalSearch({ projects, tasks, onSelectProject, onSelectTask }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const matchingProjects = q.length >= 2 ? projects.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const matchingTasks = q.length >= 2 ? tasks.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 8) : [];
  const hasResults = matchingProjects.length > 0 || matchingTasks.length > 0;

  function selectProject(p) {
    onSelectProject(p.id);
    setQuery('');
    setOpen(false);
  }
  function selectTask(t) {
    onSelectTask(t);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full" style={{ background: TOKENS.surface }}>
        <Search size={14} style={{ color: TOKENS.textMuted, flexShrink: 0 }} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search…"
          className="bg-transparent outline-none text-sm w-24 sm:w-40"
          style={{ color: TOKENS.text }}
        />
      </div>
      {open && q.length >= 2 && (
        <div
          className="absolute right-0 mt-2 rounded-xl overflow-hidden z-20"
          style={{ width: 280, maxHeight: 320, overflowY: 'auto', background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}
        >
          {!hasResults && <p className="text-xs italic px-3 py-4" style={{ color: TOKENS.textFaint }}>No matches.</p>}
          {matchingProjects.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide px-3 pt-2.5 pb-1" style={{ color: TOKENS.textFaint }}>Projects</p>
              {matchingProjects.map((p) => (
                <button key={p.id} onMouseDown={() => selectProject(p)} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2" style={{ color: TOKENS.text }}>
                  <FolderKanban size={13} style={{ color: TOKENS.textMuted, flexShrink: 0 }} /> <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}
          {matchingTasks.length > 0 && (
            <div>
              <p
                className="text-xs font-medium uppercase tracking-wide px-3 pt-2.5 pb-1"
                style={{ color: TOKENS.textFaint, borderTop: matchingProjects.length ? `1px solid ${TOKENS.border}` : 'none' }}
              >
                Tasks
              </p>
              {matchingTasks.map((t) => {
                const project = projects.find((p) => p.id === t.projectId);
                return (
                  <button key={t.id} onMouseDown={() => selectTask(t)} className="w-full text-left px-3 py-2 text-sm">
                    <p className="truncate" style={{ color: TOKENS.text }}>{t.title}</p>
                    <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>{project ? project.name : 'Unknown project'} · {STATUS_LABEL[t.status]}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium flex-shrink-0"
      style={{ background: TOKENS.surface2, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}
    >
      {copied ? <Check size={13} style={{ color: TOKENS.teal }} /> : <Copy size={13} />}
      {(copied || label) && (copied ? 'Copied' : label)}
    </button>
  );
}

function AddLogForm({ onAdd }) {
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('progress');

  function submit(e) {
    e.preventDefault();
    if (!note.trim()) return;
    onAdd({ note: note.trim(), tag });
    setNote('');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 mb-4 p-3 rounded-xl" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Quick note about behaviour or progress…"
        rows={2}
        className="rounded-lg px-3 py-2 text-sm resize-none"
        style={inputStyle}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle}>
          {LOG_TAGS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5" style={{ background: TOKENS.blue, color: '#0B0D11' }}>
          <Plus size={14} /> Add log
        </button>
      </div>
    </form>
  );
}

function formatLogTimestamp(iso) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatLogsAsText(personName, entries) {
  if (entries.length === 0) return `${personName} — no log entries yet.`;
  const lines = entries.map((e) => `[${formatLogTimestamp(e.createdAt)}]${e.tag ? ` (${LOG_TAGS.find((t) => t.id === e.tag)?.label || e.tag})` : ''} ${e.note}`);
  return `${personName} — log entries\n\n${lines.join('\n')}`;
}

// Lightweight, dependency-free renderer for the small subset of markdown the
// AI features (digest/summarize) actually produce: #/##/### headings,
// **bold**, and (possibly nested) "- " bullet lists.
function renderMarkdownInline(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
  );
}

function renderMarkdown(text) {
  const lines = text.split('\n');
  const elements = [];
  let key = 0;
  let i = 0;

  function renderList(minIndent) {
    const items = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') { i++; continue; }
      const indent = line.match(/^(\s*)/)[1].length;
      const bulletMatch = line.trim().match(/^[-*]\s+(.*)$/);
      if (!bulletMatch || indent < minIndent) break;
      if (indent > minIndent) {
        const nested = renderList(indent);
        if (items.length > 0) items[items.length - 1].children = nested;
        continue;
      }
      items.push({ text: bulletMatch[1] });
      i++;
    }
    const listKey = key++;
    return (
      <ul key={`ul-${listKey}`} className="list-disc pl-5 space-y-1">
        {items.map((item, idx) => (
          <li key={idx}>
            {renderMarkdownInline(item.text, `li-${listKey}-${idx}`)}
            {item.children}
          </li>
        ))}
      </ul>
    );
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '') { i++; continue; }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level === 1 ? 'text-base font-display font-semibold mt-3 mb-1.5' : 'text-sm font-display font-semibold mt-3 mb-1';
      elements.push(<p key={`h-${key}`} className={cls} style={{ color: TOKENS.text }}>{renderMarkdownInline(headingMatch[2], `h-${key++}`)}</p>);
      i++;
      continue;
    }

    const indent = line.match(/^(\s*)/)[1].length;
    if (trimmed.match(/^[-*]\s+/)) {
      elements.push(renderList(indent));
      continue;
    }

    elements.push(<p key={`p-${key}`} className="mb-1.5">{renderMarkdownInline(trimmed, `p-${key++}`)}</p>);
    i++;
  }

  return elements;
}

function LogsPanel({ team, logs, onAdd, onDelete, accessToken }) {
  const [personId, setPersonId] = useState(team[0]?.id || null);
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  useEffect(() => {
    if (!personId && team.length) setPersonId(team[0].id);
  }, [team, personId]);

  const person = team.find((m) => m.id === personId);
  const entries = logs
    .filter((l) => l.personId === personId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  function switchPerson(id) {
    setPersonId(id);
    setSummary('');
    setSummaryError('');
  }

  async function summarize() {
    setSummarizing(true);
    setSummaryError('');
    setSummary('');
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          person: person.name,
          entries: entries.map((e) => ({ note: e.note, tag: e.tag, created_at: e.createdAt })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Summary failed');
      setSummary(data.summary || '');
    } catch (err) {
      setSummaryError(err.message || 'Summary failed');
    } finally {
      setSummarizing(false);
    }
  }

  if (team.length === 0 || !person) {
    return <p className="text-sm italic" style={{ color: TOKENS.textFaint }}>Add a team member to start logging notes.</p>;
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {team.map((m) => (
          <button
            key={m.id}
            onClick={() => switchPerson(m.id)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm"
            style={{
              background: personId === m.id ? hexToRgba(m.color, 0.15) : TOKENS.surface,
              border: `1px solid ${personId === m.id ? hexToRgba(m.color, 0.4) : TOKENS.border}`,
              color: personId === m.id ? TOKENS.text : TOKENS.textMuted,
            }}
          >
            <span className="w-5 h-5 rounded-full flex items-center justify-center font-display" style={{ fontSize: 9, background: hexToRgba(m.color, 0.2), color: m.color }}>
              {m.initials}
            </span>
            {m.name}
          </button>
        ))}
      </div>

      <AddLogForm onAdd={(l) => onAdd(personId, l)} />

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: TOKENS.textFaint }}>
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} for {person.name}
        </span>
        <div className="flex items-center gap-2">
          <CopyButton text={formatLogsAsText(person.name, entries)} label="Copy all" />
          <button
            type="button"
            onClick={summarize}
            disabled={entries.length === 0 || summarizing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: hexToRgba(TOKENS.violet, 0.15), color: TOKENS.violet, border: `1px solid ${hexToRgba(TOKENS.violet, 0.4)}` }}
          >
            {summarizing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {summarizing ? 'Summarizing…' : 'Summarize'}
          </button>
        </div>
      </div>

      {summaryError && <p className="text-xs mb-3" style={{ color: TOKENS.coral }}>{summaryError}</p>}

      {summary && (
        <div className="rounded-xl p-4 mb-4" style={{ background: hexToRgba(TOKENS.violet, 0.08), border: `1px solid ${hexToRgba(TOKENS.violet, 0.3)}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5" style={{ color: TOKENS.violet }}>
              <Sparkles size={12} /> Summary
            </span>
            <CopyButton text={summary} label="Copy" />
          </div>
          <div className="text-sm leading-relaxed" style={{ color: TOKENS.text }}>{renderMarkdown(summary)}</div>
        </div>
      )}

      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>No log entries yet for {person.name}.</p>
        )}
        {entries.map((entry) => {
          const tagInfo = LOG_TAGS.find((t) => t.id === entry.tag);
          return (
            <div key={entry.id} className="rounded-lg p-3" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  {tagInfo && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: hexToRgba(tagInfo.color, 0.15), color: tagInfo.color }}>
                      {tagInfo.label}
                    </span>
                  )}
                  <span className="font-mono text-xs" style={{ color: TOKENS.textFaint }}>{formatLogTimestamp(entry.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <CopyButton text={entry.note} label="" />
                  <button onClick={() => onDelete(entry.id)} className="p-1 rounded" style={{ color: TOKENS.textMuted }} aria-label="Delete log entry">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: TOKENS.text }}>{entry.note}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeeklyDigestPanel({ projects, tasks, team, comments, logs, accessToken, isManagement }) {
  const [digest, setDigest] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setLoading(true);
    setError('');
    setDigest('');
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000);
      const openTasks = tasks.filter((t) => t.status !== 'done');

      const taskLine = (t) => {
        const project = projects.find((p) => p.id === t.projectId);
        const names = t.assignees.map((id) => team.find((m) => m.id === id)?.name).filter(Boolean).join(', ');
        return `- ${t.title} (${project?.name || 'Unknown project'}) — due ${t.due}${names ? `, assigned to ${names}` : ''}`;
      };
      const overdue = openTasks.filter((t) => daysUntil(t.due) < 0).map(taskLine);
      const dueSoon = openTasks.filter((t) => { const d = daysUntil(t.due); return d >= 0 && d <= 7; }).map(taskLine);

      const recentComments = comments
        .filter((c) => new Date(c.createdAt) >= weekAgo)
        .map((c) => {
          const task = tasks.find((t) => t.id === c.taskId);
          const author = team.find((m) => m.id === c.authorId);
          return `- ${author?.name || 'Someone'} on "${task?.title || 'a task'}": ${c.body}`;
        });
      const recentLogs = logs
        .filter((l) => new Date(l.createdAt) >= weekAgo)
        .map((l) => {
          const person = team.find((m) => m.id === l.personId);
          return `- ${person?.name || 'Someone'}${l.tag ? ` (${l.tag})` : ''}: ${l.note}`;
        });
      const members = team.map((m) => {
        const mine = tasks.filter((t) => t.assignees.includes(m.id) && t.status !== 'done');
        const overdueCount = mine.filter((t) => daysUntil(t.due) < 0).length;
        return `- ${m.name}: ${mine.length} open${overdueCount ? `, ${overdueCount} overdue` : ''}`;
      });

      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ overdue, dueSoon, comments: recentComments, logs: recentLogs, members }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Digest failed');
      setDigest(data.digest || '');
    } catch (err) {
      setError(err.message || 'Digest failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl p-4 mb-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="font-display font-semibold text-sm flex items-center gap-2">
          <Sparkles size={15} style={{ color: TOKENS.violet }} /> Weekly digest
        </h2>
        <div className="flex items-center gap-2">
          {digest && <CopyButton text={digest} label="Copy" />}
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: hexToRgba(TOKENS.violet, 0.15), color: TOKENS.violet, border: `1px solid ${hexToRgba(TOKENS.violet, 0.4)}` }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {loading ? 'Generating…' : digest ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>
      <p className="text-xs mb-3" style={{ color: TOKENS.textFaint }}>
        Overdue and due-soon tasks, the last 7 days of comments{isManagement ? ' and logs' : ''}, and per-member load across every project — copy it into Slack or an email yourself.
      </p>
      {error && <p className="text-xs mb-2" style={{ color: TOKENS.coral }}>{error}</p>}
      {digest && (
        <div className="text-sm leading-relaxed rounded-lg p-3" style={{ color: TOKENS.text, background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}>
          {renderMarkdown(digest)}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------- app ------------------------------------ */

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [logs, setLogs] = useState(INITIAL_LOGS);
  const [team, setTeam] = useState(INITIAL_TEAM);
  const [comments, setComments] = useState(INITIAL_COMMENTS);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [activeTab, setActiveTab] = useUrlTab(TABS, 'projects');
  const { theme, toggleTheme } = useTheme();
  const themeHex = THEME_HEX[theme];
  const [selectedMember, setSelectedMember] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [timelineView, setTimelineView] = useState('list');
  const [openMemberStat, setOpenMemberStat] = useState(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [loading, setLoading] = useState(true);
  // Least-privilege default: treated as an operator until an app_roles row
  // proves otherwise, both here and (for real) in the logs RLS policy.
  const [isManagement, setIsManagement] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [celebration, setCelebration] = useState(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);

  function jumpToProject(id) {
    setSelectedProjectId(id);
    setActiveTab('board');
  }
  function jumpToTask(task) {
    setSelectedProjectId(task.projectId);
    setActiveTab('board');
    setSelectedMember(null);
    setHighlightedTaskId(task.id);
    setTimeout(() => setHighlightedTaskId((prev) => (prev === task.id ? null : prev)), 2500);
  }

  function pushToast(message) {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }
  function dismissToast(id) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function celebrate(message) {
    const token = Date.now();
    setCelebration({ token, message });
    setTimeout(() => setCelebration((prev) => (prev?.token === token ? null : prev)), 2200);
  }

  // Fires the celebration when a task lands on Done — a bigger one if that
  // was the project's last open task.
  function celebrateCompletion(completedTask) {
    const siblings = tasks.filter((t) => t.projectId === completedTask.projectId);
    const allDone = siblings.every((t) => (t.id === completedTask.id ? true : t.status === 'done'));
    if (allDone) {
      const project = projects.find((p) => p.id === completedTask.projectId);
      celebrate(`🎉 ${project ? project.name : 'Project'} complete!`);
    } else {
      celebrate('Nice — task complete!');
    }
  }

  const currentProject = projects.find((p) => p.id === selectedProjectId) || null;
  const projectTasks = tasks.filter((t) => t.projectId === selectedProjectId);
  // True first run: nothing's been set up at all yet, vs. "projects exist but
  // none is currently selected" (e.g. after deleting the active one).
  const isFirstRun = !loading && projects.length === 0 && team.length === 0;
  // Logs/Admin are management-only. useUrlTab stays on the full TABS list
  // (see its call site) so a direct ?tab=logs link isn't bounced before
  // isManagement has finished loading — this filtered list only controls
  // what's offered in nav/palette.
  const visibleTabs = TABS.filter((t) => !MANAGEMENT_ONLY_TABS.has(t.id) || isManagement);

  // Cmd/Ctrl+K opens the command palette from anywhere, including while
  // focused in another input — that's the whole point of the shortcut.
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Track the signed-in session; the app renders a login gate until one exists.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }
  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    // Supabase returns a user with no session when email confirmation is
    // required — surface that so LoginScreen can prompt for it rather than
    // silently doing nothing.
    return { error, needsConfirmation: !error && !data.session };
  }
  async function signOut() {
    await supabase.auth.signOut();
  }

  // Load private data from Supabase once signed in.
  useEffect(() => {
    if (!session) return;
    (async () => {
      setLoading(true);
      const [
        { data: projectRows, error: projErr },
        { data: taskRows, error: taskErr },
        { data: logRows, error: logErr },
        { data: teamRows, error: teamErr },
        { data: commentRows, error: commentErr },
        { data: roleRow, error: roleErr },
      ] = await Promise.all([
        supabase.from('projects').select('*'),
        supabase.from('tasks').select('*'),
        supabase.from('logs').select('*'),
        supabase.from('team_members').select('*'),
        supabase.from('task_comments').select('*'),
        supabase.from('app_roles').select('access_tier').eq('auth_user_id', session.user.id).maybeSingle(),
      ]);
      if (projErr) console.error('Failed to load projects', projErr);
      if (taskErr) console.error('Failed to load tasks', taskErr);
      if (logErr) console.error('Failed to load logs', logErr);
      if (teamErr) console.error('Failed to load team', teamErr);
      if (commentErr) console.error('Failed to load comments', commentErr);
      if (roleErr) console.error('Failed to load access tier — defaulting to operator', roleErr);
      setProjects((projectRows || []).map(projectFromRow));
      setLogs((logRows || []).map(logFromRow));
      setTeam((teamRows || []).map(memberFromRow));
      setComments((commentRows || []).map(commentFromRow));
      setIsManagement(roleRow?.access_tier === 'management');
      setLoading(false);

      // Auto-escalate: any open task that's gone overdue and isn't already
      // High gets bumped, so priority reflects urgency without someone having
      // to notice and change it by hand.
      const loadedTasks = (taskRows || []).map(taskFromRow);
      const toEscalate = [];
      const withEscalation = loadedTasks.map((t) => {
        if (t.status !== 'done' && t.priority !== 'high' && daysUntil(t.due) < 0) {
          toEscalate.push(t.id);
          return { ...t, priority: 'high' };
        }
        return t;
      });
      setTasks(withEscalation);
      if (toEscalate.length > 0) {
        pushToast(`${toEscalate.length} overdue task${toEscalate.length === 1 ? '' : 's'} auto-escalated to High priority.`);
        const results = await Promise.all(toEscalate.map((id) => supabase.from('tasks').update({ priority: 'high' }).eq('id', id)));
        const err = results.find((r) => r.error)?.error;
        if (err) console.error('Failed to persist auto-escalated priority', err);
      }
    })();
  }, [session]);

  async function addProject({ name, subtitle, deadline, customerId }) {
    const id = `p${projects.length}-${name.toLowerCase().replace(/\s+/g, '-')}-${Math.round(Math.random() * 1e6)}`;
    const project = { id, name, subtitle, deadline, customerId };
    setProjects((prev) => [...prev, project]);
    setSelectedProjectId(id);
    setActiveTab('board');
    const { error } = await supabase.from('projects').insert(projectToRow(project));
    if (error) {
      console.error('Failed to save project', error);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      pushToast('Failed to save project — try again.');
    }
  }
  async function deleteProject(id) {
    const removedProject = projects.find((p) => p.id === id);
    const removedTasks = tasks.filter((t) => t.projectId === id);
    const removedTaskIds = removedTasks.map((t) => t.id);
    const removedComments = comments.filter((c) => removedTaskIds.includes(c.taskId));
    const taskLabel = removedTasks.length > 0 ? ` and its ${removedTasks.length} task${removedTasks.length === 1 ? '' : 's'}` : '';
    if (!window.confirm(`Delete "${removedProject?.name}"${taskLabel}? This can't be undone.`)) return;

    setProjects((prev) => prev.filter((p) => p.id !== id));
    setTasks((prev) => prev.filter((t) => t.projectId !== id));
    setComments((prev) => prev.filter((c) => !removedTaskIds.includes(c.taskId)));
    setSelectedProjectId((prev) => (prev === id ? null : prev));
    setOpenTaskId((prev) => (removedTaskIds.includes(prev) ? null : prev));
    // Delete child rows explicitly first — nothing here guarantees an ON DELETE
    // CASCADE foreign key exists in the DB, so this keeps rows from being
    // orphaned even if one isn't set up.
    const { error: commentsError } = removedTaskIds.length > 0
      ? await supabase.from('task_comments').delete().in('task_id', removedTaskIds)
      : { error: null };
    const { error: tasksError } = await supabase.from('tasks').delete().eq('project_id', id);
    const { error: projectError } = await supabase.from('projects').delete().eq('id', id);
    if (commentsError || tasksError || projectError) {
      console.error('Failed to delete project', commentsError || tasksError || projectError);
      if (removedProject) setProjects((prev) => [...prev, removedProject]);
      setTasks((prev) => [...prev, ...removedTasks]);
      setComments((prev) => [...prev, ...removedComments]);
      pushToast('Failed to delete project — try again.');
    }
  }

  async function addTask({ title, assignees, priority, due, repeat, startDate }) {
    const id = `t${tasks.length}-${Math.round(Math.random() * 1e6)}`;
    const task = { id, title, assignees, priority, due, status: 'backlog', projectId: selectedProjectId, repeat: repeat || 'none', startDate: startDate || null };
    setTasks((prev) => [...prev, task]);
    const { error } = await supabase.from('tasks').insert(taskToRow(task));
    if (error) {
      console.error('Failed to save task', error);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      pushToast('Failed to save task — try again.');
    }
  }
  // Creates the next occurrence of a recurring task once its current one is marked done.
  async function spawnRecurringTask(task) {
    const id = `t${tasks.length}-${Math.round(Math.random() * 1e6)}`;
    const nextTask = {
      id,
      title: task.title,
      assignees: task.assignees,
      priority: task.priority,
      due: advanceDueDate(task.due, task.repeat),
      status: 'backlog',
      projectId: task.projectId,
      repeat: task.repeat,
    };
    setTasks((prev) => [...prev, nextTask]);
    const { error } = await supabase.from('tasks').insert(taskToRow(nextTask));
    if (error) {
      console.error('Failed to create recurring task', error);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      pushToast(`Completed, but couldn't schedule the next "${task.title}" — try again.`);
    } else {
      pushToast(`Next "${task.title}" scheduled for ${nextTask.due}.`);
    }
  }
  async function deleteTask(id) {
    if (!window.confirm('Delete this task? This can\'t be undone.')) return;
    const removed = tasks.find((t) => t.id === id);
    const removedComments = comments.filter((c) => c.taskId === id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setComments((prev) => prev.filter((c) => c.taskId !== id));
    setOpenTaskId((prev) => (prev === id ? null : prev));
    const { error: commentsError } = await supabase.from('task_comments').delete().eq('task_id', id);
    const { error: taskError } = await supabase.from('tasks').delete().eq('id', id);
    if (commentsError || taskError) {
      console.error('Failed to delete task', commentsError || taskError);
      if (removed) setTasks((prev) => [...prev, removed]);
      setComments((prev) => [...prev, ...removedComments]);
      pushToast('Failed to delete task — try again.');
    }
  }
  function handleDragStart(e, taskId) {
    e.dataTransfer.setData('text/plain', taskId);
  }
  async function handleDrop(e, status) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const original = tasks.find((t) => t.id === id);
    const prevStatus = original?.status;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    const { error } = await supabase.from('tasks').update({ status }).eq('id', id);
    if (error) {
      console.error('Failed to update task status', error);
      if (prevStatus) setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: prevStatus } : t)));
      pushToast('Failed to move task — try again.');
      return;
    }
    if (status === 'done' && prevStatus !== 'done' && original) {
      celebrateCompletion(original);
      if (original.repeat && original.repeat !== 'none') spawnRecurringTask(original);
    }
  }
  async function updateTaskStartDate(id, startDate) {
    const original = tasks.find((t) => t.id === id);
    const prevStartDate = original?.startDate ?? null;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, startDate } : t)));
    const { error } = await supabase.from('tasks').update({ start_date: startDate }).eq('id', id);
    if (error) {
      console.error('Failed to update task start date', error);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, startDate: prevStartDate } : t)));
      pushToast('Failed to update start date — try again.');
    }
  }
  async function moveTask(id, direction) {
    let newStatus = null;
    let prevStatus = null;
    let movedTask = null;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        prevStatus = t.status;
        const idx = STATUSES.indexOf(t.status);
        const newIdx = Math.min(Math.max(idx + direction, 0), STATUSES.length - 1);
        newStatus = STATUSES[newIdx];
        movedTask = t;
        return { ...t, status: newStatus };
      })
    );
    if (newStatus) {
      const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', id);
      if (error) {
        console.error('Failed to update task status', error);
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: prevStatus } : t)));
        pushToast('Failed to move task — try again.');
        return;
      }
      if (newStatus === 'done' && prevStatus !== 'done' && movedTask) {
        celebrateCompletion(movedTask);
        if (movedTask.repeat && movedTask.repeat !== 'none') spawnRecurringTask(movedTask);
      }
    }
  }

  function exportProjectCalendar() {
    if (!currentProject) return;
    const events = [];
    if (currentProject.deadline) {
      events.push({ uid: `project-${currentProject.id}`, date: currentProject.deadline, title: `${currentProject.name} — deadline`, description: currentProject.subtitle || '' });
    }
    projectTasks
      .filter((t) => t.status !== 'done')
      .forEach((t) => {
        const names = t.assignees.map((id) => team.find((m) => m.id === id)?.name).filter(Boolean).join(', ');
        events.push({ uid: `task-${t.id}`, date: t.due, title: t.title, description: names ? `Assigned: ${names}` : '' });
      });
    if (events.length === 0) {
      pushToast('Nothing to export — no deadlines on this project yet.');
      return;
    }
    const filename = `${currentProject.name.toLowerCase().replace(/\s+/g, '-')}-deadlines.ics`;
    downloadTextFile(filename, buildICS(events), 'text/calendar;charset=utf-8');
  }

  async function addLog(personId, { note, tag }) {
    const id = crypto.randomUUID();
    const log = { id, personId, note, tag, createdAt: new Date().toISOString() };
    setLogs((prev) => [...prev, log]);
    const { error } = await supabase.from('logs').insert(logToRow(log));
    if (error) {
      console.error('Failed to save log', error);
      setLogs((prev) => prev.filter((l) => l.id !== id));
      pushToast('Failed to save log entry — try again.');
    }
  }
  async function deleteLog(id) {
    const removed = logs.find((l) => l.id === id);
    setLogs((prev) => prev.filter((l) => l.id !== id));
    const { error } = await supabase.from('logs').delete().eq('id', id);
    if (error) {
      console.error('Failed to delete log', error);
      if (removed) setLogs((prev) => [...prev, removed]);
      pushToast('Failed to delete log entry — try again.');
    }
  }

  async function addComment(taskId, authorId, body) {
    const id = crypto.randomUUID();
    const comment = { id, taskId, authorId, body, createdAt: new Date().toISOString() };
    setComments((prev) => [...prev, comment]);
    const { error } = await supabase.from('task_comments').insert(commentToRow(comment));
    if (error) {
      console.error('Failed to save comment', error);
      setComments((prev) => prev.filter((c) => c.id !== id));
      pushToast('Failed to save comment — try again.');
    }
  }
  async function deleteComment(id) {
    const removed = comments.find((c) => c.id === id);
    setComments((prev) => prev.filter((c) => c.id !== id));
    const { error } = await supabase.from('task_comments').delete().eq('id', id);
    if (error) {
      console.error('Failed to delete comment', error);
      if (removed) setComments((prev) => [...prev, removed]);
      pushToast('Failed to delete comment — try again.');
    }
  }

  async function addMember({ name, role }) {
    const id = `m${team.length}-${Math.round(Math.random() * 1e6)}`;
    const member = { id, name, role: role || 'Team member', color: MEMBER_COLORS[team.length % MEMBER_COLORS.length], initials: initialsFromName(name), skills: [] };
    setTeam((prev) => [...prev, member]);
    const { error } = await supabase.from('team_members').insert(memberToRow(member));
    if (error) {
      console.error('Failed to save team member', error);
      setTeam((prev) => prev.filter((m) => m.id !== id));
      pushToast('Failed to save team member — try again.');
    }
  }
  async function deleteMember(id) {
    const removedMember = team.find((m) => m.id === id);
    const affectedTasks = tasks.filter((t) => t.assignees.includes(id));
    const warning = affectedTasks.length > 0 ? ` They'll be unassigned from ${affectedTasks.length} task${affectedTasks.length === 1 ? '' : 's'}.` : '';
    if (!window.confirm(`Remove ${removedMember?.name}?${warning}`)) return;

    setTeam((prev) => prev.filter((m) => m.id !== id));
    setSelectedMember((prev) => (prev === id ? null : prev));
    setTasks((prev) => prev.map((t) => (t.assignees.includes(id) ? { ...t, assignees: t.assignees.filter((a) => a !== id) } : t)));

    const { error: memberError } = await supabase.from('team_members').delete().eq('id', id);
    if (memberError) {
      console.error('Failed to delete team member', memberError);
      if (removedMember) setTeam((prev) => [...prev, removedMember]);
      setTasks((prev) => prev.map((t) => {
        const original = affectedTasks.find((a) => a.id === t.id);
        return original ? { ...t, assignees: original.assignees } : t;
      }));
      pushToast('Failed to remove team member — try again.');
      return;
    }
    if (affectedTasks.length > 0) {
      const results = await Promise.all(
        affectedTasks.map((t) => supabase.from('tasks').update({ assignees: t.assignees.filter((a) => a !== id) }).eq('id', t.id))
      );
      const taskError = results.find((r) => r.error)?.error;
      if (taskError) {
        console.error('Failed to update task assignees after removing member', taskError);
        pushToast('Member removed, but some tasks may still reference them.');
      }
    }
  }

  // Team-wide workload stats — deliberately span every project, not just the active one.
  const memberStats = useMemo(() => {
    return team.map((m) => {
      const mine = tasks.filter((t) => t.assignees.includes(m.id));
      const done = mine.filter((t) => t.status === 'done').length;
      const total = mine.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const active = mine.filter((t) => t.status !== 'done');
      const overdueTasks = active.filter((t) => daysUntil(t.due) < 0);
      const dueSoonTasks = active.filter((t) => { const d = daysUntil(t.due); return d >= 0 && d <= 3; });
      const overdue = overdueTasks.length;
      const dueSoon = dueSoonTasks.length;
      let tone = TOKENS.teal, pulse = false;
      if (overdue > 0) { tone = TOKENS.coral; pulse = true; }
      else if (dueSoon > 0) { tone = TOKENS.amber; pulse = true; }
      return { ...m, done, total, pct, active, overdueTasks, dueSoonTasks, overdue, dueSoon, tone, pulse };
    });
  }, [team, tasks]);

  const totalWorkload = memberStats.reduce((sum, m) => sum + m.total, 0);

  // Projects grouped by customer for the Projects tab, so they read as
  // sub-sections instead of one flat list.
  const projectsByCustomer = useMemo(() => {
    const groups = CUSTOMERS
      .map((c) => ({ customer: c, projects: projects.filter((p) => p.customerId === c.id) }))
      .filter((g) => g.projects.length > 0);
    const unassigned = projects.filter((p) => !CUSTOMERS.some((c) => c.id === p.customerId));
    if (unassigned.length > 0) groups.push({ customer: null, projects: unassigned });
    return groups;
  }, [projects]);

  // Per-customer breakdown of who has worked on what — spans every project, like memberStats.
  const customerStats = useMemo(() => {
    return CUSTOMERS.map((c) => {
      const projectIds = new Set(projects.filter((p) => p.customerId === c.id).map((p) => p.id));
      const customerTasks = tasks.filter((t) => projectIds.has(t.projectId));
      const byMember = team
        .map((m) => ({ id: m.id, name: m.name.split(' ')[0], color: m.color, value: customerTasks.filter((t) => t.assignees.includes(m.id)).length }))
        .filter((m) => m.value > 0);
      return { ...c, total: customerTasks.length, byMember };
    });
  }, [team, projects, tasks]);

  // Current-project health — drives the header progress ring and the notification bell.
  const overall = useMemo(() => {
    const done = projectTasks.filter((t) => t.status === 'done').length;
    const total = projectTasks.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const nonDone = projectTasks.filter((t) => t.status !== 'done');
    const overdue = nonDone.filter((t) => daysUntil(t.due) < 0);
    const dueSoon = nonDone.filter((t) => { const d = daysUntil(t.due); return d >= 0 && d <= 3; });
    const tone = overdue.length > 0 ? TOKENS.coral : dueSoon.length > 0 ? TOKENS.amber : TOKENS.teal;
    return { done, total, pct, tone, atRisk: [...overdue, ...dueSoon] };
  }, [projectTasks]);

  const { overdueList, dueWeekList, laterList } = useMemo(() => {
    const nonDone = projectTasks.filter((t) => t.status !== 'done');
    const sorted = [...nonDone].sort((a, b) => daysUntil(a.due) - daysUntil(b.due));
    return {
      overdueList: sorted.filter((t) => daysUntil(t.due) < 0),
      dueWeekList: sorted.filter((t) => { const d = daysUntil(t.due); return d >= 0 && d <= 7; }),
      laterList: sorted.filter((t) => daysUntil(t.due) > 7),
    };
  }, [projectTasks]);

  const deadlineDays = currentProject?.deadline ? daysUntil(currentProject.deadline) : null;
  const selectedMemberObj = team.find((m) => m.id === selectedMember) || null;
  const openTask = tasks.find((t) => t.id === openTaskId) || null;
  const openTaskProject = openTask ? projects.find((p) => p.id === openTask.projectId) || null : null;
  const openTaskMembers = openTask ? openTask.assignees.map((id) => team.find((m) => m.id === id)).filter(Boolean) : [];
  const filteredTasks = selectedMember ? projectTasks.filter((t) => t.assignees.includes(selectedMember)) : projectTasks;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center font-body" style={{ background: TOKENS.bg, color: TOKENS.textFaint }}>
        <LoadingMark size={88} />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onSignIn={signIn} onSignUp={signUp} />;
  }

  return (
    <div className="min-h-screen font-body" style={{ background: TOKENS.bg, color: TOKENS.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-display { font-family: 'Space Grotesk', sans-serif; }
        .font-body { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'IBM Plex Mono', monospace; }
        * { box-sizing: border-box; }
        button { font-family: inherit; }
        button:focus-visible { outline: 2px solid ${TOKENS.blue}; outline-offset: 2px; border-radius: 4px; }
        ::-webkit-scrollbar { height: 8px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${TOKENS.border}; border-radius: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        @keyframes pulse-ring {
          0% { transform: scale(0.9); opacity: 0.7; }
          70%, 100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadein { animation: fadeIn 0.35s ease; }
        .stagger-item { animation: fadeIn 0.35s ease both; }
        @keyframes confettiFall {
          from { transform: translateY(0) rotate(0deg); opacity: 1; }
          to { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, .animate-fadein, .stagger-item { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* header */}
      <header className="sticky top-0 z-10 px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: TOKENS.bg, borderBottom: `1px solid ${TOKENS.border}` }}>
        <div className="flex items-center gap-3">
          <Logo />
          <div className="hidden sm:block" style={{ width: 1, height: 28, background: TOKENS.border }} />
          <div className="hidden sm:block min-w-0">
            <p className="text-sm font-display font-semibold leading-tight truncate">{currentProject ? currentProject.name : 'No active project'}</p>
            <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>{currentProject ? (currentProject.subtitle || 'No description') : 'Select or create one in Projects'} · {team.length} members</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 p-1 rounded-full w-full sm:w-auto overflow-x-auto" style={{ background: TOKENS.surface }}>
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 rounded-full text-sm flex items-center gap-1.5 transition-colors flex-shrink-0"
              style={{ background: activeTab === tab.id ? TOKENS.surface2 : 'transparent', color: activeTab === tab.id ? TOKENS.text : TOKENS.textMuted }}
            >
              <tab.icon size={14} /> <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <GlobalSearch projects={projects} tasks={tasks} onSelectProject={jumpToProject} onSelectTask={jumpToTask} />

          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden md:flex items-center gap-1 px-2 py-1 rounded-full font-mono text-xs"
            style={{ background: TOKENS.surface, color: TOKENS.textFaint }}
            aria-label="Open command palette"
            title="Command palette"
          >
            <kbd>⌘</kbd><kbd>K</kbd>
          </button>

          {deadlineDays !== null && (
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-xs" style={{ background: TOKENS.surface, color: deadlineDays < 7 ? TOKENS.amber : TOKENS.textMuted }}>
              <Calendar size={12} /> {deadlineDays}d to launch
            </div>
          )}

          <div className="relative">
            <button onClick={() => setNotifOpen((o) => !o)} className="relative p-2 rounded-full" style={{ background: TOKENS.surface }} aria-label="Notifications">
              <Bell size={15} style={{ color: TOKENS.textMuted }} />
              {overall.atRisk.length > 0 && (
                <span className="absolute flex items-center justify-center rounded-full font-mono" style={{ top: -2, right: -2, width: 15, height: 15, fontSize: 9, background: TOKENS.coral, color: TOKENS.bg }}>
                  {overall.atRisk.length}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 rounded-xl overflow-hidden" style={{ width: 280, background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}>
                <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
                  <span className="text-xs font-medium uppercase tracking-wide" style={{ color: TOKENS.textFaint }}>Needs attention</span>
                  <button onClick={() => setNotifOpen(false)} style={{ color: TOKENS.textMuted }} aria-label="Close"><X size={13} /></button>
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {overall.atRisk.length === 0 && <p className="text-xs italic px-3 py-4" style={{ color: TOKENS.textFaint }}>Nothing needs attention.</p>}
                  {overall.atRisk.map((task) => {
                    const members = task.assignees.map((id) => team.find((m) => m.id === id)).filter(Boolean);
                    const tone = dueTone(task.due);
                    return (
                      <div key={task.id} className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
                        <PulseDot color={tone.color} pulse size={6} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: TOKENS.text }}>{task.title}</p>
                          <p className="font-mono" style={{ fontSize: 10, color: tone.color }}>{formatDue(task.due)} · {members.map((m) => m.name.split(' ')[0]).join(', ')}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <RadialProgress pct={overall.pct} size={40} stroke={4} color={overall.tone} trackColor={themeHex.border}>
            <span className="font-mono" style={{ fontSize: 9, color: TOKENS.text }}><StatNumber value={overall.pct} /></span>
          </RadialProgress>

          <button onClick={toggleTheme} className="p-2 rounded-full" style={{ background: TOKENS.surface }} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun size={15} style={{ color: TOKENS.textMuted }} /> : <Moon size={15} style={{ color: TOKENS.textMuted }} />}
          </button>

          <button onClick={signOut} className="p-2 rounded-full" style={{ background: TOKENS.surface }} aria-label="Sign out" title="Sign out">
            <LogOut size={15} style={{ color: TOKENS.textMuted }} />
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row">
        {/* sidebar roster */}
        <aside className="w-full md:w-64 flex-shrink-0 md:border-r" style={{ borderColor: TOKENS.border }}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5" style={{ color: TOKENS.textFaint }}>
                <Users size={12} /> Team
              </span>
              {selectedMember && (
                <button onClick={() => setSelectedMember(null)} style={{ color: TOKENS.textMuted }} aria-label="Clear filter"><X size={12} /></button>
              )}
            </div>
            <div className="space-y-1">
              {memberStats.map((m) => {
                // The member filter only affects the Board tab — keep the roster visible
                // everywhere as reference info, but don't let it look clickable/active
                // elsewhere, since clicking here wouldn't do anything on those tabs.
                const filterable = activeTab === 'board';
                const active = filterable && selectedMember === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => filterable && setSelectedMember(active ? null : m.id)}
                    aria-disabled={!filterable}
                    title={filterable ? undefined : 'Member filtering applies to the Board tab'}
                    className={`w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors ${filterable ? '' : 'cursor-default'}`}
                    style={{ background: active ? hexToRgba(m.color, 0.12) : 'transparent', border: `1px solid ${active ? hexToRgba(m.color, 0.4) : 'transparent'}` }}
                  >
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center font-display font-semibold text-xs" style={{ background: hexToRgba(m.color, 0.18), color: m.color }}>
                        {m.initials}
                      </div>
                      <span className="absolute" style={{ bottom: -2, right: -2 }}>
                        <PulseDot color={m.tone} pulse={m.pulse} size={8} />
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: TOKENS.text }}>{m.name}</p>
                      <p className="text-xs truncate mb-1" style={{ color: TOKENS.textFaint }}>{m.role}</p>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 rounded-full overflow-hidden" style={{ height: 3, background: TOKENS.surface2 }}>
                          <div style={{ width: `${m.pct}%`, height: '100%', background: m.tone, transition: 'width 0.4s ease' }} />
                        </div>
                        <span className="font-mono flex-shrink-0" style={{ fontSize: 10, color: TOKENS.textFaint }}><StatNumber value={m.pct} /></span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* main content */}
        <main className="flex-1 p-4 md:p-6 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center" style={{ minHeight: 200 }}>
              <LoadingMark size={48} />
            </div>
          ) : (
          <div key={activeTab} className="animate-fadein">
            {activeTab === 'board' && (
              <div>
                {!currentProject ? (
                  isFirstRun ? (
                    <OnboardingEmptyState onGo={() => setActiveTab('projects')} />
                  ) : (
                    <EmptyProjectState onGo={() => setActiveTab('projects')} />
                  )
                ) : (
                  <>
                    <Breadcrumb
                      project={currentProject}
                      customer={CUSTOMERS.find((c) => c.id === currentProject.customerId)}
                      memberFilter={selectedMemberObj}
                      onClearMember={() => setSelectedMember(null)}
                    />
                    <div className="flex items-center justify-end mb-4 flex-wrap gap-2">
                      <button
                        onClick={() => setShowAddTask((s) => !s)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
                        style={{ background: showAddTask ? TOKENS.surface2 : TOKENS.blue, color: showAddTask ? TOKENS.text : '#0B0D11' }}
                      >
                        <Plus size={14} /> {showAddTask ? 'Cancel' : 'Add task'}
                      </button>
                    </div>

                    {showAddTask && (
                      <AddTaskForm
                        team={team}
                        onAdd={(t) => { addTask(t); setShowAddTask(false); }}
                        onCancel={() => setShowAddTask(false)}
                      />
                    )}

                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {STATUSES.map((status, colIdx) => {
                        const cards = filteredTasks.filter((t) => t.status === status);
                        return (
                          <div
                            key={status}
                            className="flex-shrink-0 w-64 md:w-72 stagger-item"
                            style={{ animationDelay: `${colIdx * 40}ms` }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => handleDrop(e, status)}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <span className="font-display font-semibold text-sm tracking-wide">{STATUS_LABEL[status]}</span>
                              <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: TOKENS.surface2, color: TOKENS.textMuted }}>{cards.length}</span>
                            </div>
                            <div className="rounded-xl p-2" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, minHeight: 80 }}>
                              {cards.length === 0 && (
                                <p className="text-xs italic px-2 py-4 text-center" style={{ color: TOKENS.textFaint }}>
                                  {selectedMemberObj ? `No ${STATUS_LABEL[status].toLowerCase()} tasks` : 'Nothing here'}
                                </p>
                              )}
                              {cards.map((task, taskIdx) => {
                                const members = task.assignees.map((id) => team.find((m) => m.id === id)).filter(Boolean);
                                return (
                                  <div key={task.id} className="stagger-item" style={{ animationDelay: `${taskIdx * 25}ms` }}>
                                    <TaskCard
                                      task={task}
                                      members={members}
                                      onMove={moveTask}
                                      onDragStart={handleDragStart}
                                      onDelete={deleteTask}
                                      onOpen={setOpenTaskId}
                                      canMoveLeft={colIdx > 0}
                                      canMoveRight={colIdx < STATUSES.length - 1}
                                      highlighted={task.id === highlightedTaskId}
                                      commentCount={comments.filter((c) => c.taskId === task.id).length}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'team' && (
              <div>
                <WeeklyDigestPanel projects={projects} tasks={tasks} team={team} comments={comments} logs={logs} accessToken={session.access_token} isManagement={isManagement} />

                {isManagement && (
                  <div className="rounded-xl p-4 mb-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
                    <h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
                      <Users size={15} /> Add member
                    </h2>
                    <AddMemberForm onAdd={addMember} />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  {memberStats.map((m, i) => (
                    <div key={m.id} className="rounded-xl p-4 stagger-item" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, animationDelay: `${i * 30}ms` }}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-11 h-11 rounded-full flex items-center justify-center font-display font-semibold text-sm flex-shrink-0" style={{ background: hexToRgba(m.color, 0.18), color: m.color, border: `1px solid ${hexToRgba(m.color, 0.4)}` }}>
                          {m.initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-display font-semibold text-sm truncate">{m.name}</span>
                            <PulseDot color={m.tone} pulse={m.pulse} size={7} />
                          </div>
                          <span className="text-xs" style={{ color: TOKENS.textMuted }}>{m.role}</span>
                        </div>
                        <RadialProgress pct={m.pct} size={44} stroke={4} color={m.tone} trackColor={themeHex.border}>
                          <span className="font-mono" style={{ fontSize: 10, color: TOKENS.text }}><StatNumber value={m.pct} /></span>
                        </RadialProgress>
                        {isManagement && (
                          <button onClick={() => deleteMember(m.id)} aria-label={`Remove ${m.name}`} title="Remove member" style={{ color: TOKENS.textMuted }} className="flex-shrink-0">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs mb-3 flex-wrap" style={{ color: TOKENS.textMuted }}>
                        <span className="font-mono">{m.done}/{m.total} done</span>
                        {m.overdue > 0 && (
                          <div className="relative">
                            <button
                              onClick={() => setOpenMemberStat((k) => (k === `${m.id}-overdue` ? null : `${m.id}-overdue`))}
                              className="flex items-center gap-1"
                              style={{ color: TOKENS.coral }}
                            >
                              <AlertTriangle size={12} />{m.overdue} overdue
                            </button>
                            {openMemberStat === `${m.id}-overdue` && (
                              <TaskListPopover
                                tasks={m.overdueTasks}
                                projects={projects}
                                onSelectTask={(t) => { jumpToTask(t); setOpenMemberStat(null); }}
                              />
                            )}
                          </div>
                        )}
                        {m.dueSoon > 0 && (
                          <div className="relative">
                            <button
                              onClick={() => setOpenMemberStat((k) => (k === `${m.id}-dueSoon` ? null : `${m.id}-dueSoon`))}
                              style={{ color: TOKENS.amber }}
                            >
                              {m.dueSoon} due soon
                            </button>
                            {openMemberStat === `${m.id}-dueSoon` && (
                              <TaskListPopover
                                tasks={m.dueSoonTasks}
                                projects={projects}
                                onSelectTask={(t) => { jumpToTask(t); setOpenMemberStat(null); }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {m.active.slice(0, 4).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => jumpToTask(t)}
                            title={`Jump to ${t.title}`}
                            className="text-xs px-2 py-1 rounded-full"
                            style={{ background: TOKENS.surface2, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}
                          >
                            {t.title.length > 28 ? t.title.slice(0, 26) + '…' : t.title}
                          </button>
                        ))}
                        {m.active.length === 0 && <span className="text-xs italic" style={{ color: TOKENS.textFaint }}>All caught up</span>}
                      </div>
                      <div style={{ borderTop: `1px solid ${TOKENS.border}`, paddingTop: 10 }}>
                        <p className="text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: TOKENS.textFaint }}>Skills</p>
                        <div className="flex flex-wrap gap-1.5">
                          {m.skills.map((s) => (
                            <span key={s.name} className="text-xs px-2 py-1 rounded-full" style={{ background: hexToRgba(m.color, 0.12), color: m.color, border: `1px solid ${hexToRgba(m.color, 0.35)}` }}>
                              {s.name} · {s.level}
                            </span>
                          ))}
                          {m.skills.length === 0 && <span className="text-xs italic" style={{ color: TOKENS.textFaint }}>No skills recorded yet</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
                    <div className="flex items-center gap-2 mb-4">
                      <TrendingUp size={16} style={{ color: TOKENS.textMuted }} />
                      <span className="font-display font-semibold text-sm">Completion by teammate</span>
                    </div>
                    <div style={{ width: '100%', height: 220 }}>
                      <ResponsiveContainer>
                        <BarChart data={memberStats.map((m) => ({ name: m.name.split(' ')[0], pct: m.pct, fill: m.tone }))} layout="vertical" margin={{ left: 10, right: 24, top: 4, bottom: 4 }}>
                          {/* recharts forwards tick/axisLine/cursor into raw SVG attributes, not style — need resolved hex, not a CSS var */}
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: themeHex.textMuted, fontSize: 11 }} axisLine={{ stroke: themeHex.border }} tickLine={false} />
                          <YAxis type="category" dataKey="name" width={70} tick={{ fill: themeHex.textMuted, fontSize: 12 }} axisLine={{ stroke: themeHex.border }} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: TOKENS.text }}
                            formatter={(v) => [`${v}%`, 'Complete']}
                            cursor={{ fill: themeHex.surface2 }}
                          />
                          <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={16}>
                            {memberStats.map((m, i) => <Cell key={i} fill={m.tone} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
                    <div className="flex items-center gap-2 mb-4">
                      <PieChartIcon size={16} style={{ color: TOKENS.textMuted }} />
                      <span className="font-display font-semibold text-sm">Work distribution</span>
                    </div>
                    {totalWorkload === 0 ? (
                      <div style={{ height: 220 }} className="flex items-center justify-center">
                        <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>No tasks yet across any project</p>
                      </div>
                    ) : (
                      <div style={{ width: '100%', height: 220 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={memberStats.map((m) => ({ name: m.name.split(' ')[0], value: m.total, fill: m.color }))}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={40}
                              outerRadius={72}
                              paddingAngle={2}
                            >
                              {memberStats.map((m, i) => <Cell key={i} fill={m.color} />)}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, borderRadius: 8, fontSize: 12 }}
                              labelStyle={{ color: TOKENS.text }}
                              formatter={(v, n) => [`${v} task${v === 1 ? '' : 's'}`, n]}
                            />
                            <Legend wrapperStyle={{ fontSize: 12, color: TOKENS.textMuted }} iconType="circle" iconSize={8} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'timeline' && (
              <div>
                {!currentProject ? (
                  isFirstRun ? (
                    <OnboardingEmptyState onGo={() => setActiveTab('projects')} />
                  ) : (
                    <EmptyProjectState onGo={() => setActiveTab('projects')} />
                  )
                ) : (
                  <div className="space-y-8">
                    <Breadcrumb
                      project={currentProject}
                      customer={CUSTOMERS.find((c) => c.id === currentProject.customerId)}
                    />
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: TOKENS.surface2 }}>
                        {['list', 'gantt'].map((v) => (
                          <button
                            key={v}
                            onClick={() => setTimelineView(v)}
                            className="px-3 py-1 rounded-full text-xs font-medium capitalize"
                            style={{ background: timelineView === v ? TOKENS.surface : 'transparent', color: timelineView === v ? TOKENS.text : TOKENS.textMuted }}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={exportProjectCalendar}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                        style={{ background: TOKENS.surface, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}
                      >
                        <Download size={13} /> Export calendar (.ics)
                      </button>
                    </div>

                    {timelineView === 'gantt' ? (
                      <GanttChart
                        tasks={[...overdueList, ...dueWeekList, ...laterList]}
                        priorityColor={PRIORITY_COLOR}
                        projectDeadline={currentProject.deadline}
                        onOpenTask={setOpenTaskId}
                      />
                    ) : (
                      <>
                        <TimelineSection title="Overdue" icon={AlertTriangle} color={TOKENS.coral} items={overdueList} team={team} />
                        <TimelineSection title="Due this week" icon={Clock} color={TOKENS.amber} items={dueWeekList} team={team} />
                        <TimelineSection title="Later" icon={Calendar} color={TOKENS.textMuted} items={laterList} team={team} />
                      </>
                    )}
                    {overdueList.length === 0 && dueWeekList.length === 0 && laterList.length === 0 && (
                      <p className="text-sm italic" style={{ color: TOKENS.textFaint }}>Nothing on the timeline yet.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'customers' && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {customerStats.map((c, i) => (
                  <div key={c.id} className="rounded-xl p-4 stagger-item" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, animationDelay: `${i * 30}ms` }}>
                    <div className="flex items-center gap-2.5 mb-3">
                      <CustomerLogo customer={c} />
                      <div className="min-w-0">
                        <p className="font-display font-semibold text-sm truncate">{c.name}</p>
                        {c.note && <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>{c.note}</p>}
                      </div>
                    </div>
                    {c.total === 0 ? (
                      <div style={{ height: 180 }} className="flex items-center justify-center">
                        <p className="text-xs italic text-center px-4" style={{ color: TOKENS.textFaint }}>No jobs recorded for {c.name} yet</p>
                      </div>
                    ) : (
                      <div style={{ width: '100%', height: 180 }}>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={c.byMember}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={32}
                              outerRadius={58}
                              paddingAngle={2}
                            >
                              {c.byMember.map((m, i) => <Cell key={i} fill={m.color} />)}
                            </Pie>
                            <Tooltip
                              contentStyle={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, borderRadius: 8, fontSize: 12 }}
                              labelStyle={{ color: TOKENS.text }}
                              formatter={(v, n) => [`${v} job${v === 1 ? '' : 's'}`, n]}
                            />
                            <Legend wrapperStyle={{ fontSize: 11, color: TOKENS.textMuted }} iconType="circle" iconSize={7} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'projects' && (
              <div className="space-y-6 max-w-2xl">
                <div className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
                  <h2 className="font-display font-semibold text-sm mb-3 flex items-center gap-2">
                    <FolderKanban size={15} /> New project
                  </h2>
                  <AddProjectForm onAdd={addProject} />
                </div>

                <div>
                  <h2 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: TOKENS.textFaint }}>
                    Your projects ({projects.length})
                  </h2>
                  {projects.length === 0 && (
                    <p className="text-xs italic" style={{ color: TOKENS.textFaint }}>No projects yet — add one above to get started.</p>
                  )}
                  <div className="space-y-5">
                    {projectsByCustomer.map(({ customer, projects: groupProjects }) => (
                      <div key={customer ? customer.id : 'unassigned'}>
                        <div className="flex items-center gap-2 mb-2">
                          {customer && <CustomerLogo customer={customer} size={20} />}
                          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: TOKENS.textMuted }}>
                            {customer ? customer.name : 'No customer'} ({groupProjects.length})
                          </span>
                        </div>
                        <div className="space-y-2">
                          {groupProjects.map((p) => {
                            const pTasks = tasks.filter((t) => t.projectId === p.id);
                            const done = pTasks.filter((t) => t.status === 'done').length;
                            const active = p.id === selectedProjectId;
                            return (
                              <div
                                key={p.id}
                                className="flex items-center gap-3 p-3 rounded-lg"
                                style={{ background: active ? hexToRgba(TOKENS.blue, 0.1) : TOKENS.surface, border: `1px solid ${active ? hexToRgba(TOKENS.blue, 0.4) : TOKENS.border}` }}
                              >
                                <button onClick={() => { setSelectedProjectId(p.id); setActiveTab('board'); }} className="flex-1 text-left min-w-0">
                                  <p className="text-sm font-medium truncate" style={{ color: TOKENS.text }}>{p.name}</p>
                                  <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>
                                    {p.subtitle || 'No description'}{p.deadline ? ` · due ${p.deadline}` : ''}
                                  </p>
                                </button>
                                <span className="font-mono text-xs flex-shrink-0" style={{ color: TOKENS.textMuted }}>{done}/{pTasks.length}</span>
                                {active && (
                                  <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: hexToRgba(TOKENS.blue, 0.15), color: TOKENS.blue }}>
                                    Active
                                  </span>
                                )}
                                <button onClick={() => deleteProject(p.id)} aria-label="Delete project" style={{ color: TOKENS.textMuted }} className="flex-shrink-0">
                                  <X size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              isManagement ? (
                <LogsPanel team={team} logs={logs} onAdd={addLog} onDelete={deleteLog} accessToken={session.access_token} />
              ) : (
                <ManagementOnlyNotice feature="Logs" />
              )
            )}

            {activeTab === 'admin' && (
              isManagement ? (
                <AdminPanel accessToken={session.access_token} />
              ) : (
                <ManagementOnlyNotice feature="Admin" />
              )
            )}
          </div>
          )}
        </main>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {celebration && (
        <>
          <ConfettiBurst />
          <CelebrationBanner message={celebration.message} />
        </>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabs={visibleTabs}
        onSelectTab={setActiveTab}
        projects={projects}
        tasks={tasks}
        statusLabel={STATUS_LABEL}
        onSelectProject={jumpToProject}
        onSelectTask={jumpToTask}
      />

      {openTask && (
        <TaskDetailModal
          task={openTask}
          project={openTaskProject}
          members={openTaskMembers}
          team={team}
          comments={comments}
          onClose={() => setOpenTaskId(null)}
          onAddComment={(authorId, body) => addComment(openTask.id, authorId, body)}
          onDeleteComment={deleteComment}
          onUpdateStartDate={updateTaskStartDate}
        />
      )}
    </div>
  );
}
