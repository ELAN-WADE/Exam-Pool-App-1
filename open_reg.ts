import db from "./db.ts";
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'REGISTRATION_OPEN'").run();
console.log("Registration is now open.");
