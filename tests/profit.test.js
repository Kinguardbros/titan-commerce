import { describe, it, expect } from 'vitest';

// Test the P&L calculation logic directly — extracted from system.js profit_summary

function calculateDailyPnL(orders, cogsMap, paymentFees, defaultFeeRate) {
  const emptyDay = (date) => ({
    date, revenue: 0, returns: 0, cogs: 0, shipping: 0,
    adspend_meta: 0, adspend_tiktok: 0, adspend_pinterest: 0, adspend_manual: 0,
    transaction_fees: 0,
  });
  const dailyMap = {};

  for (const order of orders) {
    const date = order.created_at.split('T')[0];
    if (!dailyMap[date]) dailyMap[date] = emptyDay(date);
    dailyMap[date].revenue += order.total;
    dailyMap[date].returns += order.refund_amount || 0;
    dailyMap[date].shipping += order.shipping || 0;
    for (const item of order.items || []) {
      const unitCost = cogsMap[item.title] || 0;
      dailyMap[date].cogs += unitCost * item.quantity;
    }
    const feeRate = paymentFees[order.payment_gateway] || defaultFeeRate;
    dailyMap[date].transaction_fees += order.total * feeRate;
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  return Object.values(dailyMap).map((d) => {
    const adspend_total = d.adspend_meta + d.adspend_tiktok + d.adspend_pinterest + d.adspend_manual;
    const net_revenue = d.revenue - d.returns;
    const profit = net_revenue - d.cogs - d.shipping - adspend_total - d.transaction_fees;
    return { ...d, profit: round2(profit), transaction_fees: round2(d.transaction_fees) };
  });
}

describe('P&L calculation', () => {
  const baseOrder = {
    created_at: '2026-04-10T12:00:00Z',
    total: 100,
    shipping: 5,
    refund_amount: 0,
    payment_gateway: 'shopify_payments',
    financial_status: 'paid',
    items: [{ title: 'Mathilda Pants', quantity: 2 }],
  };

  it('calculates profit with all components', () => {
    const cogsMap = { 'Mathilda Pants': 15 };
    const paymentFees = { shopify_payments: 0.019, paypal: 0.0349 };
    const result = calculateDailyPnL([baseOrder], cogsMap, paymentFees, 0.035);

    expect(result).toHaveLength(1);
    const day = result[0];
    expect(day.revenue).toBe(100);
    expect(day.shipping).toBe(5);
    expect(day.cogs).toBe(30); // 15 * 2
    expect(day.transaction_fees).toBe(1.9); // 100 * 0.019
    // profit = 100 - 0 - 30 - 5 - 0 - 1.9 = 63.1
    expect(day.profit).toBe(63.1);
  });

  it('uses per-gateway fee rate', () => {
    const paypalOrder = { ...baseOrder, payment_gateway: 'paypal', items: [] };
    const result = calculateDailyPnL([paypalOrder], {}, { shopify_payments: 0.019, paypal: 0.0349 }, 0.035);
    expect(result[0].transaction_fees).toBe(3.49); // 100 * 0.0349
  });

  it('falls back to default fee rate for unknown gateway', () => {
    const unknownOrder = { ...baseOrder, payment_gateway: 'klarna', items: [] };
    const result = calculateDailyPnL([unknownOrder], {}, { shopify_payments: 0.019 }, 0.035);
    expect(result[0].transaction_fees).toBe(3.5); // 100 * 0.035
  });

  it('accounts for returns/refunds', () => {
    const refundedOrder = { ...baseOrder, refund_amount: 50, items: [] };
    const result = calculateDailyPnL([refundedOrder], {}, {}, 0.035);
    // profit = 100 - 50 - 0 - 5 - 0 - 3.5 = 41.5
    expect(result[0].returns).toBe(50);
    expect(result[0].profit).toBe(41.5);
  });

  it('handles shipping from Shopify', () => {
    const shippingOrder = { ...baseOrder, shipping: 12.50, items: [] };
    const result = calculateDailyPnL([shippingOrder], {}, {}, 0.035);
    expect(result[0].shipping).toBe(12.50);
    // profit = 100 - 0 - 0 - 12.50 - 0 - 3.5 = 84
    expect(result[0].profit).toBe(84);
  });

  it('handles orders with no shipping (digital products)', () => {
    const digitalOrder = { ...baseOrder, shipping: 0, items: [] };
    const result = calculateDailyPnL([digitalOrder], {}, {}, 0.035);
    expect(result[0].shipping).toBe(0);
  });

  it('aggregates multiple orders on same day', () => {
    const order2 = { ...baseOrder, total: 50, shipping: 3, items: [{ title: 'Elara Bikini', quantity: 1 }] };
    const cogsMap = { 'Mathilda Pants': 15, 'Elara Bikini': 10 };
    const result = calculateDailyPnL([baseOrder, order2], cogsMap, {}, 0.035);
    expect(result).toHaveLength(1);
    expect(result[0].revenue).toBe(150);
    expect(result[0].shipping).toBe(8);
    expect(result[0].cogs).toBe(40); // 15*2 + 10*1
  });
});
