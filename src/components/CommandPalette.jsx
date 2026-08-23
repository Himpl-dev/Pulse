import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderKanban, Search } from 'lucide-react';
import { TOKENS } from '../theme';

// Cmd/Ctrl+K modal: jump straight to a tab, project, or task. Reuses the same
// substring-match approach as the header's always-visible GlobalSearch, plus
// a tab-jump section GlobalSearch doesn't offer.
export function CommandPalette({ open, onClose, tabs, onSelectTab, projects, tasks, statusLabel, onSelectProject, onSelectTask }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Autofocus after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const q = query.trim().toLowerCase();

  const items = useMemo(() => {
    const tabItems = tabs
      .filter((t) => q.length === 0 || t.label.toLowerCase().includes(q))
      .map((t) => ({ type: 'tab', key: `tab-${t.id}`, icon: t.icon, label: t.label, sub: 'Go to tab', data: t }));

    const projectItems = q.length >= 2
      ? projects
          .filter((p) => p.name.toLowerCase().includes(q))
          .slice(0, 5)
          .map((p) => ({ type: 'project', key: `project-${p.id}`, icon: FolderKanban, label: p.name, sub: 'Project', data: p }))
      : [];

    const taskItems = q.length >= 2
      ? tasks
          .filter((t) => t.title.toLowerCase().includes(q))
          .slice(0, 8)
          .map((t) => {
            const project = projects.find((p) => p.id === t.projectId);
            return {
              type: 'task', key: `task-${t.id}`, icon: null, label: t.title,
              sub: `${project ? project.name : 'Unknown project'} · ${statusLabel[t.status]}`, data: t,
            };
          })
      : [];

    return [...tabItems, ...projectItems, ...taskItems];
  }, [q, tabs, projects, tasks, statusLabel]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [q]);

  function activate(item) {
    if (!item) return;
    if (item.type === 'tab') onSelectTab(item.data.id);
    else if (item.type === 'project') onSelectProject(item.data.id);
    else if (item.type === 'task') onSelectTask(item.data);
    onClose();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(items[selectedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden animate-fadein"
        style={{ background: TOKENS.surface, border: `1px solid ${TOKENS.border}`, boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${TOKENS.border}` }}>
          <Search size={15} style={{ color: TOKENS.textMuted, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a tab, project, or task…"
            className="bg-transparent outline-none text-sm flex-1"
            style={{ color: TOKENS.text }}
          />
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {items.length === 0 && <p className="text-xs italic px-4 py-6 text-center" style={{ color: TOKENS.textFaint }}>No matches.</p>}
          {items.map((item, i) => (
            <button
              key={item.key}
              onMouseDown={() => activate(item)}
              onMouseEnter={() => setSelectedIndex(i)}
              className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5"
              style={{ background: i === selectedIndex ? TOKENS.surface2 : 'transparent' }}
            >
              {item.icon && <item.icon size={14} style={{ color: TOKENS.textMuted, flexShrink: 0 }} />}
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ color: TOKENS.text }}>{item.label}</p>
                <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>{item.sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
