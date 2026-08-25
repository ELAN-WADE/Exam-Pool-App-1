import { Database } from "bun:sqlite";
import { AuthService, authService } from "./auth.service";
import { UserService } from "./user.service";
import { SubjectService } from "./subject.service";
import { ExamService } from "./exam.service";
import { GradingService } from "./grading.service";
import { AcademicService } from "./academic.service";
import { NotificationService } from "./notification.service";
import { AuditService } from "./audit.service";
import { CacheService, cacheService, CacheKeys } from "./cache.service";
import { config } from "../config";

export { CacheService, cacheService, CacheKeys };

export interface Services {
  cache: CacheService;
  auth: AuthService;
  user: UserService;
  subject: SubjectService;
  exam: ExamService;
  grading: GradingService;
  academic: AcademicService;
  notification: NotificationService;
  audit: AuditService;
  db: Database;
}

let servicesInstance: Services | null = null;

export function initializeServices(db: Database): Services {
  if (servicesInstance) return servicesInstance;

  config.validate();

  const audit = new AuditService(db);
  const notification = new NotificationService(db);
  const auth = new AuthService();
  const user = new UserService(db);
  const subject = new SubjectService(db);
  const exam = new ExamService(db);
  const grading = new GradingService(db);
  const academic = new AcademicService(db);

  // Replace the global auditService with the properly initialized one
  (globalThis as any).__auditService = audit;

  servicesInstance = {
    cache: cacheService,
    auth,
    user,
    subject,
    exam,
    grading,
    academic,
    notification,
    audit,
    db
  };

  return servicesInstance;
}

export function getServices(): Services {
  if (!servicesInstance) {
    throw new Error("Services not initialized. Call initializeServices() first.");
  }
  return servicesInstance;
}

export function resetServices(): void {
  servicesInstance = null;
}