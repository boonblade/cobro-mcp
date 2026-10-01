import { describe, it, expect } from 'vitest';
import { withLocalhostHint } from '../../src/browser/launcher.js';

const HINT = '— localhost may resolve to another process (IPv6 ::1); try 127.0.0.1 instead.';

describe('withLocalhostHint (R186)', () => {
  it('localhost + ERR_EMPTY_RESPONSE → 끝에 127.0.0.1 힌트', () => {
    const m = withLocalhostHint('http://localhost:3000/', 'page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:3000/');
    expect(m.endsWith(HINT)).toBe(true);
  });
  it('localhost + ERR_CONNECTION_REFUSED → 힌트', () => {
    expect(withLocalhostHint('http://localhost:3000/', 'net::ERR_CONNECTION_REFUSED')).toContain(HINT);
  });
  it('WebKit·Firefox 오류 문자열에도 힌트(연결 거부·빈 응답)', () => {
    for (const m of ['page.goto: Could not connect to server', 'page.goto: Server returned nothing (no headers, no data)', 'page.goto: NS_ERROR_CONNECTION_REFUSED']) {
      expect(withLocalhostHint('http://localhost:3000/', m)).toContain(HINT);
    }
  });
  it('127.0.0.1은 그대로', () => {
    expect(withLocalhostHint('http://127.0.0.1:3000/', 'net::ERR_CONNECTION_REFUSED')).not.toContain(HINT);
  });
  it('다른 오류(ERR_NAME_NOT_RESOLVED)는 그대로', () => {
    expect(withLocalhostHint('http://localhost:3000/', 'net::ERR_NAME_NOT_RESOLVED')).not.toContain(HINT);
  });
  it('url이 파싱되지 않으면 그대로', () => {
    expect(withLocalhostHint('not a url', 'net::ERR_CONNECTION_REFUSED')).toBe('net::ERR_CONNECTION_REFUSED');
  });
});
