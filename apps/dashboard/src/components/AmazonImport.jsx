import AmazonInstallGuide from './AmazonInstallGuide';

// Kept as a thin wrapper (same component name + prop signature as feature-03's
// VPS-scrape version) so ImportReviews.jsx's 4th-tab wiring
// (<AmazonImport storeId={storeId} productId={productId} onImported={...} />)
// needs no changes. The actual scrape+import now happens client-side via the
// Tampermonkey userscript — this tab just shows install instructions.
// eslint-disable-next-line no-unused-vars
export default function AmazonImport({ storeId, productId, onImported }) {
  return <AmazonInstallGuide />;
}
