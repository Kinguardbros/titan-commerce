import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getStoreKnowledge(storeId) {
  if (!storeId) return '';
  const { data } = await supabase.from('store_knowledge').select('insights, category')
    .eq('store_id', storeId).order('processed_at', { ascending: false }).limit(20);
  if (!data?.length) return '';
  return '\n\nSTORE KNOWLEDGE (from processed documents):\n' +
    data.map((k) => `[${k.category}] ${k.insights}`).join('\n');
}

const BRAND_SYSTEM_PROMPT = `You are a copywriter for Elegance House, a women's fashion e-commerce brand.
Target audience: Women 30-60 who want to feel confident, elegant, and comfortable.

Brand voice:
- Empathetic, confident, warm — never pushy or salesy
- Lead with the PROBLEM/PAIN, then show how the product solves it
- Use real customer language — "finally pants that don't dig in"
- Focus on FEELING (confidence, freedom, femininity) not just features
- Bold but honest — never overpromise

Title format: "[PRODUCT_NAME] | [Key Attribute + Benefit Description]"
- Product name is a single woman's first name (e.g. Bella, Clara, Aria)
- After the pipe: 2-5 word benefit-driven description
- Examples: "Mathilda | Flattering Comfort Pants", "Elara | Tummy-Control Bikini"

Vendor: Always "Elegance House"

Description structure:
1. Opening hook — name the pain or desire (1-2 sentences, emotionally compelling)
2. Product introduction — what it is and why it's different (2-3 sentences)
3. Key features — bullet points with BENEFITS, not just specs
4. Material & care — brief, factual
5. Sizing & fit — helpful guidance

Tags: product category, key feature, target occasion, season if relevant, body type benefit.

Variant naming standards:
- Sizes MUST be: S, M, L, XL, XXL, 2XL, 3XL (standardize from: small/sm/s → S, xlarge/x-large → XL, etc.)
- Colors MUST be in English, capitalized: Black, Navy, Beige, White, Red, Pink, Blue, Green, Grey, Brown, Cream, Burgundy, Olive, Khaki, Camel
- Common renames: BLK/blk/schwarz/noir → Black, WHT/wht/weiss/blanc → White, NVY → Navy
- Option labels: "Size" and "Color" (not "Velikost", "Barva", "Farbe", "Taille")

You MUST return ONLY valid JSON. No markdown, no explanation, no code fences.`;

function buildOptimizationPrompt(rawProduct, brandContext) {
  const variantsInfo = rawProduct.variants
    ? `\nVariants:\n${JSON.stringify(rawProduct.variants.slice(0, 20), null, 2)}`
    : '';

  return `Rewrite this imported product listing for Elegance House store.

ORIGINAL PRODUCT DATA:
Title: ${rawProduct.title}
Description: ${rawProduct.description || '(no description)'}
Price: $${rawProduct.price || 'unknown'}
Product type: ${rawProduct.product_type || 'unknown'}
Tags: ${rawProduct.tags || 'none'}
Images: ${rawProduct.image_count || 0} images available
${variantsInfo}

${brandContext ? `ADDITIONAL BRAND CONTEXT:\n${brandContext}\n` : ''}
Return ONLY valid JSON:
{
  "title": "optimized title in [NAME] | [Benefit] format",
  "description": "full HTML description with h3 headings, paragraphs, ul/li bullet points, and emotional copy",
  "seo_title": "max 60 chars, keyword-rich",
  "seo_description": "max 155 chars, compelling meta description",
  "tags": ["tag1", "tag2", "tag3"],
  "product_type": "category",
  "vendor": "Elegance House"${rawProduct.variants ? `,
  "variants": [
    { "id": "original_variant_id", "option1": "standardized Size", "option2": "standardized Color" }
  ],
  "option_labels": { "option1": "Size", "option2": "Color" }` : ''}
}`;
}

export async function optimizeProduct(rawProduct, brandContext = '', storeId = null) {
  const knowledge = await getStoreKnowledge(storeId);
  const fullContext = brandContext + knowledge;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    system: BRAND_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: buildOptimizationPrompt(rawProduct, fullContext),
    }],
  });

  const text = response.content[0].text;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  }

  return JSON.parse(cleaned);
}
