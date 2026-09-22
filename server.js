const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const JWT_SECRET = 'supersecretjwtkey_please_change_in_production'; // Simple hardcoded secret

// Middleware
app.use(cors());
app.use(express.json());

const dataFilePath = path.join(__dirname, 'data.json');
const usersFilePath = path.join(__dirname, 'users.json');

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

// Start the server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
