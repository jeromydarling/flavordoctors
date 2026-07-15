-- Food-compliance fields: ingredient statement and allergen disclosure per
-- product. NULL means "not yet entered" — the storefront only renders these
-- sections when real data exists, and never invents it.
ALTER TABLE products ADD COLUMN ingredients TEXT;
ALTER TABLE products ADD COLUMN allergens TEXT;
