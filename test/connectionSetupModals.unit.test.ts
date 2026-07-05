import { describe, expect, test } from 'bun:test';
import {
  buildProviderCredentialConfig,
  normalizeObsConnectionInput,
} from '../src/ui/connectionSetupModals';

describe('buildProviderCredentialConfig', () => {
  test('trims credential values and omits empty fields', () => {
    expect(buildProviderCredentialConfig('twitch', ' client-id ', '  ')).toEqual({
      platforms: {
        twitch: {
          clientId: 'client-id',
        },
      },
    });
  });

  test('supports each connection setup provider key', () => {
    expect(buildProviderCredentialConfig('kick', 'kid', 'secret')).toEqual({
      platforms: {
        kick: {
          clientId: 'kid',
          clientSecret: 'secret',
        },
      },
    });
    expect(buildProviderCredentialConfig('youtube', 'yid', 'ysecret')).toEqual({
      platforms: {
        youtube: {
          clientId: 'yid',
          clientSecret: 'ysecret',
        },
      },
    });
  });
});

describe('normalizeObsConnectionInput', () => {
  test('trims host/password and parses port', () => {
    expect(normalizeObsConnectionInput(' obs.local ', ' 4456 ', ' secret ')).toEqual({
      host: 'obs.local',
      port: 4456,
      password: 'secret',
    });
  });

  test('falls back to default host, port, and null password', () => {
    expect(normalizeObsConnectionInput(' ', 'bad', ' ')).toEqual({
      host: 'localhost',
      port: 4455,
      password: null,
    });
  });
});
