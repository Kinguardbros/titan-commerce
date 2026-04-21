/**
 * Shared event detection logic — used by both cron/detect-events.js and system.js scan_events action.
 * Scans top products for a store and creates events + proposals.
 */
export async function detectEventsForStore(storeId, topProducts, supabase) {
  let eventsCreated = 0;
  let proposalsCreated = 0;
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

  // Pre-fetch beach creative counts for all products in one query
  const productIds = topProducts.map((p) => p.product_id).filter(Boolean);
  const { data: beachCreatives } = productIds.length > 0
    ? await supabase.from('creatives').select('product_id').eq('store_id', storeId).eq('style', 'product_photo_beach').in('status', ['pending', 'approved', 'published']).in('product_id', productIds)
    : { data: [] };
  const hasBeach = new Set((beachCreatives || []).map((c) => c.product_id));

  for (const p of topProducts) {
    if (!p.product_id) continue;

    // product_no_creatives
    if (p.units > 0 && p.creative_count === 0) {
      const created = await createEventAndProposal(supabase, {
        storeId, productId: p.product_id, type: 'product_no_creatives', severity: 'high',
        title: `${p.title} has no creatives`,
        description: `Sold ${p.units} units but has 0 creatives`,
        metadata: { revenue: p.revenue, units: p.units },
        proposalType: 'generate_creatives',
        proposalTitle: `Generate creatives for "${p.title}"`,
        proposalDescription: `${p.units} units sold, 0 creatives`,
        suggestedAction: { action: 'generate', product_id: p.product_id, count: 4, styles: ['ad_creative', 'lifestyle'], format: 'image' },
        expiresAt,
      });
      if (created) { eventsCreated++; proposalsCreated++; }
    }

    // revenue_declining
    if (p.trend !== null && parseInt(p.trend) < -10 && p.creative_count > 0) {
      const created = await createEventAndProposal(supabase, {
        storeId, productId: p.product_id, type: 'revenue_declining', severity: 'medium',
        title: `${p.title} revenue declining (${p.trend}%)`,
        description: `Revenue dropped ${p.trend}% vs previous period`,
        metadata: { revenue: p.revenue, trend: p.trend },
        proposalType: 'try_different_style',
        proposalTitle: `Try new style for "${p.title}"`,
        proposalDescription: `Revenue ${p.trend}%. Try lifestyle or UGC style.`,
        suggestedAction: { action: 'generate', product_id: p.product_id, count: 2, styles: ['lifestyle'], format: 'image' },
        expiresAt,
      });
      if (created) { eventsCreated++; proposalsCreated++; }
    }

    // winner_detected
    if (p.trend !== null && parseInt(p.trend) > 15 && p.revenue > 100) {
      const created = await createEventAndProposal(supabase, {
        storeId, productId: p.product_id, type: 'winner_detected', severity: 'low',
        title: `Winner: ${p.title} (+${p.trend}%)`,
        description: `Revenue growing ${p.trend}%. Scale with more creatives.`,
        metadata: { revenue: p.revenue, trend: p.trend },
        proposalType: 'generate_variations',
        proposalTitle: `Scale winner: "${p.title}"`,
        proposalDescription: `Top performer. Generate more in same style.`,
        suggestedAction: { action: 'generate', product_id: p.product_id, count: 4, styles: ['ad_creative'], format: 'image' },
        expiresAt,
      });
      if (created) { eventsCreated++; proposalsCreated++; }
    }

    // product_no_beach_photo — has creatives but no beach photo
    if (p.creative_count > 0 && !hasBeach.has(p.product_id)) {
      const created = await createEventAndProposal(supabase, {
        storeId, productId: p.product_id, type: 'product_no_beach_photo', severity: 'medium',
        title: `${p.title} — missing beach photo`,
        description: `Product has ${p.creative_count} creatives but no beach-style photo`,
        metadata: { creative_count: p.creative_count },
        proposalType: 'generate_beach_photo',
        proposalTitle: `Generate beach photo for "${p.title}"`,
        proposalDescription: `${p.creative_count} creatives, 0 beach. Beach photos perform well for swimwear.`,
        suggestedAction: { action: 'generate', product_id: p.product_id, count: 2, styles: ['product_photo_beach'], format: 'image' },
        expiresAt,
      });
      if (created) { eventsCreated++; proposalsCreated++; }
    }
  }

  // ── Beach photo check for ALL active products (not just top sellers) ──
  // Any real swimwear product without a beach photo should get a proposal,
  // regardless of whether it has other creatives or sales.
  const topProductIdSet = new Set(topProducts.map((p) => p.product_id).filter(Boolean));
  const NON_PRODUCT_KEYWORDS = /shipping|insurance|mystery|gift|protection|digital|warranty/i;
  const { data: allStoreProducts } = await supabase.from('products')
    .select('id, title').eq('store_id', storeId).eq('status', 'active');

  // Batch: fetch all product_ids that already have beach photos
  const allPids = (allStoreProducts || []).map((p) => p.id);
  const { data: beachAll } = allPids.length > 0
    ? await supabase.from('creatives').select('product_id').eq('store_id', storeId)
        .eq('style', 'product_photo_beach').in('status', ['pending', 'approved', 'published']).in('product_id', allPids)
    : { data: [] };
  const hasBeachAll = new Set((beachAll || []).map((c) => c.product_id));

  console.log(`[event-detector] Beach check: ${(allStoreProducts || []).length} active products, ${hasBeachAll.size} have beach, ${topProductIdSet.size} already in topProducts`);

  let beachCandidates = 0;
  for (const p of allStoreProducts || []) {
    if (topProductIdSet.has(p.id)) continue;
    if (hasBeachAll.has(p.id)) continue;
    if (NON_PRODUCT_KEYWORDS.test(p.title)) continue;

    beachCandidates++;
    console.log(`[event-detector] Beach candidate: "${p.title}" (${p.id})`);

    const created = await createEventAndProposal(supabase, {
      storeId, productId: p.id, type: 'product_no_beach_photo', severity: 'medium',
      title: `${p.title} — missing beach photo`,
      description: `Product has no beach-style photo yet`,
      metadata: {},
      proposalType: 'generate_beach_photo',
      proposalTitle: `Generate beach photo for "${p.title}"`,
      proposalDescription: `No beach photo yet. Beach photos perform well for swimwear.`,
      suggestedAction: { action: 'generate', product_id: p.id, count: 2, styles: ['product_photo_beach'], format: 'image' },
      expiresAt,
    });
    if (created) { eventsCreated++; proposalsCreated++; }
  }

  return { eventsCreated, proposalsCreated };
}

async function createEventAndProposal(supabase, opts) {
  const { storeId, productId, type, severity, title, description, metadata, proposalType, proposalTitle, proposalDescription, suggestedAction, expiresAt } = opts;

  // Check if event already exists (active) or was recently dismissed (7d cooldown)
  const { data: existing, error: existErr } = await supabase.from('events').select('id')
    .eq('store_id', storeId).eq('product_id', productId).eq('type', type)
    .in('status', ['new', 'proposal_created']).limit(1).single();
  if (existing) { console.log(`[event-detector] Skipped "${title}" — event already exists`); return false; }

  // Cooldown: skip if same proposal type was dismissed/rejected in the last 7 days
  const cooldownDate = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: dismissed, error: dismissErr } = await supabase.from('proposals').select('id')
    .eq('store_id', storeId).eq('product_id', productId).eq('type', proposalType)
    .eq('status', 'rejected').gte('created_at', cooldownDate).limit(1).single();
  if (dismissed) { console.log(`[event-detector] Skipped "${title}" — dismissed cooldown`); return false; }

  const { data: evt } = await supabase.from('events').insert({
    store_id: storeId, type, product_id: productId, severity, title, description,
    metadata: JSON.stringify(metadata),
  }).select().single();

  if (!evt) return false;

  await supabase.from('events').update({ status: 'proposal_created' }).eq('id', evt.id);
  await supabase.from('proposals').insert({
    store_id: storeId, event_id: evt.id, type: proposalType, product_id: productId,
    title: proposalTitle, description: proposalDescription,
    suggested_action: JSON.stringify(suggestedAction),
    expires_at: expiresAt,
  });

  return true;
}
