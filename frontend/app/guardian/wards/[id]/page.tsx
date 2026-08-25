import React from "react";
import WardDetailContent from "./WardDetailContent";

// Real ward detail is wired to live APIs; keep static params for pre-generation but data comes from backend
export function generateStaticParams() {
  return [
    { id: "101" },
    { id: "102" },
    { id: "1" },
    { id: "2" },
    { id: "3" },
    { id: "4" },
    { id: "5" },
  ];
}

export default function WardProfilePage() {
  return <WardDetailContent />;
}