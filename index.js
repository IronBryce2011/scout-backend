require('dotenv').config();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const express = require('express');
const app = express();

app.set('trust proxy', 1);

const allowedOrigins = [
  'https://troop423.netlify.app',
  'https://troop423-admin-site.netlify.app'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Blocked by CORS: ${origin}`), false);
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Session store using PostgreSQL
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'scout_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 1 week
  }
}));

// Admin session middleware
const checkAdmin = (req, res, next) => {
  if (req.session?.isAdmin) return next();
  res.status(403).json({ error: 'Admin access required' });
};

// Admin login/logout
app.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'scout_uploads',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
  }
});
const upload = multer({ storage });

// Upload image (admin only)
app.post('/api/upload', checkAdmin, upload.single('image'), async (req, res) => {
  try {
    const { caption } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const imageUrl = req.file.path; // Cloudinary URL

    await pool.query('INSERT INTO uploads (image_path, caption) VALUES ($1, $2)', [imageUrl, caption]);

    res.json({ message: 'Upload successful!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Get all uploads
app.get('/api/uploads', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM uploads ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch uploads' });
  }
});

// Post or update announcement (admin only)
app.post('/api/announcement', checkAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Announcement content is required' });

    await pool.query(`
      INSERT INTO announcements (id, content)
      VALUES (1, $1)
      ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
    `, [content]);

    res.json({ message: 'Announcement posted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

// Get latest announcement
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
