import './AmazonInstallGuide.css';

const USERSCRIPT_RAW_URL = 'https://raw.githubusercontent.com/Kinguardbros/titan-commerce/main/scripts/titan-amazon-userscript.user.js';
const TAMPERMONKEY_URL = 'https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo';

// Replaces the old VPS-scrape UI (feature-03) — Amazon reviews now import via a
// browser-side Tampermonkey userscript (feature-04), since Amazon blocks the
// datacenter IP the old server-side scraper ran from. This component is pure
// static instructions; the actual scrape+import happens entirely client-side on
// Amazon.com via the userscript, POSTing to Titan's existing import_amazon_reviews
// action with a per-user API token (Settings > Users > Generate API token).
export default function AmazonInstallGuide() {
  return (
    <div className="az-guide">
      <div className="az-guide-sub">
        Amazon reviews now import via a browser userscript — it scrapes reviews directly
        on the Amazon page using your own logged-in session, so Amazon never blocks it.
      </div>

      <ol className="az-guide-steps">
        <li>
          <strong>Install Tampermonkey</strong> — the browser extension that runs userscripts.
          <div className="az-guide-action">
            <a href={TAMPERMONKEY_URL} target="_blank" rel="noopener noreferrer" className="rv-btn rv-btn--save">
              Get Tampermonkey
            </a>
          </div>
        </li>
        <li>
          <strong>Install the Titan userscript</strong> — click the link below, Tampermonkey will
          prompt you to install it.
          <div className="az-guide-action">
            <a href={USERSCRIPT_RAW_URL} target="_blank" rel="noopener noreferrer" className="rv-btn rv-btn--save">
              Install userscript
            </a>
          </div>
        </li>
        <li>
          <strong>Set your API token</strong> — go to <em>Settings → Users</em> in this dashboard,
          click <em>Generate API token</em> next to your own user row, copy it. Then click the
          Tampermonkey icon in your browser toolbar → <em>Titan Commerce — Amazon Reviews Importer</em> →
          <em> Configure Titan token</em>, and paste it in.
        </li>
        <li>
          <strong>Import from Amazon</strong> — visit any Amazon product page
          (e.g. <code>amazon.com/dp/B0EXAMPLE</code>), click the floating
          <em> Import to Titan</em> button in the bottom-right corner, pick the store + product,
          and confirm. Reviews land in this dashboard&apos;s Reviews queue as <strong>pending</strong>.
        </li>
      </ol>
    </div>
  );
}
