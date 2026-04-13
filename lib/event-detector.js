/**
 * Shared event detection logic — used by both cron/detect-events.js and system.js scan_events action.
 * Scans top products for a store and creates events + proposals.
 */
export async function detectEventsForStore(storeId, topProducts, supabase) {
  let eventsCreated = 0;
  let proposalsCreated = 0;
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

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
  }

  return { eventsCreated, proposalsCreated };
}

async function createEventAndProposal(supabase, opts) {
  const { storeId, productId, type, severity, title, description, metadata, proposalType, proposalTitle, proposalDescription, suggestedAction, expiresAt } = opts;

  // Check if event already exists
  const { data: existing } = await supabase.from('events').select('id')
    .eq('store_id', storeId).eq('product_id', productId).eq('type', type)
    .in('status', ['new', 'proposal_created']).limit(1).single();
  if (existing) return false;

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
