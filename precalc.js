const fs = require('fs');
const path = require('path');

const excelMetaPath = path.join(__dirname, 'excel-metadata.json');
const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));

for (let m of metadata) {
  if (m.stats) continue; // skip if already calculated

  const jsonFilePath = path.join(__dirname, 'uploads', m.fileName + '.json');
  if (fs.existsSync(jsonFilePath)) {
    console.log(`Processing ${m.fileName}...`);
    try {
      const data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
      let stats = {
        totalVoters: data.length,
        maleVoters: 0,
        femaleVoters: 0,
        averageAge: 0,
        totalAge: 0,
        votersWithAge: 0,
        ageBrackets: { youth: 0, adult: 0, middle: 0, senior: 0 }
      };

      for (const v of data) {
        // Determine Gender
        const gender = (v.MSEX || v.FGENDER || v.SEX || '').toUpperCase();
        if (gender === 'M' || gender === 'पुरुष') stats.maleVoters++;
        else if (gender === 'F' || gender === 'स्त्री') stats.femaleVoters++;

        // Determine Age
        const age = parseInt(v.MAGE || v.FAGE || v.AGE);
        if (!isNaN(age) && age > 0 && age < 150) {
          stats.totalAge += age;
          stats.votersWithAge++;

          if (age >= 18 && age <= 25) stats.ageBrackets.youth++;
          else if (age >= 26 && age <= 40) stats.ageBrackets.adult++;
          else if (age >= 41 && age <= 60) stats.ageBrackets.middle++;
          else if (age > 60) stats.ageBrackets.senior++;
        }
      }

      if (stats.votersWithAge > 0) {
        stats.averageAge = Math.round(stats.totalAge / stats.votersWithAge);
      }

      m.stats = stats;
      console.log(`Stats for ${m.fileName}:`, stats);
    } catch (e) {
      console.error(`Failed to process ${m.fileName}:`, e.message);
    }
  }
}

fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
console.log('Done updating metadata.');
