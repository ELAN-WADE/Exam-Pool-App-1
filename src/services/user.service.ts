import { Database } from "bun:sqlite";
import { UserRepository } from "../repositories/user.repository";
import { SubjectEnrollmentRepository } from "../repositories/exam.repository";
import { ClassEnrollmentRepository } from "../repositories/academic.repository";
import { AcademicTermRepository } from "../repositories/academic.repository";
import { GradeLevelRepository } from "../repositories/academic.repository";
import { auditService } from "./audit.service";
import type { User, SafeUser, Role } from "../types";
import { isValidEmail, isValidPassword, normalizeEmail, trimStr, MIN_PASSWORD_LENGTH } from "../utils/validation";
import { authService } from "./auth.service";

export class UserService {
  private userRepo: UserRepository;
  private enrollmentRepo: SubjectEnrollmentRepository;
  private classEnrollmentRepo: ClassEnrollmentRepository;
  private termRepo: AcademicTermRepository;
  private gradeLevelRepo: GradeLevelRepository;

  constructor(db: Database) {
    this.userRepo = new UserRepository(db);
    this.enrollmentRepo = new SubjectEnrollmentRepository(db);
    this.classEnrollmentRepo = new ClassEnrollmentRepository(db);
    this.termRepo = new AcademicTermRepository(db);
    this.gradeLevelRepo = new GradeLevelRepository(db);
  }

  async createUser(data: {
    name: string;
    email: string;
    role: Role;
    password: string;
    grade?: string | null;
    regId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    address?: string | null;
    phone?: string | null;
    dob?: string | null;
    gradeLevelId?: number | null;
    actorId?: number;
  }): Promise<User> {
    const name = trimStr(data.name);
    const email = normalizeEmail(trimStr(data.email));
    const password = data.password;

    if (!name) throw new Error("Name is required");
    if (!email || !isValidEmail(email)) throw new Error("Valid email is required");
    if (!isValidPassword(password)) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (data.role === "student" && !data.gradeLevelId) throw new Error("Grade level is required for students");
    if (data.role === "student" && !data.dob) throw new Error("Date of birth is required for students");
    if (data.role === "teacher" && !data.phone) throw new Error("Phone number is required for teachers");

    if (this.userRepo.findByEmail(email)) throw new Error("Email already registered");

    const passwordHash = await authService.hashPassword(password);

    const prefix = data.role === "teacher" ? "TCH" : "REG";
    const regId = data.regId || `${prefix}-${Date.now().toString(36).toUpperCase()}`;

    let resolvedGradeString = "";
    if (data.role === "student" && data.gradeLevelId) {
      const gl = this.gradeLevelRepo.findById(data.gradeLevelId);
      if (gl) resolvedGradeString = gl.name;
    }

    const finalEmail = data.role === "student" && !email ? `${regId.toLowerCase()}@student.exampool.local` : email;

    const result = this.userRepo.create({
      name,
      email: finalEmail,
      role: data.role,
      password_hash: passwordHash,
      grade: resolvedGradeString || null,
      reg_id: regId,
      first_name: data.firstName || null,
      last_name: data.lastName || null,
      address: data.address || null,
      phone: data.role === "teacher" ? data.phone : null,
      dob: data.role === "student" ? data.dob : null,
      grade_level_id: data.role === "student" ? data.gradeLevelId : null,
      is_active: 1
    });

    const actorId = data.actorId ?? result.id;
    auditService.log(actorId, "USER_CREATE", "user", result.id, JSON.stringify({ role: data.role }));

    if (data.role === "student" && resolvedGradeString) {
      const activeTerm = this.termRepo.findActive();
      const targetClass = this.findClassByName(resolvedGradeString);
      if (targetClass && activeTerm) {
        this.classEnrollmentRepo.enroll(result.id, targetClass.id, activeTerm.id);
      }
    }

    return result;
  }

  private findClassByName(name: string) {
    // This would need a ClassRepository - simplified for now
    return null;
  }

  async register(data: {
    name: string;
    email: string;
    role: Role;
    password: string;
    gradeLevelId?: number | null;
    dob?: string | null;
    phone?: string | null;
    actorId?: number;
    registrationOpen?: boolean;
  }): Promise<User> {
    if (!data.registrationOpen && data.actorId) {
      // Check if actor is operator
      const actor = this.userRepo.findById(data.actorId);
      if (!actor || actor.role !== "operator") {
        throw new Error("Registration is closed");
      }
    } else if (!data.registrationOpen) {
      throw new Error("Registration is closed");
    }

    return this.createUser({
      name: data.name,
      email: data.email,
      role: data.role,
      password: data.password,
      gradeLevelId: data.gradeLevelId,
      dob: data.dob,
      phone: data.phone,
      actorId: data.actorId
    });
  }

  findById(id: number): User | null {
    return this.userRepo.findById(id);
  }

  findByEmail(email: string): User | null {
    return this.userRepo.findByEmail(normalizeEmail(email));
  }

  findByEmailOrReg(identifier: string): User | null {
    const normalized = identifier.includes("@") ? normalizeEmail(identifier) : identifier.toUpperCase();
    return this.userRepo.findByEmailOrReg(normalized);
  }

  findByRegId(regId: string): User | null {
    return this.userRepo.findByRegId(regId);
  }

  findAll(role?: Role): User[] {
    if (role) return this.userRepo.findByRole(role);
    return this.userRepo.findAll();
  }

  findActive(role?: Role): User[] {
    if (role) return this.userRepo.findActiveByRole(role);
    return this.userRepo.findAll().filter(u => u.is_active === 1);
  }

  getForAuth(userId: number): SafeUser | null {
    return this.userRepo.getUserForAuth(userId);
  }

  updateProfile(userId: number, data: Partial<User>): User | null {
    return this.userRepo.updateProfile(userId, data);
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = this.userRepo.findById(userId);
    if (!user) throw new Error("User not found");

    const valid = await authService.verifyPassword(currentPassword, user.password_hash);
    if (!valid) throw new Error("Current password is incorrect");

    if (!isValidPassword(newPassword)) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);

    const hash = await authService.hashPassword(newPassword);
    this.userRepo.updatePassword(userId, hash);
    auditService.log(userId, "USER_UPDATE", "user", userId, JSON.stringify({ action: "change_password" }));
  }

  async resetPassword(userId: number, newPassword: string, actorId: number): Promise<void> {
    if (!isValidPassword(newPassword)) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);

    const user = this.userRepo.findById(userId);
    if (!user) throw new Error("User not found");

    const hash = await authService.hashPassword(newPassword);
    this.userRepo.updatePassword(userId, hash);
    auditService.log(actorId, "USER_UPDATE", "user", userId, JSON.stringify({ action: "reset_password" }));
  }

  activate(userId: number): boolean {
    return this.userRepo.activate(userId);
  }

  deactivate(userId: number): boolean {
    return this.userRepo.deactivate(userId);
  }

  updateGradeLevel(userId: number, gradeLevelId: number): boolean {
    return this.userRepo.updateGradeLevel(userId, gradeLevelId);
  }

  countByRole(role: Role): number {
    return this.userRepo.countByRole(role);
  }

  getStudentsForEnrollment(): User[] {
    return this.userRepo.findActiveByRole("student");
  }

  getTeachers(): User[] {
    return this.userRepo.findActiveByRole("teacher");
  }
}