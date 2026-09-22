const fs = require('fs');
const h = fs.readFileSync('hamster-shop/public/admin.html', 'utf8');
console.log('size:', h.length);
// Find topbar
const idx = h.indexOf('topbar');
console.log('topbar at:', idx);
if (idx > -1) console.log(h.slice(idx, idx + 400));
