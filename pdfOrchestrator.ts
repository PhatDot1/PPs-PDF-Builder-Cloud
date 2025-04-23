import 'dotenv/config';
import Airtable from 'airtable';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';

const exec = promisify(_exec);
const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME
} = process.env;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !AIRTABLE_TABLE_NAME) {
  console.error('Missing AIRTABLE_* env vars');
  process.exit(1);
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Count how many records still need PDFs - cleaner to have this here, should refactor the index.ts to not need this. It also needs refactoring generally because Jamie wrote most of it and I just told him what to do, so the execution is poor.
async function countPending(): Promise<number> {
  const recs = await base(AIRTABLE_TABLE_NAME!)
    .select({
      filterByFormula: `
        AND(
          {PDF Status}='Generate PDF',
          {Participant Full Name}!='',
          {Achievement level}!='',
          {PDF Attachment}=''
        )`,
      pageSize: 100
    })
    .firstPage();
  return recs.length;
}

// Calls your existing script once
async function runIndex() {
  console.log('▶️  Running index.ts…');
  try {
    const { stdout, stderr } = await exec('ts-node index.ts');
    if (stdout) console.log(stdout.trim());
    if (stderr) console.error(stderr.trim());
  } catch (err: any) {
    console.error('❌ index.ts failed:', err.stderr || err);
  }
}

(async function loop() {
  console.log('🛡️  PDF‐Orchestrator started, polling every 60 s…');
  while (true) {
    try {
      const n = await countPending();
      if (n > 0) {
        console.log(`🔔 ${n} record(s) pending → kicking off index.ts`);
        await runIndex();
      } else {
        console.log('⏳ No pending PDFs right now.');
      }
    } catch (err) {
      console.error('❌ Orchestrator error:', err);
    }
    await sleep(60_000);
  }
})();
