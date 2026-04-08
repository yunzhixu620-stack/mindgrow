const fs = require('fs');
const filePath = 'src/app/page.tsx';
let c = fs.readFileSync(filePath, 'utf8');

// Replace all fetch("/api/knowledge -> fetch(API_BASE_URL + "/api/knowledge
c = c.replace(/fetch\("\/api\/knowledge/g, 'fetch(API_BASE_URL + "/api/knowledge');
// Replace all fetch(`/api/knowledge -> fetch(API_BASE_URL + `/api/knowledge
c = c.replace(/fetch\(`\/api\/knowledge/g, 'fetch(API_BASE_URL + `/api/knowledge');

fs.writeFileSync(filePath, c, 'utf8');

const bare = (c.match(/fetch\("\/api/g) || []).length;
const bareT = (c.match(/fetch\(`\/api/g) || []).length;
const total = (c.match(/API_BASE_URL/g) || []).length;
console.log('Bare fetch count: ' + bare + ', Bare template: ' + bareT);
console.log('API_BASE_URL occurrences: ' + total);
