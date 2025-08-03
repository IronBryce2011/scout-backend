require('dotenv').config();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const session = require('express-session');
const cors = require('cors');
const express = require('express');
const app = express();

 

app.use(cors({
  origin: ['http://troop423.netlify.app', 'http://troop423-admin-site.netlify.app'],
  credentials: true,
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'scout_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // set to true if using https
    sameSite: 'lax',
  },
}));
 

const checkAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
};

// Admin login route
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

// Admin logout route
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Postgres setup (fill your config)
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'scout_db',
  password: 'postgres',
  port: 5432,
});

// Create uploads folder if doesn't exist
const uploadFolder = './uploads';
if (!fs.existsSync(uploadFolder)) fs.mkdirSync(uploadFolder);

// Multer setup
const storage = multer.diskStorage({
  destination: uploadFolder,
  filename: (_, file, cb) => {
    const uniqueName = `${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Serve uploads statically
app.use('/uploads', express.static('uploads'));

// Protect upload route with checkAdmin middleware
app.post('/api/upload', checkAdmin, upload.single('image'), async (req, res) => {
  try {
    const { caption } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const imagePath = `/uploads/${req.file.filename}`;

    await pool.query('INSERT INTO uploads (image_path, caption) VALUES ($1, $2)', [
      imagePath,
      caption,
    ]);

    res.json({ message: 'Upload successful!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Protected route to get all uploads
app.get('/api/uploads', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM uploads ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// POST route to create/update the single announcement
app.post('/api/announcement', checkAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'Announcement content is required' });
    }

    await pool.query('BEGIN');
    await pool.query('DELETE FROM announcements'); // remove old announcement(s)
    await pool.query('INSERT INTO announcements (content) VALUES ($1)', [content]);
    await pool.query('COMMIT');

    res.json({ message: 'Announcement posted successfully' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

// GET route to fetch the latest announcement
app.get('/api/announcement', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 1');
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch announcement' });
  }
});


