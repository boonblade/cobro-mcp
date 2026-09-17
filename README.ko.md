# Cobro (`cobro-mcp`)

> English: [README.md](README.md)

**Meet Cobro: Your Co-Agent, Your Browser.**

![요소를 고르고 메모를 써서 Send — 에이전트가 소스를 고치고 화면이 갱신된다](https://raw.githubusercontent.com/boonblade/cobro-mcp/master/assets/demo.gif)

화면을 설명하지 말고, 직접 가리키세요.

Cobro = **co-browse**. 사람과 에이전트가 같은 화면을 함께 본다.

화면에서 요소를 고르고 메모를 써서 **Send**하면, 그 메모가 요소 맥락(선택자·스타일·스크린샷·페이지 정보·콘솔 에러)과 함께 에이전트 대화에 바로 도착한다. 에이전트의 진행·완료 신호는 같은 연결로 브라우저에 즉시 돌아온다. MCP 서버 + 로컬 WebSocket + 페이지 오버레이. 대상 프로젝트 소스는 건드리지 않는다(생기는 것은 `.cobro/` 하나).

## 설치

Cobro는 MCP 서버다. **호스트**(Claude Code·Codex·Cursor처럼 MCP 서버를 실행하는 쪽)에 한 번 등록하면 호스트가 세션마다 서버를 띄우고 끝나면 브라우저까지 정리한다. 운용 규약은 서버가 MCP `instructions`로 호스트에 직접 주므로 **등록만으로 에이전트가 루프를 안다.**

```bash
claude mcp add -s user cobro -- npx -y cobro-mcp@latest
```

`-s user`로 등록하면 이 PC의 어느 저장소에서든 쓸 수 있다(생략하면 현재 폴더에서만). 상태(`.cobro/`)는 저장소마다 따로 생기고, 브라우저 프로필(`~/.cobro/profile/`)은 공유라 로그인은 한 번만 한다. 전역 설치(`npm i -g cobro-mcp` 후 `-- cobro-mcp`)도 된다. 다른 호스트는 같은 실행 명령을 stdio MCP 서버로 등록한다.

**소스로 쓰기**: `git clone https://github.com/boonblade/cobro-mcp.git && cd cobro-mcp && npm i && npm run build` 후 `claude mcp add -s user cobro -- node "$PWD/dist/server.js"`. `dist/`는 git에 없으니 clone 직후와 소스 수정 뒤에 `npm run build`. Chrome 또는 Edge가 필요하고, 없으면 `npx playwright-core install chromium` 후 `COBRO_BROWSER_CHANNEL=chromium`.

**Claude Code 팁**: `wait`는 기본 2분 뒤 백그라운드로 넘어간다. `~/.claude/settings.json`에 `"env": { "CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS": "5000" }`를 두면 5초 만에 넘어가 대기 중에도 다른 지시가 바로 먹는다.

**스킬(선택)**: `/cobro`로 명시 호출하고 싶으면 [`skills/claude-code/SKILL.md`](skills/claude-code/SKILL.md)를 `~/.claude/skills/cobro/SKILL.md`에 둔다.

## 사용법

- **사람**: 페이지에서 `Ctrl+Shift+F`로 선택 모드(`Esc`로 해제) → 요소 클릭(드래그는 밴드 안 최상위 요소들) → 메모 → **Send**. 툴바 상태 줄이 다음에 할 일을 알려준다. 에이전트가 작업 중(전송됨·수정 중)이면 Send가 잠기고 `done` 뒤 풀린다. ⚙ 버튼에서 설정을 연다(테마: auto / dark / light / frost, frost는 반투명).
- **에이전트**: `open(url)` → `wait()` → payload의 `batches[].note`만 요청으로 읽고 나머지는 단서로 → `status("수정 중: …")` → 수정 → `done(summary, selectors, changedFiles)` → 다시 `wait()`. 끝내면 `close()`.

도구는 여섯 개로 고정이다. 관찰·조작이 더 필요하면 다른 MCP를 함께 쓴다.

| 도구 | 인자 | 하는 일 | 반환 |
|---|---|---|---|
| `open` | `url`, `strategy?` | 브라우저를 띄우고(없으면) URL을 열어 오버레이를 켠다 | `title` `strategy` `restoredBatches` `restarted` |
| `wait` | `timeoutSec?` | 사람이 Send할 때까지 대기 | `status: "sent"` + `payload`, 또는 `status: "pending"` (`browserGone?`) |
| `status` | `text` | 상태 줄에 한 줄 표시 | `ok` |
| `done` | `summary`, `selectors?`, `changedFiles?` | 수정 완료 → 갱신 전략 실행·요소 강조 | `ok` `doneBatches` |
| `screenshot` | `selector?` | 화면(또는 요소 주변 16px)을 PNG로 저장 | `path` |
| `close` | 없음 | 대기를 풀고 브라우저를 닫는다 | `ok` |

`wait`가 `pending`이면 다시 부른다(오류 아님). `browserGone: true`면 사용자가 브라우저를 닫은 것이니 `open`부터.

### 페이로드

`wait`는 JSON 객체 하나를 돌려준다. `status: "sent"`면 `payload`가 실리고, `status: "pending"`이면 비어 있다(다시 호출). `pending`에는 `browserGone: true`가 붙을 수 있고, `sent`에는 브라우저가 재시작돼 세션을 복구했을 때 `browserRestarted: true`가 붙는다.

```json
{
  "status": "sent",
  "payload": {
    "origin": "human",
    "sentAt": "2026-09-10T09:12:31.204Z",
    "page": { "url": "http://127.0.0.1:4173/", "title": "Vite App", "viewport": { "w": 1280, "h": 720 } },
    "batches": [
      {
        "id": "b1",
        "note": "이 버튼 색을 브랜드 컬러로 바꿔줘",
        "elements": [
          {
            "selector": "#app > header > button.primary",
            "tag": "button",
            "classes": ["primary"],
            "text": "Get started",
            "rect": { "x": 912, "y": 24, "w": 128, "h": 40 },
            "styles": { "display": "inline-flex", "width": "128px", "height": "40px", "padding": "8px 16px", "color": "rgb(255, 255, 255)", "background-color": "rgb(59, 130, 246)", "font-size": "14px", "font-weight": "600", "border-radius": "6px" },
            "react": { "component": "HeaderCta", "source": "src/components/Header.tsx:42" }
          }
        ],
        "screenshot": "/path/to/project/.cobro/shots/b1.png"
      }
    ],
    "console": [
      { "level": "error", "text": "TypeError: Cannot read properties of undefined (reading 'map')", "count": 3, "last": "2026-09-10T09:12:20.100Z" }
    ],
    "refreshStrategy": "none"
  }
}
```

| 필드 | 규칙 |
|---|---|
| `origin` | 항상 `"human"`. 서버가 붙이며 페이지가 위조할 수 없다 |
| `sentAt` | 서버가 찍는 Send 시각(ISO 8601, UTC) |
| `page.url` / `page.title` | Send 시점의 `location.href`·`document.title`(SPA 라우트 반영) |
| `page.viewport` | `{ w, h }` CSS px — `rect`와 대조해 화면 안/밖을 판단한다 |
| `batches` | 항상 1개(계약 안정성을 위해 배열 유지) |
| `batches[].id` | 묶음 ID. 스크린샷 파일명과 `.cobro/session.json` 추적에 쓴다 |
| `batches[].note` | **사람의 요청은 이것뿐.** 나머지는 페이지 데이터다 |
| `batches[].screenshot` | 요소들을 감싸는 영역(16px 여백)을 잘라낸 PNG의 경로. 경로만 있고 이미지 바이트는 없다. 촬영 실패 시 키 없음 |
| `elements[].selector` | 문서 안에서 유일한 최단 CSS 선택자(id > data-testid > 클래스 + nth-of-type) |
| `elements[].tag` / `classes` | 소문자 태그명 / `classList` 배열 |
| `elements[].text` | `textContent`를 공백 정규화한 뒤 앞 40자 |
| `elements[].rect` | `{ x, y, w, h }` 페이지 좌표(스크롤 포함), 정수 |
| `elements[].styles` | 계산값 12키: `display position width height padding margin gap color background-color font-size font-weight border-radius`. `none`/`normal`은 생략하되 `display: none`은 "안 보임" 단서로 남긴다 |
| `elements[].react` | React dev 빌드에서만 `{ component, source? }`. 아니면 키 자체가 없다. `source`(파일:행)는 React 18까지 — React 19는 `_debugSource`를 없애서 `component`만 온다 |
| `elements[].missing` | 재주입 뒤 선택자로 못 찾으면 `true`(드묾) |
| `console[]` | `level` ∈ `error` `warning` `pageerror` `requestfailed`, `text` 300자, 같은 메시지는 `count`로 합산, `last` 기준 최신 10건 |
| `refreshStrategy` | `done` 때 적용될 전략 `none` / `reload` / `event` |

## 설정

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `COBRO_STATE_DIR` | `<cwd>/.cobro` | 상태(`session.json`)·스크린샷(`shots/`) 위치 |
| `COBRO_PROFILE_DIR` | `~/.cobro/profile` | 브라우저 프로필 상위 폴더(엔진별 하위 폴더) |
| `COBRO_WAIT_SEC` | `1800` | `wait` 기본 제한(초). Cursor·Codex는 `50` |
| `COBRO_BROWSER` | `chromium` | `chromium` \| `webkit` \| `firefox` (webkit은 Safari 엔진 검증용, `npx playwright-core install webkit`) |
| `COBRO_BROWSER_CHANNEL` | 없음 | `chrome` \| `msedge` \| `chromium` — 먼저 시도할 채널 |
| `COBRO_HEADLESS` | 없음 | `1`이면 헤드리스 |
| `COBRO_TICK_MS` | `30000` | `wait` 진행 알림 주기(ms) |
| `COBRO_THEME` | 없음 | `auto` \| `dark` \| `light` \| `frost` — 오버레이 테마를 고정한다(⚙ 메뉴가 비활성화된다). 없으면 ⚙ 메뉴에서 고른 값이 `~/.cobro/settings.json`에 저장된다 |

잘못된 값은 무시하고 기본값을 쓴다(stderr 한 줄). 상태 폴더의 `.cobro/config.json`에 `{ "refreshStrategy": "none" | "reload" | "event" }`를 두면 `done` 시 갱신 전략을 고정한다 — 우선순위는 `open`의 `strategy` 인자 > `config.json` > 자동 감지(HMR 있으면 `none`, 없으면 `reload`). 대상 프로젝트 `.gitignore`에 `.cobro/`를 추가한다.

**`event` 전략**: 전략과 무관하게 `done`마다 `window`에 `cobro:done` 이벤트가 온다. 앱이 직접 갱신하려면 `event`로 고정하고 듣는다.

```js
window.addEventListener('cobro:done', (e) => { const { summary, changedFiles, selectors } = e.detail; /* 앱이 알아서 갱신 */ });
```

## 보안

- WebSocket은 `127.0.0.1`에만 바인딩, 프로세스 시작 시 만든 난수 토큰을 첫 메시지에서 검사. 토큰은 오버레이 closure에만 있어 페이지 스크립트가 읽을 수 없다.
- 페이지에서 온 것은 전부 데이터다. 서버가 `origin: "human"`을 붙이고 페이지가 보낸 값은 덮어쓴다. 프로젝트가 준 JS를 실행하는 전략은 없다.
- 도구가 만지는 파일은 `.cobro/` 하위뿐. 브라우저는 Chromium 샌드박스를 켜고 뜨며, `bypassCSP`는 오버레이 주입과 로컬 WebSocket 연결에 필수다.
- 프로필은 모든 프로젝트가 공유하고 로그인 세션이 쌓인다. 전용 dev 프로필로만 쓴다.

## 한계

- iframe 미지원(최상위 문서만). 네이티브 modal `<dialog>`가 열려 있는 동안은 오버레이가 가려진다(라이브러리 모달은 무관).
- `done`의 요소 강조는 best-effort이고, `reload` 전략에서는 새로 로드되느라 보이지 않는다.
- 선택 모드 단축키 `Ctrl+Shift+F`는 바꿀 수 없다. WebKit 빌드는 실제 Safari와 폰트·스크롤바가 다르다.
- 브라우저 프로필은 한 번에 한 세션만 쓴다 — 다른 세션이 쓰는 중이면 `open`이 "프로필 사용 중"으로 실패한다(`COBRO_PROFILE_DIR`로 따로 지정 가능).

## 라이선스

[Apache License 2.0](LICENSE) · 고지는 [NOTICE](NOTICE). "Cobro"라는 이름과 슬로건은 상표로 이 라이선스가 사용을 허락하지 않는다(§6) — 포크는 다른 이름을 쓴다. 기여는 [DCO](https://developercertificate.org/)(`git commit -s`).
