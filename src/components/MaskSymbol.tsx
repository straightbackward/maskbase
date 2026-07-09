type MaskSymbolSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeConfig: Record<MaskSymbolSize, { cell: number; gap: number; radius: number }> = {
  xs: { cell: 5.5, gap: 1.5, radius: 1 },
  sm: { cell: 7, gap: 2, radius: 1 },
  md: { cell: 10, gap: 3, radius: 1.5 },
  lg: { cell: 16, gap: 5, radius: 2 },
  xl: { cell: 24, gap: 7, radius: 2.5 },
};

const pattern = [
  [1, 0, 1, 0],
  [1, 1, 0, 1],
  [1, 0, 1, 2],
];

export function MaskSymbol({
  size = 'md',
  className,
  lightMode = false,
}: {
  size?: MaskSymbolSize;
  className?: string;
  lightMode?: boolean;
}) {
  const { cell, gap, radius } = sizeConfig[size];
  const filledColor = lightMode ? '#111827' : '#fff';
  const accentColor = lightMode ? '#EA6C00' : '#F97316';

  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(4, ${cell}px)`,
        gridTemplateRows: `repeat(3, ${cell}px)`,
        gap: `${gap}px`,
      }}
    >
      {pattern.flat().map((v, i) => (
        <div
          key={i}
          style={{
            width: cell,
            height: cell,
            borderRadius: radius,
            background: v === 2 ? accentColor : v === 1 ? filledColor : 'transparent',
          }}
        />
      ))}
    </div>
  );
}
