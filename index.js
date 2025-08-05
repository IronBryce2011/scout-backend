require('dotenv').config();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const session = require('express-session');
const cors = require('cors');
const express = require('express');
const app = express();

// Allowed frontend origins for CORS
const allowedOrigins = [
  'https://troop423.netlify.app',
  'https://troop423-admin-site.netlify.app'
];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (curl, Postman, etc.)
    if (!origin) return callback(null, true);
    if (!allowedOrigins.includes(origin)) {
      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
}));

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies (form submissions)
app.use(express.urlencoded({ extended: true }));

// Session setup with secure cross-origin cookie settings
app.use(session({
  secret: process.env.SESSION_SECRET || 'scout_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',  // cross-site cookies
  },
}));

// Admin auth middleware
const checkAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  return res.status(403).json({ error: 'Admin access required' });
};

// Admin login
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Postgres setup (uses env keys internally, never exposed to frontend)
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: { rejectUnauthorized: false }
});

// Upload folder setup
const uploadFolder = './uploads';
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: uploadFolder,
  filename: (_, file, cb) => {
    const uniqueName = `${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static('uploads'));

// Upload endpoint - only requires admin session, no API key needed
app.post('/api/upload', checkAdmin, upload.single('image'), async (req, res) => {
  try {
    const { caption } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const imagePath = `/uploads/${req.file.filename}`;
    await pool.query('INSERT INTO uploads (image_path, caption) VALUES ($1, $2)', [imagePath, caption]);

    res.json({ message: 'Upload successful!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Get uploads - no API key, no admin required (adjust if needed)
app.get('/api/uploads', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM uploads ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// Post/update announcement - requires admin session only
app.post('/api/announcement', checkAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Announcement content is required' });
    }

    await pool.query(`
      INSERT INTO announcements (id, content)
      VALUES (1, $1)
      ON CONFLICT (id) DO UPDATE
      SET content = EXCLUDED.content,
          created_at = NOW()
    `, [content]);

    res.json({ message: 'Announcement posted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

// Get announcement - no API key or admin needed
app.get('/api/announcement', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 1');
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch announcement' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
