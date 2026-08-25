import { Database } from "bun:sqlite";
import { queries, db } from "../db";

export interface GradingScheme {
  id: number;
  grading_subject_id: number;
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'locked';
  is_default: number;
  created_by: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  locked_at: string | null;
}

export interface GradingCategory {
  id: number;
  grading_scheme_id: number;
  name: string;
  description: string | null;
  weight: number;
  order_index: number;
  parent_category_id: number | null;
  is_exam_category: number;
  created_at: string;
  updated_at: string;
  children?: GradingCategory[];
  assessments?: GradingAssessment[];
}

export interface GradingAssessment {
  id: number;
  grading_category_id: number;
  grading_scheme_id: number;
  name: string;
  description: string | null;
  type: string;
  max_marks: number;
  weight: number;
  order_index: number;
  mapped_cbt_subject_id: number | null;
  is_mandatory: number;
  created_at: string;
  updated_at: string;
}

export interface GradeBoundary {
  id: number;
  grading_scheme_id: number;
  grade_symbol: string;
  min_percentage: number;
  max_percentage: number;
  grade_point: number | null;
  description: string | null;
  order_index: number;
  created_at: string;
}

export interface StudentScore {
  id: number;
  grading_assessment_id: number;
  grading_scheme_id: number;
  student_id: number;
  score: number | null;
  max_marks_override: number | null;
  entered_by: number;
  entered_at: string;
  updated_at: string;
  is_overridden: number;
  assessment_name?: string;
  assessment_type?: string;
  assessment_max_marks?: number;
  assessment_weight?: number;
  category_name?: string;
  category_weight?: number;
}

export interface CategoryBreakdown {
  category_id: number;
  category_name: string;
  category_weight: number;
  raw_score: number;
  max_possible_score: number;
  percentage: number;
  contribution: number;
  assessments: AssessmentBreakdown[];
}

export interface AssessmentBreakdown {
  assessment_id: number;
  assessment_name: string;
  assessment_type: string;
  score: number | null;
  max_marks: number;
  weight: number;
  percentage: number | null;
  contribution: number | null;
}

export interface CalculatedResult {
  grading_scheme_id: number;
  student_id: number;
  term_id: number;
  session_id: number;
  category_breakdown: CategoryBreakdown[];
  overall_percentage: number;
  grade_symbol: string | null;
  grade_point: number | null;
  status: 'draft' | 'published' | 'locked';
  calculated_at: string;
  calculated_by: number;
}

export interface SchemeConfig {
  scheme: GradingScheme;
  categories: GradingCategory[];
  assessments: GradingAssessment[];
  boundaries: GradeBoundary[];
  scores: StudentScore[];
}

/**
 * Validates that category weights sum to 100% at each level
 */
export function validateCategoryWeights(categories: GradingCategory[], tolerance = 0.01): { valid: boolean; message: string } {
  const rootCategories = categories.filter(c => !c.parent_category_id);
  const totalWeight = rootCategories.reduce((sum, c) => sum + Number(c.weight), 0);
  
  if (Math.abs(totalWeight - 100) > tolerance) {
    return { valid: false, message: `Root category weights must sum to 100%, got ${totalWeight}%` };
  }
  
  for (const cat of categories) {
    const children = categories.filter(c => c.parent_category_id === cat.id);
    if (children.length > 0) {
      const childWeight = children.reduce((sum, c) => sum + Number(c.weight), 0);
      if (Math.abs(childWeight - 100) > tolerance) {
        return { valid: false, message: `Sub-category weights for "${cat.name}" must sum to 100%, got ${childWeight}%` };
      }
    }
  }
  
  return { valid: true, message: "OK" };
}

/**
 * Validates that assessment weights sum to 100% within each category
 */
export function validateAssessmentWeights(assessments: GradingAssessment[], categories: GradingCategory[], tolerance = 0.01): { valid: boolean; message: string } {
  for (const cat of categories) {
    const catAssessments = assessments.filter(a => a.grading_category_id === cat.id);
    if (catAssessments.length > 0) {
      const totalWeight = catAssessments.reduce((sum, a) => sum + Number(a.weight), 0);
      if (Math.abs(totalWeight - 100) > tolerance) {
        return { valid: false, message: `Assessment weights for category "${cat.name}" must sum to 100%, got ${totalWeight}%` };
      }
    }
  }
  return { valid: true, message: "OK" };
}

/**
 * Validates grade boundaries for overlaps and gaps
 */
export function validateGradeBoundaries(boundaries: GradeBoundary[]): { valid: boolean; message: string } {
  if (boundaries.length === 0) {
    return { valid: false, message: "At least one grade boundary is required" };
  }
  
  const sorted = [...boundaries].sort((a, b) => b.min_percentage - a.min_percentage);
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    
    if (current.min_percentage < next.max_percentage) {
      return { valid: false, message: `Grade boundaries overlap: ${current.grade_symbol} (${current.min_percentage}-${current.max_percentage}) overlaps with ${next.grade_symbol} (${next.min_percentage}-${next.max_percentage})` };
    }
    
    if (current.min_percentage > next.max_percentage + 0.01) {
      return { valid: false, message: `Gap in grade boundaries between ${current.grade_symbol} (min ${current.min_percentage}) and ${next.grade_symbol} (max ${next.max_percentage})` };
    }
  }
  
  const highest = sorted[0];
  const lowest = sorted[sorted.length - 1];
  
  if (highest.max_percentage < 100) {
    return { valid: false, message: `Highest grade ${highest.grade_symbol} max is ${highest.max_percentage}, should be 100` };
  }
  
  if (lowest.min_percentage > 0) {
    return { valid: false, message: `Lowest grade ${lowest.grade_symbol} min is ${lowest.min_percentage}, should be 0` };
  }
  
  return { valid: true, message: "OK" };
}

/**
 * Calculates grade symbol and point from percentage using boundaries
 */
export function calculateGrade(percentage: number, boundaries: GradeBoundary[]): { grade_symbol: string; grade_point: number | null } {
  for (const b of boundaries) {
    if (percentage >= b.min_percentage && percentage <= b.max_percentage) {
      return { grade_symbol: b.grade_symbol, grade_point: b.grade_point ?? null };
    }
  }
  const lowest = boundaries.reduce((min, b) => b.min_percentage < min.min_percentage ? b : min);
  return { grade_symbol: lowest.grade_symbol, grade_point: lowest.grade_point ?? null };
}

/**
 * Builds hierarchical category tree
 */
export function buildCategoryTree(categories: GradingCategory[]): GradingCategory[] {
  const map = new Map<number, GradingCategory>();
  const roots: GradingCategory[] = [];
  
  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [], assessments: [] });
  }
  
  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parent_category_id) {
      const parent = map.get(cat.parent_category_id);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }
  
  roots.sort((a, b) => a.order_index - b.order_index);
  for (const root of roots) {
    if (root.children) {
      root.children.sort((a, b) => a.order_index - b.order_index);
    }
  }
  
  return roots;
}

/**
 * Core calculation engine - computes student results from scheme config
 */
export function calculateStudentResult(
  studentId: number,
  config: SchemeConfig,
  termId: number,
  sessionId: number
): CalculatedResult {
  const { scheme, categories, assessments, boundaries, scores } = config;
  const studentScores = scores.filter(s => s.student_id === studentId);
  
  const categoryTree = buildCategoryTree(categories);
  const categoryBreakdown: CategoryBreakdown[] = [];
  
  function processCategory(cat: GradingCategory): CategoryBreakdown {
    const catAssessments = assessments.filter(a => a.grading_category_id === cat.id);
    const assessmentBreakdowns: AssessmentBreakdown[] = [];
    let catRawScore = 0;
    let catMaxScore = 0;
    
    for (const assessment of catAssessments) {
      const scoreRecord = studentScores.find(s => s.grading_assessment_id === assessment.id);
      const score = scoreRecord?.score ?? null;
      const maxMarks = scoreRecord?.max_marks_override ?? assessment.max_marks;
      const weight = Number(assessment.weight);
      
      let percentage: number | null = null;
      let contribution: number | null = null;
      
      if (score !== null && maxMarks > 0) {
        percentage = (score / maxMarks) * 100;
        contribution = percentage * (weight / 100);
        catRawScore += contribution;
      }
      catMaxScore += weight;
      
      assessmentBreakdowns.push({
        assessment_id: assessment.id,
        assessment_name: assessment.name,
        assessment_type: assessment.type,
        score,
        max_marks: maxMarks,
        weight,
        percentage,
        contribution,
      });
    }
    
    const catWeight = Number(cat.weight);
    const catPercentage = catMaxScore > 0 ? (catRawScore / catMaxScore) * 100 : 0;
    const contribution = catPercentage * (catWeight / 100);
    
    const breakdown: CategoryBreakdown = {
      category_id: cat.id,
      category_name: cat.name,
      category_weight: catWeight,
      raw_score: catRawScore,
      max_possible_score: catMaxScore,
      percentage: catPercentage,
      contribution,
      assessments: assessmentBreakdowns,
    };
    
    categoryBreakdown.push(breakdown);
    
    if (cat.children) {
      for (const child of cat.children) {
        processCategory(child);
      }
    }
    
    return breakdown;
  }
  
  for (const root of categoryTree) {
    processCategory(root);
  }
  
  const overallPercentage = categoryBreakdown
    .filter(c => !categories.find(p => p.id === c.category_id)?.parent_category_id)
    .reduce((sum, c) => sum + c.contribution, 0);
  
  const { grade_symbol, grade_point } = calculateGrade(overallPercentage, boundaries);
  
  return {
    grading_scheme_id: scheme.id,
    student_id: studentId,
    term_id: termId,
    session_id: sessionId,
    category_breakdown: categoryBreakdown,
    overall_percentage: Number(overallPercentage.toFixed(2)),
    grade_symbol,
    grade_point,
    status: 'draft',
    calculated_at: new Date().toISOString(),
    calculated_by: 0,
  };
}

/**
 * Calculates results for all students in a scheme
 */
export function calculateAllResults(
  config: SchemeConfig,
  termId: number,
  sessionId: number,
  studentIds: number[]
): CalculatedResult[] {
  return studentIds.map(id => calculateStudentResult(id, config, termId, sessionId));
}

/**
 * Creates a scheme version snapshot for audit trail
 */
export function createSchemeVersionSnapshot(
  schemeId: number,
  changedBy: number,
  changeSummary: string
): void {
  const latestVersion = queries.getLatestSchemeVersion.get(schemeId) as { version_number?: number } | undefined;
  const versionNumber = (latestVersion?.version_number ?? 0) + 1;
  
  const scheme = queries.getGradingSchemeById.get(schemeId) as GradingScheme;
  const categories = queries.getGradingCategoriesByScheme.all(schemeId) as GradingCategory[];
  const assessments = queries.getGradingAssessmentsByScheme.all(schemeId) as GradingAssessment[];
  const boundaries = queries.getGradeBoundariesByScheme.all(schemeId) as GradeBoundary[];
  
  queries.createSchemeVersion.run(
    schemeId,
    versionNumber,
    JSON.stringify(scheme),
    JSON.stringify(categories),
    JSON.stringify(assessments),
    JSON.stringify(boundaries),
    changedBy,
    changeSummary
  );
}

/**
 * Loads full scheme configuration for calculation
 */
export function loadSchemeConfig(schemeId: number): SchemeConfig {
  const scheme = queries.getGradingSchemeById.get(schemeId) as GradingScheme;
  const categories = queries.getGradingCategoriesByScheme.all(schemeId) as GradingCategory[];
  const assessments = queries.getGradingAssessmentsByScheme.all(schemeId) as GradingAssessment[];
  const boundaries = queries.getGradeBoundariesByScheme.all(schemeId) as GradeBoundary[];
  const scores = queries.getStudentScoresByScheme.all(schemeId) as StudentScore[];
  
  return { scheme, categories, assessments, boundaries, scores };
}

/**
 * Validates entire scheme before publishing
 */
export function validateScheme(schemeId: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  const scheme = queries.getGradingSchemeById.get(schemeId) as GradingScheme;
  if (!scheme) {
    return { valid: false, errors: ["Scheme not found"] };
  }
  
  const categories = queries.getGradingCategoriesByScheme.all(schemeId) as GradingCategory[];
  const assessments = queries.getGradingAssessmentsByScheme.all(schemeId) as GradingAssessment[];
  const boundaries = queries.getGradeBoundariesByScheme.all(schemeId) as GradeBoundary[];
  
  if (categories.length === 0) {
    errors.push("At least one category is required");
  }
  
  if (assessments.length === 0) {
    errors.push("At least one assessment is required");
  }
  
  if (boundaries.length === 0) {
    errors.push("At least one grade boundary is required");
  }
  
  const catValidation = validateCategoryWeights(categories);
  if (!catValidation.valid) {
    errors.push(catValidation.message);
  }
  
  const assessValidation = validateAssessmentWeights(assessments, categories);
  if (!assessValidation.valid) {
    errors.push(assessValidation.message);
  }
  
  const boundaryValidation = validateGradeBoundaries(boundaries);
  if (!boundaryValidation.valid) {
    errors.push(boundaryValidation.message);
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Default grade boundaries (Nigerian standard)
 */
export const DEFAULT_GRADE_BOUNDARIES: Omit<GradeBoundary, 'id' | 'grading_scheme_id' | 'created_at'>[] = [
  { grade_symbol: 'A', min_percentage: 75, max_percentage: 100, grade_point: 5.0, description: 'Excellent', order_index: 1 },
  { grade_symbol: 'B', min_percentage: 65, max_percentage: 74.99, grade_point: 4.0, description: 'Very Good', order_index: 2 },
  { grade_symbol: 'C', min_percentage: 55, max_percentage: 64.99, grade_point: 3.0, description: 'Credit', order_index: 3 },
  { grade_symbol: 'D', min_percentage: 45, max_percentage: 54.99, grade_point: 2.0, description: 'Pass', order_index: 4 },
  { grade_symbol: 'E', min_percentage: 40, max_percentage: 44.99, grade_point: 1.0, description: 'Poor Pass', order_index: 5 },
  { grade_symbol: 'F', min_percentage: 0, max_percentage: 39.99, grade_point: 0.0, description: 'Fail', order_index: 6 },
];

/**
 * Default assessment types
 */
export const ASSESSMENT_TYPES = [
  { value: 'examination', label: 'Examination', description: 'Formal written/oral examination' },
  { value: 'cat', label: 'CAT', description: 'Continuous Assessment Test' },
  { value: 'assignment', label: 'Assignment', description: 'Homework or take-home assignment' },
  { value: 'quiz', label: 'Quiz', description: 'Short formative quiz' },
  { value: 'weekly_test', label: 'Weekly Test', description: 'Weekly scheduled test' },
  { value: 'practical', label: 'Practical', description: 'Laboratory or hands-on practical' },
  { value: 'project', label: 'Project', description: 'Extended project work' },
  { value: 'presentation', label: 'Presentation', description: 'Oral presentation or defense' },
  { value: 'participation', label: 'Participation', description: 'Class participation and engagement' },
  { value: 'attendance', label: 'Attendance', description: 'Attendance record' },
  { value: 'custom', label: 'Custom', description: 'Custom assessment type' },
];

/**
 * Migrates existing grading_policies to new flexible scheme
 */
export function migrateLegacyGradingPolicies(gradingSubjectId: number, teacherId: number): number {
  const policies = queries.getGradingPoliciesBySubject.all(gradingSubjectId) as any[];
  const gradingSubject = queries.getGradingSubjectById.get(gradingSubjectId) as any;
  
  if (!gradingSubject || policies.length === 0) {
    return 0;
  }
  
  const scheme = queries.createGradingScheme.run(
    gradingSubjectId,
    `${gradingSubject.name} Grading Scheme`,
    `Migrated from legacy grading policies on ${new Date().toISOString()}`,
    teacherId
  ) as { lastInsertRowid: number };
  
  const schemeId = Number(scheme.lastInsertRowid);
  
  const caPolicies = policies.filter(p => !p.is_exam);
  const examPolicies = policies.filter(p => p.is_exam);
  
  const caWeight = caPolicies.length > 0 ? 40 : 0;
  const examWeight = examPolicies.length > 0 ? 60 : 100;
  
  const caCategory = queries.createGradingCategory.run(
    schemeId, 'Continuous Assessment', 'Continuous Assessment components', caWeight, 1, null, 0
  ) as { lastInsertRowid: number };
  const caCategoryId = Number(caCategory.lastInsertRowid);
  
  const examCategory = queries.createGradingCategory.run(
    schemeId, 'Examination', 'Examination components', examWeight, 2, null, 1
  ) as { lastInsertRowid: number };
  const examCategoryId = Number(examCategory.lastInsertRowid);
  
  for (let i = 0; i < caPolicies.length; i++) {
    const p = caPolicies[i];
    queries.createGradingAssessment.run(
      caCategoryId, schemeId, p.name, '', 'cat', p.max_marks, 100 / caPolicies.length, i + 1, p.mapped_cbt_subject_id, 1
    );
  }
  
  for (let i = 0; i < examPolicies.length; i++) {
    const p = examPolicies[i];
    queries.createGradingAssessment.run(
      examCategoryId, schemeId, p.name, '', 'examination', p.max_marks, 100 / examPolicies.length, i + 1, p.mapped_cbt_subject_id, 1
    );
  }
  
  for (const b of DEFAULT_GRADE_BOUNDARIES) {
    queries.createGradeBoundary.run(
      schemeId, b.grade_symbol, b.min_percentage, b.max_percentage, b.grade_point, b.description, b.order_index
    );
  }
  
  queries.publishGradingScheme.run(schemeId);
  
  return schemeId;
}