const Assignment = require("../models/Assignment");

// Ranks students by weighted average % across graded submissions.
async function buildLeaderboard(filter = {}) {
  const assignments = await Assignment.find({ status: "published", ...filter }).select("submissions");
  const map = {};
  assignments.forEach((a) =>
    a.submissions.forEach((s) => {
      if (!s.isGraded || !s.maxScore) return;
      const id = String(s.participant);
      const m = map[id] || (map[id] = { id, name: s.participantName, pts: 0, max: 0, tasks: 0 });
      m.pts += s.totalScore;
      m.max += s.maxScore;
      m.tasks += 1;
    })
  );
  return Object.values(map)
    .map((m) => ({ ...m, avg: Math.round((m.pts / m.max) * 100) }))
    .sort((a, b) => b.avg - a.avg || b.pts - a.pts);
}

module.exports = { buildLeaderboard };