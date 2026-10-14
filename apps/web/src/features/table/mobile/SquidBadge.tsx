export function SquidBadge({ className = "", label = "鱿鱼标记" }: {
  readonly className?: string;
  readonly label?: string;
}) {
  return (
    <span aria-label={label} className={`squid-badge ${className}`.trim()} role="img">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 2.6c-4.1 0-7.1 3.2-7.1 7.3 0 2.7 1.3 4.8 3.5 6l-1.1 3.2c-.2.7.6 1.2 1.1.7l2.1-2.1.7 3.1c.2.7 1.2.7 1.4 0l.7-3.1 2.1 2.1c.5.5 1.3 0 1.1-.7l-1.1-3.2c2.2-1.2 3.5-3.3 3.5-6C19.1 5.8 16.1 2.6 12 2.6Z" />
        <circle cx="9.5" cy="10.1" r="1.1" />
        <circle cx="14.5" cy="10.1" r="1.1" />
      </svg>
    </span>
  );
}
