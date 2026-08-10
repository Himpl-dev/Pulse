import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from './supabaseClient';
import {
  Users, Clock, AlertTriangle, Calendar, TrendingUp, PieChart as PieChartIcon,
  ChevronLeft, ChevronRight, X, Bell, LayoutGrid, FolderKanban, Plus, Trash2, Building2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';

/* ---------------------------------- tokens --------------------------------- */

const TOKENS = {
  bg: '#14171C',
  surface: '#1B1F27',
  surface2: '#21262F',
  border: '#2A303B',
  text: '#EDEFF2',
  textMuted: '#8B93A1',
  textFaint: '#5C6472',
  blue: '#5B8DEF',
  teal: '#45C4A0',
  amber: '#F2A93B',
  coral: '#F2665E',
  violet: '#9B8CF2',
  magenta: '#E85DA0',
};

const PRIORITY_COLOR = { high: TOKENS.coral, medium: TOKENS.amber, low: TOKENS.blue };

/* ---------------------------------- data ----------------------------------- */

const TEAM = [
  {
    id: 'm1', name: 'Jamie Himpleman', role: 'Team member', color: TOKENS.violet, initials: 'JH',
    skills: [
      { name: 'Cognex C1', level: 'Certified' },
      { name: 'Cognex Insight Spreadsheet', level: 'Basic' },
      { name: 'Zebra Aurora', level: 'Basic + Advanced' },
    ],
  },
  {
    id: 'm2', name: 'Riaz Ahmed', role: 'Team member', color: TOKENS.blue, initials: 'RA',
    skills: [
      { name: 'Cognex C1', level: 'Certified' },
      { name: 'Cognex Insight Spreadsheet', level: 'Basic' },
    ],
  },
  { id: 'm3', name: 'Maxwell Taylor', role: 'Team member', color: TOKENS.teal, initials: 'MT', skills: [] },
  { id: 'm4', name: 'Salman Salman', role: 'Team member', color: TOKENS.amber, initials: 'SS', skills: [] },
];

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
];

const INITIAL_PROJECTS = [];
const INITIAL_TASKS = [];

/* --------------------------------- helpers ---------------------------------- */

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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

function dueTone(dateStr) {
  const d = daysUntil(dateStr);
  if (d < 0) return { color: TOKENS.coral, pulse: true };
  if (d <= 3) return { color: TOKENS.amber, pulse: true };
  return { color: TOKENS.textMuted, pulse: false };
}

const inputStyle = { background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, color: TOKENS.text };

// Supabase tables use snake_case columns; app state uses camelCase.
function projectFromRow(r) {
  return { id: r.id, name: r.name, subtitle: r.subtitle, deadline: r.deadline, customerId: r.customer_id };
}
function projectToRow(p) {
  return { id: p.id, name: p.name, subtitle: p.subtitle, deadline: p.deadline, customer_id: p.customerId };
}
function taskFromRow(r) {
  return { id: r.id, title: r.title, assignees: r.assignees, priority: r.priority, due: r.due, status: r.status, projectId: r.project_id };
}
function taskToRow(t) {
  return { id: t.id, title: t.title, assignees: t.assignees, priority: t.priority, due: t.due, status: t.status, project_id: t.projectId };
}

/* -------------------------------- primitives -------------------------------- */

function Logo() {
  // Placeholder wordmark — swap for the real Bytronic logo file (e.g. an <img> from src/assets)
  // once it's saved into the project.
  return (
    <div className="flex flex-col leading-none select-none flex-shrink-0">
      <span className="font-display font-bold text-lg tracking-tight" style={{ color: TOKENS.text }}>
        bytron<span style={{ color: TOKENS.blue }}>i</span>c
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

function RadialProgress({ pct, size = 56, stroke = 5, color, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(Math.max(pct, 0), 100) / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={TOKENS.border} strokeWidth={stroke} fill="none" />
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

function AssigneePicker({ value, onChange }) {
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
    ? TEAM.find((m) => m.id === value[0])?.name
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
          {TEAM.map((m) => (
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

function AddTaskForm({ onAdd, onCancel }) {
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState([TEAM[0].id]);
  const [priority, setPriority] = useState('medium');
  const [due, setDue] = useState('');

  function submit(e) {
    e.preventDefault();
    if (!title.trim() || !due || assignees.length === 0) return;
    onAdd({ title: title.trim(), assignees, priority, due });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]" style={inputStyle} />
      <AssigneePicker value={assignees} onChange={setAssignees} />
      <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle}>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <input type="date" required value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg px-2 py-1.5 text-sm" style={inputStyle} />
      <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: TOKENS.blue, color: '#0B0D11' }}>Add</button>
      <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: TOKENS.textMuted }}>Cancel</button>
    </form>
  );
}

function TaskCard({ task, members, onMove, onDragStart, onDelete, canMoveLeft, canMoveRight }) {
  const tone = dueTone(task.due);
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      className="rounded-lg p-3 mb-2 cursor-grab"
      style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: PRIORITY_COLOR[task.priority] }}>
          {task.priority}
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
      <p className="font-display font-semibold text-sm leading-snug mb-3" style={{ color: TOKENS.text }}>{task.title}</p>
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
        <span className="font-mono text-xs" style={{ color: tone.color }}>{formatDue(task.due)}</span>
      </div>
    </div>
  );
}

function TimelineSection({ title, icon: Icon, color, items }) {
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
          const members = task.assignees.map((id) => TEAM.find((m) => m.id === id)).filter(Boolean);
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

/* ----------------------------------- app ------------------------------------ */

export default function App() {
  const [projects, setProjects] = useState(INITIAL_PROJECTS);
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [activeTab, setActiveTab] = useState('projects');
  const [selectedMember, setSelectedMember] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [loading, setLoading] = useState(true);

  const currentProject = projects.find((p) => p.id === selectedProjectId) || null;
  const projectTasks = tasks.filter((t) => t.projectId === selectedProjectId);

  // Load shared team data from Supabase once on mount.
  useEffect(() => {
    (async () => {
      const [{ data: projectRows, error: projErr }, { data: taskRows, error: taskErr }] = await Promise.all([
        supabase.from('projects').select('*'),
        supabase.from('tasks').select('*'),
      ]);
      if (projErr) console.error('Failed to load projects', projErr);
      if (taskErr) console.error('Failed to load tasks', taskErr);
      setProjects((projectRows || []).map(projectFromRow));
      setTasks((taskRows || []).map(taskFromRow));
      setLoading(false);
    })();
  }, []);

  async function addProject({ name, subtitle, deadline, customerId }) {
    const id = `p${projects.length}-${name.toLowerCase().replace(/\s+/g, '-')}-${Math.round(Math.random() * 1e6)}`;
    const project = { id, name, subtitle, deadline, customerId };
    setProjects((prev) => [...prev, project]);
    setSelectedProjectId(id);
    setActiveTab('board');
    const { error } = await supabase.from('projects').insert(projectToRow(project));
    if (error) console.error('Failed to save project', error);
  }
  async function deleteProject(id) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setTasks((prev) => prev.filter((t) => t.projectId !== id));
    setSelectedProjectId((prev) => (prev === id ? null : prev));
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) console.error('Failed to delete project', error);
  }

  async function addTask({ title, assignees, priority, due }) {
    const id = `t${tasks.length}-${Math.round(Math.random() * 1e6)}`;
    const task = { id, title, assignees, priority, due, status: 'backlog', projectId: selectedProjectId };
    setTasks((prev) => [...prev, task]);
    const { error } = await supabase.from('tasks').insert(taskToRow(task));
    if (error) console.error('Failed to save task', error);
  }
  async function deleteTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) console.error('Failed to delete task', error);
  }
  function handleDragStart(e, taskId) {
    e.dataTransfer.setData('text/plain', taskId);
  }
  async function handleDrop(e, status) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
    const { error } = await supabase.from('tasks').update({ status }).eq('id', id);
    if (error) console.error('Failed to update task status', error);
  }
  async function moveTask(id, direction) {
    let newStatus = null;
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const idx = STATUSES.indexOf(t.status);
        const newIdx = Math.min(Math.max(idx + direction, 0), STATUSES.length - 1);
        newStatus = STATUSES[newIdx];
        return { ...t, status: newStatus };
      })
    );
    if (newStatus) {
      const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', id);
      if (error) console.error('Failed to update task status', error);
    }
  }

  // Team-wide workload stats — deliberately span every project, not just the active one.
  const memberStats = useMemo(() => {
    return TEAM.map((m) => {
      const mine = tasks.filter((t) => t.assignees.includes(m.id));
      const done = mine.filter((t) => t.status === 'done').length;
      const total = mine.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const active = mine.filter((t) => t.status !== 'done');
      const overdue = active.filter((t) => daysUntil(t.due) < 0).length;
      const dueSoon = active.filter((t) => { const d = daysUntil(t.due); return d >= 0 && d <= 3; }).length;
      let tone = TOKENS.teal, pulse = false;
      if (overdue > 0) { tone = TOKENS.coral; pulse = true; }
      else if (dueSoon > 0) { tone = TOKENS.amber; pulse = true; }
      return { ...m, done, total, pct, active, overdue, dueSoon, tone, pulse };
    });
  }, [tasks]);

  const totalWorkload = memberStats.reduce((sum, m) => sum + m.total, 0);

  // Per-customer breakdown of who has worked on what — spans every project, like memberStats.
  const customerStats = useMemo(() => {
    return CUSTOMERS.map((c) => {
      const projectIds = new Set(projects.filter((p) => p.customerId === c.id).map((p) => p.id));
      const customerTasks = tasks.filter((t) => projectIds.has(t.projectId));
      const byMember = TEAM
        .map((m) => ({ id: m.id, name: m.name.split(' ')[0], color: m.color, value: customerTasks.filter((t) => t.assignees.includes(m.id)).length }))
        .filter((m) => m.value > 0);
      return { ...c, total: customerTasks.length, byMember };
    });
  }, [projects, tasks]);

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
  const selectedMemberObj = TEAM.find((m) => m.id === selectedMember) || null;
  const filteredTasks = selectedMember ? projectTasks.filter((t) => t.assignees.includes(selectedMember)) : projectTasks;

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
        @media (prefers-reduced-motion: reduce) {
          *, .animate-fadein { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* header */}
      <header className="sticky top-0 z-10 px-4 md:px-6 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: TOKENS.bg, borderBottom: `1px solid ${TOKENS.border}` }}>
        <div className="flex items-center gap-3">
          <Logo />
          <div className="hidden sm:block" style={{ width: 1, height: 28, background: TOKENS.border }} />
          <div className="hidden sm:block min-w-0">
            <p className="text-sm font-display font-semibold leading-tight truncate">{currentProject ? currentProject.name : 'No active project'}</p>
            <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>{currentProject ? (currentProject.subtitle || 'No description') : 'Select or create one in Projects'} · {TEAM.length} members</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 p-1 rounded-full" style={{ background: TOKENS.surface }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-3 py-1.5 rounded-full text-sm flex items-center gap-1.5 transition-colors"
              style={{ background: activeTab === tab.id ? TOKENS.surface2 : 'transparent', color: activeTab === tab.id ? TOKENS.text : TOKENS.textMuted }}
            >
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
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
                    const members = task.assignees.map((id) => TEAM.find((m) => m.id === id)).filter(Boolean);
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

          <RadialProgress pct={overall.pct} size={40} stroke={4} color={overall.tone}>
            <span className="font-mono" style={{ fontSize: 9, color: TOKENS.text }}>{overall.pct}%</span>
          </RadialProgress>
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
                const active = selectedMember === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMember(active ? null : m.id)}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors"
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
                        <span className="font-mono flex-shrink-0" style={{ fontSize: 10, color: TOKENS.textFaint }}>{m.pct}%</span>
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
            <p className="text-sm italic" style={{ color: TOKENS.textFaint }}>Loading…</p>
          ) : (
          <div key={activeTab} className="animate-fadein">
            {activeTab === 'board' && (
              <div>
                {!currentProject ? (
                  <EmptyProjectState onGo={() => setActiveTab('projects')} />
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-sm min-h-[26px]" style={{ color: TOKENS.textMuted }}>
                        {selectedMemberObj && (
                          <>
                            <span>Showing tasks for <strong style={{ color: TOKENS.text }}>{selectedMemberObj.name}</strong></span>
                            <button onClick={() => setSelectedMember(null)} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ border: `1px solid ${TOKENS.border}` }}>
                              <X size={12} /> Clear
                            </button>
                          </>
                        )}
                      </div>
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
                            className="flex-shrink-0 w-64 md:w-72"
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
                              {cards.map((task) => {
                                const members = task.assignees.map((id) => TEAM.find((m) => m.id === id)).filter(Boolean);
                                return (
                                  <TaskCard
                                    key={task.id}
                                    task={task}
                                    members={members}
                                    onMove={moveTask}
                                    onDragStart={handleDragStart}
                                    onDelete={deleteTask}
                                    canMoveLeft={colIdx > 0}
                                    canMoveRight={colIdx < STATUSES.length - 1}
                                  />
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  {memberStats.map((m) => (
                    <div key={m.id} className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
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
                        <RadialProgress pct={m.pct} size={44} stroke={4} color={m.tone}>
                          <span className="font-mono" style={{ fontSize: 10, color: TOKENS.text }}>{m.pct}%</span>
                        </RadialProgress>
                      </div>
                      <div className="flex items-center gap-4 text-xs mb-3 flex-wrap" style={{ color: TOKENS.textMuted }}>
                        <span className="font-mono">{m.done}/{m.total} done</span>
                        {m.overdue > 0 && <span className="flex items-center gap-1" style={{ color: TOKENS.coral }}><AlertTriangle size={12} />{m.overdue} overdue</span>}
                        {m.dueSoon > 0 && <span style={{ color: TOKENS.amber }}>{m.dueSoon} due soon</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {m.active.slice(0, 4).map((t) => (
                          <span key={t.id} className="text-xs px-2 py-1 rounded-full" style={{ background: TOKENS.surface2, color: TOKENS.textMuted, border: `1px solid ${TOKENS.border}` }}>
                            {t.title.length > 28 ? t.title.slice(0, 26) + '…' : t.title}
                          </span>
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
                          <XAxis type="number" domain={[0, 100]} tick={{ fill: TOKENS.textMuted, fontSize: 11 }} axisLine={{ stroke: TOKENS.border }} tickLine={false} />
                          <YAxis type="category" dataKey="name" width={70} tick={{ fill: TOKENS.textMuted, fontSize: 12 }} axisLine={{ stroke: TOKENS.border }} tickLine={false} />
                          <Tooltip
                            contentStyle={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}`, borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: TOKENS.text }}
                            formatter={(v) => [`${v}%`, 'Complete']}
                            cursor={{ fill: TOKENS.surface2 }}
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
                  <EmptyProjectState onGo={() => setActiveTab('projects')} />
                ) : (
                  <div className="space-y-8">
                    <TimelineSection title="Overdue" icon={AlertTriangle} color={TOKENS.coral} items={overdueList} />
                    <TimelineSection title="Due this week" icon={Clock} color={TOKENS.amber} items={dueWeekList} />
                    <TimelineSection title="Later" icon={Calendar} color={TOKENS.textMuted} items={laterList} />
                    {overdueList.length === 0 && dueWeekList.length === 0 && laterList.length === 0 && (
                      <p className="text-sm italic" style={{ color: TOKENS.textFaint }}>Nothing on the timeline yet.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'customers' && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {customerStats.map((c) => (
                  <div key={c.id} className="rounded-xl p-4" style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}` }}>
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
                  <div className="space-y-2">
                    {projects.map((p) => {
                      const pTasks = tasks.filter((t) => t.projectId === p.id);
                      const done = pTasks.filter((t) => t.status === 'done').length;
                      const active = p.id === selectedProjectId;
                      const customer = CUSTOMERS.find((c) => c.id === p.customerId);
                      return (
                        <div
                          key={p.id}
                          className="flex items-center gap-3 p-3 rounded-lg"
                          style={{ background: active ? hexToRgba(TOKENS.blue, 0.1) : TOKENS.surface, border: `1px solid ${active ? hexToRgba(TOKENS.blue, 0.4) : TOKENS.border}` }}
                        >
                          {customer && <CustomerLogo customer={customer} size={30} />}
                          <button onClick={() => { setSelectedProjectId(p.id); setActiveTab('board'); }} className="flex-1 text-left min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: TOKENS.text }}>{p.name}</p>
                            <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>
                              {customer ? customer.name : 'No customer'} · {p.subtitle || 'No description'}{p.deadline ? ` · due ${p.deadline}` : ''}
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
              </div>
            )}
          </div>
          )}
        </main>
      </div>
    </div>
  );
}
