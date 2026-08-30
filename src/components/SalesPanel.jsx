import React from 'react';
import { Handshake } from 'lucide-react';
import { TOKENS } from '../theme';
import { AdvisorChat } from './AdvisorChat';

// Private sales advisor chat — vision-hardware capabilities (Cognex, Zebra,
// SICK, Keyence, Teledyne FLIR) and next-step recommendations for customers
// evaluating or trialling a solution, grounded in the app's customer/project
// data server-side (see api/sales-advisor.js).
export function SalesPanel({ accessToken }) {
  return (
    <AdvisorChat
      table="sales_messages"
      endpoint="/api/sales-advisor"
      accessToken={accessToken}
      icon={Handshake}
      iconColor={TOKENS.amber}
      title="Sales Advisor"
      description="Private to you — vision-hardware capabilities and next steps for a customer trial or evaluation."
      emptyHint="Ask about a supplier's capabilities, or what to suggest next for a customer evaluating a trial."
    />
  );
}
