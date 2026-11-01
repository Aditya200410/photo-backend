const fs = require('fs');
const path = require('path');

// Formats requested by user:
// 1. Without Header:
//    - 'simple8': 8 Slip on A4 (without header)
//    - 'simple10': 10 Slip on A4 (without header)
//    - 'simple12': 12 Slip on A4 (without header)
// 2. With Header:
//    - 'header6': 6 Slip on A4 (with header / banner)
//    - 'header8': 8 Slip on A4 (with header / banner)
// 3. Alphabetical:
//    - 'alphabetical': 40 entry / page

const FORMATS = [
  // Without Header
  { id: 'simple8', name: 'Without Header (8 Slip/A4)', cardsPerPage: 8, hasHeader: false, category: 'withoutHeader' },
  { id: 'simple10', name: 'Without Header (10 Slip/A4)', cardsPerPage: 10, hasHeader: false, category: 'withoutHeader' },
  { id: 'simple12', name: 'Without Header (12 Slip/A4)', cardsPerPage: 12, hasHeader: false, category: 'withoutHeader' },

  // With Header
  { id: 'header6', name: 'With Header (6 Slip/A4)', cardsPerPage: 6, hasHeader: true, category: 'withHeader' },
  { id: 'header8', name: 'With Header (8 Slip/A4)', cardsPerPage: 8, hasHeader: true, category: 'withHeader' },

  // Alphabetical
  { id: 'alphabetical', name: 'Alphabetical Voter List (40 Entry/Page)', cardsPerPage: 40, hasHeader: false, category: 'alphabetical' }
];

const cleanVal = (val, fallback = '-') => {
  if (val === undefined || val === null) return fallback;
  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'all' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') return fallback;
  return str;
};

function mapVoter(voter, meta) {
  const rawGender = voter.FGENDER || voter.MSEX || voter.GENDER || voter.SEX || '';
  const mappedGender = (rawGender === 'M' || rawGender === 'पुरुष') ? 'पुरुष' : ((rawGender === 'F' || rawGender === 'स्त्री') ? 'स्त्री' : rawGender || '-');

  const vFName = voter.V_FNAME_EN ? `${voter.V_FNAME_EN} ${voter.V_LNAME_EN || ''}`.trim() : (voter.V_FNAME_HI || voter.EFVNAME || voter.FVNAME || voter.VOTER_NAME || '-');
  const fFName = voter.VR_FNAME_EN ? `${voter.VR_FNAME_EN} ${voter.VR_LNAME_EN || ''}`.trim() : (voter.VR_FNAME_HI || voter.EFRNAME || voter.FRNAME || voter.RELATIVE_NAME || '-');

  const rawWard = voter.WARDNO || voter.WARD_NO || voter['WARD NO'] || voter['PANCHAYAT WARD NO'] || voter.WARD || voter.NWARDNO || voter._meta_ward || voter.ward || meta.ward || '-';
  const resolvedWard = cleanVal(rawWard);

  const rawPart = voter.MPARTNO || voter.PART_NO || voter.BOOTH_NO || voter.PARTNO || voter['PART NO'] || voter.PART || voter.BOOTH || voter._meta_booth || voter.booth || meta.booth || '-';
  const resolvedPart = cleanVal(rawPart);

  const rawSerial = voter.SRNO2 || voter.SRNO1 || voter.SLNOINPART || voter.SL_NO || voter.SERIAL_NO || voter.SRNO || voter.SNO || voter.ID || voter.VID || '1';
  const rawId = voter.IDCARD_NO || voter.EPIC_NO || voter.VID || voter.IDCARD || voter.EPIC || voter.VOTER_ID || '-';
  const rawHouse = voter.HOUSE_NO || voter.MHOUSENO || voter.FHOUSENO || voter.HOUSENO || '0';
  const rawAge = voter.AGE || voter.MAGE || voter.FAGE || '18';
  const resolvedPS = voter.PS_EN || voter.PS_HI || voter.MPSNAME || voter.PSLOCATION || `${meta.assembly || meta.panchayat || meta.city || 'मतदान केंद्र'} ${resolvedPart !== '-' ? '- Booth ' + resolvedPart : ''}`.trim();

  return {
    wardNo: resolvedWard,
    partNo: resolvedPart,
    serialNo: cleanVal(rawSerial, '1'),
    idNumber: cleanVal(rawId),
    voterName: vFName,
    fatherHusbandName: fFName,
    houseNo: cleanVal(rawHouse, '0'),
    gender: mappedGender,
    age: String(rawAge).replace(/वर्ष/g, '').trim(),
    pollingStation: resolvedPS
  };
}

function renderSlipHtml(voter, format) {
  const hasHeader = Boolean(format.hasHeader);
  const cardsPerPage = format.cardsPerPage || 8;

  // Adapt font sizes and line heights based on card density
  const isDense = cardsPerPage >= 10;
  const is12 = cardsPerPage >= 12;

  // Header banner height exactly matching the template box with expanded image space
  const headerH = cardsPerPage === 6 ? '68px' : (cardsPerPage === 8 ? '52px' : '40px');
  const headerFontSize = cardsPerPage === 6 ? '12px' : (cardsPerPage === 8 ? '10px' : '9px');
  const cutNoticeSize = cardsPerPage === 6 ? '8px' : '7px';
  const paddingBox = is12 ? '2px 5px 2px 5px' : (isDense ? '3px 6px 3px 6px' : '4px 8px 3px 8px');
  const fontSizeBase = is12 ? '9.5px' : (isDense ? '10px' : '11px');
  const labelSize = is12 ? '9.5px' : (isDense ? '10px' : '11px');
  const valSize = is12 ? '10.5px' : (isDense ? '11.5px' : '12px');
  const smallTextSize = is12 ? '8.5px' : (isDense ? '9px' : '10px');

  return `
    <div style="width: 100%; height: 100%; border: 1.5px solid #000000; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; background: #ffffff; color: #000000; font-family: 'Noto Sans Devanagari', 'Segoe UI', Arial, sans-serif;">
      ${hasHeader ? `
        <div style="width: 100%; height: ${headerH}; background: #ffffff; border-bottom: 1px solid #000000; flex-shrink: 0; box-sizing: border-box;">
        </div>
        <div style="width: 100%; text-align: center; font-size: ${cutNoticeSize}; font-weight: 900; color: #000000; padding: 1px 0; border-bottom: 1px solid #000000; background: #ffffff; flex-shrink: 0;">
          मतदान केंद्र जाने से पहले ऊपर वाले इस भाग को काट दे
        </div>
      ` : ''}

      <div style="padding: ${paddingBox}; display: flex; flex-direction: column; flex: 1; justify-content: space-between; font-size: ${fontSizeBase}; line-height: 1.25; box-sizing: border-box; min-height: 0;">
        <!-- Row 1: Ward & Part -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-weight: bold; font-size: ${labelSize};">वार्ड नं० :</span>
            <div style="border: 1px solid #000000; min-width: 36px; padding: 0 4px; height: ${isDense ? '15px' : '17px'}; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: ${valSize};">
              ${voter.wardNo}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-weight: bold; font-size: ${labelSize};">भाग नं० :</span>
            <div style="border: 1px solid #000000; min-width: 34px; padding: 0 4px; height: ${isDense ? '15px' : '17px'}; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: ${valSize};">
              ${voter.partNo}
            </div>
          </div>
        </div>

        <!-- Row 2: Serial & EPIC -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-weight: bold; font-size: ${labelSize};">क्रम संख्या :</span>
            <div style="border: 1px solid #000000; min-width: 48px; padding: 0 4px; height: ${isDense ? '16px' : '18px'}; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: ${valSize};">
              ${voter.serialNo}
            </div>
          </div>
          <div style="font-weight: 900; font-size: ${valSize}; font-family: monospace; letter-spacing: 0.2px;">
            ${voter.idNumber}
          </div>
        </div>

        <!-- Row 3: Name -->
        <div style="display: flex; align-items: baseline;">
          <span style="font-weight: bold; font-size: ${labelSize}; white-space: nowrap; margin-right: 4px;">मतदाता का नाम :</span>
          <span style="font-weight: 900; font-size: ${valSize}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${voter.voterName}</span>
        </div>

        <!-- Row 4: Relative -->
        <div style="display: flex; align-items: baseline;">
          <span style="font-weight: bold; font-size: ${labelSize}; white-space: nowrap; margin-right: 4px;">पिता / पति :</span>
          <span style="font-weight: 700; font-size: ${valSize}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${voter.fatherHusbandName}</span>
        </div>

        <!-- Row 5: House, Gender, Age -->
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div><span style="font-weight: bold; font-size: ${smallTextSize};">म०: </span><span style="font-weight: 800; font-size: ${smallTextSize};">${voter.houseNo}</span></div>
          <div><span style="font-weight: bold; font-size: ${smallTextSize};">लिंग: </span><span style="font-weight: 700; font-size: ${smallTextSize};">${voter.gender}</span></div>
          <div><span style="font-weight: bold; font-size: ${smallTextSize};">आयु: </span><span style="font-weight: 800; font-size: ${smallTextSize};">${voter.age}</span></div>
        </div>

        <!-- Row 6: Polling Station -->
        <div style="display: flex; align-items: flex-start; line-height: 1.2;">
          <span style="font-weight: bold; font-size: ${smallTextSize}; white-space: nowrap; margin-right: 3px; flex-shrink: 0;">केंद्र:</span>
          <span style="font-weight: 700; font-size: ${smallTextSize}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${voter.pollingStation}</span>
        </div>
      </div>
    </div>
  `;
}

function renderAppealHtml(voter, meta) {
  return `
    <div style="width: 210mm; height: 296.5mm; padding: 18mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; font-family: 'Noto Sans Devanagari', 'Segoe UI', Arial, sans-serif; background: #ffffff;">
      <div style="border: 3px double #0f172a; padding: 18px; height: 100%; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box;">
        <div>
          <div style="background: linear-gradient(to right, #ea580c, #c2410c); color: #ffffff; padding: 12px; text-align: center; border-radius: 6px; margin-bottom: 20px;">
            <h1 style="font-size: 24px; margin: 0; font-weight: 900;">सादर अपील</h1>
            <p style="font-size: 14px; margin: 4px 0 0 0; font-weight: 700;">${meta.assembly || meta.panchayat || meta.city || 'विधानसभा क्षेत्र'} के सम्मानित मतदाताओं से</p>
          </div>

          <div style="font-size: 16px; line-height: 1.8; color: #1e293b; margin-top: 15px;">
            <p style="font-weight: 700; margin-bottom: 12px;">आदरणीय <strong>${voter.voterName}</strong> जी,</p>
            <p>आपको सादर प्रणाम। आपके क्षेत्र के समग्र विकास, निष्पक्ष सेवा एवं जनकल्याण के लिए हम सदैव आपके साथ हैं।</p>
            <p style="margin-top: 12px;">आगामी मतदान दिवस पर अपने मताधिकार का प्रयोग कर हमें अपना अमूल्य आशीर्वाद व समर्थन प्रदान करें।</p>
          </div>

          <div style="margin-top: 25px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 16px;">
            <h3 style="font-size: 14px; margin: 0 0 10px 0; font-weight: 800; color: #0f172a; border-bottom: 1px solid #cbd5e1; pb: 6px;">आपकी मतदाता विवरण पर्ची:</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
              <div><strong>क्रम संख्या:</strong> ${voter.serialNo}</div>
              <div><strong>पहचान पत्र क्र०:</strong> ${voter.idNumber}</div>
              <div><strong>वार्ड नं०:</strong> ${voter.wardNo}</div>
              <div><strong>भाग / बूथ नं०:</strong> ${voter.partNo}</div>
              <div style="grid-column: span 2;"><strong>मतदान केंद्र:</strong> ${voter.pollingStation}</div>
            </div>
          </div>
        </div>

        <div style="border-top: 2px dashed #94a3b8; padding-top: 15px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div>
            <div style="font-size: 12px; color: #64748b;">दिनांक: ${new Date().toLocaleDateString('hi-IN')}</div>
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 4px;">स्थान: ${voter.pollingStation}</div>
          </div>
          <div style="text-align: center;">
            <div style="height: 35px; border-bottom: 1px solid #0f172a; width: 140px; margin-bottom: 4px;"></div>
            <div style="font-size: 13px; font-weight: 800; color: #0f172a;">प्रत्याशी हस्ताक्षर / निवेदक</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAlphabeticalPageHtml(votersSlice, pageNum, totalPages, meta) {
  return `
    <div style="width: 210mm; height: 296.5mm; padding: 6mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; font-family: 'Noto Sans Devanagari', 'Segoe UI', Arial, sans-serif; background: #ffffff; color: #0f172a;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 4px; margin-bottom: 6px;">
        <span style="font-size: 13px; font-weight: 900;">वर्णक्रमानुसार मतदाता सूची (Alphabetical Voter List)</span>
        <span style="font-size: 11px; font-weight: 700;">${meta.assembly || meta.panchayat || meta.city || ''}</span>
        <span style="font-size: 10px; color: #64748b; font-weight: 600;">Page ${pageNum} of ${totalPages}</span>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 8.5px; line-height: 1.2;">
        <thead>
          <tr style="background: #0f172a; color: #ffffff;">
            <th style="padding: 3px 5px; text-align: left; width: 45px;">क्रम</th>
            <th style="padding: 3px 5px; text-align: left;">मतदाता का नाम</th>
            <th style="padding: 3px 5px; text-align: left;">पिता / पति का नाम</th>
            <th style="padding: 3px 5px; text-align: center; width: 35px;">मकान</th>
            <th style="padding: 3px 5px; text-align: center; width: 30px;">लिंग</th>
            <th style="padding: 3px 5px; text-align: center; width: 30px;">आयु</th>
            <th style="padding: 3px 5px; text-align: right; width: 85px;">पहचान पत्र क्र०</th>
          </tr>
        </thead>
        <tbody>
          ${votersSlice.map((v, i) => `
            <tr style="border-bottom: 1px solid #e2e8f0; background: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
              <td style="padding: 3px 5px; font-weight: 800;">${v.serialNo}</td>
              <td style="padding: 3px 5px; font-weight: 700;">${v.voterName}</td>
              <td style="padding: 3px 5px;">${v.fatherHusbandName}</td>
              <td style="padding: 3px 5px; text-align: center;">${v.houseNo}</td>
              <td style="padding: 3px 5px; text-align: center;">${v.gender}</td>
              <td style="padding: 3px 5px; text-align: center;">${v.age}</td>
              <td style="padding: 3px 5px; text-align: right; font-family: monospace; font-weight: 800;">${v.idNumber}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGridPageHtml(votersSlice, pageNum, totalPages, format, meta) {
  const cardsPerPage = format.cardsPerPage || 8;
  const rows = cardsPerPage === 6 ? 3 : (cardsPerPage === 8 ? 4 : (cardsPerPage === 10 ? 5 : 6));
  const cols = 2;
  const gapV = cardsPerPage === 6 ? 10 : (cardsPerPage === 8 ? 7 : (cardsPerPage === 10 ? 5 : 4));
  const gapH = 8;

  return `
    <div style="width: 210mm; height: 296.5mm; padding: 5mm; box-sizing: border-box; page-break-after: always; display: flex; flex-direction: column; overflow: hidden; background: #ffffff;">
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 2mm; border-bottom: 2px solid #0f172a; margin-bottom: 3mm; font-size: 11pt; font-weight: bold; font-family: 'Noto Sans Devanagari', sans-serif; color: #0f172a; flex-shrink: 0;">
        <span style="font-size: 12pt; font-weight: 800;">${meta.assembly || meta.panchayat || meta.city || 'मतदाता सूची पर्ची'}</span>
        <span style="font-size: 10pt; font-weight: 700;">वार्ड: ${meta.ward || '-'}</span>
        <span style="font-size: 10pt; font-weight: 700;">भाग / बूथ: ${meta.booth || '-'}</span>
        <span style="font-size: 9pt; color: #64748b; font-weight: 600;">Page ${pageNum} of ${totalPages}</span>
      </div>

      <!-- Grid -->
      <div style="flex: 1; display: flex; flex-wrap: wrap; align-content: flex-start; min-height: 0;">
        ${votersSlice.map((voter, idx) => {
          const isRight = idx % 2 === 1;
          const isBottom = Math.floor(idx / 2) === rows - 1;
          return `
            <div style="width: calc(50% - ${gapH / 2}px); height: calc((100% - ${(rows - 1) * gapV}px) / ${rows}); margin-right: ${isRight ? 0 : gapH}px; margin-bottom: ${isBottom ? 0 : gapV}px; box-sizing: border-box; min-height: 0;">
              ${renderSlipHtml(voter, format)}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function generatePdfForFileAndFormat(browser, fileMeta, votersRaw, format, outDir) {
  const voters = votersRaw.map(v => mapVoter(v, fileMeta));
  const totalVoters = voters.length;
  if (totalVoters === 0) return null;

  // For alphabetical, sort voters by name
  let sortedVoters = voters;
  if (format.id === 'alphabetical') {
    sortedVoters = [...voters].sort((a, b) => String(a.voterName).localeCompare(String(b.voterName), 'hi'));
  }

  const cardsPerPage = format.cardsPerPage;
  const totalPages = Math.ceil(totalVoters / cardsPerPage);

  let fullHtml = `
    <!DOCTYPE html>
    <html lang="hi">
    <head>
      <meta charset="utf-8">
      <style>
        @page { size: A4 portrait; margin: 0; }
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: #ffffff; font-family: 'Noto Sans Devanagari', 'Segoe UI', Arial, sans-serif; }
      </style>
    </head>
    <body>
  `;

  for (let p = 1; p <= totalPages; p++) {
    const slice = sortedVoters.slice((p - 1) * cardsPerPage, p * cardsPerPage);
    if (format.id === 'appeal') {
      fullHtml += renderAppealHtml(slice[0], fileMeta);
    } else if (format.id === 'alphabetical') {
      fullHtml += renderAlphabeticalPageHtml(slice, p, totalPages, fileMeta);
    } else {
      fullHtml += renderGridPageHtml(slice, p, totalPages, format, fileMeta);
    }
  }

  fullHtml += `</body></html>`;

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(300000);
  page.setDefaultTimeout(300000);
  await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 300000 });

  const safeBaseName = path.basename(fileMeta.fileName, path.extname(fileMeta.fileName));
  const outFileName = `${safeBaseName}_${format.id}_${fileMeta.id}.pdf`;
  const outFilePath = path.join(outDir, outFileName);

  const pdfBuf = await page.pdf({
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    timeout: 600000
  });

  fs.writeFileSync(outFilePath, pdfBuf);
  await page.close();

  const sizeMb = (pdfBuf.length / (1024 * 1024)).toFixed(2);
  const sizeKb = (pdfBuf.length / 1024).toFixed(1);
  return {
    formatId: format.id,
    formatName: format.name,
    fileName: outFileName,
    filePath: outFilePath,
    sizeBytes: pdfBuf.length,
    sizeStr: pdfBuf.length > 1048576 ? `${sizeMb} MB` : `${sizeKb} KB`,
    pages: totalPages,
    voters: totalVoters
  };
}

module.exports = {
  FORMATS,
  generatePdfForFileAndFormat
};
