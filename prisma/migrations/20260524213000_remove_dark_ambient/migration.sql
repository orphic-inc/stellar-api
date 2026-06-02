UPDATE "user_settings"
SET "siteAppearance" = 'sublime'
WHERE "siteAppearance" = 'dark-ambient';

DELETE FROM "stylesheets"
WHERE "name" = 'dark-ambient';
