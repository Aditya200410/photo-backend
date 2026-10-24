const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { FORMATS, generatePdfForFileAndFormat } = require('./pdfGenerator.service');

const excelMetaPath = path.join(__dirname, 'excel-metadata.json');
const printSlipsDir = path.join(__dirname, 'uploads', 'print_slips');

if (!fs.existsSync(printSlipsDir)) {
  fs.mkdirSync(printSlipsDir, { recursive: true });
}

async function run() {
  console.log('--- Starting PDF Generation for all Excel files ---');
  if (!fs.existsSync(excelMetaPath)) {
    console.error('excel-metadata.json not found!');
    process.exit(1);
  }

  const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  const browser = await puppeteer.launch({
    headless: 'new',
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    for (const fileMeta of metadata) {
      const jsonPath = path.join(__dirname, 'uploads', fileMeta.fileName + '.json');
      if (!fs.existsSync(jsonPath)) {
        console.log(`Skipping file without JSON: ${fileMeta.fileName}`);
        continue;
      }

      let voters = [];
      try {
        voters = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      } catch (e) {
        console.error(`Error reading JSON for ${fileMeta.fileName}:`, e.message);
        continue;
      }

      if (!Array.isArray(voters) || voters.length === 0) {
        console.log(`Skipping empty voter list: ${fileMeta.fileName}`);
        continue;
      }

      // If voter list is massive (> 5,000 voters), process first 3,500 to keep generation rapid and low MB
      const votersToProcess = voters.length > 5000 ? voters.slice(0, 3500) : voters;
      console.log(`\nProcessing: ${fileMeta.fileName} (${votersToProcess.length} voters)`);

      if (!fileMeta.generatedPdfs) {
        fileMeta.generatedPdfs = {};
      }

      for (const format of FORMATS) {
        // For Personal Appeal Letter (1 per page), cap at 500 voters to prevent 3,500 page PDF freeze
        const formatVoters = (format.id === 'appeal' && votersToProcess.length > 500) ? votersToProcess.slice(0, 500) : votersToProcess;

        const safeBaseName = path.basename(fileMeta.fileName, path.extname(fileMeta.fileName));
        const outFileName = `${safeBaseName}_${format.id}_${fileMeta.id}.pdf`;
        const expectedPath = path.join(printSlipsDir, outFileName);

        if (fs.existsSync(expectedPath) && fs.statSync(expectedPath).size > 1000) {
          const stats = fs.statSync(expectedPath);
          fileMeta.generatedPdfs[format.id] = {
            fileName: outFileName,
            sizeBytes: stats.size,
            sizeStr: stats.size > 1048576 ? `${(stats.size / 1048576).toFixed(2)} MB` : `${(stats.size / 1024).toFixed(1)} KB`,
            pages: Math.ceil(formatVoters.length / format.cardsPerPage),
            voters: formatVoters.length,
            generatedAt: new Date().toISOString()
          };
          console.log(`  "${format.name}" already generated (${fileMeta.generatedPdfs[format.id].sizeStr}). Skipping.`);
          continue;
        }

        const t0 = Date.now();
        process.stdout.write(`  Generating "${format.name}" (${format.cardsPerPage}/page)... `);
        try {
          const result = await generatePdfForFileAndFormat(browser, fileMeta, formatVoters, format, printSlipsDir);
          if (result) {
            fileMeta.generatedPdfs[format.id] = {
              fileName: result.fileName,
              sizeBytes: result.sizeBytes,
              sizeStr: result.sizeStr,
              pages: result.pages,
              voters: result.voters,
              generatedAt: new Date().toISOString()
            };
            console.log(`DONE in ${Date.now() - t0}ms (${result.pages} pages, ${result.sizeStr})`);
          }
        } catch (err) {
          console.log(`FAILED: ${err.message}`);
        }
      }
    }

    // Save updated metadata with generatedPdfs info
    fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
    console.log('\n--- PDF Generation Complete & Metadata Updated ---');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Fatal error during PDF generation:', err);
  process.exit(1);
});
