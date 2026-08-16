const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure upload directories exist
const dirs = [
  "public/uploads/chapters",
  "public/uploads/assignments",
  "public/uploads/questions",
];

dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = (folder) =>
  multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, `public/uploads/${folder}`);
    },
    filename: (req, file, cb) => {
      const uniqueName =
        Date.now() +
        "-" +
        Math.round(Math.random() * 1e9) +
        path.extname(file.originalname);
      cb(null, uniqueName);
    },
  });

const fileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|jpg|jpeg|png|gif|doc|docx|zip|txt|js|py|java|cpp/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error("File type not allowed"), false);
  }
};

const uploadChapterFiles = multer({
  storage: storage("chapters"),
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const uploadAssignmentFile = multer({
  storage: storage("assignments"),
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Accepts any dynamically-named file field (question images, option images, etc.)
const uploadQuestionAssets = multer({
  storage: storage("questions"),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).any();

module.exports = {
  uploadChapterFiles,
  uploadAssignmentFile,
  uploadQuestionAssets,
};