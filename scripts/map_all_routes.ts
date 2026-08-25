import fs from "fs";

const serverSource = fs.readFileSync("server.ts", "utf-8");
const lines = serverSource.split("\n");

interface RouteInfo {
  line: number;
  method: string;
  path: string;
  authRequired: boolean;
  roles: string[];
  description: string;
}

const routes: RouteInfo[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const match = line.match(/if\s*\(\s*method\s*===\s*["'](GET|POST|PUT|DELETE|PATCH)["']\s*&&\s*(pathname\s*===\s*["']([^"']+)["']|pathname\.startsWith\(["']([^"']+)["']\)|([a-zA-Z0-9_]+Match))/);
  
  if (match) {
    const method = match[1] || "GET";
    const path = match[3] || match[4] || match[5] || "unknown";
    
    // Look ahead 25 lines for auth and role
    const block = lines.slice(i, i + 25).join("\n");
    const authRequired = block.includes("requireAuth") || block.includes("requireSimpleAuth");
    const roleMatch = block.match(/requireRole\([^,]+,\s*(\[[^\]]+\])/);
    let roles: string[] = [];
    if (roleMatch && roleMatch[1]) {
      try {
        roles = JSON.parse(roleMatch[1].replace(/'/g, '"'));
      } catch {
        roles = [roleMatch[1]];
      }
    } else if (block.includes("requireRole")) {
      roles = ["custom-checked"];
    }

    routes.push({
      line: i + 1,
      method,
      path,
      authRequired,
      roles,
      description: ""
    });
  }
}

console.log(`Found ${routes.length} backend API routes in server.ts:`);
console.log(JSON.stringify(routes, null, 2));
