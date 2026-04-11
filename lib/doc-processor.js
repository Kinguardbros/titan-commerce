import mammoth from 'mammoth';

/**
 * Extract text content from a file buffer based on type
 */
export async function extractText(buffer, filename, anthropic) {
  const ext = filename.split('.').pop().toLowerCase();

  // Text files — read directly
  if (['txt', 'md', 'csv'].includes(ext)) {
    return Buffer.from(buffer).toString('utf-8');
  }

  // DOCX — use mammoth
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return result.value;
  }

  // PDF, PNG, JPG — use Claude Vision
  // PDF — use document type (not image)
  if (ext === 'pdf') {
    const base64 = Buffer.from(buffer).toString('base64');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: 'Extract ALL text content from this PDF document. Return the full text, preserving structure (headings, bullet points, tables). If it contains a table, format as CSV.' },
        ],
      }],
    });
    return response.content[0].text;
  }

  // Images — use image type
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    const base64 = Buffer.from(buffer).toString('base64');
    const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Extract ALL text content from this image. Return the full text, preserving structure (headings, bullet points, tables). If it contains a table, format as CSV.' },
        ],
      }],
    });
    return response.content[0].text;
  }

  return null;
}

/**
 * Classify document into category using AI
 */
export async function classifyDocument(text, filename, anthropic) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Classify this document into exactly ONE category based on its content.

Categories:
- Brand — brand guidelines, positioning, brand voice, brand story, mission/vision
- Audience — customer personas, avatars, target audience research, demographics, customer reviews, testimonials
- Products — specific product research, product specs, offer briefs, product-specific data
- Creative — creative playbooks, ad frameworks, creative strategies, visual direction, design guidelines
- Ads — ad transcripts, ad library research, competitor ad analysis, winning hooks, ad copy
- Logos — brand logos, brand marks, icons (usually image files)

Filename: ${filename}
Content (first 2000 chars): ${text.slice(0, 2000)}

Return ONLY the category name (one word): Brand, Audience, Products, Creative, Ads, or Logos`,
    }],
  });

  const category = response.content[0].text.trim();
  const valid = ['Brand', 'Audience', 'Products', 'Creative', 'Ads', 'Logos'];
  return valid.includes(category) ? category : 'Brand';
}

/**
 * Extract key insights for store knowledge
 */
export async function extractInsights(text, filename, storeName, anthropic) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Extract the key insights from this document that should be added to the brand knowledge file for "${storeName}".

Focus on:
- Target audience details (age, demographics, pain points)
- Brand voice and tone guidelines
- Winning hooks or headlines
- Customer quotes or testimonials
- Visual direction for creatives
- Product-specific information
- Competitive positioning

Return as bullet points. Only include NEW, specific, actionable insights. Skip generic marketing advice.

Filename: ${filename}
Content: ${text.slice(0, 6000)}`,
    }],
  });

  return response.content[0].text;
}
