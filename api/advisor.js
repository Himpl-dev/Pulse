import hrAdvisor from '../lib/advisors/hr-advisor.js';
import pmAdvisor from '../lib/advisors/pm-advisor.js';
import salesAdvisor from '../lib/advisors/sales-advisor.js';

export const config = { maxDuration: 30 };

const advisors = {
  hr: hrAdvisor,
  pm: pmAdvisor,
  sales: salesAdvisor,
};

export default async function handler(req, res) {
  const type = req.query?.type;
  const advisor = typeof type === 'string' ? advisors[type] : undefined;

  if (!advisor) {
    return res.status(404).json({ error: 'Unknown advisor' });
  }

  return advisor(req, res);
}
