import { Database } from "bun:sqlite";
import path from "path";
import { MigrationRunner, createMigrationRunner } from "./runner";
import { config } from "../config";
import { db } from "../db";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  const runner = createMigrationRunner(db, {
    migrationsDir: path.join(import.meta.dir, "..", "..", "migrations"),
  });

  try {
    switch (command) {
      case "up": {
        const target = args[1];
        console.log(`[Migration] Running UP migration${target ? ` to ${target}` : ""}`);
        await runner.up(target);
        break;
      }
      case "down": {
        const target = args[1];
        if (!target) {
          console.error("Usage: bun migrate.ts down <migration-id>");
          process.exit(1);
        }
        console.log(`[Migration] Rolling back to ${target}`);
        await runner.down(target);
        break;
      }
      case "status": {
        console.log("[Migration] Checking status...");
        const status = await runner.status();
        console.log("\nMigration Status:");
        console.log("=================");
        for (const m of status) {
          const applied = m.applied ? "���" : "���";
          const when = m.appliedAt ? ` (${m.appliedAt})` : "";
          console.log(`  ${applied} ${m.id} - ${m.name}${when}`);
        }
        break;
      }
      case "create": {
        const name = args.slice(1).join(" ");
        if (!name) {
          console.error("Usage: bun migrate.ts create <migration-name>");
          process.exit(1);
        }
        await runner.create(name);
        break;
      }
      case "help":
      default: {
        console.log(`
Usage: bun migrate.ts <command> [args]

Commands:
  up [target]           Apply all pending migrations (or up to target)
  down <target>         Rollback migrations to target (inclusive)
  status                Show migration status
  create <name>         Create a new migration file
  help                  Show this help

Examples:
  bun migrate.ts up
  bun migrate.ts up 20260101000000_create_users
  bun migrate.ts down 20260101000000_create_users
  bun migrate.ts status
  bun migrate.ts create "add email index to users"
`);
        break;
      }
    }
  } catch (error) {
    console.error("[Migration] Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();