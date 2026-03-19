const fs = require('fs');
let s = fs.readFileSync('App.tsx', 'utf8');

let lines = s.split('\n');
for (let i = 0; i < lines.length; i++) {
   if (lines[i].includes('<div className="bg-red-50 border-l-4 border-red-500')) {
       if (!lines[i-1].includes('dbError')) {
           lines.splice(i, 0, "            {dbError && !dbError.includes('Offline') && (");
       }
   }
   if (lines[i].includes("; (")) {
       lines[i] = lines[i].replace("; (", "&& (");
   }
}
fs.writeFileSync('App.tsx', lines.join('\n'));
