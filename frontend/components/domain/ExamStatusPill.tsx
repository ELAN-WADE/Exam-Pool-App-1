import React from "react";
import { Badge } from "../ui/Badge";

export type ExamStatusPillProps = {
  isPublished: boolean | number;
  examDatetime?: string | null;
  windowDurationMinutes?: number;
  mode?: "test" | "exam" | "quiz";
  className?: string;
};

export function ExamStatusPill({
  isPublished,
  examDatetime,
  windowDurationMinutes = 120,
  mode,
  className = "",
}: ExamStatusPillProps) {
  const published = Number(isPublished) === 1;

  if (!published) {
    return (
      <Badge variant="neutral" size="sm" dot className={className}>
        Draft
      </Badge>
    );
  }

  if (!examDatetime) {
    return (
      <Badge variant="success" size="sm" dot className={className}>
        Published (Unscheduled)
      </Badge>
    );
  }

  const now = Date.now();
  const start = new Date(examDatetime).getTime();
  const end = start + windowDurationMinutes * 60_000;

  if (now < start) {
    return (
      <Badge variant="warning" size="sm" dot className={className}>
        Scheduled
      </Badge>
    );
  }

  if (now >= start && now <= end) {
    return (
      <Badge variant="info" size="sm" dot className={`animate-pulse ${className}`}>
        Live CBT Active
      </Badge>
    );
  }

  return (
    <Badge variant="neutral" size="sm" className={className}>
      Ended
    </Badge>
  );
}
