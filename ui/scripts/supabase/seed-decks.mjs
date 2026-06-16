import { createClient } from '@supabase/supabase-js';

import { loadLocalEnv, requireAdminKey, requireEnv } from './env.mjs';

const OPENING_REPERTOIRE = [
  {
    id: 'italian-main',
    name: 'Italian Game',
    eco: 'C50',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4'],
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez',
    eco: 'C60',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'],
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit Declined",
    eco: 'D30',
    side: 'white',
    moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3'],
  },
  {
    id: 'london',
    name: 'London System',
    eco: 'D02',
    side: 'white',
    moves: ['d4', 'Nf6', 'Bf4', 'd5', 'e3', 'e6', 'Nf3', 'c5', 'c3'],
  },
  {
    id: 'sicilian-najdorf',
    name: 'Sicilian Najdorf',
    eco: 'B90',
    side: 'black',
    moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'],
  },
  {
    id: 'french-advance',
    name: 'French Advance',
    eco: 'C02',
    side: 'black',
    moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5', 'c3', 'Nc6', 'Nf3'],
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Classical',
    eco: 'B18',
    side: 'black',
    moves: ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5', 'Ng3'],
  },
  {
    id: 'kings-indian',
    name: "King's Indian Defense",
    eco: 'E60',
    side: 'black',
    moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3', 'O-O'],
  },
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const env = loadLocalEnv();
  const supabaseUrl = requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireAdminKey(env);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const deck = {
    id: 'opening-punishments-v1',
    name: 'Opening Punishments v1',
    description: 'Canonical seed deck for opening mistake punishment training.',
    version: 1,
    is_active: true,
  };

  const lines = OPENING_REPERTOIRE.map((line) => ({
    id: line.id,
    deck_id: deck.id,
    name: line.name,
    eco: line.eco,
    side: line.side,
    moves: line.moves,
  }));

  await upsert(supabase, 'decks', deck, 'id');
  await upsert(supabase, 'opening_lines', lines, 'id');

  console.log(JSON.stringify({ seeded: { decks: 1, opening_lines: lines.length } }, null, 2));
}

async function upsert(supabase, table, rows, onConflict) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict });

  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }
}
