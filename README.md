# 오늘 15시간

하루 24시간을 고정된 총량으로 보고, 수면·준비·이동·활동을 하나씩 떼어내며 남은 시간을 체감하는 가족 테스트용 계획 앱입니다.

- 앱: https://tq6q6v5qpn-alt.github.io/today-15-hours/
- 배포: GitHub Pages, `main` 브랜치 루트
- 저장: 각 기기의 브라우저 `localStorage`
- 백업: 앱 오른쪽 위 `•••` → **전체 기록 백업**

## 구조

- `index.html`: 화면 구조
- `styles.css`: 모바일·접근성 스타일
- `app.js`: 브라우저 화면과 저장소 연결
- `core.js`: 플랫폼 독립 시간 계산·백업 검증
- `tests/`: 핵심 불변식 자동 테스트
- `DATA_CONTRACT.md`: 향후 iOS·Android 공통 데이터 규칙

```bash
npm test
```

현재 PWA는 iPhone Safari와 Android Chrome에서 사용할 수 있다. 장기적으로 iOS는 SwiftUI, Android는 Kotlin/Jetpack Compose로 구현하되 `DATA_CONTRACT.md`와 `core.js`의 테스트 결과를 공통 기준으로 삼는다.

## 개발 원칙

- 초 단위 통제, 점수, 연속 출석, 실패 표시를 만들지 않는다.
- 24시간은 늘 고정이며 모든 선택에는 실제 시간 비용이 있다.
- 활동만이 아니라 준비·이동·전환도 시간으로 기록한다.
- 계획과 실제 기록을 분리한다.
- 기록되지 않은 시간을 곧바로 낭비라고 판단하지 않는다.
- 달력의 빈 날짜는 실패가 아니라 기록하지 않은 날이다.
- 자동 감지는 확정이 아니라 사용자가 확인할 제안이어야 한다.

자세한 설계 맥락과 다음 단계는 [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)에 있습니다.
