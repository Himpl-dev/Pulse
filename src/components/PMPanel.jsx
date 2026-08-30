import React, { useState } from 'react';
import { Compass, Plus, Check } from 'lucide-react';
import { TOKENS, hexToRgba } from '../theme';
import { AdvisorChat } from './AdvisorChat';

const PRIORITY_COLOR = { high: TOKENS.coral, medium: TOKENS.amber, low: TOKENS.blue };

// Cross-project advisor chat, built on the shared AdvisorChat shell. The
// "proposals" strip is PM-specific — driven by Claude's tool-use in
// api/pm-advisor.js (management callers only) — so it's passed in via
// AdvisorChat's `extra` slot rather than living in the shared component.
export function PMPanel({ accessToken, onCreateTask }) {
  const [proposals, setProposals] = useState([]);
  const [addedIds, setAddedIds] = useState(new Set());

  function addProposal(proposal, idx) {
    onCreateTask(proposal);
    setAddedIds((prev) => new Set(prev).add(idx));
  }

  return (
    <AdvisorChat
      table="pm_messages"
      endpoint="/api/pm-advisor"
      accessToken={accessToken}
      icon={Compass}
      iconColor={TOKENS.teal}
      title="Project Manager"
      description="Cross-project advice on scope, status, and staffing — management can also add proposed tasks with one click."
      emptyHint="Ask what's missing on a project, who should pick up a job, or what to prioritize across everything active right now."
      onResponse={(data) => {
        setProposals(data.proposals || []);
        setAddedIds(new Set());
      }}
      extra={
        proposals.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: TOKENS.textFaint }}>Suggested tasks</p>
            {proposals.map((p, idx) => {
              const added = addedIds.has(idx);
              return (
                <div key={idx} className="rounded-lg p-2.5" style={{ background: TOKENS.surface2, border: `1px solid ${TOKENS.border}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm truncate" style={{ color: TOKENS.text }}>{p.title}</p>
                      <p className="text-xs truncate" style={{ color: TOKENS.textFaint }}>
                        {p.projectName} · <span style={{ color: PRIORITY_COLOR[p.priority] }}>{p.priority}</span> · due {p.due}{p.assigneeName ? ` · ${p.assigneeName}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => addProposal(p, idx)}
                      disabled={added}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium flex-shrink-0 disabled:opacity-60"
                      style={{ background: added ? TOKENS.surface : hexToRgba(TOKENS.teal, 0.15), color: added ? TOKENS.textMuted : TOKENS.teal }}
                    >
                      {added ? <><Check size={12} /> Added</> : <><Plus size={12} /> Add to board</>}
                    </button>
                  </div>
                  {p.reason && <p className="text-xs mt-1.5" style={{ color: TOKENS.textFaint }}>{p.reason}</p>}
                </div>
              );
            })}
          </div>
        )
      }
    />
  );
}
