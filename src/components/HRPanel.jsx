import React from 'react';
import { LifeBuoy } from 'lucide-react';
import { TOKENS } from '../theme';
import { AdvisorChat } from './AdvisorChat';

// Private HR/workplace advisor chat. Reads/writes go straight to Supabase
// (RLS already scopes hr_messages to the caller — see schema.sql block 11);
// only the AI call itself goes through api/hr-advisor.js, which independently
// determines the caller's role server-side rather than trusting a prop here.
export function HRPanel({ accessToken }) {
  return (
    <AdvisorChat
      table="hr_messages"
      endpoint="/api/hr-advisor"
      accessToken={accessToken}
      icon={LifeBuoy}
      iconColor={TOKENS.violet}
      title="HR Advisor"
      description="Private to you — nobody else, including management, can see this conversation."
      emptyHint="Ask about workload, a difficult situation, or when to escalate a decision — this stays between you and the advisor."
    />
  );
}
