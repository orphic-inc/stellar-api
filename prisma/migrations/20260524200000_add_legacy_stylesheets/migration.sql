-- Add legacy stylesheets: Layer Cake, Proton, Postmod, Dark Ambient
INSERT INTO "stylesheets" ("name", "description", "cssUrl", "isDefault", "createdAt")
VALUES
  ('layer-cake',   'Warm dark theme with golden amber accents', '/stylesheets/layer-cake/style.css',   false, NOW()),
  ('proton',       'Cool dark theme with teal accents',         '/stylesheets/proton/style.css',        false, NOW()),
  ('postmod',      'Stark minimalist theme with red accents',   '/stylesheets/postmod/style.css',       false, NOW()),
  ('dark-ambient', 'Deep atmospheric theme with muted blue',    '/stylesheets/dark-ambient/style.css',  false, NOW())
ON CONFLICT ("name") DO UPDATE SET
  "description" = EXCLUDED."description",
  "cssUrl"      = EXCLUDED."cssUrl";
