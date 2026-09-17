import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { THEMES, type Theme } from './types.js';
export interface UserSettings { theme?: Theme }
export function isTheme(v: unknown): v is Theme { return typeof v === 'string' && (THEMES as readonly string[]).includes(v); }
/** 없거나 깨진 파일은 {} — 설정 파일 때문에 서버가 죽지 않는다 */
export function readUserSettings(file: string): UserSettings {
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const out: UserSettings = {};
    if (isTheme(raw.theme)) out.theme = raw.theme;
    return out;
  } catch (e) { console.error('[cobro] settings.json을 읽지 못해 무시한다', (e as Error).message); return {}; }
}
/** 부분 갱신. 임시 파일 → rename(Store와 같은 원자적 쓰기) */
export function writeUserSettings(file: string, patch: UserSettings): UserSettings {
  const next = { ...readUserSettings(file), ...patch };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  renameSync(tmp, file);
  return next;
}
