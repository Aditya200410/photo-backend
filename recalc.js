// One-time script to recalculate gender/age stats for all uploaded Excel files
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const excelMetaPath = path.join(__dirname, 'excel-metadata.json');

if (!fs.existsSync(excelMetaPath)) {
  console.log('No metadata file found.');
  process.exit(0);
}

let metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
let updatedCount = 0;

for (const entry of metadata) {
  if (!entry.fileName) continue;
  const filePath = path.join(__dirname, 'uploads', entry.fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${entry.fileName} - file not found`);
    continue;
  }
  console.log(`Processing ${entry.fileName}...`);
  try {
    const wb = xlsx.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    let stats = {
      totalVoters: data.length, maleVoters: 0, femaleVoters: 0,
      averageAge: 0, totalAge: 0, votersWithAge: 0,
      ageBrackets: { youth: 0, adult: 0, middle: 0, senior: 0 }
    };
    for (const v of data) {
      const gender = String(v.MSEX || v.FGENDER || v.SEX || v.GENDER || '').trim().toUpperCase();
      if (gender === 'M' || gender === 'MALE' || gender === 'पुरुष') stats.maleVoters++;
      else if (gender === 'F' || gender === 'FEMALE' || gender === 'महिला' || gender === 'स्त्री') stats.femaleVoters++;
      const age = parseInt(v.MAGE || v.FAGE || v.AGE);
      if (!isNaN(age) && age > 0 && age < 150) {
        stats.totalAge += age; stats.votersWithAge++;
        if (age >= 18 && age <= 25) stats.ageBrackets.youth++;
        else if (age >= 26 && age <= 40) stats.ageBrackets.adult++;
        else if (age >= 41 && age <= 60) stats.ageBrackets.middle++;
        else if (age > 60) stats.ageBrackets.senior++;
      }
    }
    if (stats.votersWithAge > 0) stats.averageAge = Math.round(stats.totalAge / stats.votersWithAge);
    entry.stats = stats;
    updatedCount++;
    console.log(`  -> ${stats.totalVoters} voters | Male: ${stats.maleVoters} | Female: ${stats.femaleVoters} | Avg Age: ${stats.averageAge}`);
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
  }
}

fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
console.log(`\nDone! Updated stats for ${updatedCount} file(s).`);
