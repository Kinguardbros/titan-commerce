-- Add size chart status tracking to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_size_chart BOOLEAN DEFAULT false;
