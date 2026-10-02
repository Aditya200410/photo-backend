const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const uploadsDir = path.join(__dirname, 'uploads');
const excelMetaPath = path.join(__dirname, 'excel-metadata.json');

if (fs.existsSync(excelMetaPath)) {
  const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  let count = 0;
  
  for (const m of metadata) {
    const filePath = path.join(uploadsDir, m.fileName);
    const jsonPath = filePath + '.json';
    
    if (fs.existsSync(filePath) && !fs.existsSync(jsonPath)) {
      console.log(`Converting ${m.fileName} to JSON...`);
      try {
        const wb = xlsx.readFile(filePath);
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(firstSheet);
        fs.writeFileSync(jsonPath, JSON.stringify(data));
        console.log(`Successfully converted ${m.fileName}`);
        count++;
      } catch (err) {
        console.error(`Failed to convert ${m.fileName}:`, err.message);
      }
    } else if (fs.existsSync(jsonPath)) {
      console.log(`JSON for ${m.fileName} already exists.`);
    }
  }
  console.log(`Conversion complete. Converted ${count} files.`);
} else {
  console.log('No metadata found.');
}
