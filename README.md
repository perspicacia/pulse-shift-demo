# PULSE SHIFT

**[게임 사이트 바로가기](https://perspicacia.github.io/pulse-shift-demo/) · [프로젝트 발표 자료](presentation/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%20%EB%B0%9C%ED%91%9C%20%EC%9E%90%EB%A3%8C.pdf)**

[▶ 레벨 2·6키 플레이 영상 보기 / 다운로드](https://github.com/perspicacia/pulse-shift-demo/releases/download/demo-astral-6k-2026-10-07/ASTRAL_VEIL_6KEY_LEVEL2_AUTOPLAY.mp4) — 실제 브라우저 화면과 음악을 녹화한 **롱노트 추가 전 자동 입력 시연**입니다.

노트가 판정선에 닿는 순간 해당 키를 눌러 음악을 연주하는 브라우저 리듬 게임입니다. 오리지널 음악과 LP 턴테이블 형태의 곡 선택 화면을 제공합니다.

## 주요 기능

- 오리지널 곡 **AFTERGLOW · TIDAL CIRCUIT · ASTRAL VEIL**.
- 모든 곡의 **4키 LEVEL 1·2·3**, **6키 실험은 AFTERGLOW LEVEL 1 / ASTRAL VEIL LEVEL 2·3** 지원.
- LP 곡 선택, 선택곡 자동 미리듣기, 원근형 레인과 타격 효과.
- 판정·콤보·점수·정확도 및 곡·키 개수·레벨별 최고 기록 저장.
- 노트 속도·싱크 보정, 음악·효과음 음량과 이펙트 설정.

## 실행과 조작

위 게임 사이트에서 바로 플레이할 수 있습니다. 로컬 실행은 **Node.js 22 이상**이 필요하며, 별도 패키지 설치는 필요하지 않습니다.

```sh
git clone https://github.com/perspicacia/pulse-shift-demo.git
cd pulse-shift-demo
npm run dev
```

Chrome에서 `http://localhost:4173`을 엽니다. 소리는 첫 클릭이나 키 입력 후 재생됩니다.

| 기능 | 조작 |
| --- | --- |
| 4키 / 6키 입력 | D·F·J·K / S·D·F·J·K·L |
| 곡 선택 / 시작 | ←·→ 또는 커버 클릭 / Enter 또는 시작 버튼 |
| 일시정지 / 재개 | Esc / Enter 또는 화면 버튼 |
| 터치 입력 | 화면 아래 레인 버튼 |

플레이 구간에서 유효한 노트가 없는 키를 새로 누르면 **EMPTY**가 표시되고 콤보가 끊깁니다. 점수·정확도는 노트 판정만으로 계산하며, 오입력이 있으면 **FULL COMBO**로 표시하지 않습니다. 첫 노트 판정 구간 전·채보 완료 후 입력과 키 유지에 따른 자동 반복은 제외합니다.

**ASTRAL VEIL LEVEL 2·6키**에는 롱노트 8개가 있습니다. 머리가 판정선에 닿을 때 눌러 끝까지 유지하며, 중간에 놓으면 MISS입니다. 홀드 중 일시정지했다면 해당 키를 다시 누른 채 재개하세요. [상세 판정·복귀 규칙과 검사](docs/HOLD_NOTES.md)

## 사용 기술

HTML · CSS · JavaScript · Canvas · Web Audio API · Web Workers — 로컬 서버는 Node.js.

## 프로젝트 구조

주요 파일과 폴더만 정리했습니다.

```text
pulse-shift-demo/       # 프로젝트 루트
├── index.html         # 게임 화면 진입점
├── styles.css         # 기본 화면 스타일
├── server.mjs         # 로컬 개발 서버
├── package.json       # 실행·검증 명령
├── src/               # 게임 로직
│   ├── app.js         # 화면 전환·키 입력
│   ├── game.js        # 채보·판정·점수
│   └── audio.js       # 음악·효과음·재생 시계
├── assets/            # 앨범 아트·배경·대기 음원
├── scripts/           # 음원 생성·브라우저 검증
├── tests/             # 게임 로직 단위 검사
├── docs/              # 상세 기능·구조 설명
├── presentation/      # 발표자료 PDF
└── demo-videos/       # 자동 입력 시연 영상
```

## 자세히 보기

[기능·구조 상세](docs/FEATURES.md) · [실행·검증·발표 안내](DEMO.md) · [변경 기록](CHANGELOG.md)

음악·효과음은 자체 합성 코드, 앨범 아트·로고는 SVG, 도시 배경은 ImageGen으로 제작했습니다. DJMAX와 공식 제휴는 없습니다.
