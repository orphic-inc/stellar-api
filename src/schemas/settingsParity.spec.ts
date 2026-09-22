/**
 * Drift-guard — proves the two settings doors accept the same settings fields.
 *
 * `PUT /api/profile/me` (`profileUpdateSchema`) and `PUT /api/users/settings`
 * (`userSettingsSchema`) both write the same `UserSettings` row. The profile door
 * additionally carries `Profile` columns, so it is a superset by design; what is
 * NOT by design is a settings field reaching only one of them.
 *
 * That is exactly how `showMatureContent` shipped inert: #400 added it to
 * `userSettingsSchema` and to `updateProfile`'s writer, but not to
 * `profileUpdateSchema`. `validate()` assigns the PARSED body (`req.body =
 * data`) and Zod strips unknown keys, so a `PUT /profile/me` carrying the field
 * answered 200 having written nothing — and the settings UI submits through that
 * door. A silent strip has no failing surface to notice, so this test is the
 * surface.
 *
 * Pure: it compares the two Zod shapes, no DB.
 */
import { profileUpdateSchema } from './profile';
import { userSettingsSchema } from './user';

// `Profile` columns, which have no business on the settings-only door. Every
// OTHER divergence is drift. Keep this list minimal: adding a name here to make
// the test pass is how the guard gets defeated.
const PROFILE_ONLY = [
  'avatarMouseoverText',
  'profileTitle',
  'profileInfo',
  'activeAuthorStylesheetId'
] as const;

describe('settings schema parity — the two doors onto UserSettings', () => {
  const profileKeys = Object.keys(profileUpdateSchema.shape);
  const settingsKeys = Object.keys(userSettingsSchema.shape);

  it.each(Object.keys(userSettingsSchema.shape))(
    '%s is writable through PUT /profile/me too',
    (field) => {
      expect(profileKeys).toContain(field);
    }
  );

  it('the profile door adds only Profile columns', () => {
    expect(profileKeys.filter((k) => !settingsKeys.includes(k)).sort()).toEqual(
      [...PROFILE_ONLY].sort()
    );
  });

  it('showMatureContent reaches both doors (#400 shipped it on one)', () => {
    expect(profileKeys).toContain('showMatureContent');
    expect(settingsKeys).toContain('showMatureContent');
  });

  // #586 / ADR-0046. `paranoia` was a level that NOTHING read — every visibility
  // gate reads the five booleans below — and the two doors wrote it differently:
  // `/profile/me` cascaded it over the five, `/users/settings` stored it bare.
  // The five are the privacy control now, and presets are a stellar-ui
  // affordance that leaves no server-side trace.
  //
  // Reintroducing it as an input is what would make the five checkboxes inert
  // again, so this stands against that rather than against the name.
  it('neither door accepts a paranoia level', () => {
    expect(profileKeys).not.toContain('paranoia');
    expect(settingsKeys).not.toContain('paranoia');
  });

  it('the five privacy flags are writable through both doors', () => {
    for (const flag of [
      'showEmail',
      'showLastSeen',
      'showContributedStats',
      'showConsumedStats',
      'showRatioStats'
    ]) {
      expect(profileKeys).toContain(flag);
      expect(settingsKeys).toContain(flag);
    }
  });
});
