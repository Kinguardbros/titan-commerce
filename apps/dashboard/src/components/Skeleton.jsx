import './Skeleton.css';

export function SkeletonKPI() {
  return (
    <div className="skel-kpi">
      <div className="skel-line skel-pulse" style={{ width: '60%', height: 10 }} />
      <div className="skel-line skel-pulse" style={{ width: '40%', height: 26, marginTop: 8 }} />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="skel-card">
      <div className="skel-img skel-pulse" />
      <div className="skel-line skel-pulse" style={{ width: '80%', height: 10, marginTop: 10 }} />
      <div className="skel-line skel-pulse" style={{ width: '40%', height: 10, marginTop: 6 }} />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="skel-row">
      <div className="skel-line skel-pulse" style={{ width: '30%', height: 10 }} />
      <div className="skel-line skel-pulse" style={{ width: '20%', height: 10 }} />
      <div className="skel-line skel-pulse" style={{ width: '15%', height: 10 }} />
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="skel-chart">
      <div className="skel-chart-bars">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skel-chart-bar skel-pulse" style={{ height: `${30 + Math.random() * 70}%` }} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 4, type = 'card' }) {
  return (
    <div className={`skel-grid skel-grid--${type}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
