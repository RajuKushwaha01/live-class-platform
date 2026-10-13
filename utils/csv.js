function toCSV(rows) {
  return rows
    .map((r) =>
      r.map((v) => {
        let s = v == null ? "" : String(v);
        if (/^[=+\-@]/.test(s)) s = "'" + s; // block spreadsheet formula injection
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(",")
    )
    .join("\r\n");
}

function sendCSV(res, filename, rows) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\ufeff" + toCSV(rows));
}

module.exports = { toCSV, sendCSV };