import * as migration_20260609_140912 from './20260609_140912';

export const migrations = [
  {
    up: migration_20260609_140912.up,
    down: migration_20260609_140912.down,
    name: '20260609_140912'
  },
];
