const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

// Prefer system-installed ffmpeg (via Dockerfile apt install), fallback to npm binary
try {
  const fsSync = require('fs');
  if (fsSync.existsSync('/usr/bin/ffmpeg')) {
    ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
    console.log('Using system ffmpeg at /usr/bin/ffmpeg');
  } else {
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log('Using npm ffmpeg-installer at', ffmpegPath);
  }
} catch (e) {
  console.error('FFmpeg path setup error:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
[UPLOAD_DIR, OUTPUT_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

app.use(cors());
app.use(express.json());
app.use('/output', express.static(OUTPUT_DIR));
app.use(express.static(path.join(__dirname, 'public'))); // serves frontend index.html

// ---------- Multer setup ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB max

// ---------- Helper ----------
function outPath(ext = 'mp4') {
  return path.join(OUTPUT_DIR, `${uuidv4()}.${ext}`);
}

function fileUrl(req, filePath) {
  const name = path.basename(filePath);
  return `${req.protocol}://${req.get('host')}/output/${name}`;
}

// ================= UPLOAD =================
app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    message: 'Uploaded successfully',
    filename: req.file.filename,
    path: req.file.path
  });
});

// ================= TRIM =================
// body: { filename, start (sec), end (sec) }
app.post('/trim', (req, res) => {
  const { filename, start, end } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });
  const inputPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'File not found' });

  const output = outPath();
  const duration = parseFloat(end) - parseFloat(start);

  ffmpeg(inputPath)
    .setStartTime(parseFloat(start) || 0)
    .duration(duration > 0 ? duration : 5)
    .output(output)
    .on('end', () => res.json({ message: 'Trimmed', url: fileUrl(req, output), filename: path.basename(output) }))
    .on('error', (err, stdout, stderr) => res.status(500).json({ error: err.message, details: stderr || 'no ffmpeg log' }))
    .run();
});

// ================= FILTER =================
// body: { filename, filterType: grayscale|sepia|vintage|bright|contrast|blur|invert }
const FILTER_MAP = {
  grayscale: 'hue=s=0',
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
  vintage: 'curves=vintage',
  bright: 'eq=brightness=0.15',
  contrast: 'eq=contrast=1.4',
  blur: 'boxblur=5:1',
  invert: 'negate',
  cool: 'colorbalance=rs=-0.2:gs=0:bs=0.3',
  warm: 'colorbalance=rs=0.3:gs=0.1:bs=-0.2'
};

app.post('/filter', (req, res) => {
  const { filename, filterType } = req.body;
  const inputPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'File not found' });
  const vf = FILTER_MAP[filterType];
  if (!vf) return res.status(400).json({ error: 'Invalid filterType', valid: Object.keys(FILTER_MAP) });

  const output = outPath();
  ffmpeg(inputPath)
    .videoFilters(vf)
    .output(output)
    .on('end', () => res.json({ message: 'Filter applied', url: fileUrl(req, output), filename: path.basename(output) }))
    .on('error', (err, stdout, stderr) => res.status(500).json({ error: err.message, details: stderr || 'no ffmpeg log' }))
    .run();
});

// ================= TEXT OVERLAY =================
// body: { filename, text, position: top|center|bottom, fontsize, color }
const POSITIONS = {
  top: 'x=(w-text_w)/2:y=40',
  center: 'x=(w-text_w)/2:y=(h-text_h)/2',
  bottom: 'x=(w-text_w)/2:y=h-th-60'
};

app.post('/text', (req, res) => {
  const { filename, text, position = 'bottom', fontsize = 42, color = 'white' } = req.body;
  const inputPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'File not found' });
  if (!text) return res.status(400).json({ error: 'text required' });

  const safeText = text.replace(/:/g, '\\:').replace(/'/g, "\\'");
  const posExpr = POSITIONS[position] || POSITIONS.bottom;
  const drawtext = `drawtext=text='${safeText}':fontsize=${fontsize}:fontcolor=${color}:box=1:boxcolor=black@0.4:boxborderw=10:${posExpr}`;

  const output = outPath();
  ffmpeg(inputPath)
    .videoFilters(drawtext)
    .output(output)
    .on('end', () => res.json({ message: 'Text added', url: fileUrl(req, output), filename: path.basename(output) }))
    .on('error', (err, stdout, stderr) => res.status(500).json({ error: err.message, details: stderr || 'no ffmpeg log' }))
    .run();
});

// ================= MUSIC / AUDIO MERGE =================
// body: { videoFilename, audioFilename, volume (0-1), mode: replace|mix }
app.post('/music', (req, res) => {
  const { videoFilename, audioFilename, volume = 0.8, mode = 'mix' } = req.body;
  const videoPath = path.join(UPLOAD_DIR, videoFilename);
  const audioPath = path.join(UPLOAD_DIR, audioFilename);
  if (!fs.existsSync(videoPath) || !fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Video or audio file not found' });
  }

  const output = outPath();
  const cmd = ffmpeg();
  cmd.input(videoPath).input(audioPath);

  if (mode === 'replace') {
    cmd.outputOptions(['-map 0:v:0', '-map 1:a:0', '-shortest'])
      .audioFilters(`volume=${volume}`);
  } else {
    // mix original audio with music
    cmd.complexFilter([
      `[0:a]volume=1[a0]`,
      `[1:a]volume=${volume}[a1]`,
      `[a0][a1]amix=inputs=2:duration=shortest[aout]`
    ], 'aout')
      .outputOptions(['-map 0:v:0', '-shortest']);
  }

  cmd.output(output)
    .on('end', () => res.json({ message: 'Music merged', url: fileUrl(req, output), filename: path.basename(output) }))
    .on('error', (err, stdout, stderr) => res.status(500).json({ error: err.message, details: stderr || 'no ffmpeg log' }))
    .run();
});

// ================= TRANSITIONS (merge 2 clips) =================
// body: { filename1, filename2, transition: fade|wipeleft|slideup|circleopen|dissolve, duration }
app.post('/transition', (req, res) => {
  const { filename1, filename2, transition = 'fade', duration = 1 } = req.body;
  const path1 = path.join(UPLOAD_DIR, filename1);
  const path2 = path.join(UPLOAD_DIR, filename2);
  if (!fs.existsSync(path1) || !fs.existsSync(path2)) {
    return res.status(404).json({ error: 'One or both files not found' });
  }

  // get duration of first clip to know offset
  ffmpeg.ffprobe(path1, (err, metadata) => {
    if (err) return res.status(500).json({ error: err.message });
    const clip1Duration = metadata.format.duration;
    const offset = Math.max(clip1Duration - duration, 0);

    const output = outPath();
    ffmpeg()
      .input(path1)
      .input(path2)
      .complexFilter([
        `[0:v][1:v]xfade=transition=${transition}:duration=${duration}:offset=${offset}[v]`,
        `[0:a][1:a]acrossfade=d=${duration}[a]`
      ], ['v', 'a'])
      .outputOptions(['-map [v]', '-map [a]'])
      .output(output)
      .on('end', () => res.json({ message: 'Transition applied', url: fileUrl(req, output), filename: path.basename(output) }))
      .on('error', (e) => res.status(500).json({ error: e.message }))
      .run();
  });
});

// ================= MERGE MULTIPLE CLIPS (simple concat, no transition) =================
// body: { filenames: [array] }
app.post('/merge', (req, res) => {
  const { filenames } = req.body;
  if (!Array.isArray(filenames) || filenames.length < 2) {
    return res.status(400).json({ error: 'Provide at least 2 filenames' });
  }
  const listPath = path.join(UPLOAD_DIR, `${uuidv4()}_list.txt`);
  const listContent = filenames.map(f => `file '${path.join(UPLOAD_DIR, f).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  const output = outPath();
  ffmpeg()
    .input(listPath)
    .inputOptions(['-f concat', '-safe 0'])
    .outputOptions(['-c copy'])
    .output(output)
    .on('end', () => {
      fs.unlinkSync(listPath);
      res.json({ message: 'Merged', url: fileUrl(req, output), filename: path.basename(output) });
    })
    .on('error', (err) => res.status(500).json({ error: err.message }))
    .run();
});

// ================= HEALTH CHECK =================
app.get('/api/health', (req, res) => {
  res.json({ status: 'Desi Editor backend running', endpoints: ['/upload', '/trim', '/filter', '/text', '/music', '/transition', '/merge'] });
});

app.listen(PORT, () => console.log(`Desi Editor backend running on port ${PORT}`));
