/** Stethoscope-spoon brand mark: stethoscope tubing ending in a spoon bowl. */
export function LogoMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      {/* earpieces */}
      <path d="M18 6 L18 14" stroke="#F5A623" strokeWidth="4" strokeLinecap="round" />
      <path d="M38 6 L38 14" stroke="#F5A623" strokeWidth="4" strokeLinecap="round" />
      {/* tubing: two arms joining and curving to the spoon */}
      <path
        d="M18 14 C18 30, 28 34, 28 40 M38 14 C38 30, 28 34, 28 40 C28 48, 40 46, 46 48"
        stroke="#2ECC71"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      {/* spoon bowl as the chest piece */}
      <ellipse cx="50" cy="50" rx="9" ry="7" fill="#F5A623" stroke="#2ECC71" strokeWidth="3" />
      <ellipse cx="50" cy="50" rx="4" ry="3" fill="#0D1B2A" opacity="0.25" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark className={compact ? 'h-8 w-8' : 'h-10 w-10'} />
      <span className={`font-heading font-black tracking-tight ${compact ? 'text-xl' : 'text-2xl md:text-3xl'}`}>
        Flavor <span className="text-rx">Doctors</span>
      </span>
    </span>
  );
}
