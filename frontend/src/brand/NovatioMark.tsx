/**
 * The Novatio mark: ONE INVOICE, ONE WRITER.
 *
 * The product's differentiator is single-writer authorization deduplication:
 * an invoice can be registered for factoring exactly once, because the buyer
 * is the only party authorized to write its NovationRegistry entry. That is
 * what stops a supplier from pledging the same receivable twice - the classic
 * failure that makes receivable financing unsafe.
 *
 * The mark states that invariant: three invoice lines converge on a gate, and
 * exactly one path emerges, carrying the value. Only the outgoing arrow is
 * gold, because gold is the one thing allowed through.
 *
 * Geometry rules (a 64-unit viewBox so one file scales favicon to banner):
 *   - every stroke is 4.5 units wide, ≥1.5 units at 16px, so it holds up at
 *     favicon size instead of filling in;
 *   - no interior detail smaller than ~4 units;
 *   - the mark is rectangular, not a circle, so it stays a crisp square tile
 *     in the browser tab rather than a dot.
 */

import { useId } from 'react';

interface NovatioMarkProps {
  /** Rendered pixel size. The 64-unit viewBox keeps it sharp at any size. */
  size?: number;
  /**
   * `light` draws ink strokes, for paper backgrounds. `dark` swaps them for
   * paper strokes, because `--ink` is used as a section background all over the
   * dashboard and an ink mark on an ink panel is invisible.
   */
  tone?: 'light' | 'dark';
  className?: string;
  title?: string;
}

export function NovatioMark({
  size = 32,
  tone = 'light',
  className,
  title = 'Novatio',
}: NovatioMarkProps) {
  // useId, not a literal id: SVG paint ids are page-scoped, so N copies of this
  // component would otherwise share one gradient and bind whichever fills first.
  const gradientId = `novatio-mark-value-${useId()}`;
  const ink = tone === 'light' ? '#0B1F3A' : '#F6F3EC';
  const goldFrom = tone === 'light' ? '#C9A75C' : '#E3C583';
  const goldTo = tone === 'light' ? '#A8853A' : '#C9A75C';

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="6" y1="12" x2="58" y2="52"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={goldFrom} />
          <stop offset="1" stopColor={goldTo} />
        </linearGradient>
      </defs>

      {/* Three invoice lines. Equal length, evenly spaced, so they read as a
          set of documents rather than a to-do list. */}
      <path d="M9 18 H37" fill="none" stroke={ink}
        strokeWidth="4.5" strokeLinecap="round" />
      <path d="M9 32 H41" fill="none" stroke={ink}
        strokeWidth="4.5" strokeLinecap="round" />
      <path d="M9 46 H37" fill="none" stroke={ink}
        strokeWidth="4.5" strokeLinecap="round" />

      {/* The gate. Accent green: the bound that makes the invariant hold. */}
      <path d="M46 14 V50" fill="none" stroke="#1E4D3A"
        strokeWidth="4.5" strokeLinecap="round" />

      {/* One path out, carrying the value. */}
      <path d="M51 32 H59" fill="none" stroke={`url(#${gradientId})`}
        strokeWidth="4.5" strokeLinecap="round" />
      <path d="M54 27 L59 32 L54 37" fill="none" stroke={goldTo}
        strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The mark plus the wordmark, for headers and footers. */
export function NovatioLockup({
  size = 30,
  tone = 'light',
  label = 'Novatio',
  suffix,
  className,
}: {
  size?: number;
  tone?: 'light' | 'dark';
  label?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
      <NovatioMark size={size} tone={tone} />
      <span className="wordmark" style={{
        fontSize: `${Math.round(size * 0.62)}px`,
        color: tone === 'light' ? 'var(--ink)' : 'var(--paper)',
      }}>
        {label}
        {suffix && (
          <span style={{ color: 'var(--gold)', fontWeight: 400 }}> {suffix}</span>
        )}
      </span>
    </span>
  );
}
