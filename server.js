const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = 5000;
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
    email: 'admin123',
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
    termsOfServiceText: "These are the default terms of service. Update this in the admin panel."
  };
  fs.writeFileSync(settingsFilePath, JSON.stringify(defaultSettings, null, 2));
} else {
  // Add new defaults to existing settings if they don't exist
  let settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf-8'));
  let updated = false;
  if (!settings.privacyPolicyText) { settings.privacyPolicyText = "This is the default privacy policy. Update this in the admin panel."; updated = true; }
  if (!settings.termsOfServiceText) { settings.termsOfServiceText = "These are the default terms of service. Update this in the admin panel."; updated = true; }
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

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const users = JSON.parse(fs.readFileSync(usersFilePath, 'utf-8'));
  const user = users.find(u => u.email === email);

  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const isMatch = bcrypt.compareSync(password, user.passwordHash);
  if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// POST endpoint to log a new print
app.post('/api/prints', (req, res) => {
  const { optionType, wardNo, partNo, serialNo, voterName, pagesCount } = req.body;
  
  if (!optionType || !pagesCount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const newPrint = {
    id: Date.now(),
    option_type: optionType,
    ward_no: wardNo,
    part_no: partNo,
    serial_no: serialNo,
    voter_name: voterName,
    pages_count: pagesCount,
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
  
  const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  
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
      // Override with Excel data if present
      if (firstRow['ZILLA PARISHAD NAME']) extractedMeta.district = String(firstRow['ZILLA PARISHAD NAME']).trim();
      
      // Depending on category, map PANCHAYAT SAMITI to city or assembly
      if (firstRow['PANCHAYAT SAMITI NAME']) {
        const samiti = String(firstRow['PANCHAYAT SAMITI NAME']).trim();
        extractedMeta.city = samiti;
        extractedMeta.assembly = samiti;
      }
      
      if (firstRow['BOOTH_NO']) extractedMeta.booth = String(firstRow['BOOTH_NO']).trim();
      if (firstRow['WARDNO']) extractedMeta.ward = String(firstRow['WARDNO']).trim();
      if (firstRow['VILLAGE']) extractedMeta.village = String(firstRow['VILLAGE']).trim();
      if (firstRow['PANCHAYAT NAME']) extractedMeta.panchayat = String(firstRow['PANCHAYAT NAME']).trim();
    }
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
  let excelFilesCount = 0;
  let printsCount = 0;
  let lastPrintDate = null;

  if (fs.existsSync(excelMetaPath)) {
    const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
    excelFilesCount = metadata.length;
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
    excelFilesCount,
    printsCount,
    lastPrintDate
  });
});

// PUT endpoint to update excel file metadata and optionally replace the file
app.put('/api/excel-files/:id', upload.single('excelFile'), (req, res) => {
  const fileId = parseInt(req.params.id);
  if (!fs.existsSync(excelMetaPath)) return res.status(404).json({ error: 'Metadata file not found' });
  
  let metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
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
  }
  
  metadata[fileIndex] = updatedEntry;
  
  fs.writeFileSync(excelMetaPath, JSON.stringify(metadata, null, 2));
  res.json({ message: 'File metadata updated successfully', data: metadata[fileIndex] });
});

// GET endpoint to fetch voters from excel based on location metadata
app.get('/api/voters', (req, res) => {
  const { category, state, district, city, assembly, booth, ward, village, panchayat } = req.query;
  if (!fs.existsSync(excelMetaPath)) return res.json({ voters: [] });

  const metadata = JSON.parse(fs.readFileSync(excelMetaPath, 'utf-8'));
  // Find matching excel file
  const matchingFile = metadata.find(m => {
    let match = m.category === category;
    if (state && m.state) match = match && m.state === state;
    if (district && m.district) match = match && m.district === district;
    if (city && m.city) match = match && m.city === city;
    if (assembly && m.assembly) match = match && m.assembly === assembly;
    if (booth && m.booth) match = match && m.booth === booth;
    if (ward && m.ward) match = match && m.ward === ward;
    if (village && m.village) match = match && m.village === village;
    if (panchayat && m.panchayat) match = match && m.panchayat === panchayat;
    return match;
  });

  if (!matchingFile) return res.json({ error: 'No data found for this location', voters: [] });

  const filePath = path.join(__dirname, 'uploads', matchingFile.fileName);
  if (!fs.existsSync(filePath)) return res.json({ error: 'Excel file not found on disk', voters: [] });

  try {
    const wb = xlsx.readFile(filePath);
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(firstSheet);
    res.json({ voters: data });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read excel file', details: e.message });
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
  
  // Create absolute URL or relative URL based on app setup
  // Usually relative path like /api/uploads/filename is better as it works on any host/port
  const imageUrl = `http://localhost:${PORT}/api/uploads/${req.file.filename}`;
  
  settings[key] = imageUrl;
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));
  
  res.json({ message: 'Image updated successfully', imageUrl });
});

// Keep-alive ping endpoint
app.get('/api/ping', (req, res) => {
  res.status(200).send('pong');
});

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
