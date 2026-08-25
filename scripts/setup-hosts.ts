import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const isWindows = process.platform === "win32";
const hostsPath = isWindows
  ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts")
  : "/etc/hosts";

// Read custom domain from arguments, .env, or default
let customDomain = process.argv[2]?.trim() || "";
if (!customDomain && fs.existsSync(path.join(import.meta.dir, "..", ".env"))) {
  const envContent = fs.readFileSync(path.join(import.meta.dir, "..", ".env"), "utf-8");
  const match = envContent.match(/^\s*CUSTOM_URL\s*=\s*(.+)$/m);
  if (match && match[1]) customDomain = match[1].trim().replace(/^["']|["']$/g, "");
}

const domains = new Set([
  "exampool.com",
  "www.exampool.com",
  "exampool.local",
  "www.exampool.local",
  "exampool.co",
  "www.exampool.co",
  "exampool.ng",
  "www.exampool.ng",
]);

if (customDomain) {
  const clean = customDomain.toLowerCase().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (clean) {
    domains.add(clean);
    if (!clean.startsWith("www.")) domains.add(`www.${clean}`);
    const baseName = clean.replace(/\.[a-z0-9-]+$/i, "");
    if (baseName && baseName !== "exampool") {
      domains.add(`${baseName}.local`);
    }
  }
}

const domainList = Array.from(domains).join(" ");
const markerStart = "# === EXAMPOOL LOCAL DOMAIN MAP START ===";
const markerEnd = "# === EXAMPOOL LOCAL DOMAIN MAP END ===";
const block = `${markerStart}\n127.0.0.1 ${domainList}\n::1 ${domainList}\n${markerEnd}`;

try {
  let content = fs.readFileSync(hostsPath, "utf-8");
  if (content.includes(markerStart)) {
    const regex = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "g");
    content = content.replace(regex, block);
  } else {
    content = content.trimEnd() + "\n\n" + block + "\n";
  }

  fs.writeFileSync(hostsPath, content, "utf-8");

  console.log("\n=========================================================");
  console.log("  ✅ EXAMPOOL HOSTS FILE MAPPING SUCCESSFUL!");
  console.log("=========================================================");
  console.log("  The following URLs now route directly to ExamPool on this PC:");
  for (const d of domains) {
    console.log(`   • http://${d}:8001`);
  }
  console.log("=========================================================\n");
} catch (err: any) {
  if (isWindows && (err.code === "EPERM" || err.code === "EACCES")) {
    console.log("⚠️ Administrator privileges required to write to hosts file.");
    console.log("Requesting Windows UAC elevation...");

    const ps1Path = path.join(import.meta.dir, "setup-hosts.ps1");
    try {
      execSync(
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\\"${ps1Path}\\\"'"`
      );
      console.log("Elevation prompt sent. Please click 'Yes' on the UAC prompt to complete setup.");
    } catch {
      console.error("\n❌ Could not automatically elevate. Please run this in an Administrator PowerShell prompt:");
      console.log(`Add-Content -Path "$env:SystemRoot\\System32\\drivers\\etc\\hosts" -Value "\\n127.0.0.1 ${domainList}\\n" -Force\n`);
    }
  } else {
    console.error("Failed to update hosts file:", err.message);
  }
}
