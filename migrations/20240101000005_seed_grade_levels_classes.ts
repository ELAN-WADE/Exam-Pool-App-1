import { Migration } from "./types";

export const migration: Migration = {
  id: "20240101000005_seed_grade_levels_classes",
  name: "Seed grade levels and standardized classes",
  description: "Seeds all grade levels and standardized class names",
  
  up: (db) => {
    const allSeeds = [
      { name: 'Primary 1',  cat: 'primary',      sort_order: 1  },
      { name: 'Primary 2',  cat: 'primary',      sort_order: 2  },
      { name: 'Primary 3',  cat: 'primary',      sort_order: 3  },
      { name: 'Primary 4',  cat: 'primary',      sort_order: 4  },
      { name: 'Primary 5',  cat: 'primary',      sort_order: 5  },
      { name: 'Primary 6',  cat: 'primary',      sort_order: 6  },
      { name: 'JSS 1',      cat: 'secondary',    sort_order: 7  },
      { name: 'JSS 2',      cat: 'secondary',    sort_order: 8  },
      { name: 'JSS 3',      cat: 'secondary',    sort_order: 9  },
      { name: 'SS 1',       cat: 'secondary',    sort_order: 10 },
      { name: 'SS 2',       cat: 'secondary',    sort_order: 11 },
      { name: 'SS 3',       cat: 'secondary',    sort_order: 12 },
      { name: '100 Level',  cat: 'university',   sort_order: 13 },
      { name: '200 Level',  cat: 'university',   sort_order: 14 },
      { name: '300 Level',  cat: 'university',   sort_order: 15 },
      { name: '400 Level',  cat: 'university',   sort_order: 16 },
      { name: '500 Level',  cat: 'university',   sort_order: 17 },
      { name: '600 Level',  cat: 'university',   sort_order: 18 },
      { name: 'ND 1',       cat: 'polytechnic',  sort_order: 19 },
      { name: 'ND 2',       cat: 'polytechnic',  sort_order: 20 },
      { name: 'HND 1',      cat: 'polytechnic',  sort_order: 21 },
      { name: 'HND 2',      cat: 'polytechnic',  sort_order: 22 },
    ];

    const stmt = db.prepare('INSERT OR IGNORE INTO grade_levels (name, category, sort_order) VALUES (?, ?, ?)');
    for (const s of allSeeds) stmt.run(s.name, s.cat, s.sort_order);

    const standardizedGrades = [
      { name: 'Primary 1',  level: 'junior' },
      { name: 'Primary 2',  level: 'junior' },
      { name: 'Primary 3',  level: 'junior' },
      { name: 'Primary 4',  level: 'junior' },
      { name: 'Primary 5',  level: 'junior' },
      { name: 'Primary 6',  level: 'junior' },
      { name: 'JSS 1',      level: 'junior' },
      { name: 'JSS 2',      level: 'junior' },
      { name: 'JSS 3',      level: 'junior' },
      { name: 'SS 1',       level: 'senior' },
      { name: 'SS 2',       level: 'senior' },
      { name: 'SS 3',       level: 'senior' },
      { name: '100 Level',  level: 'senior' },
      { name: '200 Level',  level: 'senior' },
      { name: '300 Level',  level: 'senior' },
      { name: '400 Level',  level: 'senior' },
      { name: '500 Level',  level: 'senior' },
      { name: '600 Level',  level: 'senior' },
      { name: 'ND 1',       level: 'senior' },
      { name: 'ND 2',       level: 'senior' },
      { name: 'HND 1',      level: 'senior' },
      { name: 'HND 2',      level: 'senior' },
    ];

    const classStmt = db.prepare("INSERT OR IGNORE INTO classes (name, section, level) VALUES (?, NULL, ?)");
    for (const g of standardizedGrades) classStmt.run(g.name, g.level);
  },
  
  down: (db) => {
    db.exec("DELETE FROM grade_levels WHERE name IN ('Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3','100 Level','200 Level','300 Level','400 Level','500 Level','600 Level','ND 1','ND 2','HND 1','HND 2')");
    db.exec("DELETE FROM classes WHERE name IN ('Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3','100 Level','200 Level','300 Level','400 Level','500 Level','600 Level','ND 1','ND 2','HND 1','HND 2')");
  },
};

export default migration;