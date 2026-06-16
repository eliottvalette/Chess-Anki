import { Client } from 'pg';

const dbUrl = 'postgresql://postgres.rdehwurjccisorhyqonc:1T0s2lTcixTE45BN@aws-0-eu-west-1.pooler.supabase.com:6543/postgres';

async function fix() {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected to DB');

    // Drop the check constraint
    await client.query(`
      ALTER TABLE opening_trees DROP CONSTRAINT IF EXISTS opening_trees_library_check;
    `);

    console.log('Dropped opening_trees_library_check constraint');

    // Add it back with 'other'
    await client.query(`
      ALTER TABLE opening_trees ADD CONSTRAINT opening_trees_library_check CHECK (library IN ('e4', 'd4', 'c4', 'nf3', 'other'));
    `);

    console.log('Added updated opening_trees_library_check constraint');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

fix();
