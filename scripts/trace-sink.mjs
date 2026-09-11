// dev 用: background が POST してくる trace 行をファイルに溜める。
// 使い方: node scripts/trace-sink.mjs [出力先]  → tail -f で追う
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const file = process.argv[2] ?? "/tmp/mls-trace.log";
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (body) appendFileSync(file, `${new Date().toISOString().slice(11, 23)} ${body}\n`);
    res.end();
  });
}).listen(7777, () => console.log(`sink -> ${file}`));
