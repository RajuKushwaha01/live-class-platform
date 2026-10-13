
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

// --------------------------------------------------
// DATABASE CONNECTION
// --------------------------------------------------

connectDB();

require("./utils/seedAdmin")().catch((error) => {
  console.error("Admin seed failed:", error.message);
});

// --------------------------------------------------
// EXPRESS CONFIGURATION
// --------------------------------------------------

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --------------------------------------------------
// SESSION CONFIGURATION
// --------------------------------------------------

const sessionOptions = {
  secret: process.env.SESSION_SECRET || "development-only-secret-change-me",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
};

const sessionMiddleware = session(sessionOptions);

app.use(sessionMiddleware);

// Make the logged-in user available to EJS views.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// --------------------------------------------------
// ROUTES
// --------------------------------------------------

app.get("/", (req, res) => {
  res.render("home");
});

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

// Health endpoint for deployment checks.
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "live-class-platform",
    environment: process.env.NODE_ENV || "development",
  });
});

// 404 handler.
app.use((req, res) => {
  res.status(404).send("Page Not Found");
});

// --------------------------------------------------
// HTTP / HTTPS SERVER
// --------------------------------------------------

const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 5443;
const HTTP_PORT = Number(process.env.PORT) || 5000;

let server;

// On Render, use its assigned PORT.
// Render handles public HTTPS and forwards requests to this server.
if (process.env.PORT) {
  server = http.createServer(app);

  console.log("Production mode: HTTP behind Render HTTPS");
} else {
  // On your local computer, use HTTPS when certificates are available.
  try {
    const sslOptions = {
      key: fs.readFileSync(
        path.join(__dirname, "certs", "key.pem")
      ),
      cert: fs.readFileSync(
        path.join(__dirname, "certs", "cert.pem")
      ),
    };

    server = https.createServer(sslOptions, app);

    console.log("Local HTTPS enabled");
  } catch (error) {
    console.warn(
      "Local SSL certificates unavailable; falling back to HTTP."
    );

    server = http.createServer(app);
  }
}

// --------------------------------------------------
// SOCKET.IO CONFIGURATION
// --------------------------------------------------

const io = new Server(server);

io.engine.use(sessionMiddleware);

app.set("io", io);

initMeetingSocket(io);

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT
  ? Number(process.env.PORT)
  : server instanceof https.Server
    ? HTTPS_PORT
    : HTTP_PORT;

server.listen(PORT, "0.0.0.0", () => {
  const protocol = server instanceof https.Server ? "https" : "http";

  console.log("=================================================");
  console.log("FULL PLATFORM RUNNING SUCCESSFULLY");
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Local URL: ${protocol}://localhost:${PORT}`);
  console.log(`Listening on: 0.0.0.0:${PORT}`);
  console.log("=================================================");
});

server.on("error", (error) => {
  console.error("Server startup error:", error);
  process.exit(1);
});
