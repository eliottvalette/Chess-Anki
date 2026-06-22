const fs = require('fs');
let content = fs.readFileSync('components/chess-lab-panels.tsx', 'utf8');

const replacements = [
  // Mastery grades
  ['bg-[#4e93d8] text-[#f5fbff]', 'bg-[#7FBF75] text-[#F1F5EA]'],
  ['bg-[#35a979] text-[#f4fff9]', 'bg-[#A8D8A0] text-[#050B08]'],
  [
    'border-[rgba(138,198,255,0.34)] bg-[rgba(42,82,126,0.18)]',
    'border-[rgba(168,216,160,0.38)] bg-[rgba(168,216,160,0.18)]',
  ],
  [
    'border-[rgba(255,92,108,0.42)] bg-[rgba(130,38,54,0.2)]',
    'border-[rgba(225,120,120,0.14)] bg-[rgba(225,120,120,0.055)]',
  ],
  [
    'border-[rgba(152,184,255,0.3)] bg-[rgba(9,14,23,0.42)]',
    'border-[rgba(226,238,220,0.08)] bg-[rgba(241,245,234,0.035)]',
  ],

  // Button blues
  [
    'bg-[rgba(152,184,255,0.1)] text-[13px] font-medium text-[#98b8ff]',
    'bg-[rgba(168,216,160,0.18)] text-[13px] font-medium text-[#A8D8A0] border border-[rgba(168,216,160,0.38)]',
  ],
  ['text-[#98B8FF]', 'text-[#A8D8A0]'],
  ['hover:bg-[rgba(152,184,255,0.12)]', 'hover:bg-[rgba(168,216,160,0.12)]'],
  [
    'border-[rgba(152,184,255,0.38)] bg-[rgba(72,98,168,0.22)] text-[#e8eeff]',
    'border-[rgba(168,216,160,0.38)] bg-[rgba(168,216,160,0.18)] text-[#D9F2D1]',
  ],

  // Input background and focus
  [
    'bg-[rgba(18,25,38,0.48)]',
    'bg-[rgba(2,8,5,0.42)] border border-[rgba(226,238,220,0.10)] focus:border-[rgba(168,216,160,0.48)] focus:ring-[3px] focus:ring-[rgba(168,216,160,0.08)]',
  ],
  ['focus:bg-[rgba(245,248,255,0.04)]', ''], // remove old focus

  // Hover states
  ['hover:bg-[rgba(245,248,255,0.035)]', 'hover:bg-[rgba(168,216,160,0.045)]'],
  ['hover:bg-[rgba(245,248,255,0.04)]', 'hover:bg-[rgba(168,216,160,0.045)]'],
  ['bg-[rgba(152,184,255,0.08)]', 'bg-[rgba(168,216,160,0.08)]'],

  // Graph nodes
  [
    'border-[rgba(198,215,255,0.78)] shadow-[0_8px_22px_rgba(0,0,0,0.28),0_0_0_2px_rgba(198,215,255,0.16)]',
    'border-[rgba(168,216,160,0.42)] shadow-[0_8px_22px_rgba(0,0,0,0.28),0_0_0_2px_rgba(168,216,160,0.16)]',
  ],
  [
    'border-[rgba(138,198,255,0.34)] bg-[rgba(42,82,126,0.2)]',
    'border-[rgba(168,216,160,0.38)] bg-[rgba(168,216,160,0.18)]',
  ],
  [
    'border-[rgba(214,226,244,0.2)] bg-[rgba(13,20,32,0.94)]',
    'border-[rgba(226,238,220,0.075)] bg-[rgba(8,18,14,0.76)]',
  ],
  ['border-[rgba(214,226,244,0.24)]', 'border-[rgba(226,238,220,0.075)]'],
  ['fill-[#eef5ff]', 'fill-[#F1F5EA]'],
  ['fill-[rgba(5,10,17,0.88)]', 'fill-[rgba(5,12,9,0.88)]'],
  ['stroke-[rgba(214,226,244,0.18)]', 'stroke-[rgba(226,238,220,0.18)]'],
  ['stroke-[rgba(143,156,178,0.68)]', 'stroke-[rgba(168,216,160,0.68)]'],

  // Red/Danger states
  [
    'border-[rgba(255,141,145,0.42)] bg-[rgba(180,58,66,0.16)]',
    'border-[rgba(225,120,120,0.18)] bg-[rgba(225,120,120,0.07)]',
  ],
  ['bg-[rgba(181,105,108,0.12)]', 'bg-[rgba(225,120,120,0.07)]'],
  ['text-[rgba(255,141,145,0.85)]', 'text-[#E17878]'],
  ['hover:bg-[rgba(255,141,145,0.18)]', 'hover:bg-[rgba(225,120,120,0.12)]'],
  ['text-[#ffb4b2]', 'text-[#E17878]'],

  // Texts
  ['text-[#98b8ff]', 'text-[#A8D8A0]'],
  ['text-[rgba(245,248,255,0.92)]', 'text-[rgba(241,245,234,0.88)]'],

  // Background gradients
  [
    'bg-[radial-gradient(circle_at_18%_16%,rgba(152,184,255,0.1),transparent_28%),rgba(4,8,15,0.58)]',
    'bg-[rgba(8,18,14,0.76)]',
  ], // Graph background

  // Borders
  ['border-[rgba(245,248,255,0.04)]', 'border-[rgba(226,238,220,0.04)]'],
  ['border-[rgba(245,248,255,0.06)]', 'border-[rgba(226,238,220,0.06)]'],
];

for (const [search, replace] of replacements) {
  content = content.split(search).join(replace);
}

fs.writeFileSync('components/chess-lab-panels.tsx', content);
console.log('Replaced colors.');
