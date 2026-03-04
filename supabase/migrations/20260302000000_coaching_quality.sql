ALTER TABLE food_log ADD COLUMN IF NOT EXISTS components jsonb;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS iron_mg numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS calcium_mg numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS potassium_mg numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS vitamin_d_mcg numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS magnesium_mg numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS zinc_mg numeric;
ALTER TABLE food_log ADD COLUMN IF NOT EXISTS b12_mcg numeric;
