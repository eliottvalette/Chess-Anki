const fs = require('fs');
let content = fs.readFileSync('components/chess-lab-panels.tsx', 'utf8');

const replacements = [
  ['rgba(245,248,255', 'rgba(241,245,234'],
  ['rgba(18,25,38', 'rgba(8,18,14'], // map to surface
  ['bg-[rgba(13,20,32,0.94)]', 'bg-[rgba(5,12,9,0.94)]'],
  ['text-[rgba(13,20,32,0.94)]', 'text-[rgba(5,12,9,0.94)]'],
  ['hover:bg-[#c6d7ff]', 'hover:bg-[#7FBF75]'], // hover accent-strong
];

for (const [search, replace] of replacements) {
  content = content.split(search).join(replace);
}

fs.writeFileSync('components/chess-lab-panels.tsx', content);
console.log('Replaced leftover colors.');
