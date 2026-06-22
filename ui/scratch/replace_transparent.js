const fs = require('fs');
const files = [
  'components/chess-lab-panels.tsx',
  'components/lab/sidebar/LabSidebar.tsx',
  'components/lab/board/LabBoardArea.tsx',
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  // replace bg-transparent on elements that have a hover:bg
  // but only if it's not a tab (actually user said "i don't want button with transparent bg... like it's the case for a lot of buttons already")
  // Let's just blindly replace `bg-transparent` with `bg-[rgba(168,216,160,0.025)]` in the whole file where hover:bg-[... is also present. Or simpler, just replace `bg-transparent` with `bg-[rgba(168,216,160,0.025)]` everywhere where it looks like a button/hover.

  content = content.replace(/bg-transparent(.*?)hover:bg-\[/g, 'bg-[rgba(168,216,160,0.025)]$1hover:bg-[');

  fs.writeFileSync(file, content);
}
console.log('Replaced transparent buttons.');
