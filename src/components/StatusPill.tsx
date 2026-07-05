// StatusPill renders a small colored pill for status labels.
// Also exports hexToStatusColor to map DB hex colors to the pill's semantic color name.
import React from "react";

export type StatusColor =
  | "gray"
  | "blue"
  | "amber"
  | "red"
  | "teal"
  | "green"
  // Semantic one-off tones consolidated from feature surfaces:
  | "neutral" // warm gray (admin Inactive/No/Billing pills)
  | "brand" // primary-green tint (Admin role badge)
  | "violet"; // audit TOUCH_LOGGED

export interface StatusPillProps {
  status: StatusColor;
  label: string;
  className?: string;
}

export function hexToStatusColor(hex: string | null | undefined): StatusColor {
  switch ((hex ?? "").toUpperCase()) {
    case "#2563EB":
      return "blue";
    case "#D97706":
      return "amber";
    case "#DC2626":
    case "#991B1B":
      return "red";
    case "#0891B2":
      return "teal";
    case "#059669":
      return "green";
    default:
      return "gray";
  }
}

export const StatusPill = ({ status, label, className = "" }: StatusPillProps) => {
  const statusStyles: Record<StatusColor, string> = {
    gray: "bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]",
    blue: "bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]",
    amber: "bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]",
    red: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]",
    teal: "bg-[#CCFBF1] text-[#0F766E] border-[#99F6E4]",
    green: "bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]",
    neutral: "bg-[#F5F5F4] text-[#57534E] border-[#E8E5E0]",
    brand: "bg-[#E7F0EC] text-[#1B4D3E] border-[#C8DBD4]",
    violet: "bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border ${statusStyles[status]} ${className}`}
    >
      {label}
    </span>
  );
};
