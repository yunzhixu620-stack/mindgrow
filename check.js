const fs = require('fs');
const c = fs.readFileSync('src/app/page.tsx', 'utf8');
const lines = c.split('\n');
console.log('Lines:', lines.length);
const matches = c.match(/fetch\("\/api/g) || [];
console.log('Bare fetch count:', matches.length);
