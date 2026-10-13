require("dotenv").config();
const express = require("express");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const hostRoutes = require("./routes/hostRoutes");
const participantRoutes = require("./routes/participantRoutes");
const meetingRoutes = require("./routes/meetingRoutes");
const chapterRoutes = require("./routes/chapterRoutes");
const assignmentRoutes = require("./routes/assignmentRoutes");
const inviteRoutes = require("./routes/inviteRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const initMeetingSocket = require("./sockets/meetingSocket");

const app = express();
connectDB();

require("./utils/seedAdmin")().catch((e) => console.error("Admin seed failed:", e.message));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24, httpOnly: true, sameSite: "lax" },
});
app.use(sessionMiddleware);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.get("/", (req, res) => res.render("home"));
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/host", hostRoutes);
app.use("/participant", participantRoutes);
app.use("/meeting", meetingRoutes);
app.use("/chapter", chapterRoutes);
app.use("/assignment", assignmentRoutes);
app.use("/invite", inviteRoutes);
app.use("/notification", notificationRoutes);
app.use("/account", require("./routes/accountRoutes"));
app.use((req, res) => res.status(404).send("Page Not Found"));


const HTTPS_PORT = process.env.HTTPS_PORT || 5443;
const HTTP_PORT = process.env.PORT || 5000;

// ⭐ Try HTTPS first (required for camera/mic across devices)
let server;
try {
  const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, "certs/key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "certs/cert.pem")),
  };
  server = https.createServer(sslOptions, app);
} catch (e) {
  console.warn("⚠️  No SSL certs found in /certs — falling back to plain HTTP (camera will only work on localhost, not other devices).");
  server = http.createServer(app);
}

const io = new Server(server);
io.engine.use(sessionMiddleware);
app.set("io", io);
initMeetingSocket(io);

const PORT = server instanceof https.Server ? HTTPS_PORT : HTTP_PORT;
server.listen(PORT, "0.0.0.0", () => {
  const protocol = server instanceof https.Server ? "https" : "http";
  console.log("=================================================");
  console.log(`🚀 FULL PLATFORM RUNNING successfully!`);
  console.log(`🌐 Local:   ${protocol}://localhost:${PORT}`);
  console.log(`📡 Network: ${protocol}://YOUR_LOCAL_IP:${PORT}  (replace with your ipconfig IPv4)`);
  console.log(`📡 Listening on PORT: ${PORT}`);
  console.log("=================================================");
});