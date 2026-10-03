const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'supersecretjwtkey_please_change_in_production'; // Simple hardcoded secret

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/download/:filename', (req, res) => {
  const file = path.join(__dirname, 'uploads', req.params.filename);
  res.download(file);
});

const dataFilePath = path.join(__dirname, 'data.json');
const usersFilePath = path.join(__dirname, 'users.json');
const settingsFilePath = path.join(__dirname, 'settings.json');


// Initialize data files if they don't exist
if (!fs.existsSync(dataFilePath)) {
  fs.writeFileSync(dataFilePath, JSON.stringify([]));
}
if (!fs.existsSync(usersFilePath)) {
  // Create default admin: admin123 / admin123
  const defaultAdmin = [{
    id: 'admin123',
    email: 'admin123',
    name: 'Admin',
    phone: '',
    role: 'admin',
    status: 'active',
    passwordHash: '$2b$10$.TH8V2wgwIf8Kuz1pZEdF.DHKchynjrV0B8OLK2d.fS4skIaHkgPm'
  }];
  fs.writeFileSync(usersFilePath, JSON.stringify(defaultAdmin, null, 2));
}
if (!fs.existsSync(settingsFilePath)) {
  const defaultSettings = {
    assemblyImage: "https://images.unsplash.com/photo-1575517111478-7f6afd0973db?q=80&w=2070&auto=format&fit=crop",
    nagarNigamImage: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?q=80&w=2070&auto=format&fit=crop",
    gramPanchayatImage: "https://images.unsplash.com/photo-1592659762303-90081d34b277?q=80&w=2073&auto=format&fit=crop",
    privacyPolicyText: "This is the default privacy policy. Update this in the admin panel.",
    termsOfServiceText: "These are the default terms of service. Update this in the admin panel.",
    qrCodeImage: "https://via.placeholder.com/200?text=Scan+QR+Code"
  };
  fs.writeFileSync(settingsFilePath, JSON.stringify(defaultSettings, null, 2));
} else {
  // Add new defaults to existing settings if they don't exist
  let settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  let updated = false;
  if (!settings.privacyPolicyText) { settings.privacyPolicyText = "This is the default privacy policy. Update this in the admin panel."; updated = true; }
  if (!settings.termsOfServiceText) { settings.termsOfServiceText = "These are the default terms of service. Update this in the admin panel."; updated = true; }
  if (!settings.qrCodeImage) { settings.qrCodeImage = "https://via.placeholder.com/200?text=Scan+QR+Code"; updated = true; }
  if (updated) fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));
}

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/api/signup', (req, res) => {
  const { name, phone, email, password } = req.body;
  if (!name || !phone || !email || !password) return res.status(400).json({ error: 'All fields are required' });
  
  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
  
  const newUser = {
    id: Date.now().toString(),
    name, phone, email,
    role: 'user',
    status: 'pending_payment',
    passwordHash: bcrypt.hashSync(password, 10)
  };
  
  users.push(newUser);
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ message: 'Signup successful', userId: newUser.id });
});

app.post('/api/submit-utr', (req, res) => {
  const { userId, utr } = req.body;
  if (!userId || !utr) return res.status(400).json({ error: 'User ID and UTR are required' });
  
  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.id === userId);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.status !== 'pending_payment' && user.status !== 'pending_approval') {
    return res.status(400).json({ error: 'Invalid user status' });
  }
  
  user.status = 'pending_approval';
  user.utr = utr;
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ message: 'UTR submitted successfully. Please wait for admin approval.' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.email === email);

  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const isMatch = bcrypt.compareSync(password, user.passwordHash);
  if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

  if (user.role !== 'admin' && user.status === 'pending_payment') {
    return res.status(403).json({ error: 'Payment pending', userId: user.id, status: user.status });
  }
  if (user.role !== 'admin' && user.status === 'pending_approval') {
    return res.status(403).json({ error: 'Account pending admin approval', userId: user.id, status: user.status });
  }

  const token = jwt.sign({ email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token, role: user.role || 'user', status: user.status });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  console.log("API /me called. req.user:", req.user);
  const user = users.find(u => u.email === req.user.email);
  if (!user) {
    console.log("User not found in users.json for email:", req.user.email);
    return res.status(404).json({ error: 'User not found' });
  }
  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

// Admin User endpoints
app.get('/api/admin/users', (req, res) => {
  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const safeUsers = users.map(u => {
    const { passwordHash, ...rest } = u;
    return rest;
  });
  res.json(safeUsers);
});

app.post('/api/admin/approve-user', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  
  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.id === userId);
  
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  user.status = 'active';
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ message: 'User approved successfully' });
});

app.post('/api/admin/remove-user', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID required' });
  
  let users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const initialLength = users.length;
  users = users.filter(u => u.id !== userId);
  
  if (users.length === initialLength) return res.status(404).json({ error: 'User not found' });
  
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
  res.json({ message: 'User access removed successfully' });
});

// POST endpoint to log a new print
app.post('/api/prints', (req, res) => {
  const { optionType, wardNo, partNo, serialNo, voterName, pagesCount } = req.body;
  
  if (!optionType || !pagesCount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let accountDetails = 'Guest User';
  const token = req.headers.authorization?.split(' ')[1];
  if (token && token !== 'DUMMY') {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      accountDetails = decoded.email || 'Guest User';
    } catch (e) {
      // ignore invalid tokens for guest prints
    }
  }

  const newPrint = {
    id: Date.now(),
    option_type: optionType,
    ward_no: wardNo,
    part_no: partNo,
    serial_no: serialNo,
    voter_name: voterName,
    pages_count: pagesCount,
    account: accountDetails,
    timestamp: new Date().toISOString()
  };

  try {
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    data.push(newPrint);
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    res.status(201).json({ id: newPrint.id, message: 'Print record logged successfully' });
  } catch (err) {
    console.error('Error saving print:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET endpoint to retrieve all print records (Protected)
app.get('/api/prints', authMiddleware, (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    // Sort descending by timestamp
    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(data);
  } catch (err) {
    console.error('Error reading prints:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const customName = req.body.fileName || file.originalname;
    const finalName = (customName.endsWith('.xlsx') || customName.endsWith('.csv') || customName.endsWith('.xls')) ? customName : `${customName}.xlsx`;
    cb(null, finalName);
  }
});
const upload = multer({ storage });

const excelMetaPath = path.join(__dirname, 'excel-metadata.json');

app.post('/api/upload-excel', upload.single('excelFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const category = req.body.category || 'general';
  
  if (!fs.existsSync(excelMetaPath)) fs.writeFileSync(excelMetaPath, JSON.stringify([]));
  
  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch(e) {
    console.error('Error parsing metadata:', e);
    // If metadata file is completely corrupted, backup the file and reset
    fs.copyFileSync(excelMetaPath, excelMetaPath + '.bak');
    fs.writeFileSync(excelMetaPath, JSON.stringify([]));
  }
  
  let extractedMeta = {
    state: req.body.state,
    district: req.body.district,
    city: req.body.city,
    assembly: req.body.assembly,
    booth: req.body.booth,
    ward: req.body.ward,
    village: req.body.village,
    panchayat: req.body.panchayat,
  };

  try {
    const wb = xlsx.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    if (data && data.length > 0) {
      const firstRow = data[0];
      // Override with Excel data ONLY if user did not manually provide it
      if (!extractedMeta.district && firstRow['ZILLA PARISHAD NAME']) extractedMeta.district = String(firstRow['ZILLA PARISHAD NAME']).trim();
      
      // Depending on category, map PANCHAYAT SAMITI to city or assembly
      if (firstRow['PANCHAYAT SAMITI NAME']) {
        const samiti = String(firstRow['PANCHAYAT SAMITI NAME']).trim();
        if (!extractedMeta.city) extractedMeta.city = samiti;
        if (!extractedMeta.assembly) extractedMeta.assembly = samiti;
      }
      
      if (!extractedMeta.booth && firstRow['BOOTH_NO']) extractedMeta.booth = String(firstRow['BOOTH_NO']).trim();
      if (!extractedMeta.ward && firstRow['WARDNO']) extractedMeta.ward = String(firstRow['WARDNO']).trim();
      if (!extractedMeta.village && firstRow['VILLAGE']) extractedMeta.village = String(firstRow['VILLAGE']).trim();
      if (!extractedMeta.panchayat && firstRow['PANCHAYAT NAME']) extractedMeta.panchayat = String(firstRow['PANCHAYAT NAME']).trim();
    }
    // Store JSON version for fast access
    fs.writeFileSync(req.file.path + '.json', JSON.stringify(data));
    
    // Calculate stats
    let stats = {
      totalVoters: data.length, maleVoters: 0, femaleVoters: 0,
      averageAge: 0, totalAge: 0, votersWithAge: 0,
      ageBrackets: { youth: 0, adult: 0, middle: 0, senior: 0 }
    };
    for (const v of data) {
      const gender = (v.MSEX || v.FGENDER || v.SEX || '').toUpperCase();
      if (gender === 'M' || gender === 'पुरुष') stats.maleVoters++;
      else if (gender === 'F' || gender === 'स्त्री') stats.femaleVoters++;
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
    extractedMeta.stats = stats;
  } catch(e) {
    console.error('Error extracting data from excel:', e);
  }

  metadata.push({
    id: Date.now(),
    fileName: req.file.filename,
    originalName: req.file.originalname,
    category: category,
    ...extractedMeta,
    timestamp: new Date().toISOString()
  });
  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));

  res.json({ message: 'File uploaded successfully', fileName: req.file.filename });
});

app.get('/api/excel-files/:category', (req, res) => {
  const category = req.params.category;
  if (!fs.existsSync(excelMetaPath)) return res.json([]);
  
  const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  const filtered = metadata.filter(m => m.category === category);
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(filtered);
});

// Analytics API
app.get('/api/analytics', (req, res) => {
  let printsCount = 0;
  let lastPrintDate = null;
  
  let stats = {
    assemblyFiles: 0,
    nagarNigamFiles: 0,
    panchayatFiles: 0,
    totalVoters: 0,
    maleVoters: 0,
    femaleVoters: 0,
    averageAge: 0,
    totalAge: 0, // for internal calculation
    votersWithAge: 0,
    ageBrackets: {
      youth: 0,     // 18-25
      adult: 0,     // 26-40
      middle: 0,    // 41-60
      senior: 0     // 60+
    }
  };

  if (fs.existsSync(excelMetaPath)) {
    const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
    
    for (const m of metadata) {
      if (m.category === 'assembly') stats.assemblyFiles++;
      else if (m.category === 'nagar-nigam') stats.nagarNigamFiles++;
      else if (m.category === 'panchayat') stats.panchayatFiles++;

      if (m.stats) {
        stats.totalVoters += m.stats.totalVoters || 0;
        stats.maleVoters += m.stats.maleVoters || 0;
        stats.femaleVoters += m.stats.femaleVoters || 0;
        stats.totalAge += m.stats.totalAge || 0;
        stats.votersWithAge += m.stats.votersWithAge || 0;
        
        if (m.stats.ageBrackets) {
          stats.ageBrackets.youth += m.stats.ageBrackets.youth || 0;
          stats.ageBrackets.adult += m.stats.ageBrackets.adult || 0;
          stats.ageBrackets.middle += m.stats.ageBrackets.middle || 0;
          stats.ageBrackets.senior += m.stats.ageBrackets.senior || 0;
        }
      }
    }
    
    if (stats.votersWithAge > 0) {
      stats.averageAge = Math.round(stats.totalAge / stats.votersWithAge);
    }
  }
  
  if (fs.existsSync(dataFilePath)) {
    const prints = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    printsCount = prints.length;
    if (prints.length > 0) {
      prints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      lastPrintDate = prints[0].timestamp;
    }
  }

  res.json({
    ...stats,
    printsCount,
    lastPrintDate
  });
});

// PUT endpoint to update excel file metadata and optionally replace the file
app.put('/api/excel-files/:id', upload.single('excelFile'), (req, res) => {
  const fileId = parseInt(req.params.id);
  if (!fs.existsSync(excelMetaPath)) return res.status(404).json({ error: 'Metadata file not found' });
  
  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch(e) {
    return res.status(500).json({ error: 'Internal server error reading metadata' });
  }
  const fileIndex = metadata.findIndex(m => m.id === fileId);
  
  if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });
  
  const updatedData = req.body;
  // Ensure we don't overwrite id, fileName, originalName, category, timestamp unless a new file is uploaded
  let updatedEntry = { 
    ...metadata[fileIndex], 
    state: updatedData.state || metadata[fileIndex].state,
    district: updatedData.district || metadata[fileIndex].district,
    city: updatedData.city || metadata[fileIndex].city,
    ward: updatedData.ward || metadata[fileIndex].ward,
    booth: updatedData.booth || metadata[fileIndex].booth,
    assembly: updatedData.assembly || metadata[fileIndex].assembly,
    village: updatedData.village || metadata[fileIndex].village,
    panchayat: updatedData.panchayat || metadata[fileIndex].panchayat
  };

  if (req.file) {
    updatedEntry.fileName = req.file.filename;
    updatedEntry.originalName = req.file.originalname;
    updatedEntry.timestamp = new Date().toISOString();

    // Process new file to JSON immediately
    try {
      const wb = xlsx.readFile(req.file.path);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(sheet);
      fs.writeFileSync(req.file.path + '.json', JSON.stringify(data));
      
      // Calculate stats
      let stats = {
        totalVoters: data.length, maleVoters: 0, femaleVoters: 0,
        averageAge: 0, totalAge: 0, votersWithAge: 0,
        ageBrackets: { youth: 0, adult: 0, middle: 0, senior: 0 }
      };
      for (const v of data) {
        const gender = (v.MSEX || v.FGENDER || v.SEX || '').toUpperCase();
        if (gender === 'M' || gender === 'पुरुष') stats.maleVoters++;
        else if (gender === 'F' || gender === 'स्त्री') stats.femaleVoters++;
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
      updatedEntry.stats = stats;
    } catch(e) {
      console.error('Error processing updated excel to JSON:', e);
    }
  }
  
  metadata[fileIndex] = updatedEntry;
  
  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
  res.json({ message: 'File metadata updated successfully', data: metadata[fileIndex] });
});

app.delete('/api/excel-files/:id', (req, res) => {
  const fileId = parseInt(req.params.id);
  if (!fs.existsSync(excelMetaPath)) return res.status(404).json({ error: 'Metadata file not found' });
  
  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch(e) {
    return res.status(500).json({ error: 'Internal server error reading metadata' });
  }
  
  const fileIndex = metadata.findIndex(m => m.id === fileId);
  if (fileIndex === -1) return res.status(404).json({ error: 'File not found' });
  
  const fileEntry = metadata[fileIndex];
  
  // Optionally delete physical files
  try {
    if (fileEntry.fileName) {
      const filePath = path.join(__dirname, 'uploads', fileEntry.fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(filePath + '.json')) fs.unlinkSync(filePath + '.json');
    }
  } catch (err) {
    console.error('Error deleting physical files:', err);
  }
  
  metadata.splice(fileIndex, 1);
  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
  
  res.json({ message: 'File deleted successfully' });
});

const excelDataCache = new Map(); // Kept for backwards compatibility if needed, but not heavily relied on

// GET endpoint to fetch voters from excel based on location metadata
app.get('/api/voters', (req, res) => {
  const { category, state, district, city, assembly, booth, ward, village, panchayat } = req.query;
  if (!fs.existsSync(excelMetaPath)) return res.json({ voters: [] });

  let metadata = [];
  try {
    metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  } catch(e) {
    console.error('Error parsing metadata:', e);
    return res.status(500).json({ error: 'Internal server error reading metadata', voters: [] });
  }
  // Find matching excel file
  const matchingFiles = metadata.filter(m => {
    let match = m.category === category;
    if (state) match = match && m.state === state;
    if (district) match = match && m.district === district;
    if (city) match = match && m.city === city;
    if (assembly) match = match && m.assembly === assembly;
    if (village) match = match && m.village === village;
    if (panchayat) match = match && m.panchayat === panchayat;
    
    // Exact match if provided and no range
    if (booth && !req.query.boothStart) match = match && m.booth === booth;
    if (ward && !req.query.wardStart) match = match && m.ward === ward;

    // Range match logic
    if (req.query.boothStart && req.query.boothEnd && m.booth) {
      const bStart = parseInt(req.query.boothStart);
      const bEnd = parseInt(req.query.boothEnd);
      const mBooth = parseInt(m.booth);
      if (!isNaN(bStart) && !isNaN(bEnd) && !isNaN(mBooth)) {
        match = match && mBooth >= bStart && mBooth <= bEnd;
      }
    }

    if (req.query.wardStart && req.query.wardEnd && m.ward) {
      const wStart = parseInt(req.query.wardStart);
      const wEnd = parseInt(req.query.wardEnd);
      const mWard = parseInt(m.ward);
      if (!isNaN(wStart) && !isNaN(wEnd) && !isNaN(mWard)) {
        match = match && mWard >= wStart && mWard <= wEnd;
      }
    }

    return match;
  });

  if (matchingFiles.length === 0) return res.json({ error: 'No data found for this location', voters: [] });

  try {
    let allVoters = [];
    for (const matchingFile of matchingFiles) {
      const filePath = path.join(__dirname, 'uploads', matchingFile.fileName);
      const jsonFilePath = filePath + '.json';
      
      if (!fs.existsSync(filePath) && !fs.existsSync(jsonFilePath)) continue;

      let data;
      if (fs.existsSync(jsonFilePath)) {
        data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf-8'));
      } else {
        const wb = xlsx.readFile(filePath);
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        data = xlsx.utils.sheet_to_json(firstSheet);
        fs.writeFileSync(jsonFilePath, JSON.stringify(data));
      }
      
      // Inject ward/booth info if missing from row (helps grouping on frontend)
      data = data.map(row => ({
        ...row, 
        _meta_ward: matchingFile.ward, 
        _meta_booth: matchingFile.booth,
        _meta_panchayat: matchingFile.panchayat
      }));

      allVoters = allVoters.concat(data);
    }
    res.json({ voters: allVoters });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read data files', details: e.message });
  }
});

// Settings API
app.get('/api/settings', (req, res) => {
  const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  res.json(settings);
});

app.put('/api/settings', (req, res) => {
  const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  const updatedSettings = { ...settings, ...req.body };
  fs.writeFileSync(settingsFilePath, JSON.stringify(updatedSettings, null, 2));
  res.json({ message: 'Settings updated successfully', settings: updatedSettings });
});

app.post('/api/settings/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const key = req.body.key;
  
  if (!['assemblyImage', 'nagarNigamImage', 'gramPanchayatImage'].includes(key)) {
    // try to delete the uploaded file since it's invalid
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid key' });
  }

  const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const imageUrl = `${baseUrl}/api/uploads/${req.file.filename}`;
  
  settings[key] = imageUrl;
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));
  
  res.json({ message: 'Image updated successfully', imageUrl });
});

// Keep-alive ping endpoint
app.get('/api/ping', (req, res) => {
  res.status(200).send('pong');
});

// Pre-convert any .xlsx files to .json on server startup (useful for Render deployment)
if (fs.existsSync(excelMetaPath)) {
  console.log('Checking for unconverted Excel files...');
  try {
    const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
    for (const m of metadata) {
      if (m.fileName) {
        const filePath = path.join(__dirname, 'uploads', m.fileName);
        const jsonFilePath = filePath + '.json';
        if (fs.existsSync(filePath) && !fs.existsSync(jsonFilePath)) {
          console.log(`Converting ${m.fileName} to JSON...`);
          try {
            const wb = xlsx.readFile(filePath);
            const firstSheet = wb.Sheets[wb.SheetNames[0]];
            const data = xlsx.utils.sheet_to_json(firstSheet);
            fs.writeFileSync(jsonFilePath, JSON.stringify(data));
            console.log(`Successfully converted ${m.fileName}`);
          } catch (e) {
            console.error(`Failed to convert ${m.fileName}:`, e.message);
          }
        }
      }
    }
    console.log('Excel to JSON startup check complete.');
  } catch (err) {
    console.error('Error during startup Excel conversion check:', err);
  }
}

// Start the server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  
  // Self-ping to keep Render backend awake
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const interval = 14 * 60 * 1000; // 14 minutes
  
  setInterval(() => {
    const lib = url.startsWith('https') ? require('https') : require('http');
    lib.get(`${url}/api/ping`, (res) => {
      console.log(`Keep-alive ping to ${url}/api/ping: ${res.statusCode}`);
    }).on('error', (e) => {
      console.error(`Keep-alive ping error: ${e.message}`);
    });
  }, interval);
});
