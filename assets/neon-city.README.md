# 시작 화면 도시 배경

- 파일: `neon-city-v1.jpg` (1672 × 941, JPEG 품질 84)
- 제작일: 2026-10-07
- 제작 방식: Codex 내장 ImageGen으로 새로 생성한 배경. PNG 출력은 JPEG로 압축해 웹 자산으로 사용한다.
- 사용자 참고 이미지의 야간 도시·달빛·네온 분위기를 참고했다. 기존 게임의 스크린샷·간판·로고를 파일에 복사하지 않았다.
- 적용: `menu-background.css`에서 시작/곡 선택 화면에만 표시한다. 어두운 오버레이와 메뉴 패널은 CSS이며 원본 그림에 UI를 합성하지 않는다.
- 배경 자체는 정적이다. 플레이 중에는 숨기고 기존 앨범 커버 배경을 유지한다.

## 생성 프롬프트

```text
Use case: stylized-concept. Asset type: full-screen background artwork for the starting track-select menu of a cyber rhythm game. Create a new original cinematic night city, inspired by the user's reference mood: low-angle view between densely layered futuristic concrete and metal skyscrapers; blue-grey moonlit hazy sky with a small luminous full moon above the central skyline, teal/cyan illuminated windows and scattered warm amber lights; asymmetrical towers with antennas, elevated transit structure crossing the lower distance, small red neon light strips on a dark foreground canopy at the lower right. Dark, grounded and atmospheric, richly detailed realistic 3D game environment art, subtle film grain, restrained neon, deep charcoal shadows, no oversaturated pink. Wide 16:9 landscape composition. Buildings frame both sides, central 45 percent remains a lower-contrast open sky/distant-city region to sit behind an existing silver vinyl turntable UI. Keep the sky and city recognizable, not an abstract pattern; concentrate bright detail toward outer edges. No characters, no vehicles close to camera, no logos, no readable text or brand signs, no UI, no border, no watermark. Reference screenshot is mood inspiration only: create different buildings and a distinct city layout.
```
