const fs = require('fs');
const path = require('path');

try {
  const target = path.join(__dirname, 'node_modules', 'exceljs', 'lib', 'utils', 'browser-buffer-decode.js');
  if (fs.existsSync(target)) {
    let content = fs.readFileSync(target, 'utf-8');
    if (!content.includes('{ stream: true }')) {
      content = content.replace(
        'return textDecoder.decode(chunk);',
        'return textDecoder.decode(chunk, { stream: true });'
      );
      fs.writeFileSync(target, content, 'utf-8');
      console.log('Successfully patched exceljs for flawless Hindi UTF-8 stream decoding.');
    }
  }
} catch (e) {
  console.warn('Note: Could not patch exceljs:', e.message);
}
