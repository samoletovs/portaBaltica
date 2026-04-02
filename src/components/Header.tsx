interface HeaderProps {
  lastUpdated: Date | null;
}

export function Header({ lastUpdated }: HeaderProps) {
  return (
    <header className="py-8 px-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            <span className="text-ocean-400">⚓</span> Porta Baltica
          </h1>
          <p className="text-ocean-300 mt-1">Live maritime dashboard — Latvia's ports</p>
        </div>
        {lastUpdated && (
          <div className="text-sm text-ocean-400">
            Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </header>
  );
}
