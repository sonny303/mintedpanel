import React from 'react';

export type StatusColor = 'gray' | 'blue' | 'amber' | 'red' | 'teal' | 'green';

export interface StatusPillProps {
  status: StatusColor;
  label: string;
  className?: string;
}

export const StatusPill = ({ status, label, className = '' }: StatusPillProps) => {
  const statusStyles: Record<StatusColor, string> = {
    gray: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]',
    blue: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
    amber: 'bg-[#FEF3C7] text-[#D97706] border-[#FDE68A]',
    red: 'bg-[#FEF2F2] text-[#DC2626] border-[#FECACA]',
    teal: 'bg-[#CCFBF1] text-[#0F766E] border-[#99F6E4]',
    green: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]',
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[12px] font-medium border ${statusStyles[status]} ${className}`}
    >
      {label}
    </span>
  );
};
