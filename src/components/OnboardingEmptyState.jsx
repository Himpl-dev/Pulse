import React from 'react';
import { FolderKanban, Users, LayoutGrid, ArrowRight } from 'lucide-react';
import { TOKENS } from '../theme';

const STEPS = [
  { icon: FolderKanban, text: "Create a project for the work you're tracking" },
  { icon: Users, text: 'Add your team so tasks can be assigned' },
  { icon: LayoutGrid, text: 'Add tasks and drag them across the board as work moves' },
];

// First-run panel for a brand-new account with no projects or team members
// yet — replaces the plain "No active project selected" message, which is
// meant for "you deleted your last project," not "you've never had one."
export function OnboardingEmptyState({ onGo }) {
  return (
    <div className="rounded-xl p-10 text-center" style={{ background: TOKENS.surface, border: `1px dashed ${TOKENS.border}` }}>
      <p className="font-display font-semibold text-lg mb-1" style={{ color: TOKENS.text }}>Welcome to Pulse</p>
      <p className="text-sm mb-6" style={{ color: TOKENS.textMuted }}>Nothing here yet — here's how to get started.</p>
      <div className="flex flex-col gap-2 max-w-sm mx-auto mb-6 text-left">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: TOKENS.surface2 }}>
            <span
              className="flex items-center justify-center rounded-full font-mono flex-shrink-0"
              style={{ width: 20, height: 20, fontSize: 11, background: TOKENS.surface, color: TOKENS.textFaint }}
            >
              {i + 1}
            </span>
            <s.icon size={16} style={{ color: TOKENS.blue, flexShrink: 0 }} />
            <span className="text-sm" style={{ color: TOKENS.text }}>{s.text}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onGo}
        className="px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
        style={{ background: TOKENS.blue, color: '#0B0D11' }}
      >
        Create your first project <ArrowRight size={14} />
      </button>
    </div>
  );
}
