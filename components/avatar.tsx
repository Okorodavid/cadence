/** Round character avatar with an initial fallback. Server- and client-safe. */
export function Avatar({
  src,
  name,
  size = 32,
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        style={style}
        className={`shrink-0 rounded-full object-cover ring-1 ring-line ${className}`}
      />
    );
  }

  return (
    <span
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
      className={`grid shrink-0 place-items-center rounded-full bg-raise2 font-semibold text-muted ring-1 ring-line ${className}`}
      aria-label={name}
    >
      {name.charAt(0).toUpperCase() || "?"}
    </span>
  );
}
