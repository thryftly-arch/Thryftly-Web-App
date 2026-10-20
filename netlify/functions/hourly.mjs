// Every hour on Netlify: pull shipping updates from Qikink (and email customers when an order ships
// or is delivered) and send abandoned-checkout reminders. Same code as a server with RUN_JOBS=1.
import { hourly } from '../../server/index.js';

export default async () => {
  const r = await hourly();
  console.log('hourly', r);
  return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
};
export const config = { schedule: '@hourly' };
