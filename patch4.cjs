const fs = require('fs');
let s = fs.readFileSync('App.tsx', 'utf8');
s = s.replace(/<div className="bg-red-50 border-l-4 border-red-500/g, '{dbError && !dbError.includes(\'Offline\') && (\n              <div className="bg-red-50 border-l-4 border-red-500');
fs.writeFileSync('App.tsx', s);
