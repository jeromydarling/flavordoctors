-- Seed: 34 Flavor Doctors SKUs. Prices in cents.
-- Safe to re-run: replaces existing rows by primary key.

INSERT OR REPLACE INTO products (id, slug, name, collection, description, price, is_bestseller) VALUES
-- Doctored Mayo (8 oz jars)
('p001', 'ranch-rx',                 'Ranch Rx',                 'mayo',         'Ranch-style flavored mayo — cool buttermilk herbs meet rich, creamy mayo.', 999, 1),
('p002', 'bleu-diagnosis',           'Bleu Diagnosis',           'mayo',         'Blue cheese mayo with a bold, funky bite. A confirmed case of flavor.', 1049, 0),
('p003', 'lemon-aide',               'Lemon Aide',               'mayo',         'Hollandaise-style mayo with bright lemon and clarified butter.', 1099, 0),
('p004', 'smoked-cheddar-cure',      'Smoked Cheddar Cure',      'mayo',         'Smoky cheddar mayo — campfire depth with sharp cheese richness.', 1049, 0),
('p005', 'saffron-gold',             'Saffron Gold',             'mayo',         'Saffron aioli-style mayo. Liquid gold for sandwiches, fries, and seafood.', 1199, 0),

-- Doctored Butter (4 oz rolls)
('p006', 'cowboy-compound',          'Cowboy Compound',          'butter',       'Dijon, horseradish, garlic, and chili flake compound butter. Steak''s best friend.', 1249, 1),
('p007', 'miso-doctor',              'Miso Doctor',              'butter',       'White miso, garlic, and sesame butter. Umami in spreadable form.', 1249, 0),
('p008', 'seoul-spice',              'Seoul Spice',              'butter',       'Gochujang and sesame butter — sweet heat with toasty depth.', 1249, 0),
('p009', 'garam-gold',               'Garam Gold',               'butter',       'Garam masala, ginger, and garlic butter. Warm spice for everything.', 1249, 0),
('p010', 'truffle-treatment',        'Truffle Treatment',        'butter',       'Black truffle and cracked pepper butter. The luxury course of treatment.', 1499, 1),
('p011', 'chile-lime-cure',          'Chile-Lime Cure',          'butter',       'Lime, chili, and cilantro butter. Bright, zesty, and a little dangerous.', 1199, 0),
('p012', 'blueberry-lavender-rx',    'Blueberry Lavender Rx',    'butter',       'Blueberry, lavender, and honey butter. Breakfast, prescribed.', 1299, 0),

-- Doctored Burger Sauce (8 oz jars)
('p013', 'canes-classic',            'Cane''s Classic',          'burger-sauce', 'Raising Cane''s inspired dipping sauce — peppery, tangy, unreasonably good.', 999, 0),
('p014', 'big-doc-sauce',            'Big Doc Sauce',            'burger-sauce', 'Big Mac-style special sauce. The classic burger prescription.', 999, 1),
('p015', 'chick-physician',          'Chick Physician',          'burger-sauce', 'Chick-fil-A style honey mustard BBQ sauce. Nugget therapy.', 1049, 0),
('p016', 'in-n-out-insider',         'In-N-Out Insider',         'burger-sauce', 'Secret spread style sauce. Animal-style anything, at home.', 999, 0),
('p017', 'polynesian-protocol',      'Polynesian Protocol',      'burger-sauce', 'Sweet and sour fruity dipping sauce with island energy.', 1049, 0),

-- Doctored Ice Cream Toppers (8 oz jars)
('p018', 'bourbon-street-drizzle',   'Bourbon Street Drizzle',   'toppers',      'Bourbon salted caramel sauce. Warm, boozy, buttery.', 1299, 1),
('p019', 'espresso-caramel-rx',      'Espresso Caramel Rx',      'toppers',      'Espresso caramel sauce — a double shot for your dessert.', 1199, 0),
('p020', 'miso-caramel-doctor',      'Miso Caramel Doctor',      'toppers',      'Miso salted caramel. Sweet-savory in perfect equilibrium.', 1249, 0),
('p021', 'dark-matter-fudge',        'Dark Matter Fudge',        'toppers',      'Bittersweet dark chocolate sauce, dense enough to bend spoons.', 1199, 1),
('p022', 'hazelnut-haze',            'Hazelnut Haze',            'toppers',      'Dark chocolate hazelnut sauce. Gianduja, doctored.', 1249, 0),
('p023', 'spicy-cacao-cure',         'Spicy Cacao Cure',         'toppers',      'Chipotle dark chocolate sauce with a slow, smoky burn.', 1199, 0),
('p024', 'mango-rx',                 'Mango Rx',                 'toppers',      'Mango chili lime topper — tropical with a kick.', 1149, 0),
('p025', 'strawberry-balsamic-serum','Strawberry Balsamic Serum','toppers',      'Strawberry balsamic drizzle. Bright berries, aged tang.', 1199, 0),
('p026', 'passion-fruit-protocol',   'Passion Fruit Protocol',   'toppers',      'Passion fruit lime topper. Tart, floral, electric.', 1199, 0),

-- Doctored French Fry Seasoning (4 oz shakers)
('p027', 'classic-md',               'Classic MD',               'seasoning',    'Garlic herb blend — the general practitioner of fry seasonings.', 899, 1),
('p028', 'smoke-and-mirrors',        'Smoke & Mirrors',          'seasoning',    'Smoky BBQ blend with sweet, savory sleight of hand.', 899, 0),
('p029', 'old-bay-rx',               'Old Bay Rx',               'seasoning',    'Chesapeake crab fry blend. Boardwalk fries, board-certified.', 949, 0),
('p030', 'truffle-tremor',           'Truffle Tremor',           'seasoning',    'Truffle parmesan blend. Symptoms include involuntary fry ordering.', 999, 0),
('p031', 'tajin-treatment',          'Tajín Treatment',          'seasoning',    'Lime chili blend — citrusy heat for fries, fruit, and rims.', 899, 1),
('p032', 'greek-diagnosis',          'Greek Diagnosis',          'seasoning',    'Mediterranean oregano feta blend. Opa-level fries.', 899, 0),
('p033', 'ketchup-code',             'Ketchup Code',             'seasoning',    'Tomato-based sweet-savory blend. Ketchup, decoded into a shaker.', 899, 0),
('p034', 'ramen-remedy',             'Ramen Remedy',             'seasoning',    'Umami chicken-style blend. The instant classic, weaponized.', 949, 0);
