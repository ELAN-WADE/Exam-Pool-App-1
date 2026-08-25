import React from "react";
import { Badge } from "../ui/Badge";

export type SessionTermBadgeProps = {
  sessionName?: string;
  termName?: string;
  isActive?: boolean;
  className?: string;
};

export function SessionTermBadge({
  sessionName,
  termName,
  isActive = false,
  className = "",
}: SessionTermBadgeProps) {
  if (!sessionName && !termName) return null;

  return (
    <Badge
      variant={isActive ? "success" : "neutral"}
      size="sm"
      dot={isActive}
      className={className}
    >
      {sessionName && <span className="font-semibold">{sessionName}</span>}
      {sessionName && termName && <span className="opacity-50">·</span>}
      {termName && <span>{termName}</span>}
      {isActive && <span className="text-[0.65rem] font-bold uppercase tracking-wider ml-0.5 opacity-90">(Active)</span>}
    </Badge>
  );
}
