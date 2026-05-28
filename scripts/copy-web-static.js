const fs = require('fs');
const path = require('path');

const files = ['kakao-map.html'];
const publicDir = path.resolve(__dirname, '..', 'public');
const distDir = path.resolve(__dirname, '..', 'dist');

fs.mkdirSync(distDir, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(publicDir, file), path.join(distDir, file));
}
